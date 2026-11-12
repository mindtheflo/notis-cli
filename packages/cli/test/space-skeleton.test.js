import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import { spacesCommandSpecs } from '../src/command-specs/spaces.js';
import { appFilesDigest, saveSpacePendingScreenshots, saveSpaceScreenshots } from '../src/runtime/app-platform.js';
import { buildSpaceArtifact } from '../src/runtime/space-platform.js';
import { verifySpaceRelease } from '../src/runtime/space-verification.js';
import { createSpaceFixtureBroker } from '../src/runtime/space-fixture-broker.js';
import * as renderer from '../../view-renderer/src/index.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const b = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const SKELETON = 'bundle/skeleton.json';
const rendererDigest = sha256('space-skeleton-test');

// ---------- Real browser: the measured skeleton looks like the final view (spike metric) ----------

/** Minimal PNG reader for Chromium screenshots: 8-bit RGB or RGBA, not interlaced. Returns RGBA rows. */
function decodePng(png) {
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'a PNG file');
  let offset = 8, width = 0, height = 0, colorType = 0;
  const data = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset), type = png.subarray(offset + 4, offset + 8).toString('latin1');
    const chunk = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); colorType = chunk[9];
      assert.equal(chunk[8], 8, '8-bit channels'); assert.equal(chunk[12], 0, 'not interlaced');
      assert.ok([2, 6].includes(colorType), 'RGB or RGBA');
    } else if (type === 'IDAT') data.push(chunk);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : 3, stride = width * channels;
  const raw = inflateSync(Buffer.concat(data)), pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? line[i - channels] : 0, up = previous[i], corner = i >= channels ? previous[i - channels] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      line[i] = (line[i] + add) & 255;
    }
    for (let x = 0; x < width; x++) {
      const from = x * channels, to = (y * width + x) * 4;
      pixels[to] = line[from]; pixels[to + 1] = line[from + 1]; pixels[to + 2] = line[from + 2];
      pixels[to + 3] = channels === 4 ? line[from + 3] : 255;
    }
    previous = line;
  }
  return { width, height, pixels };
}

/** The spike's metric: ink on a 24 px grid below the region top, against the final view's background. */
function gridIou(final, pending, regionTop, height) {
  const W = final.width, H = height;
  const F = final.pixels, P = pending.pixels;
  const at = (H - 2) * W * 4 + 4;
  const bg = [F[at], F[at + 1], F[at + 2]];
  const CELL = 24, top = Math.max(0, Math.round(regionTop)), gw = Math.ceil(W / CELL), gh = Math.ceil((H - top) / CELL);
  const mask = D => {
    const m = new Uint8Array(gw * gh);
    for (let y = top; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (Math.abs(D[i] - bg[0]) + Math.abs(D[i + 1] - bg[1]) + Math.abs(D[i + 2] - bg[2]) > 18) m[Math.floor((y - top) / CELL) * gw + Math.floor(x / CELL)] = 1;
    }
    return m;
  };
  const a = mask(F), c = mask(P);
  let i = 0, u = 0;
  for (let k = 0; k < a.length; k++) { i += a[k] & c[k]; u += a[k] | c[k]; }
  return u ? i / u : 1;
}

const RECORD = '11111111-1111-4111-8111-111111111111';
// A list view: a toolbar, then rows of an avatar, a title and a date. While the read is pending it renders
// ViewSkeleton in the same container, as the Spaces design guide asks.
const LIST_BUNDLE = `
import { jsx, jsxs } from "react/jsx-runtime";
import { useContext, useEffect, useState } from "react";
import { ViewSkeleton } from "@notis/sdk";
const ROWS = Array.from({ length: 20 }, (_, index) => index);
const block = (width, height, color) => ({ display: "block", width, height, background: color, borderRadius: 6, flex: "none" });
function Row({ index }) {
  return jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12, height: 56 }, children: [
    jsx("span", { style: block(32, 32, "#c9ced6") }),
    jsx("span", { style: block(index % 2 ? "46%" : "38%", 14, "#d5d9e0") }),
    jsx("span", { style: { ...block(64, 14, "#d5d9e0"), marginLeft: "auto" } }),
  ] });
}
export function SpaceView() {
  const runtime = useContext(globalThis[Symbol.for("notis.sdk.runtime_context")]);
  const [body, setBody] = useState(null);
  useEffect(() => { runtime.documentBody({ operation: "read", binding: "notes", readAction: "read", recordKey: "${RECORD}" }).then(setBody); }, []);
  return jsx("main", { style: { padding: 16, background: "#ffffff" }, children: body
    ? jsxs("div", { children: [
        jsx("div", { style: { display: "flex", gap: 8, height: 44, alignItems: "center" }, children: [jsx("span", { style: block(120, 28, "#c9ced6") }), jsx("span", { style: block(88, 28, "#c9ced6") })] }),
        ...ROWS.map(index => jsx(Row, { index }, index)),
      ] })
    : jsx(ViewSkeleton, { label: "Loading notes" }) });
}
`;

function listRelease() {
  const inputs = { type: 'object', required: ['request'], properties: { request: { type: 'object' } } };
  const release = { manifest: { local_key: 'skeleton-list', name: 'Skeleton list', kind: 'presentation',
    actions: { read: { tool: 'LOCAL_NOTIS_DATABASE_QUERY', inputs, arguments: { database_id: { $asset: 'notes' }, request: { $input: 'request' } } } },
    resources: { notes: { kind: 'database', key: 'notes' } }, params: {}, shows: {}, bundle: { js: 'bundle/app.js' } },
  files: { 'bundle/app.js': b(LIST_BUNDLE) }, fixturePath: 'fixtures.json', sourceFiles: { 'fixtures.json': b({ actions: {}, documentBodies: [{
    request: { operation: 'read', binding: 'notes', readAction: 'read', recordKey: RECORD },
    result: { record_key: RECORD, title: 'Fixture', revision: 1, schema_revision: 1, content_markdown: 'Fixture notes' },
  }] }) } };
  return { release, capabilities: { actions: { read: { inputSchema: inputs, readOnly: true } }, bindings: {} } };
}

test('the measured skeleton matches the final view at 390 and 1440 (IoU of at least 0.85 on a 24 px grid)', async t => {
  const { release, capabilities } = listRelease();
  const result = await verifySpaceRelease(release, { capabilities, loadRenderer: async () => ({ ...renderer, rendererDigest }) });
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.equal(result.skeleton.status, 'captured', JSON.stringify(result.skeleton));
  assert.deepEqual(result.skeleton.regions, ['main']);
  assert.equal(renderer.validateSkeletonDocument(result.skeletonDocument, { appJsSha256: sha256(Buffer.from(release.files['bundle/app.js'], 'base64')) }), null);
  assert.equal(result.skeletonJson, renderer.canonicalSkeletonJson(result.skeletonDocument));
  assert.equal(result.pendingScreenshots.length, 4);
  const pool = renderer.createBrowserPool({ concurrency: 2, maxQueue: 2 });
  try {
    for (const width of [390, 1440]) {
      const broker = outputs => createSpaceFixtureBroker({ release, capabilities, width, outputs });
      const finalShot = (await renderer.renderView({ broker: broker(['markdown', 'screenshot']), pool, outputs: ['markdown', 'screenshot'], width })).screenshot;
      const regionTop = (await renderer.renderView({ broker: broker(['markdown']), pool, outputs: ['markdown'], width, pending: true, locale: 'en' }))
        .pending.regions.find(region => region.key === 'main').y;
      const pending = decodePng(result.pendingScreenshots.find(value => value.width === width && value.locale === 'en').png);
      const final = decodePng(Buffer.from(finalShot.data_base64, 'base64'));
      assert.equal(final.width, pending.width);
      assert.ok(final.height >= pending.height, 'the final page is at least one viewport tall');
      let differing = 0;
      for (let k = 0; k < pending.pixels.length; k += 4) if (pending.pixels[k] !== final.pixels[k] || pending.pixels[k + 1] !== final.pixels[k + 1]) differing++;
      t.diagnostic(`pixels differing at ${width}: ${differing} of ${pending.pixels.length / 4}; region top ${regionTop}`);
      assert.ok(differing > 1000, 'the pending screenshot shows the skeleton, not the loaded view');
      const iou = gridIou(final, pending, regionTop, pending.height);
      t.diagnostic(`IoU at ${width}: ${iou.toFixed(3)}`);
      assert.ok(iou >= 0.85, `IoU at ${width} is ${iou.toFixed(3)}`);
    }
  } finally { await pool.close(); }
});

// ---------- sourceRelease: injection, second source-verify, retry, stale file, warnings ----------

const VIEW_DECLARATION = `path:'board',description:'A skeleton contract fixture.',memory:{markdown:false,attachments:false,screenshot:false,snapshots:[]}`;

/** One presentation Space built by a stub bundler, which may also leave a hand-written bundle/skeleton.json. */
async function builtSpace(t, { staleSkeleton = null, keys = ['board'] } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'notis-space-skeleton-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of [...keys.map(key => `spaces/${key}`), 'node_modules/.bin']) mkdirSync(join(root, dir), { recursive: true });
  symlinkSync(join(repo, 'packages/sdk/node_modules/typescript'), join(root, 'node_modules/typescript'), 'dir');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'space-skeleton-fixture', private: true, scripts: { build: 'fixture-build' } }));
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { moduleResolution: 'bundler', module: 'ESNext', jsx: 'react-jsx' } }));
  writeFileSync(join(root, 'notis.config.ts'), `import { defineSpaces } from '@notis/sdk/config';
export default defineSpaces({ spaces: { ${keys.map(key => `${key}: { definition: 'spaces/${key}/space.config.ts' }`).join(', ')} } });`);
  for (const key of keys) {
    writeFileSync(join(root, `spaces/${key}/space.config.ts`), `import { defineSpace } from '@notis/sdk/config';
export default defineSpace({ name: '${key}', icon: 'phosphor:kanban', ${VIEW_DECLARATION}, entry: './view.tsx' });`);
    writeFileSync(join(root, `spaces/${key}/view.tsx`), 'export default function View() { return null; }\n');
  }
  writeFileSync(join(root, 'node_modules/.bin/fixture-build'), `#!/usr/bin/env node
const fs = require('node:fs');
fs.mkdirSync('.notis/output/bundle', { recursive: true });
fs.writeFileSync('.notis/output/bundle/app.js', 'export default function SpaceView() { return null; }');
fs.writeFileSync('.notis/output/bundle/app.css', '[data-notis-app-root]{}');
${staleSkeleton ? `fs.writeFileSync('.notis/output/bundle/skeleton.json', ${JSON.stringify(staleSkeleton)});` : ''}
`, { mode: 0o755 });
  for (const key of keys) await buildSpaceArtifact(root, key, { stdio: 'pipe', refreshSdk: false });
  return root;
}

/**
 * The real capture code over a scripted renderer: each render answers like the browser would, so the test
 * controls what is measured without Chromium. `state.mode` picks the loading behaviour.
 */
function scriptedRenderer(state) {
  const shot = (label, width) => ({ data_base64: b(`png ${label} ${width}`), width, height: 900 });
  return async () => ({ ...renderer, rendererDigest, createBrowserPool: () => ({ close: async () => {} }),
    async renderView({ width, pending, measure, locale, skeleton, readyTimeoutMs }) {
      state.renders.push({ width, pending: Boolean(pending), measure: Boolean(measure), locale, skeleton: Boolean(skeleton), readyTimeoutMs });
      if (pending) {
        if (state.mode === 'static') return { pending: { static: true, reads: 0, regions: [], landmarks: [] }, screenshot: shot('static', width) };
        return { pending: { static: false, reads: 1, viewport: { width, height: 900 }, landmarks: [],
          regions: [{ key: 'main', valid: true, x: 0, y: 0, width, height: 300, ink: 5000, bones: 4 }],
          ...(state.mode === 'warnings' ? { loadingText: 'Loading', emptyStates: 1 } : {}) },
        screenshot: shot(`${skeleton ? 'checked' : 'first'} ${locale}`, width) };
      }
      if (measure) {
        if (state.mode === 'broken') throw Object.assign(new Error('measure failed'), { code: 'fixture_measure_failed' });
        return { skeleton_measure: { landmarks: [], regions: [{ key: 'main', width, y: 0, groups: [],
          bones: [[0, 0, state.boneWidth, 300, 8, 0]] }] } };
      }
      if (state.failWidth === width) {
        if (state.mode !== 'not_ready') throw new renderer.ViewRenderError('render_failed', 'The view could not be rendered.');
        throw Object.defineProperties(new renderer.ViewRenderError('render_not_ready', 'Not ready.', 504),
          { screenshot: { value: shot('still loading', width) }, mounted: { value: true }, waitedSeconds: { value: 38 },
            blocked: { value: [{ code: 'render_read_only' }] } });
      }
      return { markdown: '# Board', screenshot: shot('final', width), rendered_at: new Date().toISOString(), blocked_calls: [] };
    } });
}

function context(path, options, args, loadSpaceRenderer) {
  const spec = spacesCommandSpecs.find(value => value.command_path.join(' ') === path);
  assert.ok(spec);
  return { spec, options, args, globalOptions: {}, loadSpaceRenderer, runtime: { credentialKind: 'env', profileName: 'spaces-unit-only',
    jwt: 'fixture-not-a-real-credential', apiBase: 'https://fixture.invalid', timeoutMs: 1000, cliVersion: 'fixture' },
  output: { emitSuccess: value => value } };
}

/** A server stand-in: source-verify binds exactly the bytes it was sent. */
function server(t, { publish = () => new Response('{"published_revision":1}') } = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    const body = JSON.parse(request.body); calls.push({ url, body });
    if (url.endsWith('/source-verify')) return new Response(JSON.stringify({ valid: true, actor_id: 'fixture-user',
      space_id: body.space_id, revision: 0, bindings: {}, reuse_grants: body.reuse_grants, capabilities: { actions: {}, bindings: {} },
      source_digest: appFilesDigest(body.source_files), artifact_digest: appFilesDigest(body.artifact_files) }));
    return publish(url, body);
  });
  return { calls, verifies: () => calls.filter(call => call.url.endsWith('/source-verify')), publishes: () => calls.filter(call => call.url.endsWith('/source-publish')) };
}

const decoded = encoded => JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));

// A view with two tabs: it opens on the list, and on the board when its `tab` param says so. Each tab loads with
// its own region, so only measuring the board through context.skeletonParams gives it its own bones.
const TABS_BUNDLE = LIST_BUNDLE
  .replace('export function SpaceView() {', 'export function SpaceView() {\n  const tab = useContext(globalThis[Symbol.for("notis.sdk.runtime_context")])?.context?.params?.tab;')
  .replace('jsx(ViewSkeleton, { label: "Loading notes" })', 'jsx(ViewSkeleton, { label: "Loading notes", skeletonKey: tab === "board" ? "board" : "main" })');

test('regions a view shows only under other params are measured from fixtures context.skeletonParams', async t => {
  const { release, capabilities } = listRelease();
  release.files['bundle/app.js'] = b(TABS_BUNDLE);
  const fixtures = JSON.parse(Buffer.from(release.sourceFiles['fixtures.json'], 'base64').toString());
  release.sourceFiles['fixtures.json'] = b({ ...fixtures, context: { skeletonParams: [{ tab: 'board' }, { bad: 1 }] } });
  const result = await verifySpaceRelease(release, { capabilities, loadRenderer: async () => ({ ...renderer, rendererDigest }) });
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.equal(result.skeleton.status, 'captured', JSON.stringify(result.skeleton));
  assert.deepEqual(result.skeleton.regions, ['board', 'main'], 'the opening view and the board tab both have bones');
  for (const width of ['390', '1440']) for (const locale of ['en', 'fr']) {
    assert.ok(result.skeletonDocument.regions.board[width][locale].bones.length > 0, `${width} ${locale}`);
  }
});

// A view that draws an editors' page and a public page, each loading with its own region. The Space marks an action
// editor-only, so the one skeleton every visitor sees is measured from the public page, never from the editors' one.
const AUDIENCE_BUNDLE = LIST_BUNDLE
  .replace('export function SpaceView() {', 'export function SpaceView() {\n  const space = useContext(globalThis[Symbol.for("notis.sdk.runtime_context")])?.space;\n  const editor = space?.audience === "editor" && space?.viewAs !== "public";')
  .replace('jsx(ViewSkeleton, { label: "Loading notes" })', 'jsx(ViewSkeleton, { label: "Loading notes", skeletonKey: editor ? "editors" : "public" })');

test('a Space with editor-only parts measures its skeleton from the view the public sees', async t => {
  const { release, capabilities } = listRelease();
  release.files['bundle/app.js'] = b(AUDIENCE_BUNDLE);
  // The public reads a document body only through a binding the Space declares.
  capabilities.bindings = { notes: { kind: 'database' } };
  const result = await verifySpaceRelease(release, { capabilities, loadRenderer: async () => ({ ...renderer, rendererDigest }) });
  assert.equal(result.skeleton.audience, 'editor', 'nothing marked: measured as the editor, as before');
  assert.deepEqual(result.skeleton.regions, ['editors']);

  release.manifest.editors_only = { actions: ['write'] };
  const marked = await verifySpaceRelease(release, { capabilities, loadRenderer: async () => ({ ...renderer, rendererDigest }) });
  assert.equal(marked.status, 'passed', JSON.stringify(marked));
  assert.equal(marked.skeleton.audience, 'public');
  assert.deepEqual(marked.skeleton.regions, ['public'], 'the editors\u2019 page never becomes the skeleton visitors see');

  release.manifest.editors_only = { view: true };
  const editorsView = await verifySpaceRelease(release, { capabilities, loadRenderer: async () => ({ ...renderer, rendererDigest }) });
  assert.equal(editorsView.skeleton.audience, 'editor', 'a wholly editor-only view has no public to draw');
  assert.deepEqual(editorsView.skeleton.regions, ['editors']);
});

test('verify adds the measured skeleton in memory and binds it with a second source-verify', async t => {
  const root = await builtSpace(t), api = server(t), state = { mode: 'clean', boneWidth: 100, renders: [] };
  const ctx = context('spaces verify', { space: 'board', spaceId: 'fixture-space' }, { dir: root }, scriptedRenderer(state));
  const result = await ctx.spec.handler(ctx);
  const [first, second] = api.verifies();
  assert.equal(api.verifies().length, 2);
  assert.equal(first.body.artifact_files[SKELETON], undefined, 'the first verify sees the build as built');
  const app = Buffer.from(second.body.artifact_files['bundle/app.js'], 'base64');
  const skeleton = decoded(second.body.artifact_files[SKELETON]);
  assert.equal(skeleton.schema, 'notis-space-skeleton/v1');
  assert.equal(skeleton.sourceHash, sha256(app));
  assert.deepEqual(Object.keys(skeleton.regions.main).sort(), ['1440', '390']);
  assert.deepEqual(Object.keys(skeleton.regions.main['390']).sort(), ['en', 'fr']);
  assert.equal(Buffer.from(second.body.artifact_files[SKELETON], 'base64').toString('utf8'), renderer.canonicalSkeletonJson(skeleton));
  assert.equal(renderer.validateSkeletonDocument(skeleton, { appJsSha256: sha256(app) }), null);
  const { [SKELETON]: _added, ...rest } = second.body.artifact_files;
  assert.deepEqual(rest, first.body.artifact_files, 'nothing else in the release changes');
  assert.equal(result.data.artifact_digest, appFilesDigest(second.body.artifact_files));
  assert.equal(existsSync(join(root, '.notis/output/bundle/skeleton.json')), false, 'the skeleton is never written into the build');
  assert.equal(state.renders.filter(value => value.skeleton).length, 4, 'pass 3 renders each width and locale with the skeleton');
  const shots = result.data.render.skeleton.pending_screenshots;
  assert.deepEqual(shots.map(value => `${value.width}-${value.locale}`).sort(), ['1440-en', '1440-fr', '390-en', '390-fr']);
  for (const value of shots) {
    assert.equal(value.path, join(root, '.notis', `pending-board-${value.width}-${value.locale}.png`));
    assert.equal(sha256(readFileSync(value.path)), value.sha256);
  }
  const diagnostic = JSON.parse(readFileSync(result.data.diagnostic_path, 'utf8'));
  assert.equal(diagnostic.skeleton.status, 'captured');
  assert.equal(diagnostic.skeleton.pending_screenshots.length, 4);
  assert.match(result.humanSummary, /Loading skeleton measured for main\./);
  assert.match(result.humanSummary, /Loading screenshots: .*pending-board-390-en\.png/);
  assert.deepEqual(result.warnings ?? [], []);
});

test('verify saves the screenshots of the loaded view at both widths and prints where they are', async t => {
  const root = await builtSpace(t); server(t);
  const state = { mode: 'clean', boneWidth: 100, renders: [] };
  const ctx = context('spaces verify', { space: 'board', spaceId: 'fixture-space' }, { dir: root }, scriptedRenderer(state));
  const result = await ctx.spec.handler(ctx);
  const finals = state.renders.filter(value => !value.pending && !value.measure);
  assert.deepEqual(finals.map(value => value.readyTimeoutMs), [40_000, 40_000], 'each screenshot waits up to 40 s for the data');
  for (const value of result.data.render.renders) {
    assert.equal(value.loaded, true);
    assert.equal(value.screenshot_path, join(root, '.notis', `view-board-${value.width}.png`));
    const png = readFileSync(value.screenshot_path);
    assert.equal(png.toString('utf8'), `png final ${value.width}`, 'the screenshot taken after the data arrived, not a loading one');
    assert.equal(sha256(png), value.screenshot_sha256);
  }
  const diagnostic = JSON.parse(readFileSync(result.data.diagnostic_path, 'utf8'));
  assert.equal(diagnostic.renders.every(value => value.loaded === true && value.screenshot_path), true);
  assert.equal(JSON.stringify(diagnostic).includes(b('png final 390')), false, 'the image bytes stay out of the diagnostic');
  assert.match(result.humanSummary, /Screenshots after the data loaded: [^ ]*view-board-390\.png, [^ ]*view-board-1440\.png\./);
});

test('a view still loading after the bounded wait keeps its screenshot, and verify says so', async t => {
  const root = await builtSpace(t); server(t);
  const state = { mode: 'not_ready', failWidth: 390, boneWidth: 100, renders: [] };
  const ctx = context('spaces verify', { space: 'board', spaceId: 'fixture-space' }, { dir: root }, scriptedRenderer(state));
  const shot = join(root, '.notis', 'view-board-390.png');
  await assert.rejects(ctx.spec.handler(ctx), error => {
    assert.match(error.message, /did not pass offline render verification/);
    // The seconds it actually waited: the wait also leaves the capture room before the render deadline.
    assert.match(error.message, new RegExp(`At 390 px the view had not finished loading its data after 38 s; ${shot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} shows what it showed then\.`));
    assert.match(error.message, /Screenshots after the data loaded: [^ ]*view-board-1440\.png\./);
    const notReady = error.details.render.renders.find(value => value.width === 390);
    assert.deepEqual(notReady.blocked_calls, [{ code: 'render_read_only' }], 'the calls it blocked while loading are kept');
    assert.equal(error.details.render.errors.filter(value => value.width === 390).length, 1);
    return true;
  });
  assert.equal(readFileSync(shot, 'utf8'), 'png still loading 390');
  assert.equal(readFileSync(join(root, '.notis', 'view-board-1440.png'), 'utf8'), 'png final 1440');
  // A later verify whose 390 render fails outright leaves no stale image behind.
  state.mode = 'broken_render';
  await assert.rejects(ctx.spec.handler(ctx), /did not pass offline render verification/);
  assert.equal(existsSync(shot), false);
  // Nor does one that stops before rendering anything (here the renderer cannot load).
  assert.equal(existsSync(join(root, '.notis', 'view-board-1440.png')), true);
  const stopped = context('spaces verify', { space: 'board', spaceId: 'fixture-space' }, { dir: root },
    async () => { throw new Error('The shared view renderer is missing.'); });
  await assert.rejects(stopped.spec.handler(stopped), /did not pass offline render verification/);
  assert.equal(existsSync(join(root, '.notis', 'view-board-1440.png')), false);
  // Nor one the server refuses before verify renders anything.
  state.mode = 'clean'; delete state.failWidth;
  await ctx.spec.handler(ctx);
  assert.equal(existsSync(shot), true);
  t.mock.method(globalThis, 'fetch', async () => new Response('{"message":"source refused"}', { status: 422 }));
  await assert.rejects(ctx.spec.handler(ctx));
  assert.equal(existsSync(shot), false);
  assert.equal(existsSync(join(root, '.notis', 'view-board-1440.png')), false);
});

test('two Spaces verified from one folder keep their own images, and older unnamed images are removed', async t => {
  const root = await builtSpace(t, { keys: ['board', 'notes'] }); server(t);
  const legacy = ['view-390.png', 'view-1440.png', 'pending-390-en.png', 'pending-1440-fr.png'].map(name => join(root, '.notis', name));
  for (const path of legacy) writeFileSync(path, 'png from an older CLI');
  const run = (space, state) => { const ctx = context('spaces verify', { space, spaceId: `fixture-${space}` }, { dir: root }, scriptedRenderer(state)); return ctx.spec.handler(ctx); };
  const board = await run('board', { mode: 'clean', boneWidth: 100, renders: [] });
  for (const path of legacy) assert.equal(existsSync(path), false, `${path} names no Space, so it is removed`);
  const notes = await run('notes', { mode: 'clean', boneWidth: 100, renders: [] });
  const paths = result => [...result.data.render.renders.map(value => value.screenshot_path), ...result.data.render.skeleton.pending_screenshots.map(value => value.path)];
  assert.equal(paths(board).length, 6);
  assert.equal(paths(notes).length, 6);
  for (const path of paths(board)) {
    assert.match(path, /[/\\](view|pending)-board-/);
    assert.equal(paths(notes).includes(path), false, 'no file is shared');
    assert.equal(existsSync(path), true, `${path} survives the other Space's verify`);
  }
  assert.match(notes.humanSummary, /Screenshots after the data loaded: [^ ]*view-notes-390\.png, [^ ]*view-notes-1440\.png\./);
  assert.equal(readFileSync(join(root, '.notis', 'view-board-390.png'), 'utf8'), 'png final 390');
});

test('a verify refused for a build older than its source keeps no image of that build', async t => {
  const root = await builtSpace(t); server(t);
  const ctx = context('spaces verify', { space: 'board', spaceId: 'fixture-space' }, { dir: root }, scriptedRenderer({ mode: 'clean', boneWidth: 100, renders: [] }));
  await ctx.spec.handler(ctx);
  const images = ['view-board-390.png', 'view-board-1440.png', 'pending-board-390-en.png'].map(name => join(root, '.notis', name));
  assert.ok(images.every(path => existsSync(path)));
  writeFileSync(join(root, 'spaces/board/view.tsx'), 'export default function View() { return 1; }\n');
  await assert.rejects(ctx.spec.handler(ctx), /Selected Space build is missing or stale/);
  for (const path of images) assert.equal(existsSync(path), false, `${path} shows a build its source no longer matches`);
});

test('a new build of a Space removes its verify images; a folder never built or a bad key fails with the release step words', async t => {
  const root = await builtSpace(t); server(t);
  const verify = (space) => { const ctx = context('spaces verify', { space, spaceId: 'fixture-space' }, { dir: root }, scriptedRenderer({ mode: 'clean', boneWidth: 100, renders: [] })); return ctx.spec.handler(ctx); };
  await verify('board');
  const images = ['view-board-390.png', 'pending-board-1440-fr.png'].map(name => join(root, '.notis', name));
  assert.ok(images.every(path => existsSync(path)));
  await buildSpaceArtifact(root, 'board', { stdio: 'pipe', refreshSdk: false });
  for (const path of images) assert.equal(existsSync(path), false, `${path} showed the build this one replaced`);
  await assert.rejects(verify('Board'), /Space must be a stable lowercase source key/);
  rmSync(join(root, '.notis'), { recursive: true, force: true });
  await assert.rejects(verify('board'), error => { assert.doesNotMatch(error.message, /screenshot/i); return true; });
  assert.equal(existsSync(join(root, '.notis')), false, 'verify never makes a build workspace');
});

test('an image verify cannot name writes nothing, not even the images before it', async t => {
  const root = await builtSpace(t);
  const png = Buffer.from('png');
  assert.throws(() => saveSpaceScreenshots(root, 'board', [{ width: 390, png }, { width: 768, png }]), /Unsafe screenshot name/);
  assert.throws(() => saveSpacePendingScreenshots(root, 'board', [{ width: 390, locale: 'en', png }, { width: 390, locale: 'de', png }]), /Unsafe pending screenshot name/);
  assert.throws(() => saveSpaceScreenshots(root, '../board', [{ width: 390, png }]), /Unsafe screenshot name/);
  for (const name of ['view-board-390.png', 'pending-board-390-en.png']) assert.equal(existsSync(join(root, '.notis', name)), false, name);
});

test('a release without a loading skeleton keeps no loading screenshot of an earlier verify', async t => {
  const root = await builtSpace(t); server(t);
  const run = state => { const ctx = context('spaces verify', { space: 'board', spaceId: 'fixture-space' }, { dir: root }, scriptedRenderer(state)); return ctx.spec.handler(ctx); };
  const first = await run({ mode: 'clean', boneWidth: 100, renders: [] });
  const pending = first.data.render.skeleton.pending_screenshots.map(value => value.path);
  assert.equal(pending.length, 4);
  assert.ok(pending.every(path => existsSync(path)));
  const second = await run({ mode: 'static', boneWidth: 100, renders: [] });
  assert.equal(second.data.render.skeleton.status, 'none');
  for (const path of pending) assert.equal(existsSync(path), false, `${path} is gone: this release has no skeleton`);
  assert.doesNotMatch(second.humanSummary, /Loading screenshots/);
  // Nor does a verify whose renders fail before the skeleton is measured.
  await run({ mode: 'clean', boneWidth: 100, renders: [] });
  assert.ok(pending.every(path => existsSync(path)));
  await assert.rejects(run({ mode: 'broken_render', failWidth: 390, boneWidth: 100, renders: [] }), /did not pass offline render verification/);
  for (const path of pending) assert.equal(existsSync(path), false);
});

test('a retried deploy reuses the stored verification and sends the same skeleton bytes', async t => {
  const root = await builtSpace(t);
  let lost = true;
  const api = server(t, { publish: () => lost ? new Response('{"message":"reply lost"}', { status: 503 })
    : new Response('{"published_revision":1,"replayed":true}') });
  const state = { mode: 'clean', boneWidth: 100, renders: [] };
  const ctx = context('spaces deploy', { space: 'board', spaceId: 'fixture-space', requestId: 'skeleton-intent' }, { dir: root }, scriptedRenderer(state));
  await assert.rejects(ctx.spec.handler(ctx));
  assert.equal(api.verifies().length, 2);
  lost = false; state.boneWidth = 60;
  const result = await ctx.spec.handler(ctx);
  assert.equal(result.data.replayed, true);
  assert.equal(api.verifies().length, 2, 'the retry makes no new source-verify');
  const [attempt, retry] = api.publishes();
  assert.deepEqual(retry.body.artifact_files, attempt.body.artifact_files, 'identical bytes although this verify measured other bones');
  assert.ok(retry.body.artifact_files[SKELETON]);
  assert.equal(decoded(retry.body.artifact_files[SKELETON]).regions.main['390'].en.bones[0][2], 100);
  assert.equal(retry.body.verification.artifact_digest, appFilesDigest(retry.body.artifact_files));
  assert.deepEqual(retry.body.verification, attempt.body.verification);
  for (const call of api.publishes()) {
    for (const key of ['local_skeleton', 'local_changes_fingerprint', 'local_state']) assert.equal(Object.hasOwn(call.body.verification, key), false);
  }
});

test('a hand-written bundle/skeleton.json is removed when nothing is measured and replaced when bones are', async t => {
  const stale = JSON.stringify({ schema: 'notis-space-skeleton/v1', sourceHash: '0'.repeat(64), regions: {} });
  const root = await builtSpace(t, { staleSkeleton: stale }), api = server(t);
  const removed = { mode: 'static', boneWidth: 100, renders: [] };
  let ctx = context('spaces verify', { space: 'board', spaceId: 'fixture-space' }, { dir: root }, scriptedRenderer(removed));
  let result = await ctx.spec.handler(ctx);
  let [first, second] = api.verifies();
  assert.equal(Buffer.from(first.body.artifact_files[SKELETON], 'base64').toString('utf8'), stale, 'the build carried the stale file');
  assert.equal(second.body.artifact_files[SKELETON], undefined);
  assert.equal(result.data.artifact_digest, appFilesDigest(second.body.artifact_files));
  assert.equal(result.data.render.skeleton.status, 'none');
  assert.ok(result.warnings.some(value => /Removed bundle\/skeleton\.json from the release/.test(value)), JSON.stringify(result.warnings));

  const replaced = { mode: 'clean', boneWidth: 100, renders: [] };
  ctx = context('spaces verify', { space: 'board', spaceId: 'fixture-space' }, { dir: root }, scriptedRenderer(replaced));
  result = await ctx.spec.handler(ctx);
  [first, second] = api.verifies().slice(2);
  assert.equal(decoded(second.body.artifact_files[SKELETON]).sourceHash, sha256(Buffer.from(second.body.artifact_files['bundle/app.js'], 'base64')));
  assert.ok(result.warnings.some(value => /Replaced bundle\/skeleton\.json with the skeleton verify measured/.test(value)));
});

test('loading-state findings and a failed capture are warnings: verify still succeeds', async t => {
  const root = await builtSpace(t), api = server(t);
  const warned = { mode: 'warnings', boneWidth: 100, renders: [] };
  let ctx = context('spaces verify', { space: 'board', spaceId: 'fixture-space' }, { dir: root }, scriptedRenderer(warned));
  let result = await ctx.spec.handler(ctx);
  const checks = result.data.render.skeleton.findings.map(value => value.check);
  assert.ok(checks.includes('loading_text') && checks.includes('empty_before_data'), JSON.stringify(checks));
  assert.ok(result.data.render.skeleton.findings.every(value => value.severity === 'warning'));
  assert.equal(result.data.render.status, 'passed');
  assert.equal(result.data.render.skeleton.status, 'captured');
  assert.match(result.humanSummary, /Loading state warnings \(\d+\): \[390 en\] /);
  assert.equal(api.verifies().length, 2);

  const broken = { mode: 'broken', boneWidth: 100, renders: [] };
  ctx = context('spaces verify', { space: 'board', spaceId: 'fixture-space' }, { dir: root }, scriptedRenderer(broken));
  result = await ctx.spec.handler(ctx);
  assert.equal(result.data.render.status, 'passed');
  assert.equal(result.data.render.skeleton.status, 'failed');
  assert.ok(result.data.render.skeleton.findings.some(value => value.check === 'capture_failed'));
  assert.equal(api.verifies().length, 3, 'nothing measured: no file and no second source-verify');
  assert.equal(api.verifies()[2].body.artifact_files[SKELETON], undefined);
  assert.match(result.humanSummary, /could not be measured/);
});
