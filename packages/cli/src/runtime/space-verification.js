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
    for (const file of ['src/renderer.js', 'src/dom.js', 'src/pool.js', 'dist/host.js', 'dist/host.css', 'dist/theme.css']) {
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
    return { ...diagnostic, status: passed ? 'passed' : 'failed', mounted: renders.every(value => value.mounted),
      fixture_digest: brokers[0].broker.fixtureDigest, renderer_digest: rendererDigest,
      render_count: renders.length, browser_count: 1, renders, runtimeCalls,
      errors: passed ? [] : [{ phase: 'renderer', message: 'At least one width or read-only fixture failed verification.' }] };
  } catch (error) {
    return { ...diagnostic, status: 'failed', ...(rendererDigest ? { renderer_digest: rendererDigest } : {}),
      errors: [{ phase: 'harness', message: error.message }] };
  } finally {
    try { await pool?.close(); } finally { if (held) releaseSlot(); }
  }
}
