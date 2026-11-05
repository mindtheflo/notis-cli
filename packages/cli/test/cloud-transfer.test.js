import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ccCommandSpecs } from '../src/command-specs/cc.js';
import { collectFiles, idleWatchdog, manifestText, streamBody, tarBatch, validRelative } from '../src/runtime/cloud-transfer.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GATE = path.join(REPO, 'server/lib/cloud_gate_machine.mjs');
const HANDLER = path.join(REPO, 'server/lib/cloud_transfer_machine.mjs');
const SPACE = '0b8f7a52-5d1e-4c4b-9a43-5f3a1e2c9d10';
const SANDBOX = 'bx_cli_transfer';
const API = 'https://api.fixture.invalid';
const CS = 64 * 1024;
const sha = data => createHash('sha256').update(data).digest('hex');

function freePort() {
  return new Promise(resolve => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitListening(port) {
  for (let i = 0; i < 200; i += 1) {
    const ok = await new Promise(resolve => {
      const socket = net.connect(port, '127.0.0.1', () => { socket.end(); resolve(true); });
      socket.on('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('gate never listened');
}

/** A real gate with transfer.mjs, and a fake Notis API that signs passes for it. */
async function startGate(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notis-transfer-'));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const kid = 'testkid';
  const port = await freePort();
  const sandbox = path.join(root, 'sandbox');
  fs.mkdirSync(path.join(root, 'gate'), { recursive: true });
  fs.mkdirSync(sandbox);
  fs.copyFileSync(HANDLER, path.join(root, 'gate/transfer.mjs'));
  fs.writeFileSync(path.join(root, 'gate/config.json'), JSON.stringify({
    sandbox_id: SANDBOX, port, host: '127.0.0.1', public_keys: { [kid]: publicKey.export({ format: 'jwk' }).x },
    api_base: 'http://127.0.0.1:9', portal_origin: 'https://app.example.test', allowed_origins: [],
    services_dir: path.join(root, 'services'), previews_dir: path.join(root, 'previews'),
    sandbox_root: sandbox, transfers_dir: path.join(sandbox, '.notis/transfers') }));
  const child = spawn(process.execPath, [GATE], { env: { PATH: process.env.PATH, NOTIS_GATE_CONFIG: path.join(root, 'gate/config.json') }, stdio: 'ignore' });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(root, { recursive: true, force: true }); });
  await waitListening(port);
  const passFor = claims => {
    const now = Math.floor(Date.now() / 1000);
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const head = encode({ alg: 'EdDSA', kid, typ: 'JWT' });
    const body = encode({ sub: 'user-1', sbx: SANDBOX, scope: ['transfer'], aud: 'gate', iat: now, exp: now + 900, jti: randomUUID(), ...claims });
    return `${head}.${body}.${sign(null, Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
  };
  return { root, sandbox, origin: `http://127.0.0.1:${port}`, passFor };
}

function mockApi(t, gate, { stopChunksAfter = Infinity, sessions = new Map() } = {}) {
  const realFetch = globalThis.fetch;
  const calls = [];
  let chunkPuts = 0;
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const href = String(url);
    if (href.startsWith(`${gate.origin}/t/`) && href.includes('/f/') && init.method === 'PUT') {
      chunkPuts += 1;
      // The process is killed here: every later chunk is refused at once, nothing more lands.
      if (chunkPuts > stopChunksAfter) return new Response(JSON.stringify({ error: 'killed' }), { status: 400 });
    }
    if (!href.startsWith(API)) return realFetch(url, init);
    const body = JSON.parse(init.body);
    calls.push(body);
    const respond = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    if (body.action === 'begin') {
      const root = body.space_id ? path.join(gate.sandbox, 'spaces', body.space_id, body.dest.space) : body.path;
      let id = body.session_id && sessions.has(body.session_id) ? body.session_id : null;
      if (!id) {
        id = `tr_${randomBytes(16).toString('hex')}`;
        sessions.set(id, { id, root, direction: body.direction, mh: body.manifest_digest });
      }
      const session = sessions.get(id);
      const claims = { ses: id, dir: session.direction, root, ...(session.direction === 'push' ? { mh: session.mh, cs: CS } : {}) };
      session.claims = claims;
      return respond({ session_id: id, transfer_url: `${gate.origin}/t/${id}`, pass: gate.passFor(claims), chunk_size: CS,
        small_file_bytes: 4096, batch_bytes: 64 * 1024, root, status: session.status || 'open', resumed: Boolean(body.session_id) });
    }
    const session = sessions.get(body.session_id);
    if (body.action === 'status') return respond({ session_id: session.id, transfer_url: `${gate.origin}/t/${session.id}`, pass: gate.passFor(session.claims) });
    if (body.action === 'commit') {
      if (session.direction === 'pull') return respond({ status: 'committed' });
      const response = await realFetch(`${gate.origin}/t/${session.id}/commit`, { method: 'POST', headers: { authorization: `Bearer ${gate.passFor(session.claims)}` } });
      const result = await response.json();
      if (response.status === 409 && result.error === 'incomplete') return respond({ status: 'incomplete', missing: result.missing });
      if (result.status === 'committed') session.status = 'committed';
      return respond(result);
    }
    throw new Error(`unexpected ${body.action}`);
  });
  return { calls, sessions };
}

function context(pathName, { args = {}, options = {} } = {}) {
  const spec = ccCommandSpecs.find(value => value.command_path.join(' ') === pathName);
  const progress = [];
  return { spec, args, options, globalOptions: {},
    runtime: { credentialKind: 'env', profileName: 'transfer-unit-only', jwt: 'fixture-not-a-real-credential', apiBase: API,
      timeoutMs: 30000, cliVersion: 'fixture', outputMode: 'json' },
    output: { emitSuccess: value => value, emitProgress: value => progress.push(value), note() {}, isMachineMode: () => true },
    progress };
}

function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notis-project-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'notis-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'media'));
  fs.mkdirSync(path.join(dir, 'clips/deep'), { recursive: true });
  const files = { 'media/big.bin': randomBytes(CS * 5 + 77), 'media/mid.bin': randomBytes(CS + 1), 'empty.txt': Buffer.alloc(0) };
  for (let i = 0; i < 40; i += 1) files[`clips/deep/c${i}.txt`] = randomBytes(100 + i * 50);
  for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), data);
  fs.writeFileSync(path.join(outside, 'shared.txt'), 'shared through a link');
  fs.symlinkSync(path.join(outside, 'shared.txt'), path.join(dir, 'linked.txt'));
  files['linked.txt'] = Buffer.from('shared through a link');
  return { dir, files };
}

test('push and pull are cc commands that open a direct transfer', () => {
  const push = ccCommandSpecs.find(spec => spec.command_path.join(' ') === 'cc push');
  const pull = ccCommandSpecs.find(spec => spec.command_path.join(' ') === 'cc pull');
  assert.deepEqual(push.backend_call, { type: 'http', path: '/portal_spaces/cloud-transfer' });
  assert.deepEqual(pull.backend_call, { type: 'http', path: '/portal_spaces/cloud-transfer' });
  assert.equal(push.mutates, true);
  assert.equal(pull.mutates, false);
});

test('paths, manifests and tar batches follow the gate rules', async t => {
  assert.equal(validRelative('a/b.txt'), true);
  for (const bad of ['', '/a', 'a/', 'a//b', '../a', 'a/./b', 'a\\b', 'a\nb']) assert.equal(validRelative(bad), false, bad);
  assert.equal(manifestText([{ sha256: 'a'.repeat(64), size: 3, path: 'x' }]), `${'a'.repeat(64)} 3 x\n`);
  const tar = tarBatch([{ index: 7, data: Buffer.from('hello') }]);
  assert.equal(tar.length, 512 + 512 + 1024);
  assert.equal(tar.subarray(0, 1).toString(), '7');
  const { dir } = project(t);
  const collected = await collectFiles(dir);
  assert.ok(collected.files.some(file => file.path === 'linked.txt'));
  const noLinks = await collectFiles(dir, { followLinks: false });
  assert.deepEqual(noLinks.skipped, [{ path: 'linked.txt', reason: 'link' }]);
});

test('cc push sends a folder to a Space and resumes after the link drops', async t => {
  const gate = await startGate(t);
  const { dir, files } = project(t);
  process.env.NOTIS_TRANSFER_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'notis-state-'));
  t.after(() => { fs.rmSync(process.env.NOTIS_TRANSFER_STATE_DIR, { recursive: true, force: true }); delete process.env.NOTIS_TRANSFER_STATE_DIR; });

  // First run: stopped after three chunks.
  const first = mockApi(t, gate, { stopChunksAfter: 3 });
  const ctx = context('cc push', { args: { local: dir }, options: { space: SPACE, dest: 'files/launch', streams: '1' } });
  await assert.rejects(() => ctx.spec.handler(ctx), error => error.code === 'cloud_transfer_killed');
  t.mock.restoreAll();

  // Second run: the same session continues and only the missing bytes travel.
  const second = mockApi(t, gate, { sessions: first.sessions });
  const again = context('cc push', { args: { local: dir }, options: { space: SPACE, dest: 'files/launch' } });
  const result = await again.spec.handler(again);
  assert.equal(result.data.status, 'committed');
  assert.equal(result.data.session_id, [...first.sessions.keys()][0]);
  assert.ok(result.data.resumed_from_bytes >= CS * 3);
  const root = path.join(gate.sandbox, 'spaces', SPACE, 'files/launch');
  for (const [name, data] of Object.entries(files)) assert.equal(sha(fs.readFileSync(path.join(root, name))), sha(data), name);
  assert.ok(second.calls.some(call => call.action === 'begin' && call.session_id === result.data.session_id));
  assert.equal(second.calls.find(call => call.action === 'begin').manifest_digest.length, 64);

  // Third run: nothing changed, nothing is sent again.
  const third = context('cc push', { args: { local: dir }, options: { space: SPACE, dest: 'files/launch' } });
  const unchanged = await third.spec.handler(third);
  assert.equal(unchanged.data.already_committed, true);
});

test('cc pull brings a folder back and checks every file', async t => {
  const gate = await startGate(t);
  const remote = path.join(gate.sandbox, 'spaces', SPACE, 'files/out');
  fs.mkdirSync(path.join(remote, 'sub'), { recursive: true });
  const big = randomBytes(5 * 1024 * 1024 + 3);
  fs.writeFileSync(path.join(remote, 'sub/big.bin'), big);
  fs.writeFileSync(path.join(remote, 'a.txt'), 'alpha');
  mockApi(t, gate);
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'notis-pull-'));
  t.after(() => fs.rmSync(local, { recursive: true, force: true }));
  const ctx = context('cc pull', { args: { remote: 'files/out', local: path.join(local, 'copy') }, options: { space: SPACE } });
  const result = await ctx.spec.handler(ctx);
  assert.equal(result.data.files, 2);
  assert.equal(sha(fs.readFileSync(path.join(local, 'copy/sub/big.bin'))), sha(big));
  assert.equal(fs.readFileSync(path.join(local, 'copy/a.txt'), 'utf8'), 'alpha');
  const again = await ctx.spec.handler(context('cc pull', { args: { remote: 'files/out', local: path.join(local, 'copy') }, options: { space: SPACE } }));
  assert.equal(again.data.unchanged_files, 2);
});

test('cc push and pull refuse targets outside the Cloud Computer', async () => {
  const push = context('cc push', { args: { local: '.' }, options: { dest: '/etc' } });
  await assert.rejects(() => push.spec.handler(push), error => /\/vercel\/sandbox/.test(error.message));
  const spaced = context('cc push', { args: { local: '.' }, options: { space: SPACE, dest: '/vercel/sandbox/x' } });
  await assert.rejects(() => spaced.spec.handler(spaced), error => /inside the Space folder/.test(error.message));
  const pull = context('cc pull', { args: { remote: '/etc/passwd', local: '.' } });
  await assert.rejects(() => pull.spec.handler(pull), error => /\/vercel\/sandbox/.test(error.message));
});

test('a slow part keeps going while its bytes leave, and stops once they stall', async t => {
  // Seen live: on a ~5 Mbit/s link, 8 streams of 32 MiB outlasted a fixed 300 s limit and restarted forever.
  const data = randomBytes(2 * 1024 * 1024);
  const pace = idleWatchdog(400);
  const reader = streamBody(data, () => pace.touch()).getReader();
  const slices = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    slices.push(value);
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.equal(pace.signal.aborted, false, 'a part whose bytes keep leaving is never cut, however long it takes');
  assert.equal(sha(Buffer.concat(slices)), sha(data));
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(pace.signal.aborted, true, 'once nothing leaves, the part is given up');

  // Through fetch: the declared length and the streamed body reach the server whole; a server that stops reading is left.
  let stall = false;
  const server = http.createServer(async (req, res) => {
    if (stall) return;
    const hash = createHash('sha256');
    for await (const chunk of req) hash.update(chunk);
    res.end(`${req.headers['content-length']} ${hash.digest('hex')}`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const send = idle => {
    const watchdog = idleWatchdog(idle);
    return fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'PUT', duplex: 'half', signal: watchdog.signal,
      headers: { 'content-length': String(data.length) }, body: streamBody(data, () => watchdog.touch()) })
      .then(response => response.text()).finally(() => watchdog.stop());
  };
  assert.equal(await send(2000), `${data.length} ${sha(data)}`);
  stall = true;
  const started = Date.now();
  await assert.rejects(send(400));
  assert.ok(Date.now() - started < 5000, 'a stalled part is given up within its idle limit');
});
