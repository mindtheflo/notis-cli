import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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
    let hardStop;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      hardStop = setTimeout(() => child.kill('SIGKILL'), 2000);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer); clearTimeout(hardStop);
      resolvePromise({
        exitCode: 1,
        stdout,
        stderr: stderr || error.message,
        timedOut,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer); clearTimeout(hardStop);
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
  designViewports = DEFAULT_DESIGN_VIEWPORTS,
  waitForRuntime = false,
  signal,
}) {
  const cancelled = () => ({ mounted: false, renderStarted: false, runtimeCalls: [],
    errors: [{ phase: 'browser', message: 'Verification cancelled.' }], snapshotPath: null, tool_error: null });
  if (signal?.aborted) return cancelled();
  const opened = await runAgentBrowser(['--session', sessionName, 'open', url], {
    timeoutMs: Math.min(Math.max(timeoutMs, 5000), 30_000),
  });
  // Let an in-flight open settle before the owner closes its browser. Closing
  // concurrently with open can leave a newly launched browser behind.
  if (signal?.aborted) return cancelled();
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
  let readySince = null;
  while (Date.now() < deadline && !signal?.aborted) {
    const lastRead = await readHarness(sessionName, 5000);
    if (!lastRead.ok) {
      readySince = null;
      await delay(250);
      continue;
    }
    const harness = lastRead.harness;
    if (Array.isArray(harness?.errors) && harness.errors.length > 0) break;
    const pending = (harness?.runtimeCalls || []).some(call => call?.ok == null);
    if (harness?.mounted && (!waitForRuntime || !pending)) {
      readySince ??= Date.now();
      if (Date.now() - readySince >= 250) break;
    } else readySince = null;
    await delay(250);
  }

  if (signal?.aborted) return cancelled();

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

  const runtimeCalls = Array.isArray(harness.runtimeCalls) ? harness.runtimeCalls : [];
  const timedOut = (!harness.mounted || (waitForRuntime && runtimeCalls.some(call => call?.ok == null))) && Date.now() >= deadline;

  // Design assertions only mean something on a mounted route. Loading
  // placeholders are excused while a runtime call is still in flight.
  let design = [];
  let designToolError = null;
  if (harness.mounted && Array.isArray(designViewports) && designViewports.length > 0) {
    await delay(500);
    const pending = runtimeCalls.some((call) => call && call.ok == null);
    const collected = await collectDesignFindings(sessionName, {
      viewports: designViewports,
      skipLoadingCheck: pending,
    });
    design = collected.findings;
    designToolError = collected.tool_error;
  }

  return {
    mounted: Boolean(harness.mounted),
    renderStarted: Boolean(harness.renderStarted),
    errors: Array.isArray(harness.errors) ? harness.errors : [],
    runtimeCalls,
    snapshotPath: savedSnapshotPath,
    timed_out: timedOut,
    tool_error: null,
    design,
    design_tool_error: designToolError,
    raw: harness,
  };
}

export async function closeAgentBrowserSessionResult(sessionName) {
  const started = Date.now();
  // agent-browser waits up to 30s for CDP Browser.close and then up to 5s
  // for its owned Chrome process. Do not kill the client at the start of the
  // provider's shutdown grace period and lose its actual close acknowledgement.
  const result = await runAgentBrowser(['--session', sessionName, '--json', 'close'], { timeoutMs: 40_000 });
  let acknowledged = false;
  try {
    const reply = parseAgentBrowserJson(result.stdout);
    acknowledged = reply?.success === true && reply?.data?.closed === true;
  } catch { /* Missing acknowledgement is a failed cleanup, never a pass. */ }
  return { ok: result.exitCode === 0 && acknowledged, exit_code: result.exitCode,
    timed_out: Boolean(result.timedOut), duration_ms: Date.now() - started };
}

// ---------------------------------------------------------------------------
// Runtime design assertions.
//
// The static design lint (app-boundary-validator.js) catches banned class
// names. This script runs in the mounted harness page and catches what a
// regex cannot: a bordered box nested in a bordered box across files, tinted
// panels stacked three deep, text that computes below 12px, horizontal
// overflow at a phone width, and loading placeholders that outlive the data.
// Palette colors are deliberately not checked here: at runtime a token and a
// hardcoded hue resolve to the same RGB, so that stays with the static lint.
// ---------------------------------------------------------------------------
export const DESIGN_ASSERTIONS_MARKER = '__notisDesignAssertions';

export const DESIGN_ASSERTIONS_SCRIPT = `(() => {
  /* ${DESIGN_ASSERTIONS_MARKER} */
  const root = document.getElementById('root') || document.body;
  const out = [];
  const seen = new Set();
  const push = (kind, el, extra) => {
    const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').trim().slice(0, 80);
    const text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
    const snippet = el.tagName.toLowerCase() + (cls ? '.' + cls.split(/\\s+/).slice(0, 6).join('.') : '') + (text ? ' "' + text + '"' : '');
    const key = kind + '|' + snippet;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(Object.assign({ kind, snippet }, extra || {}));
  };
  const controls = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY']);
  const isControl = (el) => controls.has(el.tagName) || /^(button|checkbox|switch|radio|combobox|textbox|tab|menuitem)$/.test(el.getAttribute('role') || '');
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const isBox = (el) => {
    const cs = getComputedStyle(el);
    if (!['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].every((k) => parseFloat(cs[k]) > 0)) return false;
    if (/rgba\\(\\d+, \\d+, \\d+, 0\\)|transparent/.test(cs.borderTopColor)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 20;
  };
  const bg = (el) => getComputedStyle(el).backgroundColor;
  const transparent = (c) => !c || c === 'transparent' || /rgba\\(\\d+, \\d+, \\d+, 0\\)/.test(c);
  const isPanel = (el) => {
    if (transparent(bg(el))) return false;
    if (parseFloat(getComputedStyle(el).borderRadius) <= 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 160 && r.height > 48;
  };
  const all = Array.from(root.querySelectorAll('*'));
  for (const el of all) {
    if (!visible(el) || isControl(el)) continue;
    if (isBox(el)) {
      let p = el.parentElement; let depth = 0;
      while (p && p !== root && depth < 6) { if (!isControl(p) && isBox(p)) { push('nested_border_box', el); break; } p = p.parentElement; depth += 1; }
    }
    if (isPanel(el)) {
      let p = el.parentElement; let panels = 0;
      while (p && p !== root) { if (isPanel(p)) panels += 1; p = p.parentElement; }
      if (panels >= 2) push('nested_tinted_panel', el, { depth: panels + 1 });
    }
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = (node.textContent || '').trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || !visible(el)) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size > 0 && size < 12) push('text_below_12px', el, { font_size: size });
    if (/^Loading(\\.{3}|\\u2026)?(\\s|$)/.test(text)) push('loading_placeholder_after_mount', el);
  }
  if (root.querySelector('[data-notis-content-skeleton]')) push('loading_placeholder_after_mount', root.querySelector('[data-notis-content-skeleton]'));
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth + 1) out.push({ kind: 'horizontal_overflow', snippet: 'document', scroll_width: doc.scrollWidth, client_width: doc.clientWidth });
  return JSON.stringify(out.slice(0, 40));
})()`;

export const DEFAULT_DESIGN_VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

/**
 * Evaluate the design assertions in the current page. Returns an array of
 * findings, or `{ tool_error }` when agent-browser could not run the script.
 */
export async function evalDesignAssertions(sessionName, { viewport = null, timeoutMs = 8000 } = {}) {
  const result = await runAgentBrowser(
    ['--session', sessionName, '--json', 'eval', DESIGN_ASSERTIONS_SCRIPT],
    { timeoutMs },
  );
  if (result.exitCode !== 0) {
    return { tool_error: commandError('design_eval', result) };
  }
  try {
    const payload = parseAgentBrowserJson(result.stdout);
    const raw = payload?.data?.result ?? payload?.result ?? payload?.data ?? null;
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(value)) throw new Error('Design evaluation did not return a findings array.');
    return value.map((finding) => ({ ...finding, viewport: viewport || finding.viewport || null }));
  } catch (error) {
    return { tool_error: { phase: 'design_eval_parse', message: error.message } };
  }
}

/**
 * Run every requested viewport. Missing browser checks are incomplete proof,
 * not a passing design result, even when static source lint passed.
 */
export async function collectDesignFindings(sessionName, { viewports = DEFAULT_DESIGN_VIEWPORTS, settleMs = 350, skipLoadingCheck = false } = {}) {
  const findings = [];
  let toolError = null;
  for (const viewport of viewports) {
    const applied = await setViewport(sessionName, viewport.width, viewport.height);
    if (!applied) {
      toolError ||= { phase: 'design_viewport', message: `Could not set ${viewport.name} viewport.` };
      continue;
    }
    await delay(settleMs);
    const result = await evalDesignAssertions(sessionName, { viewport: viewport.name });
    if (Array.isArray(result)) {
      for (const finding of result) {
        if (skipLoadingCheck && finding.kind === 'loading_placeholder_after_mount') continue;
        findings.push(finding);
      }
    } else if (!toolError) {
      toolError = result.tool_error;
    }
  }
  return { findings, tool_error: toolError };
}
