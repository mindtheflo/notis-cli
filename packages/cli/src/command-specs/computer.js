// `notis computer ssh`: SSH from this device to the user's Cloud Computer.
//
// --setup makes this device's key, registers it, and writes the
// `notis-computer` SSH host so `ssh notis-computer` (and tools such as T3 that
// read ~/.ssh/config) connect. --proxy is that host's ProxyCommand: it asks
// Notis where the computer is, fails fast while a stopped computer starts (the
// caller's retry connects), saves the current host key and relays the bytes.
// With neither, the command sets up when needed, waits for the computer and
// runs ssh.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { connect as netConnect } from 'node:net';
import { CliError, EXIT_CODES, asCliError, usageError } from '../runtime/errors.js';
import { httpRequest } from '../runtime/transport.js';
import { readComputerIdentity } from '../runtime/computer-identity.js';
import { resolveConfigFile } from '../runtime/profiles.js';
import {
  SSH_HOST_ALIAS, parseConnectReply, sshPaths, writeHostKey, writeSshFiles,
} from '../runtime/computer-ssh.js';

const PATH = '/cloud_computer_ssh';
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

export const computerCommandSpecs = [{
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
