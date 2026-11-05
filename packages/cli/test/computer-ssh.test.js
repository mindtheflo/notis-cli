import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import {
  INCLUDE_MARKER, knownHostsText, parseConnectReply, proxyScriptText, sshConfigText, sshPaths, withInclude,
} from '../src/runtime/computer-ssh.js';
import { COMMAND_SPECS, GROUP_SUMMARIES } from '../src/command-specs/index.js';

const CLI = new URL('../bin/notis.js', import.meta.url).pathname;
const HOST_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
const HAS_SSH_KEYGEN = spawnSync('ssh-keygen', ['-?']).error === undefined;

function makeJwt(sub = 'computer-ssh-test-user') {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${encode({ alg: 'none', typ: 'at+jwt' })}.${encode({ sub, exp })}.sig`;
}

async function fakeApi(reply) {
  const received = [];
  const server = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      received.push({ path: req.url, body });
      const [status, payload] = reply(body);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, received, base: `http://127.0.0.1:${server.address().port}` };
}

function cli(home, base, args, { input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, '--api-base', base, ...args], {
      env: {
        ...process.env, HOME: home, NOTIS_JWT: makeJwt(), NOTIS_OUTPUT: 'json', NODE_ENV: 'test',
        NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1', NOTIS_CLI_CONFIG_FILE: join(home, '.notis', 'config.json'),
        NOTIS_TELEMETRY_DISABLED: '1',
      },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
  });
}

function devicePaths() {
  const home = mkdtempSync(join(tmpdir(), 'notis-computer-ssh-'));
  return { home, paths: sshPaths(home) };
}

// Pure helpers ----------------------------------------------------------------

test('the command is registered under its own group', () => {
  assert.ok(COMMAND_SPECS.some((spec) => spec.command_path.join(' ') === 'computer ssh'));
  assert.ok(GROUP_SUMMARIES.computer);
});

test('the SSH host pins the key, the proxy and its own known_hosts', () => {
  const paths = sshPaths('/Users/a b');
  const text = sshConfigText(paths);
  assert.match(text, /^Host notis-computer$/m);
  assert.match(text, /^ {2}User user$/m);
  assert.match(text, /^ {2}IdentityFile "\/Users\/a b\/\.ssh\/notis\/id_ed25519"$/m);
  assert.match(text, /^ {2}ProxyCommand "\/Users\/a b\/\.ssh\/notis\/proxy"$/m);
  assert.match(text, /^ {2}UserKnownHostsFile "\/Users\/a b\/\.ssh\/notis\/known_hosts"$/m);
  assert.match(text, /^ {2}StrictHostKeyChecking yes$/m);
  assert.match(text, /^ {2}IdentitiesOnly yes$/m);
});

test('the proxy wrapper pins this CLI and profile with safe quoting', () => {
  const text = proxyScriptText({ nodePath: '/opt/node', cliPath: "/tmp/it's/notis.js", profileName: 'beta' });
  assert.match(text, /^#!\/bin\/sh$/m);
  assert.match(text, /^CLI='\/tmp\/it'\\''s\/notis\.js'$/m);
  assert.match(text, /exec "\$NODE" "\$CLI" --profile 'beta' computer ssh --proxy/);
  assert.match(text, /exec npx --yes --package @notis_ai\/cli@latest -- notis --profile 'beta' computer ssh --proxy/);
});

test('the proxy wrapper pins a moved config file, since apps start it without the shell environment', () => {
  const pinned = proxyScriptText({ nodePath: '/opt/node', cliPath: '/c/notis.js', profileName: 'e2e', configFile: '/w/.context/cli.json' });
  assert.match(pinned, /^NOTIS_CLI_CONFIG_FILE='\/w\/\.context\/cli\.json'\nexport NOTIS_CLI_CONFIG_FILE$/m);
  const plain = proxyScriptText({ nodePath: '/opt/node', cliPath: '/c/notis.js', profileName: 'beta' });
  assert.doesNotMatch(plain, /NOTIS_CLI_CONFIG_FILE/);
});

test('the Include line goes first once and keeps the existing config', () => {
  const paths = sshPaths('/home/u');
  const first = withInclude('Host other\n  User x\n', paths);
  assert.ok(first.startsWith(`Include /home/u/.ssh/notis/config ${INCLUDE_MARKER}\n`));
  assert.ok(first.endsWith('Host other\n  User x\n'));
  assert.equal(withInclude(first, paths), first);
  assert.equal(withInclude('', paths), `Include /home/u/.ssh/notis/config ${INCLUDE_MARKER}\n`);
});

test('host keys are stored under the alias whatever shape boat sends', () => {
  assert.equal(knownHostsText(HOST_KEY), `notis-computer ${HOST_KEY}\n`);
  assert.equal(knownHostsText(`[1.2.3.4]:2222 ${HOST_KEY} root@x`), `notis-computer ${HOST_KEY}\n`);
  assert.equal(knownHostsText(`${HOST_KEY}\necdsa-sha2-nistp256 AAAAE2\n`),
    `notis-computer ${HOST_KEY}\nnotis-computer ecdsa-sha2-nistp256 AAAAE2\n`);
  assert.equal(knownHostsText('nonsense'), '');
  assert.equal(knownHostsText(undefined), '');
});

test('only a ready reply with a host and port is a target', () => {
  assert.deepEqual(parseConnectReply({ status: 'ready', host: '1.2.3.4', port: 22, user: 'user', host_key: HOST_KEY }),
    { host: '1.2.3.4', port: 22, user: 'user', hostKey: HOST_KEY });
  assert.equal(parseConnectReply({ status: 'starting' }), null);
  assert.equal(parseConnectReply({ status: 'ready', host: '1.2.3.4', port: 0 }), null);
  assert.equal(parseConnectReply({ status: 'ready', port: 22 }), null);
});

// The command against a fake backend ----------------------------------------------

test('--setup makes a key, registers it and writes the SSH host', { skip: !HAS_SSH_KEYGEN }, async () => {
  const { home, paths } = devicePaths();
  mkdirSync(paths.sshDir, { recursive: true });
  writeFileSync(paths.userConfig, 'Host work\n  User me\n');
  const api = await fakeApi((body) => (body.operation === 'register'
    ? [200, { status: 'registered', key: { key_id: 'k1', device_name: body.device_name } }]
    : [200, { status: 'starting', retry_after_seconds: 5, message: 'Starting.' }]));
  try {
    const result = await cli(home, api.base, ['computer', 'ssh', '--setup']);
    assert.equal(result.code, 0, result.stderr + result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.data.status, 'starting');
    assert.deepEqual(api.received.map((r) => [r.path, r.body.operation]),
      [['/cloud_computer_ssh', 'register'], ['/cloud_computer_ssh', 'connect']]);
    const [register, connect] = api.received.map((r) => r.body);
    assert.match(register.public_key, /^ssh-ed25519 /);
    assert.equal(register.public_key, readFileSync(paths.publicKey, 'utf8').trim());
    assert.ok(register.device_name);
    assert.equal(connect.wait, false);
    assert.equal(statSync(paths.key).mode & 0o777, 0o600);
    assert.equal(statSync(paths.proxy).mode & 0o777, 0o700);
    assert.ok(readFileSync(paths.userConfig, 'utf8').startsWith(`Include ${paths.config} ${INCLUDE_MARKER}\n`));
    assert.match(readFileSync(paths.userConfig, 'utf8'), /Host work\n {2}User me\n$/);
    assert.match(readFileSync(paths.proxy, 'utf8'), /computer ssh --proxy/);
    // A second setup keeps the same key and adds no second Include.
    const again = await cli(home, api.base, ['computer', 'ssh', '--setup']);
    assert.equal(again.code, 0);
    assert.equal(api.received[2].body.public_key, register.public_key);
    assert.equal(readFileSync(paths.userConfig, 'utf8').split(INCLUDE_MARKER).length, 2);
  } finally {
    await new Promise((resolve) => api.server.close(resolve));
  }
});

test('--proxy relays the connection and saves the host key', async () => {
  const { home, paths } = devicePaths();
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.publicKey, 'ssh-ed25519 AAAAdevice me@here\n');
  const sshd = createTcpServer((socket) => {
    socket.write('SSH-2.0-fake\r\n');
    socket.on('data', (chunk) => socket.write(chunk));
    socket.on('end', () => socket.end());
  });
  await new Promise((resolve) => sshd.listen(0, '127.0.0.1', resolve));
  const api = await fakeApi(() => [200, {
    status: 'ready', host: '127.0.0.1', port: sshd.address().port, user: 'user', host_key: HOST_KEY,
  }]);
  try {
    const result = await cli(home, api.base, ['computer', 'ssh', '--proxy'], { input: 'hello' });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, 'SSH-2.0-fake\r\nhello');
    assert.equal(api.received[0].body.operation, 'connect');
    assert.equal(api.received[0].body.wait, false);
    assert.equal(api.received[0].body.public_key, 'ssh-ed25519 AAAAdevice me@here');
    assert.equal(readFileSync(paths.knownHosts, 'utf8'), `notis-computer ${HOST_KEY}\n`);
  } finally {
    await new Promise((resolve) => api.server.close(resolve));
    await new Promise((resolve) => sshd.close(resolve));
  }
});

test('--proxy fails fast on stderr while the computer starts', async () => {
  const { home, paths } = devicePaths();
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.publicKey, 'ssh-ed25519 AAAAdevice me@here\n');
  const api = await fakeApi(() => [200, { status: 'starting', retry_after_seconds: 5, message: 'Your Cloud Computer is starting.' }]);
  try {
    const result = await cli(home, api.base, ['computer', 'ssh', '--proxy']);
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Your Cloud Computer is starting\./);
    assert.equal(existsSync(paths.knownHosts), false);
  } finally {
    await new Promise((resolve) => api.server.close(resolve));
  }
});

test('--proxy keeps backend refusals off the SSH stream', async () => {
  const { home, paths } = devicePaths();
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.publicKey, 'ssh-ed25519 AAAAdevice me@here\n');
  const api = await fakeApi(() => [409, { status: 'error', code: 'cloud_computer_ssh_after_move',
    error: 'cloud_computer_ssh_after_move', message: 'SSH is not available on your Cloud Computer yet.' }]);
  try {
    const result = await cli(home, api.base, ['computer', 'ssh', '--proxy']);
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /SSH is not available on your Cloud Computer yet/);
  } finally {
    await new Promise((resolve) => api.server.close(resolve));
  }
});

test('--list and --revoke call the account operations', async () => {
  const { home } = devicePaths();
  const api = await fakeApi((body) => (body.operation === 'list'
    ? [200, { keys: [{ key_id: 'k1', device_name: 'mac', fingerprint: 'SHA256:x', last_used_at: null }] }]
    : [200, { status: 'revoked', key: { key_id: body.key_id, device_name: 'mac', removed_from_computer: true } }]));
  try {
    const listed = await cli(home, api.base, ['computer', 'ssh', '--list']);
    assert.equal(listed.code, 0, listed.stderr);
    assert.equal(JSON.parse(listed.stdout).data.keys[0].key_id, 'k1');
    const revoked = await cli(home, api.base, ['computer', 'ssh', '--revoke', 'k1']);
    assert.equal(revoked.code, 0, revoked.stderr);
    assert.deepEqual(api.received.map((r) => r.body), [{ operation: 'list' }, { operation: 'revoke', key_id: 'k1' }]);
    const both = await cli(home, api.base, ['computer', 'ssh', '--list', '--revoke', 'k1']);
    assert.equal(both.code, 2);
  } finally {
    await new Promise((resolve) => api.server.close(resolve));
  }
});
