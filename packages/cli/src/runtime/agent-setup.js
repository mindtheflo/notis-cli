import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTRUCTIONS_PATH = join(HERE, '..', '..', 'skills', 'notis-cli', 'AGENT_INSTRUCTIONS.md');
const HOOK_BUNDLE_PATH = join(HERE, '..', '..', 'dist', 'agent-hooks', 'notis-agent-hook.mjs');
const START_MARKER = '<!-- notis-cli:instructions:start -->';
const END_MARKER = '<!-- notis-cli:instructions:end -->';
const LEGACY_SENTINEL = 'Use the Notis CLI (`npx --package @notis_ai/cli@latest -- notis ...`)';
const MANAGED_HOOK_MARKER = '--notis-managed-agent-hook';
const LEGACY_MANAGED_HOOK_MARKER = 'NOTIS_MANAGED_AGENT_HOOK=1';

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
} = {}) {
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

function contextHandler(agentId, profileName, launcherPath, platform) {
  return {
    type: 'command',
    command: shellHookCommand(launcherPath, profileName, 'agent-context', null, platform),
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
) {
  const settings = readJsonObject(filePath);
  const hooks = settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks)
    ? { ...settings.hooks }
    : {};
  let removedManagedHook = false;
  for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop']) {
    const previousGroups = Array.isArray(hooks[event]) ? hooks[event] : [];
    const groups = removePriorNotisPromptHooks(previousGroups);
    if (JSON.stringify(groups) !== JSON.stringify(previousGroups)) removedManagedHook = true;
    if (enabled) {
      groups.push({ hooks: [event === 'Stop'
        ? captureHandler(agentId, profileName, launcherPath, platform)
        : contextHandler(agentId, profileName, launcherPath, platform)] });
    }
    if (groups.length) hooks[event] = groups;
    else delete hooks[event];
  }
  const next = { ...settings, hooks };
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  const existing = readText(filePath);
  if (!enabled && !removedManagedHook) return { path: filePath, status: 'unchanged' };
  if (existing === serialized) return { path: filePath, status: 'unchanged' };
  atomicWrite(filePath, serialized);
  return {
    path: filePath,
    status: enabled
      ? existsSync(filePath) && existing ? 'updated' : 'installed'
      : 'removed',
  };
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

export function shouldInstallLocalAgentSetup(env = process.env, home = homedir()) {
  if (env.NOTIS_JWT || env.NOTIS_AGENT === '1' || env.NOTIS_DELEGATED_CONTEXT === '1') return false;
  if (env.CONDUCTOR_IS_LOCAL === '0') return false;
  if (existsSync('/vercel/sandbox')) return false;
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
        result.memory_hook = upsertPromptHooks(
          paths.hooks,
          agentId,
          profileName,
          memoryHooks !== false,
          hookRuntime?.launcherPath,
          platform,
        );
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
      // A root containing only our three links is not evidence that the vendor
      // itself is installed; any other skill entry is a genuine user signal.
      return readdirSync(skillsRoot).some((name) => (
        !['notis-apps', 'notis-query', 'notis-cli'].includes(name)
      ));
    } catch {
      return false;
    }
  });
}

export function instructionTemplatePath() {
  return INSTRUCTIONS_PATH;
}
