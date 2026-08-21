import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, Option } from 'commander';
import { COMMAND_SPECS, GROUP_SUMMARIES } from './command-specs/index.js';
import { OutputManager } from './runtime/output.js';
import { asCliError } from './runtime/errors.js';
import { reportCliCommand } from './runtime/telemetry.js';
import { reconcileBaseSkillsBestEffort } from './runtime/base-skills.js';
import { detectedAgentIds } from './runtime/agent-setup.js';
import { withSkillSyncLock } from './runtime/sync-skills.js';
import {
  CHANNEL_SWITCH_ENV,
  resolveChannelSwitch,
} from './runtime/channel.js';
import {
  DEFAULT_PROFILE,
  getProfile,
  loadConfig,
  resolveOutputMode,
  resolveRuntimeProfile,
  resolveWorktreeRuntime,
  workspacePath,
} from './runtime/profiles.js';

// Read the version from package.json: the publish pipeline bumps the manifest
// (scripts/release-utils.js applyVersion), so a hardcoded string here goes
// stale on every release.
function readCliVersion() {
  try {
    const manifestPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const version = JSON.parse(readFileSync(manifestPath, 'utf-8')).version;
    if (typeof version === 'string' && version.trim()) {
      return version.trim();
    }
  } catch {
    // Fall through to the placeholder below.
  }
  return '0.0.0';
}

const CLI_VERSION = readCliVersion();

function buildHelpFooter(spec) {
  const lines = [
    '',
    `When to use: ${spec.when_to_use}`,
    '',
    'Examples:',
    ...(spec.examples || []).map((example) => `  ${example}`),
  ];
  if (spec.related_commands?.length) {
    lines.push('', 'Related commands:', ...spec.related_commands.map((command) => `  ${command}`));
  }
  return lines.join('\n');
}
function mapArgs(spec, rawArgs) {
  const mapped = {};
  const argumentDefs = spec.args_schema?.arguments || [];
  for (const [index, argument] of argumentDefs.entries()) {
    const normalizedToken = (argument.key || argument.token.replace(/[<>\[\]]/g, '').replace('...', ''))
      .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    mapped[normalizedToken] = rawArgs[index];
  }
  return mapped;
}

function ensureParentCommand(program, parentMap, parentPath) {
  const key = parentPath.join(' ');
  if (parentMap.has(key)) {
    return parentMap.get(key);
  }

  const parentCommand = ensureParentCommand(program, parentMap, parentPath.slice(0, -1));
  const segment = parentPath[parentPath.length - 1];
  const command = parentCommand.command(segment).description(GROUP_SUMMARIES[segment] || '');
  parentMap.set(key, command);
  return command;
}

function buildRuntime(globalOptions, spec) {
  const localBackendTypes = new Set(['local', 'local_config', 'local_registry']);
  const commandName = spec.command_path.join(' ');
  const liveAppHarness = (
    commandName === 'apps verify' || commandName === 'apps screenshot'
  ) && globalOptions.mode === 'live';
  const runtime = resolveRuntimeProfile(globalOptions, {
    requireAuth: spec.require_auth !== false,
    allowUnknownProfile: spec.allow_unknown_profile === true,
    allowUnavailableWorktree:
      localBackendTypes.has(spec.backend_call?.type) && !liveAppHarness,
  });
  // A stopped local-only worktree may keep executing commands whose backend is
  // entirely local, but it must not carry a shared live credential into those
  // handlers or their post-command telemetry. Naming --profile explicitly is
  // the deliberate escape hatch from the worktree boundary.
  if (runtime.worktreeRuntimeUnavailable && runtime.profileSource !== 'explicit') {
    runtime.jwt = undefined;
    runtime.credentialKind = undefined;
    runtime.credentialSource = undefined;
    runtime.oauthAccessToken = undefined;
    runtime.oauthRefreshToken = undefined;
  }
  return {
    ...runtime,
    cliVersion: CLI_VERSION,
    color: globalOptions.color !== false,
    quiet: Boolean(globalOptions.quiet),
    verbose: Boolean(globalOptions.verbose),
    workspacePath,
  };
}

function buildErrorRuntime(globalOptions) {
  try {
    return {
      ...resolveRuntimeProfile(globalOptions, {
        requireAuth: false,
        includeDebugEntitlementOverride: false,
        allowUnknownProfile: true,
      }),
      cliVersion: CLI_VERSION,
      color: globalOptions.color !== false,
      quiet: Boolean(globalOptions.quiet),
      verbose: Boolean(globalOptions.verbose),
      workspacePath,
    };
  } catch {
    return {
      profileName: globalOptions.profile || DEFAULT_PROFILE,
      apiBase: null,
      outputMode: resolveOutputMode(globalOptions),
      cliVersion: CLI_VERSION,
      color: globalOptions.color !== false,
      quiet: Boolean(globalOptions.quiet),
      verbose: Boolean(globalOptions.verbose),
      workspacePath,
    };
  }
}

function attachSpec(program, parentMap, spec, specs, launchContext = {}) {
  const parent = ensureParentCommand(program, parentMap, spec.command_path.slice(0, -1));
  const leaf = spec.command_path[spec.command_path.length - 1];
  const command = parent.command(leaf, spec.hidden ? { hidden: true } : undefined).description(spec.summary);
  command.addHelpText('after', buildHelpFooter(spec));

  for (const argument of spec.args_schema?.arguments || []) {
    command.argument(argument.token, argument.description);
  }

  for (const option of spec.args_schema?.options || []) {
    if (option.collect) {
      command.option(
        option.flags,
        option.description,
        (value, previous) => [...(previous || []), value],
        [],
      );
    } else {
      command.option(option.flags, option.description);
    }
  }

  command.action(async (...raw) => {
    const startedAt = Date.now();
    const commanderCommand = raw[raw.length - 1];
    const argumentValues = raw.slice(0, -1);
    const globalOptions = commanderCommand.optsWithGlobals();
    try {
      const runtime = buildRuntime(globalOptions, spec);
      const output = new OutputManager(runtime);
      const args = mapArgs(spec, argumentValues);

      if (spec.deprecated_alias_for && runtime.outputMode === 'table') {
        output.writeWarning(`Warning: Command "${spec.command_path.join(' ')}" is deprecated. Use "${spec.deprecated_alias_for}" instead.`);
      }

      const exitCode = await spec.handler({
        spec,
        registrySpecs: specs,
        args,
        options: commanderCommand.opts(),
        globalOptions,
        runtime,
        output,
        ...launchContext,
      });
      process.exitCode = typeof exitCode === 'number' ? exitCode : 0;
      await reportCliCommand({
        spec,
        runtime,
        result: process.exitCode === 0 ? 'success' : 'failed',
        durationMs: Date.now() - startedAt,
        error: process.exitCode === 0 ? null : { exitCode: process.exitCode },
      });
    } catch (error) {
      const runtime = buildErrorRuntime(globalOptions);
      const output = new OutputManager(runtime);
      const cliError = asCliError(error);
      await reportCliCommand({
        spec,
        runtime,
        result: 'failed',
        durationMs: Date.now() - startedAt,
        error: cliError,
      });
      process.exitCode = output.emitError({
        command: spec.command_path.join(' '),
        error: cliError,
      });
    }
  });
}

export function createProgram(launchContext = {}) {
  const program = new Command();

  program
    .name('notis')
    .description('Agent-first Notis CLI for apps and generic tool execution')
    .version(CLI_VERSION)
    .showHelpAfterError()
    .option('--json', 'Shortcut for --output json')
    .option('--output <table|json|yaml|ndjson>', 'Output mode override')
    .option('--non-interactive', 'Disable all interactive prompts')
    .option('--quiet', 'Suppress non-essential human output')
    .option('--verbose', 'Show extra human-readable diagnostics')
    .option('--no-color', 'Disable ANSI color output')
    // No default value: commander cannot tell a default apart from an explicit
    // flag, and a defaulted "default" here silently overrode every
    // `notis profile use`, pinning all commands to the default profile.
    .option('--profile <name>', 'CLI profile to run as (defaults to the active profile)')
    .option('--api-base <url>', 'Override the API base URL for this invocation')
    .option('--timeout-ms <n>', 'HTTP timeout in milliseconds')
    .option('--idempotency-key <key>', 'Override the generated idempotency key for mutating commands')
    .addOption(new Option('--notis-managed-agent-hook').hideHelp());

  const parentMap = new Map([['', program]]);
  for (const spec of COMMAND_SPECS) {
    attachSpec(program, parentMap, spec, COMMAND_SPECS, launchContext);
  }

  return program;
}

/**
 * Read the two global flags that decide which build should serve this run.
 *
 * Commander cannot help here: the decision has to be made before the program
 * parses, because the answer may be to hand the whole invocation to a
 * different process. Only `--profile` and `--api-base` matter, and both are
 * plain `--flag value` pairs.
 */
export function readChannelRelevantFlags(args = []) {
  const flags = {};
  for (const [index, token] of args.entries()) {
    for (const [flag, key] of [['--profile', 'profile'], ['--api-base', 'apiBase']]) {
      if (token === flag) flags[key] = args[index + 1];
      else if (token.startsWith(`${flag}=`)) flags[key] = token.slice(flag.length + 1);
    }
  }
  return flags;
}

export function channelProfileForArgs(
  args = [],
  env = process.env,
  { config: suppliedConfig, worktreeRuntime: suppliedWorktreeRuntime } = {},
) {
  // An explicit endpoint overrides the stored profile for this run, so it also
  // decides the build: `--api-base https://api-beta.notis.ai` on a production
  // profile is a deliberate one-off beta call.
  const { profile: profileName, apiBase } = readChannelRelevantFlags(args);
  if (apiBase) {
    return { api_base: apiBase };
  }
  if (env.NOTIS_API_BASE) {
    return { api_base: env.NOTIS_API_BASE };
  }
  const config = suppliedConfig || loadConfig();
  const explicitProfile = profileName || env.NOTIS_PROFILE;
  if (explicitProfile) {
    return getProfile(config, explicitProfile);
  }
  const resolvedWorktree = suppliedWorktreeRuntime === undefined
    ? resolveWorktreeRuntime()
    : suppliedWorktreeRuntime;
  // A stopped local-only worktree must reach the normal routing error on the
  // current build. Switching based on an unrelated shared profile would escape
  // the worktree boundary before that fail-closed check runs.
  if (resolvedWorktree?.unavailable) {
    return {};
  }
  if (resolvedWorktree?.profile) {
    return resolvedWorktree;
  }
  // NOTIS_JWT replaces the credential, not the route. Unless NOTIS_API_BASE
  // was explicit above, the selected/current profile still owns the channel.
  return getProfile(config, config.current_profile || DEFAULT_PROFILE);
}

function interruptedExitCode(signal) {
  if (signal === 'SIGINT') return 130;
  if (signal === 'SIGTERM') return 143;
  return 1;
}

export function executeChannelSwitch(
  decision,
  args,
  env,
  { spawn = spawnSync } = {},
) {
  const childEnv = { ...env, [CHANNEL_SWITCH_ENV]: '1' };
  // First make npm resolve and boot the target package without executing the
  // requested command. That distinguishes an unavailable tag/network from a
  // legitimate non-zero exit of the handed-off CLI, which must be propagated
  // rather than retried locally after a possible mutation.
  const probe = spawn(decision.command, [...decision.args, '--version'], {
    stdio: 'ignore',
    env: childEnv,
  });
  if (probe.signal) {
    return {
      ...decision,
      exitCode: interruptedExitCode(probe.signal),
      reason: 'switch_interrupted',
    };
  }
  if (probe.error || probe.status !== 0) {
    return { ...decision, switch: false, reason: 'switch_unavailable' };
  }

  const result = spawn(decision.command, [...decision.args, ...args], {
    stdio: 'inherit',
    env: childEnv,
  });
  if (result.signal) {
    return {
      ...decision,
      exitCode: interruptedExitCode(result.signal),
      reason: 'switch_interrupted',
    };
  }
  if (result.error || typeof result.status !== 'number') {
    return { ...decision, switch: false, reason: 'switch_failed' };
  }
  return { ...decision, exitCode: result.status };
}

/**
 * Hand this invocation to the published build the profile is pinned to.
 *
 * Returns the decision rather than exiting so tests can assert on it. Any
 * failure to reach the other build is non-fatal: running the wrong channel is
 * a much smaller problem than refusing to run at all.
 */
export function switchChannelIfNeeded(
  argv = process.argv,
  env = process.env,
  { spawn = spawnSync, platform = process.platform, moduleDirectory } = {},
) {
  const args = argv.slice(2);
  let profile;
  try {
    profile = channelProfileForArgs(args, env);
  } catch {
    return { switch: false, reason: 'profile_unreadable' };
  }
  const decision = resolveChannelSwitch({
    runningVersion: CLI_VERSION,
    profile,
    moduleDirectory: moduleDirectory || dirname(fileURLToPath(import.meta.url)),
    env,
    platform,
  });
  if (!decision.switch) {
    return decision;
  }

  const result = executeChannelSwitch(decision, args, env, { spawn });
  if (!result.switch) {
    process.stderr.write(
      `Notis CLI could not start the ${decision.targetChannel} build for this profile; `
      + `continuing on ${decision.runningChannel}.\n`,
    );
  }
  return result;
}

export function isSkillsSyncInvocation(args) {
  return args.some((value, index) => value === 'skills' && args[index + 1] === 'sync');
}

export async function run(argv = process.argv) {
  const switched = switchChannelIfNeeded(argv);
  if (switched.switch) {
    process.exitCode = switched.exitCode;
    return;
  }
  const preexistingAgentIds = detectedAgentIds();
  // Every actual CLI launch repairs the three system skills before doing any
  // command work, including before an authenticated command can fail. Capture
  // vendor presence first because reconciliation creates their skill roots.
  const basePreflightResult = await withSkillSyncLock(
    async () => reconcileBaseSkillsBestEffort(),
  ).catch(() => undefined);
  const program = createProgram({ preexistingAgentIds, basePreflightResult });
  await program.parseAsync(argv);
}
