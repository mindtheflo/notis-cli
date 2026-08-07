import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { COMMAND_SPECS, GROUP_SUMMARIES } from './command-specs/index.js';
import { OutputManager } from './runtime/output.js';
import { asCliError } from './runtime/errors.js';
import { reportCliCommand } from './runtime/telemetry.js';
import {
  DEFAULT_PROFILE,
  resolveOutputMode,
  resolveRuntimeProfile,
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
  const runtime = resolveRuntimeProfile(globalOptions, { requireAuth: spec.require_auth !== false });
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

function attachSpec(program, parentMap, spec, specs) {
  const parent = ensureParentCommand(program, parentMap, spec.command_path.slice(0, -1));
  const leaf = spec.command_path[spec.command_path.length - 1];
  const command = parent.command(leaf).description(spec.summary);
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

export function createProgram() {
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
    .option('--profile <name>', 'CLI profile name', 'default')
    .option('--api-base <url>', 'Override the API base URL for this invocation')
    .option('--timeout-ms <n>', 'HTTP timeout in milliseconds')
    .option('--idempotency-key <key>', 'Override the generated idempotency key for mutating commands');

  const parentMap = new Map([['', program]]);
  for (const spec of COMMAND_SPECS) {
    attachSpec(program, parentMap, spec, COMMAND_SPECS);
  }

  return program;
}

export async function run(argv = process.argv) {
  const program = createProgram();
  await program.parseAsync(argv);
}

const isDirectInvocation =
  process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href;

if (isDirectInvocation) {
  run();
}
