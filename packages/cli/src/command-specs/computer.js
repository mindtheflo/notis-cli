// `notis computer ssh`: SSH from this device to the user's Cloud Computer.
//
// --setup makes this device's key, registers it, and writes the
// `notis-computer` SSH host so `ssh notis-computer` (and tools such as T3 that
// read ~/.ssh/config) connect. --proxy is that host's ProxyCommand: it asks
// Notis where the computer is, fails fast while a stopped computer starts (the
// caller's retry connects), saves the current host key and relays the bytes.
// With neither, the command sets up when needed, waits for the computer and
// runs ssh.
//
// `notis computer status | restart | recover` (CC-150, CC-151) go through
// LOCAL_NOTIS_GET_CLOUD_COMPUTER and LOCAL_NOTIS_MANAGE_CLOUD_COMPUTER, so the
// server keeps every check. Restart and recover preview first and ask.

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { connect as netConnect } from 'node:net';
import { CliError, EXIT_CODES, asCliError, usageError } from '../runtime/errors.js';
import {
  canPrompt, createStderrPrompter, extractToolResult, findConfirmationPreview, renderPreview, resolveConfirmation,
} from '../runtime/tool-confirmation.js';
import { runToolCommand } from './helpers.js';
import { httpRequest } from '../runtime/transport.js';
import { readComputerIdentity } from '../runtime/computer-identity.js';
import { resolveConfigFile } from '../runtime/profiles.js';
import {
  SSH_HOST_ALIAS, parseConnectReply, sshPaths, writeHostKey, writeSshFiles,
} from '../runtime/computer-ssh.js';

const PATH = '/cloud_computer_ssh';
const GET_TOOL = 'LOCAL_NOTIS_GET_CLOUD_COMPUTER';
const MANAGE_TOOL = 'LOCAL_NOTIS_MANAGE_CLOUD_COMPUTER';
const WAIT_TIMEOUT_MS = 240_000;
const PROXY_TIMEOUT_MS = 90_000;

function readPublicKey(paths) {
  return existsSync(paths.publicKey) ? readFileSync(paths.publicKey, 'utf8').trim() : '';
}

function makeKey(paths, deviceName) {
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  const result = spawnSync('ssh-keygen', [
    '-q', '-t', 'ed25519', '-N', '', '-C', `notis-computer@${deviceName}`, '-f', paths.key,
  ], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new CliError({
      code: 'ssh_keygen_failed',
      message: 'Could not create an SSH key on this device. Check that OpenSSH (ssh-keygen) is installed.',
      exitCode: EXIT_CODES.unexpected,
      details: { stderr: String(result.stderr || result.error?.message || '').slice(0, 2000) },
    });
  }
}

async function post(runtime, body, timeoutMs) {
  return httpRequest({ runtime, method: 'POST', path: PATH, body, ...(timeoutMs ? { timeoutMs } : {}) });
}

async function setup(ctx, paths) {
  if (process.platform === 'win32') {
    throw usageError('notis computer ssh works on macOS and Linux.');
  }
  const deviceName = readComputerIdentity().displayName;
  if (!readPublicKey(paths)) makeKey(paths, deviceName);
  const publicKey = readPublicKey(paths);
  const registered = await post(ctx.runtime, { operation: 'register', public_key: publicKey, device_name: deviceName });
  writeSshFiles({
    paths,
    nodePath: process.execPath,
    cliPath: process.argv[1],
    profileName: ctx.runtime.profileName,
    // Only a config moved with NOTIS_CLI_CONFIG_FILE needs pinning.
    configFile: process.env.NOTIS_CLI_CONFIG_FILE ? resolveConfigFile() : undefined,
  });
  // Checks the plan (the upsell comes back here) and starts a stopped computer.
  const connected = await post(ctx.runtime, { operation: 'connect', public_key: publicKey, wait: false });
  if (parseConnectReply(connected.payload)) writeHostKey(paths, connected.payload.host_key);
  return { key: registered.payload?.key, status: connected.payload?.status, publicKey };
}

function proxyFail(message) {
  process.stderr.write(`notis computer ssh: ${message}\n`);
  return EXIT_CODES.backend;
}

async function proxy(ctx, paths) {
  try {
    const publicKey = readPublicKey(paths);
    if (!publicKey) return proxyFail('this device is not set up. Run: notis computer ssh --setup');
    const { payload } = await post(ctx.runtime, { operation: 'connect', public_key: publicKey, wait: false }, PROXY_TIMEOUT_MS);
    if (payload?.status === 'starting') {
      return proxyFail(payload.message || 'your Cloud Computer is starting. Connect again in a few seconds.');
    }
    const target = parseConnectReply(payload);
    if (!target) return proxyFail('Notis did not say where your Cloud Computer is. Try again.');
    if (!writeHostKey(paths, target.hostKey)) return proxyFail('Notis did not send the computer\'s host key. Try again.');
    return await relay(target);
  } catch (error) {
    return proxyFail(asCliError(error).message);
  }
}

function relay({ host, port }) {
  return new Promise((resolve) => {
    const socket = netConnect({ host, port });
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      process.stdin.unpipe(socket);
      process.stdin.pause();
      process.stdin.unref?.();
      resolve(code);
    };
    socket.once('connect', () => {
      process.stdin.pipe(socket);
      socket.pipe(process.stdout);
    });
    socket.once('error', (error) => {
      process.stderr.write(`notis computer ssh: could not reach your Cloud Computer (${error.code || error.message}).\n`);
      finish(EXIT_CODES.network);
    });
    socket.once('close', () => finish(0));
    process.stdin.once('end', () => socket.end());
  });
}

async function waitForComputer(ctx, publicKey) {
  const { payload } = await post(ctx.runtime, { operation: 'connect', public_key: publicKey, wait: true }, WAIT_TIMEOUT_MS);
  if (!parseConnectReply(payload)) {
    throw new CliError({
      code: 'cloud_computer_not_ready', exitCode: EXIT_CODES.backend, details: payload || {},
      message: payload?.message || 'Your Cloud Computer did not start. Try again in a moment.',
    });
  }
}

function runSsh(args) {
  return new Promise((resolve) => {
    const child = spawn('ssh', [SSH_HOST_ALIAS, ...args], { stdio: 'inherit' });
    child.once('error', () => {
      process.stderr.write('notis computer ssh: ssh is not installed on this device.\n');
      resolve(EXIT_CODES.unexpected);
    });
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

function keyLine(key) {
  const used = key.last_used_at ? `last used ${key.last_used_at}` : 'never used';
  return `${key.key_id}  ${key.device_name || 'unnamed device'}  ${key.fingerprint}  ${used}`;
}

/** One Cloud Computer tool call; a refusal (status error) becomes a CliError. */
async function callComputer(ctx, toolName, args, idempotencyKey) {
  const result = await runToolCommand({ runtime: ctx.runtime, toolName, arguments_: args,
    mutating: toolName === MANAGE_TOOL, idempotencyKey, sendIdempotencyKeyWhenReading: true });
  const payload = extractToolResult(result.payload) || {};
  if (payload.status === 'error') {
    throw new CliError({
      code: payload.code || 'cloud_computer_error', exitCode: EXIT_CODES.backend, details: payload,
      message: payload.message || 'The Cloud Computer could not do this.',
    });
  }
  return { result, payload };
}

const STATUS_LINES = {
  running: 'Your Cloud Computer is working.',
  stopped: 'Your Cloud Computer is asleep. It wakes up when Notis has work to do.',
  moving: 'Your Cloud Computer is moving to a bigger disk.',
  none: 'You have no Cloud Computer yet. It starts the first time Notis needs it.',
};

function statusText(computer) {
  if (computer.status !== 'not_responding') return STATUS_LINES[computer.status] || STATUS_LINES.none;
  const reason = computer.status_reason ? ` Reason: ${computer.status_reason}.` : '';
  const saved = computer.last_saved_at ? ` Last saved ${computer.last_saved_at}.` : '';
  return `Your Cloud Computer is not responding.${reason}${saved} Restart it with: notis computer restart`;
}

async function machineAction(ctx, action) {
  const command = `computer ${action}`;
  // As in notis tools exec: a key the caller chose takes the preview, and the confirming call
  // takes that key plus ".confirm", so a retry with the same key replays both answers.
  const callerKey = ctx.globalOptions.idempotencyKey;
  const first = await callComputer(ctx, MANAGE_TOOL, { action }, callerKey || randomUUID());
  const preview = findConfirmationPreview(first.payload);
  if (!preview) {
    throw new CliError({ code: 'cloud_computer_preview_missing', exitCode: EXIT_CODES.backend, details: first.payload,
      message: 'Notis did not say what this would do. Nothing changed.' });
  }
  const yes = Boolean(ctx.options.yes);
  const interactive = canPrompt({ runtime: ctx.runtime, output: ctx.output });
  const previewText = renderPreview(preview);
  if (interactive && !yes) process.stderr.write(`${previewText}\n`);
  const prompter = interactive && !yes ? createStderrPrompter() : null;
  let decision;
  try {
    decision = await resolveConfirmation({ preview, yes, interactive, ask: (question) => prompter.ask(question) });
  } finally {
    prompter?.close();
  }
  if (decision.decision !== 'apply') {
    const reason = decision.decision === 'not_interactive'
      ? `Nothing has changed. Run notis computer ${action} --yes to apply it.` : decision.reason;
    return ctx.output.emitSuccess({
      command, data: first.payload, requestId: first.result.requestId, humanSummary: reason,
      hints: decision.decision === 'not_interactive' ? [{ command: `notis computer ${action} --yes`, reason: 'Apply it' }] : [],
      meta: { mutating: false, confirmation: decision.decision, applied: false },
      renderHuman: () => (interactive && !yes ? reason : `${previewText}\n\n${reason}`),
    });
  }
  const applied = await callComputer(ctx, MANAGE_TOOL, decision.arguments,
    callerKey ? `${callerKey}.confirm` : randomUUID());
  return ctx.output.emitSuccess({
    command, data: applied.payload, requestId: applied.result.requestId,
    humanSummary: applied.payload.message || 'Done.', meta: { mutating: true, confirmation: 'confirmed', applied: true },
  });
}

const YES_OPTION = { flags: '--yes', description: 'Apply without the Continue? [y/N] question.' };

export const computerCommandSpecs = [{
  command_path: ['computer', 'status'],
  summary: 'Show whether your Cloud Computer is working, asleep or not responding.',
  when_to_use: 'Check your Cloud Computer, for example when a command on it fails or an agent says it stopped answering.',
  args_schema: { arguments: [], options: [] },
  examples: ['notis computer status'],
  mutates: false, idempotent: true, require_auth: true,
  backend_call: { type: 'tool', name: GET_TOOL },
  async handler(ctx) {
    const { result, payload } = await callComputer(ctx, GET_TOOL, {}, randomUUID());
    const computer = payload.cloud_computer || {};
    return ctx.output.emitSuccess({
      command: 'computer status', data: computer, requestId: result.requestId, humanSummary: statusText(computer),
      hints: computer.status === 'not_responding' ? [{ command: 'notis computer restart', reason: 'Restart it; its files are kept' }] : [],
      meta: { mutating: false },
    });
  },
}, {
  command_path: ['computer', 'restart'],
  summary: 'Restart a Cloud Computer that stopped answering. Its files are kept.',
  when_to_use: 'Only while notis computer status says it is not responding. Whatever was running on it stops; it answers again in 1 to 2 minutes.',
  args_schema: { arguments: [], options: [YES_OPTION] },
  examples: ['notis computer restart', 'notis computer restart --yes'],
  mutates: true, idempotent: false, require_auth: true,
  backend_call: { type: 'tool', name: MANAGE_TOOL },
  handler: (ctx) => machineAction(ctx, 'restart'),
}, {
  command_path: ['computer', 'recover'],
  summary: 'Bring back a Cloud Computer that cannot restart, from its last save.',
  when_to_use: 'Only after notis computer restart failed. Anything written after the last save is lost, and this cannot be undone; the preview says when that save was made.',
  args_schema: { arguments: [], options: [YES_OPTION] },
  examples: ['notis computer recover'],
  mutates: true, idempotent: false, require_auth: true,
  backend_call: { type: 'tool', name: MANAGE_TOOL },
  handler: (ctx) => machineAction(ctx, 'recover'),
}, {
  command_path: ['computer', 'ssh'],
  summary: 'Open SSH to your Cloud Computer from this device.',
  when_to_use: 'Use a terminal, an editor or T3 on your Cloud Computer. The first run sets this device up; after that `ssh notis-computer` works anywhere. A stopped computer starts; it stays on while you are connected.',
  args_schema: {
    arguments: [{ token: '[ssh_args...]', key: 'sshArgs', description: 'Extra ssh arguments or a remote command, after --.' }],
    options: [
      { flags: '--setup', description: 'Create and register this device\'s key and write the notis-computer SSH host, then stop.' },
      { flags: '--list', description: 'List the devices that can open SSH to your Cloud Computer.' },
      { flags: '--revoke <key_id>', description: 'Remove a device\'s key; it can no longer connect.' },
      { flags: '--proxy', description: 'Used by ssh as the notis-computer ProxyCommand.' },
    ],
  },
  examples: [
    'notis computer ssh',
    'notis computer ssh --setup',
    'notis computer ssh -- -L 3000:localhost:3000',
    'notis computer ssh --list',
    'notis computer ssh --revoke <key_id>',
  ],
  mutates: true, idempotent: false, require_auth: true,
  backend_call: { type: 'http', path: PATH },
  async handler(ctx) {
    const paths = sshPaths();
    const { setup: setupOnly, list, revoke, proxy: proxyMode } = ctx.options;
    if ([setupOnly, list, revoke, proxyMode].filter(Boolean).length > 1) {
      throw usageError('Choose one of --setup, --list, --revoke or --proxy.');
    }
    if (proxyMode) return proxy(ctx, paths);
    if (list) {
      const { payload, requestId } = await post(ctx.runtime, { operation: 'list' });
      const keys = Array.isArray(payload?.keys) ? payload.keys : [];
      return ctx.output.emitSuccess({
        command: 'computer ssh', data: { keys }, meta: { mutating: false, request_id: requestId },
        humanSummary: keys.length ? keys.map(keyLine).join('\n') : 'No device can open SSH to your Cloud Computer yet.',
      });
    }
    if (revoke) {
      const { payload, requestId } = await post(ctx.runtime, { operation: 'revoke', key_id: revoke });
      return ctx.output.emitSuccess({
        command: 'computer ssh', data: payload, meta: { mutating: true, request_id: requestId },
        humanSummary: `Removed the key of ${payload?.key?.device_name || 'that device'}. It can no longer connect.`,
      });
    }
    const configured = Boolean(readPublicKey(paths)) && existsSync(paths.config) && existsSync(paths.proxy);
    if (setupOnly || !configured) {
      const result = await setup(ctx, paths);
      if (setupOnly) {
        const starting = result.status === 'starting' ? ' Your Cloud Computer is starting.' : '';
        return ctx.output.emitSuccess({
          command: 'computer ssh', data: { key: result.key, host: SSH_HOST_ALIAS, status: result.status },
          meta: { mutating: true },
          humanSummary: `This device can open SSH to your Cloud Computer.${starting} Connect with: ssh ${SSH_HOST_ALIAS}`,
        });
      }
    }
    ctx.output.note('Connecting to your Cloud Computer. A stopped one takes about a minute to start.');
    await waitForComputer(ctx, readPublicKey(paths));
    return runSsh(ctx.args.sshArgs || []);
  },
}];
