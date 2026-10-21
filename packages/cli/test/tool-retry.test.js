import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { runToolCommand } from '../src/command-specs/helpers.js';
import { CliError } from '../src/runtime/errors.js';
import {
  RETRY_MAX_ATTEMPTS,
  callCarriesToolRequestId,
  canReplayRequest,
  findToolOutcomeUnknown,
  isTransientFailure,
  resolveRetryEnabled,
  waitForNextAttempt,
} from '../src/runtime/retry.js';

const cliRoot = resolve(import.meta.dirname, '..');
const binPath = join(cliRoot, 'bin', 'notis.js');
const execFileAsync = promisify(execFile);

// `credentialKind: 'env'` keeps these tests hermetic: the transport reads the
// credential from `runtime.jwt` alone and never loads a profile from disk.
function makeJwt(sub = 'retry-test-user') {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${encode({ alg: 'none', typ: 'at+jwt' })}.${encode({ sub, exp })}.sig`;
}

const OK_BODY = { successful: true, data: { results: [{ response: { successful: true, data: { ok: true } } }] } };

function outcomeUnknownBody(requestId) {
  return {
    successful: false,
    data: {
      results: [{
        tool_slug: 'LOCAL_NOTIS_DATABASE_UPSERT_NOTES',
        index: 0,
        error: 'The document write may have committed. Retry with the same request_id.',
        response: {
          successful: false,
          data: {
            status: 'error',
            status_code: 503,
            error: 'document_outcome_unknown',
            message: `Retry with the same request_id ${requestId}.`,
          },
        },
      }],
    },
  };
}

// A local backend that answers each request with the next scripted step:
// `'drop'` closes the socket without a reply, otherwise `{ status, body }`.
async function withScriptedBackend(steps, run) {
  const received = [];
  const server = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      received.push(JSON.parse(raw));
      const step = steps[Math.min(received.length - 1, steps.length - 1)];
      if (step === 'drop') {
        req.socket.destroy();
        return;
      }
      res.writeHead(step.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(step.body));
    });
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  try {
    const apiBase = `http://127.0.0.1:${server.address().port}`;
    return { outcome: await run(apiBase), received };
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

function runtimeFor(apiBase, overrides = {}) {
  return {
    apiBase,
    credentialKind: 'env',
    jwt: makeJwt(),
    timeoutMs: 8000,
    cliVersion: 'test',
    outputMode: 'json',
    profileName: 'retry-test',
    ...overrides,
  };
}

async function settle(promise) {
  try {
    return { result: await promise };
  } catch (error) {
    return { error };
  }
}

function writeCall(apiBase, { runtime = {}, idempotencyKey = 'write-key-123', args = {} } = {}) {
  return settle(runToolCommand({
    runtime: runtimeFor(apiBase, runtime),
    toolName: 'COMPOSIO_MULTI_EXECUTE_TOOL',
    arguments_: { tools: [{ tool_slug: 'LOCAL_NOTIS_DATABASE_UPSERT_NOTES', arguments: args }] },
    mutating: true,
    idempotencyKey,
  }));
}

test('a write with an idempotency key is retried after a dropped connection, then succeeds', async () => {
  const { outcome, received } = await withScriptedBackend(
    ['drop', { status: 200, body: OK_BODY }],
    (apiBase) => writeCall(apiBase),
  );
  assert.equal(outcome.error, undefined, outcome.error?.message);
  assert.equal(outcome.result.attempts, 2);
  assert.deepEqual(outcome.result.payload, OK_BODY);
  assert.equal(received.length, 2);
  // The same key lets the server join or replay the first attempt.
  assert.deepEqual(received.map((body) => body.idempotency_key), ['write-key-123', 'write-key-123']);
  assert.deepEqual(received[0].arguments, received[1].arguments);
});

test('a write is retried on 502, 503 and 504 with the same key', async () => {
  const { outcome, received } = await withScriptedBackend(
    [
      { status: 502, body: { error: { code: 'bad_gateway', message: 'Bad gateway' } } },
      { status: 504, body: { error: { code: 'gateway_timeout', message: 'Gateway timeout' } } },
      { status: 200, body: OK_BODY },
    ],
    (apiBase) => writeCall(apiBase),
  );
  assert.equal(outcome.error, undefined, outcome.error?.message);
  assert.equal(outcome.result.attempts, 3);
  assert.equal(new Set(received.map((body) => body.idempotency_key)).size, 1);
});

test('a write without a key is never replayed', () => {
  // runToolCommand always mints a key for a write, so the keyless case is
  // guarded by the replay rule itself.
  assert.equal(canReplayRequest({ mutating: true, idempotencyKey: null }), false);
  assert.equal(canReplayRequest({ mutating: true, idempotencyKey: '' }), false);
  assert.equal(canReplayRequest({ mutating: true, idempotencyKey: 'write-key-123' }), true);
  // A keyless read is refused by the server before it runs if it is not a read.
  assert.equal(canReplayRequest({ mutating: false, idempotencyKey: null }), true);
});

test('a read without a key is retried after a dropped connection', async () => {
  const { outcome, received } = await withScriptedBackend(
    ['drop', { status: 200, body: OK_BODY }],
    (apiBase) => settle(runToolCommand({
      runtime: runtimeFor(apiBase),
      toolName: 'COMPOSIO_SEARCH_TOOLS',
      arguments_: { queries: [{ use_case: 'list notes' }] },
      mutating: false,
    })),
  );
  assert.equal(outcome.error, undefined, outcome.error?.message);
  assert.equal(outcome.result.attempts, 2);
  assert.deepEqual(received.map((body) => body.idempotency_key), [null, null]);
});

test('an unknown native outcome is retried with the same request_id under a fresh key', async () => {
  const args = { protocol: 1, target: { database: 'notes' }, input: { title: 'Plan' }, request_id: 'doc-write-0001' };
  const { outcome, received } = await withScriptedBackend(
    [{ status: 200, body: outcomeUnknownBody('doc-write-0001') }, { status: 200, body: OK_BODY }],
    (apiBase) => writeCall(apiBase, { args }),
  );
  assert.equal(outcome.error, undefined, outcome.error?.message);
  assert.equal(outcome.result.attempts, 2);
  assert.deepEqual(outcome.result.payload, OK_BODY);
  assert.equal(received.length, 2);
  // Identical arguments, so the native receipt for the request_id decides.
  assert.deepEqual(received[1].arguments, received[0].arguments);
  assert.equal(received[1].arguments.tools[0].arguments.request_id, 'doc-write-0001');
  // The first key's stored answer is the unknown outcome; only a new key
  // reaches the tool again.
  assert.equal(received[0].idempotency_key, 'write-key-123');
  assert.notEqual(received[1].idempotency_key, 'write-key-123');
  assert.equal(outcome.result.idempotencyKey, received[1].idempotency_key);
});

test('an unknown native outcome without a request_id is returned after one attempt', async () => {
  const { outcome, received } = await withScriptedBackend(
    [{ status: 200, body: outcomeUnknownBody('none') }, { status: 200, body: OK_BODY }],
    (apiBase) => writeCall(apiBase, { args: { input: { title: 'Plan' } } }),
  );
  assert.equal(outcome.error, undefined, outcome.error?.message);
  assert.equal(outcome.result.attempts, 1);
  assert.equal(findToolOutcomeUnknown(outcome.result.payload), 'document_outcome_unknown');
  assert.equal(received.length, 1);
});

test('--no-retry (runtime.retry false) makes a single attempt', async () => {
  const { outcome, received } = await withScriptedBackend(
    ['drop', { status: 200, body: OK_BODY }],
    (apiBase) => writeCall(apiBase, { runtime: { retry: false } }),
  );
  assert.ok(outcome.error instanceof CliError);
  assert.equal(outcome.error.code, 'network_error');
  assert.equal(received.length, 1);
});

test('--no-retry also stops the unknown-outcome replay', async () => {
  const args = { request_id: 'doc-write-0002' };
  const { outcome, received } = await withScriptedBackend(
    [{ status: 200, body: outcomeUnknownBody('doc-write-0002') }, { status: 200, body: OK_BODY }],
    (apiBase) => writeCall(apiBase, { runtime: { retry: false }, args }),
  );
  assert.equal(outcome.result.attempts, 1);
  assert.equal(received.length, 1);
});

test('retries stop after the attempt limit and report the attempt count', async () => {
  const unavailable = { status: 503, body: { error: { code: 'service_unavailable', message: 'Try again soon' } } };
  const { outcome, received } = await withScriptedBackend(
    [unavailable],
    (apiBase) => writeCall(apiBase),
  );
  assert.equal(received.length, RETRY_MAX_ATTEMPTS);
  assert.ok(outcome.error instanceof CliError);
  assert.equal(outcome.error.code, 'backend_error');
  assert.equal(outcome.error.details.attempts, RETRY_MAX_ATTEMPTS);
  // The backend's own error body stays readable next to the count.
  assert.equal(outcome.error.details.error.code, 'service_unavailable');
  assert.ok(outcome.error.hints.some((hint) => /tried this call 3 times/.test(hint.reason || '')));
});

test('a non-retryable error is returned after the first attempt, unchanged', async () => {
  const cases = [
    { status: 400, body: { error: { code: 'invalid_arguments', message: 'Bad input' } }, code: 'usage_error' },
    { status: 409, body: { error: { code: 'idempotency_outcome_unknown', message: 'Do not retry with a new key' } }, code: 'conflict' },
    { status: 500, body: { error: { code: 'internal_error', message: 'Boom' } }, code: 'backend_error' },
  ];
  for (const step of cases) {
    const { outcome, received } = await withScriptedBackend([step, { status: 200, body: OK_BODY }], (apiBase) => writeCall(apiBase));
    assert.equal(received.length, 1, `${step.status} must not be retried`);
    assert.ok(outcome.error instanceof CliError);
    assert.equal(outcome.error.code, step.code);
    assert.equal(outcome.error.details?.attempts, undefined);
  }
});

test('a call still in progress on the server is retried with the same key', async () => {
  const { outcome, received } = await withScriptedBackend(
    [
      { status: 409, body: { error: { code: 'idempotency_in_progress', message: 'Retry with the same key' } } },
      { status: 200, body: OK_BODY },
    ],
    (apiBase) => writeCall(apiBase),
  );
  assert.equal(outcome.error, undefined, outcome.error?.message);
  assert.equal(outcome.result.attempts, 2);
  assert.equal(received[0].idempotency_key, received[1].idempotency_key);
});

test('the retry classification only accepts transient failures', () => {
  const backendError = (httpStatus, code) => Object.assign(
    new CliError({ code: httpStatus === 409 ? 'conflict' : 'backend_error', message: 'x', details: { error: { code } } }),
    { httpStatus },
  );
  assert.equal(isTransientFailure(new CliError({ code: 'network_error', message: 'fetch failed' })), true);
  assert.equal(isTransientFailure(new CliError({ code: 'network_timeout', message: 'timed out' })), true);
  assert.equal(isTransientFailure(backendError(503, 'service_unavailable')), true);
  assert.equal(isTransientFailure(backendError(503, 'document_outcome_unknown')), false);
  assert.equal(isTransientFailure(backendError(409, 'idempotency_in_progress')), true);
  assert.equal(isTransientFailure(backendError(409, 'idempotency_outcome_unknown')), false);
  assert.equal(isTransientFailure(backendError(500, 'internal_error')), false);
  assert.equal(isTransientFailure(new Error('plain')), false);
});

test('only a single tool with a request_id qualifies for the unknown-outcome replay', () => {
  assert.equal(callCarriesToolRequestId({ tools: [{ arguments: { request_id: 'abc12345' } }] }), true);
  assert.equal(callCarriesToolRequestId({ tools: [{ arguments: {} }] }), false);
  assert.equal(callCarriesToolRequestId({ tools: [{ arguments: { request_id: '  ' } }] }), false);
  assert.equal(callCarriesToolRequestId({
    tools: [{ arguments: { request_id: 'a1234567' } }, { arguments: { request_id: 'b1234567' } }],
  }), false);
  assert.equal(callCarriesToolRequestId({ request_id: 'abc12345' }), true);
});

test('the next attempt waits only while the time budget allows it', async () => {
  const slept = [];
  const sleep = async (ms) => { slept.push(ms); };
  const now = () => 0;
  assert.equal(await waitForNextAttempt({ attempt: 1, deadline: 30000, budgetMs: 30000, now, sleep }), true);
  assert.equal(await waitForNextAttempt({ attempt: 2, deadline: 30000, budgetMs: 30000, now, sleep }), true);
  assert.equal(await waitForNextAttempt({ attempt: RETRY_MAX_ATTEMPTS, deadline: 30000, budgetMs: 30000, now, sleep }), false);
  // Less than a usable attempt left: stop instead of starting a doomed one.
  assert.equal(await waitForNextAttempt({ attempt: 1, deadline: 300, budgetMs: 30000, now, sleep }), false);
  assert.equal(slept.length, 2);
  assert.ok(slept[0] >= 125 && slept[0] <= 250, `first backoff ${slept[0]}`);
  assert.ok(slept[1] >= 250 && slept[1] <= 500, `second backoff ${slept[1]}`);
});

test('the opt-out reads --no-retry and NOTIS_NO_RETRY', () => {
  assert.equal(resolveRetryEnabled({}, {}), true);
  assert.equal(resolveRetryEnabled({ retry: true }, {}), true);
  assert.equal(resolveRetryEnabled({ retry: false }, {}), false);
  assert.equal(resolveRetryEnabled({}, { NOTIS_NO_RETRY: '1' }), false);
  assert.equal(resolveRetryEnabled({}, { NOTIS_NO_RETRY: 'true' }), false);
  assert.equal(resolveRetryEnabled({}, { NOTIS_NO_RETRY: '0' }), true);
  assert.equal(resolveRetryEnabled({}, { NOTIS_NO_RETRY: 'false' }), true);
  assert.equal(resolveRetryEnabled({}, { NOTIS_NO_RETRY: '' }), true);
});

async function runCli(args, env = {}) {
  try {
    const result = await execFileAsync('node', [binPath, ...args], {
      cwd: cliRoot,
      env: {
        PATH: process.env.PATH,
        HOME: mkdtempSync(join(tmpdir(), 'notis-cli-retry-home-')),
        NODE_ENV: 'test',
        NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1',
        NOTIS_JWT: makeJwt(),
        ...env,
      },
      encoding: 'utf-8',
    });
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { status: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

const EXEC_ARGS = ['tools', 'exec', 'LOCAL_NOTIS_DATABASE_QUERY', '--arguments', '{"database_slug":"tasks"}'];

test('tools exec reports the attempt count in meta', async () => {
  const { outcome, received } = await withScriptedBackend(
    [{ status: 502, body: { error: { code: 'bad_gateway', message: 'Bad gateway' } } }, { status: 200, body: OK_BODY }],
    (apiBase) => runCli(['--json', '--api-base', apiBase, ...EXEC_ARGS]),
  );
  assert.equal(outcome.status, 0, outcome.stderr);
  const payload = JSON.parse(outcome.stdout);
  assert.equal(payload.meta.attempts, 2);
  assert.equal(payload.meta.idempotency_key, received[1].idempotency_key);
  assert.equal(received[0].idempotency_key, received[1].idempotency_key);
});

for (const [label, extraArgs, env] of [
  ['--no-retry', ['--no-retry'], {}],
  ['NOTIS_NO_RETRY=1', [], { NOTIS_NO_RETRY: '1' }],
]) {
  test(`tools exec with ${label} reports the first failure`, async () => {
    const { outcome, received } = await withScriptedBackend(
      [{ status: 502, body: { error: { code: 'bad_gateway', message: 'Bad gateway' } } }, { status: 200, body: OK_BODY }],
      (apiBase) => runCli(['--json', '--api-base', apiBase, ...extraArgs, ...EXEC_ARGS], env),
    );
    assert.notEqual(outcome.status, 0);
    assert.equal(received.length, 1);
    const payload = JSON.parse(outcome.stdout);
    assert.equal(payload.error.code, 'backend_error');
    assert.equal(payload.error.details.attempts, 1);
  });
}
