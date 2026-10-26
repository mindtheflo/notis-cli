/** Frozen offline fixtures rendered by the same read-only library as CLI/service. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appFilesDigest } from './app-platform.js';
import { createSpaceFixtureBroker } from './space-fixture-broker.js';

// Kept for the standalone legacy worker's lifecycle tests while that diagnostic
// entrypoint is retired. The primary verifier below never starts that worker.
export function spaceVerificationEnvironment(environment, { configPath }) {
  const names = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'SystemRoot', 'WINDIR', 'DISPLAY', 'XDG_RUNTIME_DIR'];
  return { ...Object.fromEntries(names.filter(name => typeof environment[name] === 'string').map(name => [name, environment[name]])),
    AGENT_BROWSER_CONFIG: configPath, AGENT_BROWSER_NO_WEBMCP: '1' };
}

export async function loadSpaceVerificationRenderer() {
  const candidates = [new URL('../../dist/view-renderer/', import.meta.url), new URL('../../../view-renderer/', import.meta.url)];
  for (const root of candidates) {
    const entry = new URL('src/index.js', root);
    if (!existsSync(fileURLToPath(entry))) continue;
    const digest = createHash('sha256');
    for (const file of ['src/renderer.js', 'src/dom.js', 'src/pool.js', 'src/skeleton.js', 'dist/host.js', 'dist/host.css', 'dist/theme.css']) {
      digest.update(file); digest.update(readFileSync(new URL(file, root)));
    }
    return { ...(await import(entry.href)), rendererDigest: digest.digest('hex') };
  }
  throw new Error('The shared view renderer is missing. Rebuild or reinstall this CLI package.');
}

// One browser per verification, two widths concurrently; no worker creates an
// unbounded browser fanout. Up to two invocations may run simultaneously.
let active = 0;
const waiting = [];
async function acquire(signal) {
  if (signal?.aborted) throw new Error('Verification cancelled.');
  if (active < 2) { active++; return; }
  if (waiting.length >= 8) throw new Error('The local verification queue is full.');
  await new Promise((accept, reject) => {
    const entry = { accept: () => { signal?.removeEventListener('abort', abort); accept(); } };
    const abort = () => { const index = waiting.indexOf(entry); if(index >= 0) waiting.splice(index, 1); reject(new Error('Verification cancelled.')); };
    waiting.push(entry); signal?.addEventListener('abort', abort, { once: true });
  });
}
function releaseSlot() { const next = waiting.shift(); if (next) next.accept(); else active--; }

/** Initial deployment checks the exact captured bytes at both product widths. */
export async function verifySpaceRelease(release, { capabilities, timeoutMs = 45_000, signal, loadRenderer = loadSpaceVerificationRenderer,
  authorizationMode = 'authorize_missing', unavailableActions = [] } = {}) {
  const diagnostic = { schema: 'notis-space-render/v1', local_key: release.manifest.local_key,
    source_digest: appFilesDigest(release.sourceFiles), artifact_digest: appFilesDigest(release.files),
    mode: 'offline_fixtures', checked_at: new Date().toISOString(),
    ...(authorizationMode === 'reuse_only' ? { authorization_mode: authorizationMode,
      unavailable_actions: structuredClone(unavailableActions) } : {}) };
  if (signal?.aborted) return { ...diagnostic, status: 'failed', errors: [{ phase: 'browser', message: 'Verification cancelled.' }] };
  if (release.manifest.kind === 'container') return { ...diagnostic, status: 'not_applicable_container' };
  let pool, held = false, rendererDigest;
  const brokers = [390, 1440].map(width => ({ width, broker: null }));
  try {
    // Validate fixture authority before opening a browser or acquiring a slot.
    for (const item of brokers) item.broker = createSpaceFixtureBroker({ release, capabilities, width: item.width,
      authorizationMode, unavailableActions });
    await acquire(signal); held = true;
    const library = await loadRenderer(); rendererDigest = library.rendererDigest;
    pool = library.createBrowserPool({ concurrency: 2, maxQueue: 2 });
    const observations = await Promise.allSettled(brokers.map(async ({ width, broker }) => {
      const result = await library.renderView({ broker, pool, outputs: ['markdown', 'screenshot'], width, timeoutMs, signal });
      const blocked = result.blocked_calls || [];
      return { width, mounted: true, status: blocked.length ? 'failed' : 'passed',
        markdown_sha256: createHash('sha256').update(result.markdown).digest('hex'),
        screenshot_sha256: createHash('sha256').update(Buffer.from(result.screenshot.data_base64, 'base64')).digest('hex'),
        screenshot_width: result.screenshot.width, screenshot_height: result.screenshot.height,
        rendered_at: result.rendered_at, blocked_calls: blocked };
    }));
    const renders = observations.map((value, index) => value.status === 'fulfilled' ? value.value : {
      width: brokers[index].width, mounted: false, status: 'failed', error: value.reason?.code || 'render_failed',
    });
    const runtimeCalls = brokers.flatMap(({ width, broker }) => broker.calls.map(call => ({ width, ...call })));
    const passed = renders.every(value => value.status === 'passed') && runtimeCalls.every(call => call.ok);
    // Each distinct fixture reason once (both widths usually hit the same one), ahead of the generic line.
    const fixtureErrors = [...new Map(runtimeCalls.filter(call => !call.ok && call.error)
      .map(call => [call.error, { phase: 'fixture', operation: call.operation,
        ...(call.recordKey ? { record_key: call.recordKey } : {}), ...(call.actionId ? { action_id: call.actionId } : {}),
        message: call.error }])).values()].slice(0, 10);
    const result = { ...diagnostic, status: passed ? 'passed' : 'failed', mounted: renders.every(value => value.mounted),
      fixture_digest: brokers[0].broker.fixtureDigest, renderer_digest: rendererDigest,
      render_count: renders.length, browser_count: 1, renders, runtimeCalls,
      errors: passed ? [] : [...fixtureErrors, { phase: 'renderer', message: 'At least one width or read-only fixture failed verification.' }] };
    // The skeleton is measured only from a view that rendered cleanly, with a renderer that can measure it.
    if (passed && typeof library.buildSkeletonDocument === 'function') {
      const capture = await captureSpaceSkeleton({ library, pool, release, capabilities, timeoutMs, signal, authorizationMode, unavailableActions });
      result.skeleton = capture.skeleton;
      Object.defineProperty(result, 'skeletonDocument', { value: capture.document, enumerable: false });
      Object.defineProperty(result, 'pendingScreenshots', { value: capture.screenshots, enumerable: false });
      Object.defineProperty(result, 'skeletonJson', { value: capture.document ? library.canonicalSkeletonJson(capture.document) : null, enumerable: false });
    }
    return result;
  } catch (error) {
    return { ...diagnostic, status: 'failed', ...(rendererDigest ? { renderer_digest: rendererDigest } : {}),
      errors: [{ phase: 'harness', message: error.message }] };
  } finally {
    try { await pool?.close(); } finally { if (held) releaseSlot(); }
  }
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const captureFailure = (width, locale, error) => ({ check: 'capture_failed', severity: 'warning', width, locale,
  message: `The loading skeleton could not be measured: ${String(error?.code || error?.message || error).slice(0, 300)}` });

/**
 * Loading skeleton capture, per width and locale: (1) pending with the view's fallback skeleton gives the region
 * boxes and landmarks, (2) final measures the bones inside those boxes, (3) pending again with the measured bones
 * injected is checked and screenshotted. Never throws: failures become warnings and status `failed`.
 */
async function captureSpaceSkeleton({ library, pool, release, capabilities, timeoutMs, signal, authorizationMode, unavailableActions }) {
  const findings = [], screenshots = [], combos = [];
  let failed = false, document = null;
  const widths = library.SKELETON_WIDTHS || [390, 1440], locales = library.SKELETON_LOCALES || ['en', 'fr'];
  const render = (width, options) => library.renderView({ broker: createSpaceFixtureBroker({ release, capabilities, width,
    outputs: ['markdown'], authorizationMode, unavailableActions }), pool, outputs: ['markdown'], width, timeoutMs, signal, ...options });
  // Both widths of one locale run together: the pool holds two renders at a time.
  const each = async (step) => {
    for (const locale of locales) {
      const settled = await Promise.allSettled(widths.map(width => step(combos.find(value => value.width === width && value.locale === locale))));
      settled.forEach((value, index) => {
        if (value.status === 'fulfilled') return;
        const combo = combos.find(item => item.width === widths[index] && item.locale === locale);
        combo.error = value.reason; failed = true;
        findings.push(captureFailure(combo.width, locale, value.reason));
      });
    }
  };
  for (const locale of locales) for (const width of widths) combos.push({ width, locale });
  try {
    await each(async (combo) => { combo.first = await render(combo.width, { pending: true, locale: combo.locale }); });
    await each(async (combo) => {
      combo.regions = combo.first?.pending?.static ? [] : (combo.first?.pending?.regions || []);
      const valid = combo.regions.filter(region => region.valid);
      if (!valid.length) return;
      combo.final = (await render(combo.width, { measure: { regions: valid }, locale: combo.locale })).skeleton_measure;
    });
    const measurements = {};
    for (const combo of combos) if (combo.final) (measurements[combo.width] ||= {})[combo.locale] = { regions: combo.final.regions };
    const app = release.files[release.manifest.bundle?.js || 'bundle/app.js'];
    if (Object.keys(measurements).length && typeof app === 'string') {
      document = library.buildSkeletonDocument({ sourceHash: sha256(Buffer.from(app, 'base64')), measurements });
      const invalid = document && library.validateSkeletonDocument(document, { appJsSha256: document.sourceHash });
      const bytes = document && Buffer.byteLength(library.canonicalSkeletonJson(document));
      const tooLarge = bytes > (library.SKELETON_LIMITS?.maxBytes || 512 * 1024);
      if (invalid || tooLarge) {
        failed = true;
        findings.push({ check: 'skeleton_invalid', severity: 'warning', width: null, locale: null,
          message: `The measured skeleton was dropped: ${invalid || 'it is larger than 512 KiB'}.` });
        document = null;
      }
    }
    if (document) {
      await each(async (combo) => {
        if (!combo.final) return;
        combo.checked = await render(combo.width, { pending: true, locale: combo.locale, skeleton: document });
      });
    }
  } catch (error) {
    failed = true; findings.push(captureFailure(null, null, error));
  }
  for (const combo of combos) {
    const shown = combo.checked || combo.first;
    if (!shown) continue;
    const heights = Object.fromEntries((combo.final?.regions || []).map(region => [region.key, library.buildSkeletonEntry(region).height]));
    try {
      findings.push(...library.runSkeletonChecks({ width: combo.width, locale: combo.locale, pending: shown.pending,
        regions: combo.regions || [], final: combo.final, heights }));
    } catch (error) { failed = true; findings.push(captureFailure(combo.width, combo.locale, error)); }
    if (shown.pending?.static || !shown.screenshot?.data_base64) continue;
    const png = Buffer.from(shown.screenshot.data_base64, 'base64');
    screenshots.push({ width: combo.width, locale: combo.locale, png, sha256: sha256(png) });
  }
  const status = document ? 'captured' : failed ? 'failed' : 'none';
  return { document, screenshots, skeleton: { status, regions: document ? Object.keys(document.regions).sort() : [], findings,
    pending_screenshots: screenshots.map(({ width, locale, sha256: digest }) => ({ width, locale, sha256: digest })) } };
}
