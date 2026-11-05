/**
 * Direct Cloud Computer transfers for `notis cc push` and `notis cc pull`.
 *
 * The Notis API only opens the session (POST /portal_spaces/cloud-transfer): it decides the folder,
 * wakes the machine and signs a short transfer pass. The bytes go straight between this computer and
 * the machine's gate (https://...on.boat.dev/t/<session>/...), never through Notis servers.
 *
 * Push: a manifest of every file (sha256, size, path) is sent first; files at or below the session's
 * small-file size travel whole in tar batches, larger ones in chunks over parallel streams. The gate
 * journals each chunk once it is on disk, so a rerun (or a dropped link) asks the gate what it already
 * has and sends only the rest. Commit checks every sha256 on the machine and moves the files into place.
 *
 * Pull: the gate lists the remote files with their sha256; each is downloaded with Range requests into
 * a `.notis-part` file beside its target, resumed from what is already there, checked, then renamed.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CliError, EXIT_CODES, usageError } from './errors.js';
import { CONFIG_DIR } from './profiles.js';
import { httpRequest } from './transport.js';

export const PARALLEL_STREAMS = 8;
const LEASE_RENEW_MS = 60 * 1000;
const PROGRESS_EVERY_MS = 2000;
const MAX_ATTEMPTS = 8;
const BEGIN_ATTEMPTS = 4;
const BEGIN_RETRY_MS = 5000;
const MAX_FILES_PER_BATCH = 4000;
const STATE_VERSION = 1;
const PULL_CHUNK = 32 * 1024 * 1024;

const sleepFor = ms => new Promise(resolve => setTimeout(resolve, ms));
const STREAM_BODY_MIN = 1024 * 1024;
const STREAM_SLICE = 256 * 1024;
const SEND_IDLE_MS = 180_000;
const ANSWER_IDLE_MS = 60_000;

/** An abort signal that fires once nothing moved for `ms`; `touch` re-arms it, `stop` disarms it. */
export function idleWatchdog(ms) {
  const controller = new AbortController();
  let timer = null;
  const touch = (next = ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new Error('send_idle')), next);
    timer.unref?.();
  };
  touch();
  return { signal: controller.signal, touch, stop: () => clearTimeout(timer) };
}

/** The bytes as a stream read slice by slice, so each slice taken by the socket counts as progress. */
export function streamBody(data, onPull) {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= data.length) {
        controller.close();
        return;
      }
      const end = Math.min(data.length, offset + STREAM_SLICE);
      controller.enqueue(data.subarray(offset, end));
      offset = end;
      onPull();
    },
  });
}

export function stateDir() {
  return process.env.NOTIS_TRANSFER_STATE_DIR || path.join(CONFIG_DIR, 'transfers');
}

/** The same rule the server and the gate apply: relative, no empty, '.', '..' or control characters. */
export function validRelative(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.startsWith('/') || value.endsWith('/')) return false;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return false;
  return value.split('/').every(part => part && part !== '.' && part !== '..');
}

export function manifestText(files) {
  return files.map(file => `${file.sha256} ${file.size} ${file.path}\n`).join('');
}

function digestOf(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit += 1; }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Every regular file under `local` (or `local` itself), following links like scp does. A link loop
 * or a link to a folder already walked is skipped once.
 */
export async function collectFiles(local, { followLinks = true } = {}) {
  const top = await (followLinks ? fsp.stat(local) : fsp.lstat(local));
  if (top.isFile()) {
    return { kind: 'file', files: [{ abs: path.resolve(local), path: path.basename(local), size: top.size, mtimeMs: Math.floor(top.mtimeMs) }], skipped: [] };
  }
  if (!top.isDirectory()) throw usageError(`${local} is not a file or folder.`);
  const files = [];
  const skipped = [];
  const seen = new Set();
  const walk = async (dir, prefix) => {
    const real = await fsp.realpath(dir);
    const id = await fsp.stat(real);
    const key = `${id.dev}:${id.ino}`;
    if (seen.has(key)) { skipped.push({ path: prefix || '.', reason: 'link_loop' }); return; }
    seen.add(key);
    const entries = (await fsp.readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (!validRelative(relative)) { skipped.push({ path: relative, reason: 'name' }); continue; }
      let stat;
      try {
        stat = entry.isSymbolicLink() ? (followLinks ? await fsp.stat(abs) : null) : await fsp.lstat(abs);
      } catch {
        skipped.push({ path: relative, reason: 'broken_link' });
        continue;
      }
      if (!stat) { skipped.push({ path: relative, reason: 'link' }); continue; }
      if (stat.isDirectory()) await walk(abs, relative);
      else if (stat.isFile()) files.push({ abs, path: relative, size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) });
      else skipped.push({ path: relative, reason: 'not_a_regular_file' });
    }
  };
  await walk(path.resolve(local), '');
  return { kind: 'dir', files, skipped };
}

async function hashFile(abs) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    fs.createReadStream(abs, { highWaterMark: 4 * 1024 * 1024 }).on('data', data => hash.update(data))
      .on('error', reject).on('end', resolve);
  });
  return hash.digest('hex');
}

function statePath(key) {
  return path.join(stateDir(), `${digestOf(key).slice(0, 32)}.json`);
}

function readState(key) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath(key), 'utf8'));
    return state.version === STATE_VERSION ? state : null;
  } catch {
    return null;
  }
}

function writeState(key, state) {
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  const file = statePath(key);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ ...state, version: STATE_VERSION }), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}

/** sha256 of every file, reusing the ones a previous run computed for the same size and time. */
async function hashAll(files, cache, onProgress) {
  let done = 0;
  const queue = [...files];
  const work = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const known = cache[file.path];
      file.sha256 = known && known.size === file.size && known.mtimeMs === file.mtimeMs ? known.sha256 : await hashFile(file.abs);
      done += file.size;
      onProgress(done);
    }
  };
  await Promise.all(Array.from({ length: 4 }, work));
}

/** One ustar archive of whole files, each entry named by its index in the manifest. */
export function tarBatch(entries) {
  const blocks = [];
  for (const { index, data } of entries) {
    const header = Buffer.alloc(512);
    header.write(String(index), 0, 100, 'utf8');
    header.write('0000644\0', 100, 'ascii');
    header.write('0000000\0', 108, 'ascii');
    header.write('0000000\0', 116, 'ascii');
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
    header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136, 'ascii');
    header.write('        ', 148, 'ascii');
    header.write('0', 156, 'ascii');
    header.write('ustar\0', 257, 'ascii');
    header.write('00', 263, 'ascii');
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
    blocks.push(header, data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

async function readRange(abs, offset, length) {
  const handle = await fsp.open(abs, 'r');
  try {
    const buffer = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await handle.read(buffer, read, length - read, offset + read);
      if (!bytesRead) throw new Error('file_changed');
      read += bytesRead;
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

function transferError(code, message, details = {}) {
  return new CliError({ code, message, exitCode: EXIT_CODES.backend, details });
}

/** The API side of a session: begin, status (fresh pass), commit, abort. */
async function api(ctx, body) {
  // A machine still pausing or slow to start answers a retryable error: begin tries again before giving up.
  const attempts = body.action === 'begin' ? BEGIN_ATTEMPTS : 1;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const result = await httpRequest({ runtime: { ...ctx.runtime, timeoutMs: Math.max(ctx.runtime.timeoutMs || 0, 600_000) },
        method: 'POST', path: '/portal_spaces/cloud-transfer', body, spacesProtocol: true });
      return result.payload || {};
    } catch (error) {
      if (attempt >= attempts || !(error instanceof CliError) || !error.retryable) throw error;
      ctx.output.emitProgress({ phase: 'wait', message: 'Your Cloud Computer is starting, trying again' });
      await sleepFor(BEGIN_RETRY_MS * attempt);
    }
  }
}

/** A gate session whose pass is refreshed in the background and re-begun when the machine stopped. */
class GateSession {
  constructor(ctx, begun, beginBody) {
    this.ctx = ctx;
    this.beginBody = beginBody;
    this.apply(begun);
    this.refreshing = null;
    // Renewing more often than the server's 120 s transfer lease keeps the idle pause waiting while bytes flow,
    // even when the gate's own activity reports cannot reach Notis.
    this.timer = setInterval(() => { this.refresh().catch(() => {}); }, LEASE_RENEW_MS);
    this.timer.unref?.();
  }

  apply(answer) {
    this.answer = answer;
    this.id = answer.session_id;
    this.url = answer.transfer_url;
    this.pass = answer.pass;
  }

  async refresh() {
    if (!this.refreshing) {
      this.refreshing = api(this.ctx, { action: 'status', session_id: this.id }).then(answer => this.apply(answer))
        .finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }

  /** Wake the machine again (it may have stopped) and resume the same session. */
  async rebegin() {
    if (!this.rebeginning) {
      this.rebeginning = api(this.ctx, { ...this.beginBody, session_id: this.id }).then(answer => this.apply(answer))
        .finally(() => { this.rebeginning = null; });
    }
    return this.rebeginning;
  }

  close() {
    clearInterval(this.timer);
  }

  /** One gate request with retries: a 401 refreshes the pass, a dead link wakes the machine. */
  async fetch(route, init = {}, { expect = [200], attempts = MAX_ATTEMPTS } = {}) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let response;
      let watchdog = null;
      try {
        const body = typeof init.body === 'function' ? await init.body() : init.body;
        // A part or batch is given as long as its bytes keep leaving: on a slow link, 8 streams of 32 MiB
        // can take far longer than any fixed limit, and restarting them only sends the same bytes again.
        const streamed = body instanceof Uint8Array && body.length > STREAM_BODY_MIN ? body : null;
        let signal = AbortSignal.timeout(init.timeoutMs || 300_000);
        if (streamed) {
          watchdog = idleWatchdog(SEND_IDLE_MS);
          signal = watchdog.signal;
        }
        response = await fetch(`${this.url}/${route}`, { ...init, redirect: 'manual',
          body: streamed ? streamBody(streamed, () => watchdog.touch()) : body, ...(streamed ? { duplex: 'half' } : {}),
          headers: { ...(init.headers || {}), authorization: `Bearer ${this.pass}`,
            ...(streamed ? { 'content-length': String(streamed.length) } : {}) }, signal });
        // Bytes all sent: the gate now checks the part and answers; give that its own limit.
        watchdog?.touch(ANSWER_IDLE_MS);
      } catch (error) {
        watchdog?.stop();
        lastError = error;
        await sleepFor(Math.min(30_000, 500 * 2 ** attempt));
        if (attempt >= 2) await this.rebegin().catch(() => {});
        continue;
      }
      if (response.status === 401) {
        await response.arrayBuffer().catch(() => {});
        await this.refresh();
        continue;
      }
      if ([301, 302, 303, 307, 308, 502, 503, 504].includes(response.status)) {
        // A stopped machine answers the provider's redirect or a gateway error: wake it and go on.
        await response.arrayBuffer().catch(() => {});
        lastError = new Error(`gate_${response.status}`);
        await sleepFor(Math.min(30_000, 1000 * attempt));
        await this.rebegin().catch(() => {});
        continue;
      }
      if (expect.includes(response.status)) return response;
      let body = {};
      try { body = await response.json(); } catch { body = {}; }
      if (response.status >= 500 && attempt < attempts && body.error !== 'disk_full') {
        lastError = new Error(body.error || `gate_${response.status}`);
        await sleepFor(Math.min(30_000, 1000 * attempt));
        continue;
      }
      throw transferError(body.error === 'disk_full' ? 'cloud_computer_disk_full' : `cloud_transfer_${body.error || response.status}`,
        body.error === 'disk_full' ? 'Your Cloud Computer is out of disk space.' : `The Cloud Computer refused the transfer (${body.error || response.status}).`, body);
    }
    throw transferError('cloud_computer_unreachable', 'Your Cloud Computer stopped answering. Run the same command again to resume.',
      { reason: lastError?.message || lastError?.name });
  }

  async json(route, init, options) {
    const response = await this.fetch(route, init, options);
    return response.json();
  }
}

function progressReporter(ctx, label, total) {
  const started = Date.now();
  let last = 0;
  let sent = 0;
  const report = (force = false) => {
    const now = Date.now();
    if (!force && now - last < PROGRESS_EVERY_MS) return;
    last = now;
    const seconds = Math.max(0.001, (now - started) / 1000);
    const rate = sent / seconds;
    const percent = total ? Math.floor((sent / total) * 100) : 100;
    ctx.output.emitProgress({ phase: label, message: `${formatBytes(sent)} of ${formatBytes(total)} (${percent}%), ${formatBytes(rate)}/s` });
  };
  return {
    add(bytes) { sent += bytes; report(); },
    done() { report(true); return { bytes: sent, seconds: (Date.now() - started) / 1000 }; },
  };
}

async function pool(tasks, size, run) {
  const queue = [...tasks];
  let failure = null;
  const worker = async () => {
    while (queue.length && !failure) {
      const task = queue.shift();
      try { await run(task); } catch (error) { failure = failure || error; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, Math.max(1, queue.length)) }, worker));
  if (failure) throw failure;
}

/**
 * Push `local` to the Cloud Computer. `target` is { spaceId, dest } (dest inside the Space folder) or
 * { path } (a folder on the machine). Answers a summary with sizes, times and the session id.
 */
export async function push(ctx, local, target, { streams = PARALLEL_STREAMS, followLinks = true } = {}) {
  const collected = await collectFiles(local, { followLinks });
  const files = collected.files;
  if (!files.length) throw usageError(`${local} has no files to send.`);
  if (files.length > 200_000) throw usageError('Send at most 200000 files at once.');
  const key = JSON.stringify(['push', ctx.runtime.apiBase, ctx.runtime.profileName, path.resolve(local), target]);
  const saved = readState(key) || {};
  const total = files.reduce((sum, file) => sum + file.size, 0);
  ctx.output.emitProgress({ phase: 'scan', message: `${files.length} files, ${formatBytes(total)}${collected.skipped.length ? `, ${collected.skipped.length} skipped` : ''}` });

  const hashing = progressReporter(ctx, 'hash', total);
  let hashed = 0;
  await hashAll(files, saved.hashes || {}, done => { hashing.add(done - hashed); hashed = done; });
  const hashTime = hashing.done();
  const hashes = Object.fromEntries(files.map(file => [file.path, { size: file.size, mtimeMs: file.mtimeMs, sha256: file.sha256 }]));
  const text = manifestText(files);
  const digest = digestOf(text);

  const beginBody = { action: 'begin', direction: 'push', manifest_digest: digest, file_count: files.length, total_bytes: total,
    ...(target.spaceId ? { space_id: target.spaceId, dest: { space: target.dest || 'files' } } : { path: target.path }) };
  let begun = null;
  if (saved.session_id && saved.manifest_digest === digest) {
    try {
      begun = await api(ctx, { ...beginBody, session_id: saved.session_id });
    } catch (error) {
      if (!['cloud_transfer_conflict', 'cloud_transfer_closed', 'cloud_transfer_unknown', 'cloud_transfer_machine_changed'].includes(error.code)) throw error;
    }
  }
  if (!begun) begun = await api(ctx, beginBody);
  writeState(key, { session_id: begun.session_id, manifest_digest: digest, hashes });
  const summary = { session_id: begun.session_id, root: begun.root, files: files.length, total_bytes: total,
    skipped: collected.skipped, resumed: Boolean(begun.resumed), hash_seconds: hashTime.seconds };
  if (begun.status === 'committed') return { ...summary, status: 'committed', already_committed: true, sent_bytes: 0 };

  const session = new GateSession(ctx, begun, beginBody);
  try {
    let state = await session.json('manifest', { method: 'PUT', body: Buffer.from(text), headers: { 'content-type': 'text/plain' } });
    const smallLimit = begun.small_file_bytes;
    const batchLimit = begun.batch_bytes;
    const chunkSize = begun.chunk_size;
    const already = state.received_bytes || 0;
    if (already) ctx.output.emitProgress({ phase: 'resume', message: `${formatBytes(already)} already on the Cloud Computer` });
    const progress = progressReporter(ctx, 'send', total - already);
    const timings = { small: { bytes: 0, ms: 0 }, large: { bytes: 0, ms: 0 } };
    const largeStarted = { at: null, end: null };
    const smallStarted = { at: null, end: null };

    for (let round = 1; round <= 3; round += 1) {
      const complete = new Set(state.complete || []);
      const chunks = state.chunks || {};
      const tasks = [];
      let batch = [];
      let batchBytes = 0;
      const flush = () => {
        if (batch.length) tasks.push({ kind: 'batch', items: batch, bytes: batchBytes });
        batch = [];
        batchBytes = 0;
      };
      files.forEach((file, index) => {
        if (complete.has(index)) return;
        if (file.size <= smallLimit) {
          if (batchBytes + file.size > batchLimit || batch.length >= MAX_FILES_PER_BATCH) flush();
          batch.push(index);
          batchBytes += file.size;
          return;
        }
        const have = new Set(chunks[index] || []);
        for (let chunk = 0; chunk * chunkSize < file.size; chunk += 1) {
          if (!have.has(chunk)) tasks.push({ kind: 'chunk', index, chunk, bytes: Math.min(chunkSize, file.size - chunk * chunkSize) });
        }
      });
      flush();
      // Big chunks first, so the long tail is small batches running beside each other.
      tasks.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'chunk' ? -1 : 1));
      await pool(tasks, streams, async task => {
        const started = Date.now();
        if (task.kind === 'chunk') {
          largeStarted.at = largeStarted.at ?? started;
          const file = files[task.index];
          const offset = task.chunk * chunkSize;
          const data = await readRange(file.abs, offset, task.bytes);
          await session.fetch(`f/${task.index}?offset=${offset}`, { method: 'PUT', body: data,
            headers: { 'x-notis-sha256': createHash('sha256').update(data).digest('hex'), 'content-type': 'application/octet-stream' } });
          timings.large.bytes += task.bytes;
          largeStarted.end = Date.now();
        } else {
          smallStarted.at = smallStarted.at ?? started;
          const entries = [];
          for (const index of task.items) entries.push({ index, data: await readRange(files[index].abs, 0, files[index].size) });
          const answer = await session.json('batch', { method: 'POST', body: tarBatch(entries), headers: { 'content-type': 'application/x-tar' } },
            { expect: [200, 422] });
          if (answer.rejected?.length) {
            throw transferError('cloud_transfer_rejected', `${answer.rejected.length} files changed while they were sent. Run the same command again.`, answer);
          }
          timings.small.bytes += task.bytes;
          smallStarted.end = Date.now();
        }
        progress.add(task.bytes);
      });
      const committed = await api(ctx, { action: 'commit', session_id: session.id });
      if (committed.status === 'committed') {
        const sent = progress.done();
        writeState(key, { session_id: session.id, manifest_digest: digest, hashes, committed: true });
        const rate = (bytes, window) => (window.at && window.end > window.at ? bytes / ((window.end - window.at) / 1000) : null);
        return { ...summary, status: 'committed', committed_bytes: committed.committed_bytes, wire_bytes: committed.wire_bytes,
          sent_bytes: sent.bytes, seconds: sent.seconds, resumed_from_bytes: already,
          large: { bytes: timings.large.bytes, bytes_per_second: rate(timings.large.bytes, largeStarted) },
          small: { bytes: timings.small.bytes, bytes_per_second: rate(timings.small.bytes, smallStarted) } };
      }
      state = await session.json('state', { method: 'GET' });
    }
    throw transferError('cloud_transfer_incomplete', 'Some files did not arrive. Run the same command again to send the rest.');
  } finally {
    session.close();
  }
}

/** Pull `remote` (a file or folder on the machine) into `local`, resumable. */
export async function pull(ctx, target, local, { streams = PARALLEL_STREAMS } = {}) {
  const beginBody = { action: 'begin', direction: 'pull',
    ...(target.spaceId ? { space_id: target.spaceId, dest: { space: target.dest } } : { path: target.path }) };
  const begun = await api(ctx, beginBody);
  const session = new GateSession(ctx, begun, beginBody);
  try {
    const listing = await session.json('list?hash=1', { method: 'GET', timeoutMs: 1_800_000 });
    const single = listing.kind === 'file';
    let destination = path.resolve(local);
    if (single) {
      const isDir = fs.existsSync(destination) && fs.statSync(destination).isDirectory();
      if (isDir || local.endsWith('/')) destination = path.join(destination, path.basename(begun.root));
    }
    const files = listing.files.map(file => ({ ...file, local: single ? destination : path.join(destination, ...file.path.split('/')) }));
    for (const file of files) {
      if (!single && !validRelative(file.path)) throw transferError('cloud_transfer_bad_path', `The Cloud Computer listed an unsafe path: ${file.path}`);
    }
    const total = files.reduce((sum, file) => sum + file.size, 0);
    ctx.output.emitProgress({ phase: 'scan', message: `${files.length} files, ${formatBytes(total)}` });
    const progress = progressReporter(ctx, 'receive', total);
    let skippedSame = 0;
    const tasks = [];
    for (const file of files) {
      if (fs.existsSync(file.local) && fs.statSync(file.local).size === file.size && await hashFile(file.local) === file.sha256) {
        skippedSame += 1;
        progress.add(file.size);
        continue;
      }
      tasks.push(file);
    }
    await pool(tasks, streams, file => pullFile(session, file, progress, streams));
    const sent = progress.done();
    await api(ctx, { action: 'commit', session_id: session.id }).catch(() => ({}));
    return { session_id: session.id, root: begun.root, local: destination, files: files.length, total_bytes: total,
      unchanged_files: skippedSame, skipped: listing.skipped || [], seconds: sent.seconds, status: 'received' };
  } finally {
    session.close();
  }
}

async function pullFile(session, file, progress, streams) {
  await fsp.mkdir(path.dirname(file.local), { recursive: true });
  const part = `${file.local}.notis-part`;
  const sidecar = `${part}.json`;
  const query = `file?path=${encodeURIComponent(file.path)}`;
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(sidecar, 'utf8')); } catch { meta = {}; }
  if (meta.sha256 !== file.sha256 || meta.size !== file.size) {
    meta = { sha256: file.sha256, size: file.size, done: [] };
    await fsp.rm(part, { force: true });
  }
  const handle = await fsp.open(part, fs.existsSync(part) ? 'r+' : 'w+');
  try {
    const chunks = Math.max(1, Math.ceil(file.size / PULL_CHUNK));
    const done = new Set(meta.done);
    for (const chunk of done) progress.add(Math.min(PULL_CHUNK, file.size - chunk * PULL_CHUNK));
    const todo = [];
    for (let chunk = 0; chunk < chunks; chunk += 1) if (!done.has(chunk) && file.size > 0) todo.push(chunk);
    let saving = Promise.resolve();
    await pool(todo, file.size > PULL_CHUNK ? Math.min(streams, 4) : 1, async chunk => {
      const start = chunk * PULL_CHUNK;
      const end = Math.min(file.size, start + PULL_CHUNK) - 1;
      const response = await session.fetch(query, { method: 'GET', headers: { range: `bytes=${start}-${end}` } }, { expect: [206, 200] });
      const data = Buffer.from(await response.arrayBuffer());
      const expected = end - start + 1;
      const slice = response.status === 200 ? data.subarray(start, end + 1) : data;
      if (slice.length !== expected) throw transferError('cloud_transfer_short_read', `A part of ${file.path} came back short. Run the same command again.`);
      await handle.write(slice, 0, slice.length, start);
      done.add(chunk);
      progress.add(slice.length);
      saving = saving.then(() => fsp.writeFile(sidecar, JSON.stringify({ ...meta, done: [...done] })));
      await saving;
    });
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (await hashFile(part) !== file.sha256) {
    await fsp.rm(part, { force: true });
    await fsp.rm(sidecar, { force: true });
    throw transferError('cloud_transfer_sha256_mismatch', `${file.path} did not match its sha256. Run the same command again.`);
  }
  await fsp.rename(part, file.local);
  await fsp.rm(sidecar, { force: true });
}
