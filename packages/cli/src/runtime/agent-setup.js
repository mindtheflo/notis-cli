import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE_SKILL_NAMES, RETIRED_BASE_SKILL_NAMES, isBaseSkillLink } from './base-skills.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTRUCTIONS_PATH = join(HERE, '..', '..', 'skills', 'notis-cli', 'AGENT_INSTRUCTIONS.md');
const HOOK_BUNDLE_PATH = join(HERE, '..', '..', 'dist', 'agent-hooks', 'notis-agent-hook.mjs');
const START_MARKER = '<!-- notis-cli:instructions:start -->';
const END_MARKER = '<!-- notis-cli:instructions:end -->';
const LEGACY_SENTINEL = 'Use the Notis CLI (`npx --package @notis_ai/cli@latest -- notis ...`)';
const MANAGED_HOOK_MARKER = '--notis-managed-agent-hook';
const LEGACY_MANAGED_HOOK_MARKER = 'NOTIS_MANAGED_AGENT_HOOK=1';
const CODEX_TRUST_START = '# notis-cli:hook-trust:start';
const CODEX_TRUST_END = '# notis-cli:hook-trust:end';
const CODEX_EVENT_LABELS = Object.freeze({
  SessionStart: 'session_start',
  UserPromptSubmit: 'user_prompt_submit',
  Stop: 'stop',
});
// Recall-only hooks inject memory and never capture turns, so they run only
// on these events.
export const RECALL_ONLY_HOOK_EVENTS = Object.freeze(['SessionStart', 'UserPromptSubmit']);

export const AGENT_IDS = Object.freeze(['codex', 'claude-code']);

function atomicWrite(filePath, contents, mode = 0o600) {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.notis-${process.pid}-${Date.now()}.tmp`;
  writeFileSync(temporaryPath, contents, { mode });
  renameSync(temporaryPath, filePath);
}

function readText(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
}

function activeCodexInstructionsPath(home) {
  const overridePath = join(home, '.codex', 'AGENTS.override.md');
  if (existsSync(overridePath) && readText(overridePath).trim()) {
    return overridePath;
  }
  return join(home, '.codex', 'AGENTS.md');
}

function upsertInstructionBlock(filePath, block) {
  const existing = readText(filePath);
  const managedBlockPattern = new RegExp(
    `${START_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    'g',
  );
  const managedBlocks = [...existing.matchAll(managedBlockPattern)];
  let next;
  let status;

  if (managedBlocks.length) {
    let replaced = false;
    next = existing.replace(managedBlockPattern, () => {
      if (replaced) return '';
      replaced = true;
      return block;
    });
    status = next === existing ? 'unchanged' : 'updated';
  } else if (existing.includes(LEGACY_SENTINEL)) {
    // An unmarked block belongs to the user or another installer. Do not risk
    // rewriting adjacent personal instructions merely to take ownership of it.
    return { path: filePath, status: 'already_present_unmanaged' };
  } else {
    const prefix = existing.trimEnd();
    next = `${prefix ? `${prefix}\n\n` : ''}${block.trim()}\n`;
    status = 'installed';
  }

  if (status !== 'unchanged') {
    atomicWrite(filePath, next);
  }
  return { path: filePath, status };
}

function readJsonObject(filePath) {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('root value must be an object');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Refusing to modify invalid JSON at ${filePath}: ${error.message}`);
  }
}

function isManagedNotisHookCommand(command) {
  if (typeof command !== 'string') return false;
  if (
    command.includes(MANAGED_HOOK_MARKER)
    || command.includes(LEGACY_MANAGED_HOOK_MARKER)
  ) return true;
  if (
    command.includes('.notis/agent-hooks/bin/notis-agent-hook')
    && /\sagent-(?:context|capture)\b/.test(command)
  ) return true;
  // Supported legacy installers used either this package's bin/notis.js path
  // or the exact public npx package. Do not claim arbitrary commands merely
  // because they happen to use the same subcommand words.
  return (
    /(?:^|\s)(?:'[^']*|"[^"]*"|\S*)bin\/notis\.js(?:'|")?\s[^\n]*\sagent-(?:context|capture)\b/.test(command)
    || /@notis_ai\/cli@[^\s]+\s+--\s+notis\s[^\n]*\sagent-(?:context|capture)\b/.test(command)
    || /^\s*notis\s+(?:--[^\s]+\s+)*agent-(?:context|capture)\b/.test(command)
  );
}

function objectHasManagedNotisHook(value) {
  if (Array.isArray(value)) return value.some(objectHasManagedNotisHook);
  if (!value || typeof value !== 'object') return false;
  if (isManagedNotisHookCommand(value.command)) return true;
  return Object.values(value).some(objectHasManagedNotisHook);
}

function fileHasManagedNotisHook(filePath) {
  try {
    return objectHasManagedNotisHook(readJsonObject(filePath));
  } catch {
    return false;
  }
}

function removePriorNotisPromptHooks(groups) {
  if (!Array.isArray(groups)) return [];
  const kept = [];
  for (const group of groups) {
    if (!group || typeof group !== 'object' || !Array.isArray(group.hooks)) {
      kept.push(group);
      continue;
    }
    const hooks = group.hooks.filter((hook) => !isManagedNotisHookCommand(hook?.command));
    if (hooks.length) kept.push({ ...group, hooks });
  }
  return kept;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function installManagedHookRuntime({
  home = homedir(),
  bundlePath = HOOK_BUNDLE_PATH,
  nodePath = process.execPath,
  platform = process.platform,
  envFile = null,
} = {}) {
  if (envFile && (platform === 'win32' || !isAbsolute(envFile))) {
    throw new Error('A session environment file must be an absolute POSIX path');
  }
  const bundle = readFileSync(bundlePath);
  const digest = createHash('sha256').update(bundle).digest('hex');
  const runtimePath = join(
    home,
    '.notis',
    'agent-hooks',
    'runtime',
    digest,
    'notis-agent-hook.mjs',
  );
  const existingDigest = existsSync(runtimePath)
    ? createHash('sha256').update(readFileSync(runtimePath)).digest('hex')
    : null;
  if (existingDigest !== digest) atomicWrite(runtimePath, bundle, 0o500);
  chmodSync(runtimePath, 0o500);

  const launcherPath = join(
    home,
    '.notis',
    'agent-hooks',
    'bin',
    platform === 'win32' ? 'notis-agent-hook.cmd' : 'notis-agent-hook',
  );
  const launcher = platform === 'win32'
    ? [
        '@echo off',
        `if not exist "${nodePath}" (`,
        '  >&2 echo Notis memory hook runtime needs repair; run notis agents install again.',
        '  exit /b 1',
        ')',
        `"${nodePath}" "${runtimePath}" %*`,
        '',
      ].join('\r\n')
    : [
        '#!/bin/sh',
        // A hosted session's sign-in is rotated into this file while the
        // coding agent keeps running, so each hook reads the current one.
        ...(envFile ? [`if [ -r ${shellQuote(envFile)} ]; then . ${shellQuote(envFile)}; fi`] : []),
        `if [ -x ${shellQuote(nodePath)} ]; then`,
        `  exec ${shellQuote(nodePath)} ${shellQuote(runtimePath)} "$@"`,
        'fi',
        `echo 'Notis memory hook runtime needs repair; run notis agents install again.' >&2`,
        'exit 1',
        '',
      ].join('\n');
  if (readText(launcherPath) !== launcher) {
    // Windows maps the owner write bit to the read-only file attribute. A
    // launcher installed by an older CLI is deliberately read-only, so make
    // our owned file replaceable before the atomic rename used for upgrades.
    if (platform === 'win32' && existsSync(launcherPath)) {
      chmodSync(launcherPath, 0o700);
    }
    atomicWrite(launcherPath, launcher, 0o500);
  }
  chmodSync(launcherPath, 0o500);
  return { launcherPath, runtimePath, digest };
}

function shellHookCommand(launcherPath, profileName, command, agentId = null, platform = process.platform) {
  // Stored profile names follow a shell-safe grammar enforced by the CLI.
  const agentFlag = agentId ? ` --agent ${agentId}` : '';
  const quotedLauncher = platform === 'win32'
    ? `"${launcherPath}"`
    : shellQuote(launcherPath);
  return `${quotedLauncher} ${MANAGED_HOOK_MARKER} --profile ${profileName} --timeout-ms 30000 ${command}${agentFlag}`;
}

function recallOnlyHookCommand(launcherPath, stateDir) {
  // No --profile: the hook signs in with the session's injected credential.
  return `${shellQuote(launcherPath)} ${MANAGED_HOOK_MARKER} --timeout-ms 30000 agent-context --recall-only --state-dir ${shellQuote(stateDir)}`;
}

function contextHandler(agentId, profileName, launcherPath, platform, recallOnly = null) {
  return {
    type: 'command',
    command: recallOnly
      ? recallOnlyHookCommand(launcherPath, recallOnly.stateDir)
      : shellHookCommand(launcherPath, profileName, 'agent-context', null, platform),
    timeout: 30,
    statusMessage: 'Loading relevant Notis memory',
    ...(agentId === 'codex' ? { additionalContextLimit: 2500 } : {}),
  };
}

function captureHandler(agentId, profileName, launcherPath, platform) {
  return {
    type: 'command',
    command: shellHookCommand(launcherPath, profileName, 'agent-capture', agentId, platform),
    timeout: 30,
    statusMessage: 'Saving durable Notis context',
  };
}

function upsertPromptHooks(
  filePath,
  agentId,
  profileName,
  enabled,
  launcherPath = '',
  platform = process.platform,
  recallOnly = null,
) {
  const settings = readJsonObject(filePath);
  const hooks = settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks)
    ? { ...settings.hooks }
    : {};
  let removedManagedHook = false;
  const managed = [];
  for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop']) {
    const previousGroups = Array.isArray(hooks[event]) ? hooks[event] : [];
    const groups = removePriorNotisPromptHooks(previousGroups);
    if (JSON.stringify(groups) !== JSON.stringify(previousGroups)) removedManagedHook = true;
    if (enabled && (!recallOnly || RECALL_ONLY_HOOK_EVENTS.includes(event))) {
      const handler = event === 'Stop'
        ? captureHandler(agentId, profileName, launcherPath, platform)
        : contextHandler(agentId, profileName, launcherPath, platform, recallOnly);
      groups.push({ hooks: [handler] });
      managed.push({ event, groupIndex: groups.length - 1, handlerIndex: 0, handler });
    }
    if (groups.length) hooks[event] = groups;
    else delete hooks[event];
  }
  const next = { ...settings, hooks };
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  const existing = readText(filePath);
  if (!enabled && !removedManagedHook) return { path: filePath, status: 'unchanged', managed };
  if (existing === serialized) return { path: filePath, status: 'unchanged', managed };
  atomicWrite(filePath, serialized);
  return {
    path: filePath,
    status: enabled
      ? existsSync(filePath) && existing ? 'updated' : 'installed'
      : 'removed',
    managed,
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

/**
 * The hash Codex records when a user trusts one hook in `/hooks`: SHA-256 of
 * the event's normalized handler group, serialized with sorted keys. Matches
 * the pinned Codex 0.160 app-server `hooks/list` currentHash for the handler
 * shape this installer writes (no matcher; additionalContextLimit not hashed).
 */
export function codexHookTrustHash(event, handler) {
  const label = CODEX_EVENT_LABELS[event];
  if (!label) throw new Error(`Unsupported Codex hook event: ${event}`);
  const normalized = {
    type: 'command',
    command: handler.command,
    timeout: handler.timeout,
    async: false,
    ...(handler.statusMessage ? { statusMessage: handler.statusMessage } : {}),
  };
  const digest = createHash('sha256')
    .update(JSON.stringify(canonicalJson({ event_name: label, hooks: [normalized] })))
    .digest('hex');
  return `sha256:${digest}`;
}

/** The `hooks.state` key Codex uses for one handler in a hooks.json file. */
export function codexHookTrustKey(hooksPath, event, groupIndex, handlerIndex = 0) {
  return `${hooksPath}:${CODEX_EVENT_LABELS[event]}:${groupIndex}:${handlerIndex}`;
}

function tomlBasicString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Record trust for the managed Codex hooks in config.toml, so a headless Codex
 * runs them without the interactive `/hooks` review. Only the block between
 * the managed markers is rewritten; a key the user already trusts elsewhere is
 * left alone, because a second TOML table with the same name breaks parsing.
 */
export function upsertCodexHookTrust(configPath, hooksPath, managed) {
  const existing = readText(configPath);
  const blockPattern = new RegExp(
    `\\n?${CODEX_TRUST_START}[\\s\\S]*?${CODEX_TRUST_END}\\n?`,
    'g',
  );
  const outside = existing.replace(blockPattern, '\n');
  const resolvedHooksPath = realpathSync(hooksPath);
  const entries = [];
  const skipped = [];
  for (const item of managed) {
    const key = codexHookTrustKey(resolvedHooksPath, item.event, item.groupIndex, item.handlerIndex);
    const header = `[hooks.state.${tomlBasicString(key)}]`;
    if (outside.includes(header)) {
      skipped.push(key);
      continue;
    }
    entries.push(`${header}\ntrusted_hash = ${tomlBasicString(codexHookTrustHash(item.event, item.handler))}`);
  }
  const prefix = outside.replace(/\n+$/, '');
  const block = entries.length
    ? `${CODEX_TRUST_START}\n${entries.join('\n\n')}\n${CODEX_TRUST_END}\n`
    : '';
  const next = prefix && block ? `${prefix}\n\n${block}` : prefix ? `${prefix}\n` : block;
  if (next === existing) return { path: configPath, status: 'unchanged', skipped };
  atomicWrite(configPath, next);
  return { path: configPath, status: existing ? 'updated' : 'installed', skipped };
}

function agentPaths(agentId, home) {
  if (agentId === 'codex') {
    return {
      root: join(home, '.codex'),
      instructions: activeCodexInstructionsPath(home),
      hooks: join(home, '.codex', 'hooks.json'),
    };
  }
  if (agentId === 'claude-code') {
    return {
      root: join(home, '.claude'),
      instructions: join(home, '.claude', 'CLAUDE.md'),
      hooks: join(home, '.claude', 'settings.json'),
    };
  }
  throw new Error(`Unsupported agent: ${agentId}`);
}

// The cloud computer's root. Present only inside the user's Vercel sandbox.
const CLOUD_COMPUTER_ROOT = '/vercel/sandbox';

/**
 * Whether this process runs on the Notis cloud computer. A test run pins the
 * answer with NOTIS_TEST_CLOUD_COMPUTER=0 or 1, so a suite run on the cloud
 * computer reads the same as one run anywhere else.
 */
export function onCloudComputer(env = process.env) {
  const pinned = env.NODE_ENV === 'test' ? env.NOTIS_TEST_CLOUD_COMPUTER : undefined;
  if (pinned === '0' || pinned === '1') return pinned === '1';
  return existsSync(CLOUD_COMPUTER_ROOT);
}

export function shouldInstallLocalAgentSetup(
  env = process.env,
  home = homedir(),
  { cloudComputer = () => onCloudComputer(env) } = {},
) {
  if (env.NOTIS_JWT || env.NOTIS_AGENT === '1' || env.NOTIS_DELEGATED_CONTEXT === '1') return false;
  if (env.CONDUCTOR_IS_LOCAL === '0') return false;
  if (cloudComputer()) return false;
  return Boolean(home);
}

export function installAgentSetup({
  profileName,
  agents = AGENT_IDS,
  memoryHooks = true,
  onlyExisting = false,
  detectedAgents = null,
  home = homedir(),
  platform = process.platform,
} = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(profileName || ''))) {
    throw new Error('A valid authenticated Notis profile is required for agent setup');
  }
  const instructions = readFileSync(INSTRUCTIONS_PATH, 'utf-8').trim();
  const results = [];
  const shouldRepairManagedHooks = memoryHooks === true || (
    memoryHooks === null
    && agents.some((agentId) => fileHasManagedNotisHook(agentPaths(agentId, home).hooks))
  );
  const hookRuntime = shouldRepairManagedHooks
    ? installManagedHookRuntime({ home, platform })
    : null;

  for (const agentId of agents) {
    const paths = agentPaths(agentId, home);
    const detected = Array.isArray(detectedAgents)
      ? detectedAgents.includes(agentId)
      : existsSync(paths.root);
    if (onlyExisting && !detected) {
      results.push({ agent: agentId, status: 'not_detected' });
      continue;
    }
    const result = {
      agent: agentId,
      instructions: upsertInstructionBlock(paths.instructions, instructions),
      memory_hook: null,
    };
    if (memoryHooks === null && !fileHasManagedNotisHook(paths.hooks)) {
      result.memory_hook = { path: paths.hooks, status: 'preserved' };
    } else {
      try {
        const { managed: _managed, ...memoryHook } = upsertPromptHooks(
          paths.hooks,
          agentId,
          profileName,
          memoryHooks !== false,
          hookRuntime?.launcherPath,
          platform,
        );
        result.memory_hook = memoryHook;
      } catch (error) {
        result.memory_hook = {
          path: paths.hooks,
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
    results.push(result);
  }
  return results;
}

/**
 * Recall-only memory hooks for a hosted coding agent (the Cloud Computer's
 * native Codex and Claude Code). They go into the agent's own config folder
 * (CODEX_HOME or CLAUDE_CONFIG_DIR), sign in with the session's injected
 * credential, run only on SessionStart and UserPromptSubmit, and never capture
 * a turn. No instruction file is written: the hosted contract already carries
 * the Notis guidance. Codex trust is recorded so no `/hooks` review is needed.
 */
export function installRecallOnlyAgentHooks({
  agentId,
  configDir,
  envFile = null,
  bundlePath = HOOK_BUNDLE_PATH,
  nodePath = process.execPath,
  platform = process.platform,
} = {}) {
  if (!AGENT_IDS.includes(agentId)) throw new Error(`Unsupported agent: ${agentId}`);
  if (platform === 'win32') throw new Error('Recall-only hooks are only supported on POSIX hosts');
  if (typeof configDir !== 'string' || !isAbsolute(configDir)) {
    throw new Error('Recall-only hooks need the agent config folder as an absolute path');
  }
  const runtime = installManagedHookRuntime({
    home: configDir, bundlePath, nodePath, platform, envFile,
  });
  const hooksPath = join(configDir, agentId === 'codex' ? 'hooks.json' : 'settings.json');
  const result = { agent: agentId, mode: 'recall_only', instructions: null, memory_hook: null };
  try {
    const { managed, ...memoryHook } = upsertPromptHooks(
      hooksPath,
      agentId,
      null,
      true,
      runtime.launcherPath,
      platform,
      { stateDir: configDir },
    );
    result.memory_hook = memoryHook;
    if (agentId === 'codex') {
      result.hook_trust = upsertCodexHookTrust(join(configDir, 'config.toml'), hooksPath, managed);
    }
  } catch (error) {
    result.memory_hook = {
      path: hooksPath,
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return result;
}

export function detectedAgentIds(home = homedir()) {
  return AGENT_IDS.filter((agentId) => {
    const root = agentPaths(agentId, home).root;
    if (!existsSync(root)) return false;
    try {
      const entries = readdirSync(root, { withFileTypes: true });
      if (entries.some((entry) => entry.name !== 'skills')) return true;
      const skillsRoot = join(root, 'skills');
      if (!existsSync(skillsRoot)) return false;
      // Base reconciliation intentionally creates every supported vendor root.
      // A root containing only our base links, or the links an earlier CLI
      // made under retired names, is not evidence that the vendor itself is
      // installed; any other skill entry is a genuine user signal.
      return readdirSync(skillsRoot).some((name) => !(
        BASE_SKILL_NAMES.includes(name)
        || (RETIRED_BASE_SKILL_NAMES.includes(name) && isBaseSkillLink(join(skillsRoot, name), name, { home }))
      ));
    } catch {
      return false;
    }
  });
}

export function instructionTemplatePath() {
  return INSTRUCTIONS_PATH;
}
