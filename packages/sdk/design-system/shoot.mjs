// Screenshots every state of a built design system book (design review spec, section 6.3).
//
//   node packages/sdk/design-system/shoot.mjs --book <dir> --out <shots dir> [--jobs 4] [--only <specimen ids>] [--no-cache]
//
// Serves the book on 127.0.0.1:0 and shoots each state's frame (`index.html?frame=...&shot=1`) with Chromium from
// `portal/node_modules/playwright` at the four matrix cells (light en 1440, dark en 1440, light fr 390, dark fr
// 768); a state's fixed width or theme collapses the cells that become identical. A shot is the
// `[data-ds-state-root]` area as PNG (the full frame height for states with a fixed height).
//
// Shots are content addressed: `<out>/<key>.png`, where the key is the sha256 of the specimen's repo inputs,
// `frame_inputs`, `css_sha256`, `versions`, the Chromium version, the build.mjs and shoot.mjs texts, the state and
// the cell. An existing PNG is reused. `<out>/shots.json` maps `"<specimen>/<state>"` to
// `{<theme>-<lang>-<width>: {sha256, file, ms, error}}`; `sha256` is the PNG bytes' hash, `file` the PNG name in
// `<out>`. A state that errors, times out or touches the network gets `error` and no file.
//
// `--only` takes specimen ids, comma separated or repeated. `--no-cache` shoots again over existing PNGs.
// Prints "Shooting <n> of <total>" as shots finish. Exit 0 once shots.json is written (failed states are data in
// it), 1 when the book cannot be read or the browser cannot start.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const PLAYWRIGHT = path.join(ROOT, 'portal', 'node_modules', 'playwright', 'index.mjs');
const FIXED_NOW = '2026-06-15T09:30:00Z';
const TIMEZONE = 'Europe/Paris';
const CELLS = [
  { theme: 'light', lang: 'en', width: 1440 },
  { theme: 'dark', lang: 'en', width: 1440 },
  { theme: 'light', lang: 'fr', width: 390 },
  { theme: 'dark', lang: 'fr', width: 768 },
];
const VIEWPORT_HEIGHT = 900;
// The frame reports a timeout itself after 20 s (frame/frame.tsx READY_TIMEOUT_MS); this is the outer guard.
const READY_WAIT_MS = 30_000;
const SHOT_WAIT_MS = 20_000;
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };

class ShootError extends Error {}

function parseArgs(argv) {
  const options = { book: null, out: null, jobs: 4, only: [], cache: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new ShootError(`${arg} needs a value`);
      index += 1;
      return next;
    };
    if (arg === '--book') options.book = path.resolve(value());
    else if (arg === '--out') options.out = path.resolve(value());
    else if (arg === '--jobs') {
      const jobs = Number(value());
      if (!Number.isInteger(jobs) || jobs < 1 || jobs > 32) throw new ShootError('--jobs must be a whole number from 1 to 32');
      options.jobs = jobs;
    } else if (arg === '--only') options.only.push(...value().split(',').map((id) => id.trim()).filter(Boolean));
    else if (arg === '--no-cache') options.cache = false;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('node packages/sdk/design-system/shoot.mjs --book <dir> --out <shots dir> [--jobs 4] [--only <specimen ids>] [--no-cache]\n');
      process.exit(0);
    } else throw new ShootError(`unknown argument ${arg}`);
  }
  if (!options.book) throw new ShootError('--book <dir> is required');
  if (!options.out) throw new ShootError('--out <shots dir> is required');
  return options;
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** JSON with sorted object keys, so a key does not depend on the order a manifest was written in. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function readManifest(book) {
  const file = path.join(book, 'manifest.json');
  if (!existsSync(file) || !existsSync(path.join(book, 'index.html'))) throw new ShootError(`${book} holds no built book (index.html and manifest.json)`);
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (manifest?.schema !== 'notis-design-book/v1' || !Array.isArray(manifest.specimens)) throw new ShootError(`${file} is not a design book manifest`);
  return manifest;
}

/** The cells a state is shot at: its fixed width and theme applied, duplicates collapsed, in matrix order. */
function stateCells(state) {
  const seen = new Map();
  for (const cell of CELLS) {
    const effective = { theme: state.theme ?? cell.theme, lang: cell.lang, width: state.width ?? cell.width };
    const key = `${effective.theme}-${effective.lang}-${effective.width}`;
    if (!seen.has(key)) seen.set(key, { key, ...effective });
  }
  return [...seen.values()];
}

/** Serves the book folder, read only, on 127.0.0.1 with a random port. */
async function serveBook(book) {
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(book, relative);
    if (file !== book && !file.startsWith(`${book}${path.sep}`)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function frameUrl(origin, specimen, state, cell) {
  const query = new URLSearchParams({ frame: specimen, state, theme: cell.theme, lang: cell.lang, w: String(cell.width), shot: '1' });
  return `${origin}/index.html?${query}`;
}

/** Shoots one state at one cell. Returns the PNG bytes, or an error text. */
async function shootOne(browser, origin, job) {
  const { specimen, state, cell } = job;
  const network = [];
  const context = await browser.newContext({
    viewport: { width: cell.width, height: state.height ?? VIEWPORT_HEIGHT },
    deviceScaleFactor: 1,
    colorScheme: cell.theme,
    locale: cell.lang,
    timezoneId: TIMEZONE,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  try {
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(`${origin}/`)) return route.continue();
      network.push(url);
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(FIXED_NOW));
    await page.goto(frameUrl(origin, specimen.id, state.id, cell), { waitUntil: 'load', timeout: READY_WAIT_MS });
    await page.waitForSelector('body[data-ds-status]', { timeout: READY_WAIT_MS, state: 'attached' }).catch(() => null);
    const result = await page.evaluate(() => ({
      status: document.body.dataset.dsStatus ?? null,
      error: document.body.dataset.dsError ?? null,
      flags: document.body.dataset.dsFlags ?? '',
    }));
    if (result.status === null) return { error: `timeout: the frame did not settle in ${READY_WAIT_MS / 1000} s` };
    if (result.status === 'timeout') return { error: `timeout: ${result.error ?? 'the state was not ready in time'}` };
    if (result.status !== 'ready') return { error: result.error ?? 'the state did not render' };
    if (network.length || result.flags.split(' ').includes('network')) {
      return { error: `network: the state reached outside the book (${network[0] ?? 'a request off the page origin'})` };
    }
    const root = page.locator('[data-ds-state-root]').first();
    if (!state.height) {
      // A state taller than the viewport gets a viewport as tall as it, so nothing scrolls during the shot.
      const bottom = await root.evaluate((element) => Math.ceil(element.getBoundingClientRect().bottom));
      if (bottom > VIEWPORT_HEIGHT) {
        await page.setViewportSize({ width: cell.width, height: bottom });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
    }
    const png = await root.screenshot({ type: 'png', animations: 'disabled', caret: 'hide', scale: 'css', timeout: SHOT_WAIT_MS });
    return { png };
  } catch (error) {
    const text = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return { error: /timeout/i.test(text) ? `timeout: ${text}` : text };
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = readManifest(options.book);
  const known = new Set(manifest.specimens.map((specimen) => specimen.id));
  const unknown = options.only.filter((id) => !known.has(id));
  if (unknown.length) throw new ShootError(`no specimen ${unknown.join(', ')} in ${options.book}`);
  const only = options.only.length ? new Set(options.only) : null;
  mkdirSync(options.out, { recursive: true });

  if (!existsSync(PLAYWRIGHT)) throw new ShootError(`Playwright is not installed at ${PLAYWRIGHT} (run npm install in portal/)`);
  const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href);
  const browser = await chromium.launch();
  const { server, origin } = await serveBook(options.book);
  const stop = async () => {
    await browser.close().catch(() => {});
    server.close();
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop().finally(() => process.exit(1)); });

  try {
    const shared = {
      frame_inputs: manifest.frame_inputs ?? {},
      css_sha256: manifest.css_sha256 ?? null,
      versions: manifest.versions ?? {},
      chromium: browser.version(),
      build: manifest.build_sha256 ?? sha256(readFileSync(path.join(HERE, 'build.mjs'))),
      shoot: sha256(readFileSync(fileURLToPath(import.meta.url))),
    };
    const jobs = [];
    for (const specimen of manifest.specimens) {
      if (only && !only.has(specimen.id)) continue;
      for (const state of specimen.states) {
        for (const cell of stateCells(state)) {
          const key = sha256(canonical({ ...shared, specimen: specimen.id, file: specimen.file, inputs: specimen.inputs ?? {}, state, cell: cell.key }));
          jobs.push({ specimen, state, cell, key });
        }
      }
    }

    // Filled in job order, so shots.json is the same whatever order the shots finish in.
    const shots = {};
    for (const { specimen, state, cell } of jobs) (shots[`${specimen.id}/${state.id}`] ??= {})[cell.key] = null;
    let done = 0;
    let cached = 0;
    let failed = 0;
    let next = 0;
    const total = jobs.length;
    console.log(`Shooting 0 of ${total} (Chromium ${shared.chromium}, ${options.jobs} at a time)`);
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        const file = `${job.key}.png`;
        const target = path.join(options.out, file);
        const started = Date.now();
        let record;
        if (options.cache && existsSync(target)) {
          cached += 1;
          record = { sha256: sha256(readFileSync(target)), file, ms: 0, error: null };
        } else {
          const result = await shootOne(browser, origin, job);
          const ms = Date.now() - started;
          if (result.png) {
            const temporary = `${target}.${process.pid}.tmp`;
            writeFileSync(temporary, result.png);
            renameSync(temporary, target);
            record = { sha256: sha256(result.png), file, ms, error: null };
          } else {
            failed += 1;
            record = { sha256: null, file: null, ms, error: result.error };
          }
        }
        shots[`${job.specimen.id}/${job.state.id}`][job.cell.key] = record;
        done += 1;
        const failure = record.error ? `: ${job.specimen.id}/${job.state.id} ${job.cell.key} failed (${record.error})` : '';
        console.log(`Shooting ${done} of ${total}${failure}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(options.jobs, Math.max(total, 1)) }, worker));

    const output = path.join(options.out, 'shots.json');
    const temporary = `${output}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(shots, null, 2)}\n`);
    renameSync(temporary, output);
    console.log(`Wrote ${output}: ${total} shots, ${cached} reused, ${failed} failed`);
  } finally {
    await stop();
  }
}

main().catch((error) => {
  const message = error instanceof ShootError ? error.message : error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`ERROR the shots did not run: ${message}\n`);
  process.exit(1);
});
