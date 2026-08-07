import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const HIDE_HARNESS_STATUS_SCRIPT =
  "(() => { const el = document.getElementById('harness-status'); if (el) el.style.opacity = '0'; return true; })()";

/**
 * Prepare the mounted harness page for a listing capture: remove the debug
 * banner and the layout the harness adds around the app (top padding for the
 * banner, 100vh min-height) so content height can be measured and framed
 * without artificial whitespace.
 */
const PREPARE_CAPTURE_SCRIPT =
  "(() => { const s = document.getElementById('harness-status'); if (s) s.style.display = 'none';" +
  " const r = document.getElementById('root'); if (r) { r.style.paddingTop = '0'; r.style.minHeight = '0'; }" +
  " document.body.style.minHeight = '0'; document.documentElement.style.minHeight = '0'; return true; })()";

const FONTS_STATUS_SCRIPT =
  "(() => (document.fonts ? document.fonts.status : 'loaded'))()";

const CONTENT_HEIGHT_SCRIPT =
  '(() => { const r = document.getElementById(\'root\');' +
  ' if (!r) return Math.ceil(document.documentElement.scrollHeight);' +
  ' return Math.ceil(Math.max(r.scrollHeight, r.getBoundingClientRect().height)); })()';

// CSS viewport bounds for content-aware framing. Content shorter than the
// minimum gets a little breathing room; content taller than the maximum is
// cropped at the frame rather than shrunk into unreadably small text.
const MIN_CSS_VIEWPORT_HEIGHT = 720;
const MAX_CSS_VIEWPORT_HEIGHT = 1500;

function pngDimensions(path) {
  try {
    const buffer = readFileSync(path);
    if (buffer.length < 24 || buffer.readUInt32BE(12) !== 0x49484452) {
      return null;
    }
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } catch {
    return null;
  }
}

/**
 * Pick a CSS viewport that frames `contentHeight` at the output aspect ratio,
 * with a deviceScaleFactor that maps it back to exactly outputWidth x
 * outputHeight physical pixels. Width snaps to a multiple of 8 so the height
 * stays integral for the common 16:10 target.
 */
function fitCssViewport(contentHeight, outputWidth, outputHeight) {
  const aspect = outputWidth / outputHeight;
  const cssH = Math.min(
    MAX_CSS_VIEWPORT_HEIGHT,
    Math.max(MIN_CSS_VIEWPORT_HEIGHT, Math.round(contentHeight)),
  );
  const cssW = Math.round((cssH * aspect) / 8) * 8;
  return {
    width: cssW,
    height: Math.round(cssW / aspect),
    scale: outputWidth / cssW,
  };
}

async function evalNumber(sessionName, script, fallback = null) {
  const result = await runAgentBrowser(
    ['--session', sessionName, '--json', 'eval', script],
    { timeoutMs: 5000 },
  );
  if (result.exitCode !== 0) {
    return fallback;
  }
  try {
    const payload = parseAgentBrowserJson(result.stdout);
    const raw = payload?.data?.result ?? payload?.result ?? payload?.data ?? null;
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

async function waitForFonts(sessionName, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await runAgentBrowser(
      ['--session', sessionName, '--json', 'eval', FONTS_STATUS_SCRIPT],
      { timeoutMs: 5000 },
    );
    if (result.exitCode !== 0) {
      return;
    }
    try {
      const payload = parseAgentBrowserJson(result.stdout);
      const raw = payload?.data?.result ?? payload?.result ?? payload?.data ?? null;
      const status = typeof raw === 'string' && raw.startsWith('"') ? JSON.parse(raw) : raw;
      if (status !== 'loading') {
        return;
      }
    } catch {
      return;
    }
    await delay(150);
  }
}

async function setViewport(sessionName, width, height, scale = null) {
  const args = ['--session', sessionName, 'set', 'viewport', String(width), String(height)];
  if (scale != null) {
    args.push(String(scale));
  }
  const result = await runAgentBrowser(args, { timeoutMs: 5000 });
  return result.exitCode === 0;
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function commandError(phase, result) {
  return {
    phase,
    exit_code: result.exitCode,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function runAgentBrowser(args, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn('agent-browser', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: 1,
        stdout,
        stderr: stderr || error.message,
        timedOut,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

function parseAgentBrowserJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  return JSON.parse(trimmed);
}

function parseHarnessFromEval(stdout) {
  const payload = parseAgentBrowserJson(stdout);
  const rawResult = payload?.data?.result ?? payload?.result ?? payload?.data ?? null;
  if (rawResult == null || rawResult === 'null') {
    return null;
  }
  return typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
}

async function readHarness(sessionName, timeoutMs) {
  const result = await runAgentBrowser(
    [
      '--session',
      sessionName,
      '--json',
      'eval',
      'JSON.stringify(window.__harness || null)',
    ],
    { timeoutMs },
  );
  if (result.exitCode !== 0) {
    return { ok: false, toolError: commandError('eval', result) };
  }

  try {
    return { ok: true, harness: parseHarnessFromEval(result.stdout) };
  } catch (error) {
    return {
      ok: false,
      toolError: {
        phase: 'eval_parse',
        message: error instanceof Error ? error.message : String(error),
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      },
    };
  }
}

export function isAgentBrowserAvailable() {
  const result = spawnSync('agent-browser', ['--version'], {
    stdio: 'ignore',
    env: process.env,
  });
  return result.status === 0;
}

export async function runHarnessRoute({
  url,
  sessionName,
  timeoutMs = 10_000,
  snapshotPath = null,
}) {
  const opened = await runAgentBrowser(['--session', sessionName, 'open', url], {
    timeoutMs: Math.min(Math.max(timeoutMs, 5000), 30_000),
  });
  if (opened.exitCode !== 0) {
    return {
      mounted: false,
      renderStarted: false,
      errors: [],
      runtimeCalls: [],
      snapshotPath: null,
      tool_error: commandError('open', opened),
    };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const lastRead = await readHarness(sessionName, 5000);
    if (!lastRead.ok) {
      await delay(250);
      continue;
    }
    const harness = lastRead.harness;
    if (harness?.mounted || (Array.isArray(harness?.errors) && harness.errors.length > 0)) {
      await delay(250);
      break;
    }
    await delay(250);
  }

  const finalRead = await readHarness(sessionName, 5000);
  if (!finalRead.ok) {
    return {
      mounted: false,
      renderStarted: false,
      errors: [],
      runtimeCalls: [],
      snapshotPath: null,
      tool_error: finalRead.toolError,
    };
  }

  const harness = finalRead.harness || {};
  let savedSnapshotPath = null;
  if (snapshotPath) {
    const snapshot = await runAgentBrowser(['--session', sessionName, 'snapshot', '-i'], {
      timeoutMs: 10_000,
    });
    if (snapshot.exitCode === 0) {
      mkdirSync(dirname(snapshotPath), { recursive: true });
      writeFileSync(snapshotPath, snapshot.stdout);
      savedSnapshotPath = snapshotPath;
    }
  }

  const timedOut = !harness.mounted && Date.now() >= deadline;
  return {
    mounted: Boolean(harness.mounted),
    renderStarted: Boolean(harness.renderStarted),
    errors: Array.isArray(harness.errors) ? harness.errors : [],
    runtimeCalls: Array.isArray(harness.runtimeCalls) ? harness.runtimeCalls : [],
    snapshotPath: savedSnapshotPath,
    timed_out: timedOut,
    tool_error: null,
    raw: harness,
  };
}

/**
 * Open a harness route, wait for it to mount, then capture a PNG screenshot of
 * the rendered app. Output is always exactly `width` x `height` physical
 * pixels (default 2000x1250, the 16:10 the listing validator expects), but the
 * CSS viewport is fitted to the rendered content height: short pages render
 * larger (no dead whitespace below the app), tall pages get more room before
 * cropping. The deviceScaleFactor maps the fitted CSS viewport back onto the
 * fixed output frame. Used by `notis apps screenshot`.
 */
export async function captureHarnessScreenshot({
  url,
  sessionName,
  screenshotPath,
  focusSelector = null,
  width = 2000,
  height = 1250,
  timeoutMs = 15_000,
}) {
  const opened = await runAgentBrowser(['--session', sessionName, 'open', url], {
    timeoutMs: Math.min(Math.max(timeoutMs, 5000), 30_000),
  });
  if (opened.exitCode !== 0) {
    return { ok: false, mounted: false, screenshotPath: null, tool_error: commandError('open', opened) };
  }

  // Initial fixed frame so mount/layout happen at a deterministic size; the
  // scale keeps physical output at width x height from the very first paint.
  const initial = fitCssViewport(900, width, height);
  let scaledViewport = await setViewport(
    sessionName,
    initial.width,
    initial.height,
    initial.scale,
  );
  if (!scaledViewport) {
    // Older agent-browser without deviceScaleFactor support: fall back to a
    // plain fixed viewport at output size.
    await setViewport(sessionName, width, height);
  }

  const deadline = Date.now() + timeoutMs;
  let lastErrors = [];
  let lastReadError = null;
  let mounted = false;
  while (Date.now() < deadline) {
    const read = await readHarness(sessionName, 5000);
    if (read.ok) {
      const harness = read.harness || {};
      mounted = Boolean(harness.mounted);
      lastErrors = Array.isArray(harness.errors) ? harness.errors : [];
      if (mounted || lastErrors.length > 0) {
        break;
      }
    } else {
      lastReadError = read.toolError;
    }
    await delay(250);
  }

  if (lastErrors.length > 0) {
    return { ok: false, mounted, screenshotPath: null, errors: lastErrors, tool_error: null };
  }
  if (!mounted) {
    return {
      ok: false,
      mounted: false,
      screenshotPath: null,
      errors: [],
      timed_out: true,
      tool_error: lastReadError || {
        phase: 'harness',
        message: 'Timed out waiting for window.__harness.mounted.',
      },
    };
  }

  // Strip harness chrome (debug banner, banner padding, 100vh min-height) so
  // the frame contains only the app, then wait for webfonts before measuring.
  await runAgentBrowser(
    ['--session', sessionName, 'eval', PREPARE_CAPTURE_SCRIPT],
    { timeoutMs: 5000 },
  );
  await waitForFonts(sessionName);

  // Fit the CSS viewport to the rendered content. Content height depends on
  // viewport width, so refine once after the first resize reflows the page.
  let framing = null;
  if (scaledViewport) {
    let contentHeight = await evalNumber(sessionName, CONTENT_HEIGHT_SCRIPT);
    for (let pass = 0; contentHeight != null && pass < 2; pass += 1) {
      const fitted = fitCssViewport(contentHeight, width, height);
      if (framing && fitted.width === framing.width) {
        break;
      }
      scaledViewport = await setViewport(sessionName, fitted.width, fitted.height, fitted.scale);
      if (!scaledViewport) {
        framing = null;
        await setViewport(sessionName, width, height);
        break;
      }
      framing = { ...fitted, content_height: contentHeight };
      await delay(150);
      const remeasured = await evalNumber(sessionName, CONTENT_HEIGHT_SCRIPT);
      if (remeasured == null || Math.abs(remeasured - contentHeight) <= 32) {
        framing.content_height = remeasured ?? contentHeight;
        break;
      }
      contentHeight = remeasured;
    }
  }

  // Let the route settle (async data, resize transitions) before the capture.
  await delay(500);

  mkdirSync(dirname(screenshotPath), { recursive: true });
  const screenshotArgs = ['--session', sessionName, 'screenshot'];
  if (focusSelector) {
    screenshotArgs.push(focusSelector);
  }
  screenshotArgs.push(screenshotPath, '--screenshot-format', 'png');
  const shot = await runAgentBrowser(screenshotArgs, { timeoutMs: 15_000 });
  if (shot.exitCode !== 0) {
    return { ok: false, mounted: true, screenshotPath: null, errors: lastErrors, timed_out: false, tool_error: commandError('screenshot', shot) };
  }

  // The listing validator requires exact output dimensions. If the fitted
  // capture came out wrong (e.g. the browser ignored the scale factor),
  // recapture once at a plain fixed viewport.
  const dimensions = pngDimensions(screenshotPath);
  if (!focusSelector && framing && (!dimensions || dimensions.width !== width || dimensions.height !== height)) {
    await setViewport(sessionName, width, height);
    await delay(300);
    const retry = await runAgentBrowser(
      ['--session', sessionName, 'screenshot', screenshotPath, '--screenshot-format', 'png'],
      { timeoutMs: 15_000 },
    );
    if (retry.exitCode !== 0) {
      return { ok: false, mounted: true, screenshotPath: null, errors: lastErrors, timed_out: false, tool_error: commandError('screenshot', retry) };
    }
    framing = null;
  }

  if (focusSelector) {
    framing = {
      ...(framing || {}),
      focus_selector: focusSelector,
      source_dimensions: dimensions,
    };
  }

  return {
    ok: true,
    mounted: true,
    screenshotPath,
    errors: lastErrors,
    timed_out: false,
    tool_error: null,
    framing,
  };
}

export async function closeAgentBrowserSession(sessionName) {
  const result = await runAgentBrowser(['--session', sessionName, 'close'], {
    timeoutMs: 5000,
  });
  return result.exitCode === 0;
}
