import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMAND_SPECS, GROUP_SUMMARIES } from '../src/command-specs/index.js';
import { repositorySecretsCommandSpecs } from '../src/command-specs/repository-secrets.js';

const PLANTED = 'FAKE_KEY=sk_test_PLANTED_cli_value\n';
const CLI = new URL('../bin/notis.js', import.meta.url).pathname;

function context(path, { options = {}, args = {} } = {}) {
  const spec = repositorySecretsCommandSpecs.find(value => value.command_path.join(' ') === path);
  assert.ok(spec, path);
  return { spec, options, args, globalOptions: {},
    runtime: { credentialKind: 'env', profileName: 'repo-secrets-unit', jwt: 'fixture-not-a-real-credential',
      apiBase: 'https://fixture.invalid', timeoutMs: 30000, cliVersion: 'fixture', outputMode: 'json' },
    output: { emitSuccess: value => value, emitProgress() {}, note() {}, isMachineMode: () => true } };
}

function mockServer(t, answer) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls.push({ url: String(url), body: JSON.parse(request.body) });
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

function makeJwt() {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'at+jwt' })}.${encode({ sub: 'repo-secrets-cli-test', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

/** The real CLI against a fake /repository_secrets: what it sent, its exit code and its output. */
async function runCli(answer, args) {
  const received = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      received.push({ path: req.url, body: raw ? JSON.parse(raw) : {} });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const home = mkdtempSync(join(tmpdir(), 'notis-repo-secrets-'));
  try {
    return await new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, '--api-base', `http://127.0.0.1:${server.address().port}`, ...args], {
        env: { ...process.env, HOME: home, NOTIS_JWT: makeJwt(), NOTIS_OUTPUT: 'json', NODE_ENV: 'test',
          NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1', NOTIS_CLI_CONFIG_FILE: join(home, '.notis', 'config.json'),
          NOTIS_TELEMETRY_DISABLED: '1', INHERITED_FROM_PARENT: 'yes' },
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr, received }));
      child.stdin.end();
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('repository-secrets is its own group with list, set, delete and exec, and no deliver', () => {
  assert.ok(GROUP_SUMMARIES['repository-secrets']);
  const paths = COMMAND_SPECS.filter(spec => spec.command_path[0] === 'repository-secrets').map(spec => spec.command_path[1]);
  assert.deepEqual(paths.sort(), ['delete', 'exec', 'list', 'set']);
});

test('set reads the env file here and posts it to /repository_secrets, never to the tool pipeline or the summary', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'repo-secrets-'));
  const file = join(dir, '.env');
  writeFileSync(file, PLANTED);
  const calls = mockServer(t, { status: 'success', replaced: false, secret: { id: 'x', repository: 'notis', name: 'server/.env' } });
  const ctx = context('repository-secrets set', { options: { repository: 'notis', name: 'server/.env', file } });
  const result = await ctx.spec.handler(ctx);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/repository_secrets$/);
  assert.deepEqual(calls[0].body, { action: 'set', repository: 'notis', name: 'server/.env', secret: PLANTED });
  assert.doesNotMatch(JSON.stringify(result), /PLANTED/);
});

test('set stores a variable by name, without the newline a pipe adds', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'repo-secrets-'));
  const file = join(dir, 'key.txt');
  writeFileSync(file, 'sk_test_PLANTED_variable\n');
  const calls = mockServer(t, { status: 'success', replaced: true, secret: { id: 'x', repository: 'web', name: 'STRIPE_SECRET_KEY', kind: 'variable' } });
  const ctx = context('repository-secrets set', { options: { repository: 'web', name: 'STRIPE_SECRET_KEY', file } });
  const result = await ctx.spec.handler(ctx);
  assert.deepEqual(calls[0].body, { action: 'set', repository: 'web', name: 'STRIPE_SECRET_KEY', secret: 'sk_test_PLANTED_variable' });
  assert.match(result.humanSummary, /Replaced web · STRIPE_SECRET_KEY/);
  assert.doesNotMatch(JSON.stringify(result), /PLANTED/);
});

test('set never takes a value as an argument', async () => {
  const ctx = context('repository-secrets set', { options: { repository: 'notis', name: 'server/.env' } });
  await assert.rejects(ctx.spec.handler(ctx), /--file/);
});

test('exec runs the command after -- with the secrets as environment variables and its exit code', async () => {
  const printer = 'const names = process.env.NOTIS_REPOSITORY_SECRET_NAMES.split(","); '
    + 'console.log(JSON.stringify({ names, values: names.map(n => process.env[n]), inherited: process.env.INHERITED_FROM_PARENT, '
    + 'argv: process.argv.slice(1) })); process.exit(3)';
  const answer = { status: 'success', scope: 'team', repository: 'notis',
    variables: { STRIPE_SECRET_KEY: 'sk_test_PLANTED_exec', DATABASE_URL: 'postgres://x' },
    sources: [], refused: [{ repository: 'notis', name: 'server/.env', kind: 'env_file' }],
    overridden: ['STRIPE_SECRET_KEY'], skipped: ['PATH'] };
  const run = await runCli(answer, ['repository-secrets', 'exec', '--repository', 'notis', '--',
    process.execPath, '-e', printer, 'first', '--repository', 'not-ours']);
  assert.deepEqual(run.received.map(item => item.body), [{ action: 'environment', repository: 'notis' }]);
  assert.match(run.received[0].path, /\/repository_secrets$/);
  assert.equal(run.code, 3, run.stderr);
  // Only the command's own output is on stdout.
  assert.deepEqual(JSON.parse(run.stdout), { names: ['DATABASE_URL', 'STRIPE_SECRET_KEY'],
    values: ['postgres://x', 'sk_test_PLANTED_exec'], inherited: 'yes', argv: ['first', '--repository', 'not-ours'] });
  // Names of what was refused, overridden or skipped go to stderr; never a value.
  assert.match(run.stderr, /notis\/server\/\.env: not given/);
  assert.match(run.stderr, /STRIPE_SECRET_KEY: set by more than one secret/);
  assert.match(run.stderr, /PATH: left out/);
  assert.doesNotMatch(run.stderr, /PLANTED|postgres/);
});

test('exec with no secrets still runs the command, and a command killed by a signal exits 128 + its number', async () => {
  const answer = { status: 'success', variables: {}, sources: [], refused: [], overridden: [], skipped: [] };
  const plain = await runCli(answer, ['repository-secrets', 'exec', '--repository', 'notis', '--',
    process.execPath, '-e', 'console.log(JSON.stringify(process.env.NOTIS_REPOSITORY_SECRET_NAMES))']);
  assert.equal(plain.code, 0, plain.stderr);
  assert.equal(JSON.parse(plain.stdout), '');
  const killed = await runCli(answer, ['repository-secrets', 'exec', '--repository', 'notis', '--',
    process.execPath, '-e', 'process.kill(process.pid, "SIGTERM")']);
  assert.equal(killed.code, 143);
});

test('exec needs a repository and a command', async () => {
  const bare = context('repository-secrets exec', { options: {}, args: { command: ['true'] } });
  await assert.rejects(bare.spec.handler(bare), /--repository/);
  const ctx = context('repository-secrets exec', { options: { repository: 'notis' }, args: { command: [] } });
  await assert.rejects(ctx.spec.handler(ctx), /after --/);
});
