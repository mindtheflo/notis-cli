/** Runs in a credential-free child process, never in the authenticated CLI. */
import { closeAgentBrowserSessionResult, isAgentBrowserAvailable, runHarnessRoute } from './agent-browser.js';

let sessionName;
let closing;
let started = false;
const controller = new AbortController();
let exitCode = 0;
const cleanup = () => closing ||= sessionName ? closeAgentBrowserSessionResult(sessionName) : Promise.resolve({ ok: true });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  exitCode = signal === 'SIGINT' ? 130 : 143;
  controller.abort();
  if (!started) process.exit(exitCode);
});
process.on('disconnect', () => { exitCode = 1; controller.abort(); if (!started) process.exit(1); });

process.once('message', async input => {
  started = true;
  let result;
  try {
    const url = new URL(input.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
      || !/^notis-space-[a-f0-9-]+$/.test(input.sessionName)) throw new Error('Invalid offline verification session.');
    sessionName = input.sessionName;
    if (!isAgentBrowserAvailable()) throw new Error('Install agent-browser and its Chromium browser to verify a presentation.');
    const observed = await runHarnessRoute({ url: url.href, sessionName, timeoutMs: input.timeoutMs,
      designViewports: [], waitForRuntime: true, signal: controller.signal });
    // Never retain raw eval/stdout or action inputs/results in a diagnostic receipt.
    result = {
      mounted: observed.mounted,
      renderStarted: observed.renderStarted,
      timed_out: Boolean(observed.timed_out),
      errors: (observed.errors || []).map(error => ({ phase: String(error.phase).slice(0, 100), message: String(error.message).slice(0, 2000) })),
      runtimeCalls: (observed.runtimeCalls || []).map(call => ({ actionId: call.actionId, ok: call.ok,
        ...(call.error ? { error: String(call.error).slice(0, 2000) } : {}) })),
      ...(observed.tool_error ? { tool_error: { phase: observed.tool_error.phase,
        message: String(observed.tool_error.stderr || observed.tool_error.message
          || 'The isolated verification browser could not complete this operation.').slice(0, 2000) } } : {}),
    };
  } catch (error) {
    result = { mounted: false, errors: [{ phase: 'browser', message: error.message }], runtimeCalls: [] };
  } finally {
    if (process.connected) {
      try { process.send({ phase: 'cleanup' }, () => {}); } catch { /* Cleanup still owns the browser after IPC loss. */ }
    }
    const closed = await cleanup();
    result = { ...result, cleanup: closed, ...(!closed.ok ? { cleanup_failed: true } : {}) };
  }
  if (process.connected) process.send(result, () => process.exit(exitCode));
  else process.exit(exitCode);
});
