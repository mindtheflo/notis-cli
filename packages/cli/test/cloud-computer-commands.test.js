import assert from 'node:assert/strict';
import test from 'node:test';
import { ccCommandSpecs } from '../src/command-specs/cc.js';
import { spacesCommandSpecs } from '../src/command-specs/spaces.js';
import { COMMAND_SPECS, GROUP_SUMMARIES } from '../src/command-specs/index.js';
import { toolCallTimeoutMs, toolsCommandSpecs } from '../src/command-specs/tools.js';

const SPACE = '0b8f7a52-5d1e-4c4b-9a43-5f3a1e2c9d10';
const SHELL = 'LOCAL_NOTIS_RUN_SANDBOX_SHELL';

function context(specs, path, { options = {}, args = {}, globalOptions = {}, timeoutMs = 30000, machine = true } = {}) {
  const spec = specs.find(value => value.command_path.join(' ') === path);
  assert.ok(spec, path);
  const notes = [];
  return { spec, options, args, globalOptions, notes,
    runtime: { credentialKind: 'env', profileName: 'cc-unit-only', jwt: 'fixture-not-a-real-credential',
      apiBase: 'https://fixture.invalid', timeoutMs, cliVersion: 'fixture', outputMode: 'json' },
    output: { emitSuccess: value => value, emitProgress() {}, note: message => notes.push(message), isMachineMode: () => machine } };
}

/** Answers /cli_tools calls in order (the last answer repeats) and records each request. */
function mockTools(t, answers) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls.push({ url, body: JSON.parse(request.body) });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

test('long shell calls: the sandbox shell is long-running and a long timeout_ms gets 30 s more', () => {
  assert.equal(toolCallTimeoutMs(SHELL, {}, 30000), 600000);
  assert.equal(toolCallTimeoutMs(SHELL, { command: 'x', timeout_ms: 700000 }, 30000), 730000);
  assert.equal(toolCallTimeoutMs('LOCAL_NOTIS_RUN_DESKTOP_SHELL', { command: 'x', timeout_ms: 300000 }, 30000), 330000);
  assert.equal(toolCallTimeoutMs('LOCAL_NOTIS_RUN_DESKTOP_SHELL', { command: 'x' }, 30000), 30000);
  // A detached job or a job action answers at once: its timeout bounds the job only.
  assert.equal(toolCallTimeoutMs(SHELL, { command: 'x', detach: true, timeout_ms: 21600000 }, 0), 600000);
  assert.equal(toolCallTimeoutMs(SHELL, { job_id: 'j', job_action: 'status', timeout_ms: 21600000 }, 0), 600000);
  // Never lowered below an explicit longer limit.
  assert.equal(toolCallTimeoutMs(SHELL, { command: 'x', timeout_ms: 1000 }, 900000), 900000);
  assert.equal(toolCallTimeoutMs('LOCAL_NOTIS_DATABASE_QUERY', { timeout_ms: 900000 }, 30000), 30000);
});

test('tools exec raises the call limit from the shell arguments it sends', async t => {
  mockTools(t, [{ successful: true, data: { results: [{ response: { data: { status: 'success', exit_code: 0 } } }] } }]);
  const ctx = context(toolsCommandSpecs, 'tools exec', { args: { toolName: 'LOCAL_NOTIS_RUN_DESKTOP_SHELL' },
    options: { arguments: JSON.stringify({ command: 'sleep 400', timeout_ms: 400000 }) } });
  await ctx.spec.handler(ctx);
  assert.equal(ctx.runtime.timeoutMs, 430000);
  const parallel = context(toolsCommandSpecs, 'tools exec-parallel', {
    args: { calls: JSON.stringify([{ tool_name: SHELL, arguments: { command: 'x', timeout_ms: 700000 } }]) } });
  await parallel.spec.handler(parallel);
  assert.equal(parallel.runtime.timeoutMs, 730000);
});

test('cc is its own extensible group with a summary, beside the other groups', () => {
  assert.ok(GROUP_SUMMARIES.cc);
  const paths = COMMAND_SPECS.filter(spec => spec.command_path[0] === 'cc').map(spec => spec.command_path.join(' '));
  assert.deepEqual(paths, ['cc run', 'cc push', 'cc pull', 'cc job status', 'cc job logs', 'cc job cancel']);
  for (const spec of ccCommandSpecs) {
    const direct = ['push', 'pull'].includes(spec.command_path[1]);
    assert.deepEqual(spec.backend_call, direct
      ? { type: 'http', path: '/portal_spaces/cloud-transfer' }
      : { type: 'tool', name: SHELL });
  }
});

test('cc run sends the command with detach, Space, folder and timeout, then prints the job id and next steps', async t => {
  const job = { job_id: 'job-1', status: 'running', exit_code: null, started_at: '2026-11-03T10:00:00Z', ended_at: null, log_bytes: 0 };
  const calls = mockTools(t, [{ status: 'success', job_id: 'job-1', job }]);
  const ctx = context(ccCommandSpecs, 'cc run', { args: { command: 'npm run build' },
    options: { detach: true, space: SPACE, cwd: '/vercel/sandbox/app' }, globalOptions: { timeoutMs: '3600000', idempotencyKey: 'run-key' },
    timeoutMs: 3600000 });
  const result = await ctx.spec.handler(ctx);
  assert.ok(calls[0].url.endsWith('/cli_tools'));
  assert.equal(calls[0].body.tool_name, SHELL);
  assert.deepEqual(calls[0].body.arguments, { command: 'npm run build', detach: true, space_id: SPACE, cwd: '/vercel/sandbox/app', timeout_ms: 3600000 });
  assert.equal(calls[0].body.idempotency_key, 'run-key');
  assert.equal(result.humanSummary, 'Started job job-1.');
  assert.deepEqual(result.hints.map(hint => hint.command), ['notis cc job logs job-1 --follow', 'notis cc job status job-1', 'notis cc job cancel job-1']);
  assert.equal(result.meta.mutating, true);
});

test('cc run attached returns the command output; a non-zero exit is a result, not a CLI error', async t => {
  const calls = mockTools(t, [{ status: 'error', stdout: 'built\n', stderr: 'warn\n', exit_code: 3, timeout_ms: 30000 }]);
  const ctx = context(ccCommandSpecs, 'cc run', { args: { command: 'make' } });
  const result = await ctx.spec.handler(ctx);
  assert.deepEqual(calls[0].body.arguments, { command: 'make' });
  assert.equal(result.data.exit_code, 3);
  assert.equal(result.humanSummary, 'Exited with code 3.');
  assert.ok(calls[0].body.idempotency_key);
});

test('cc run refuses bad input before any request', async t => {
  const calls = mockTools(t, [{}]);
  const cases = [
    [{ args: { command: '  ' } }, /command/],
    [{ args: { command: 'x' }, options: { space: 'not-a-uuid' } }, /--space/],
    [{ args: { command: 'x' }, globalOptions: { timeoutMs: '900000' } }, /720000/],
    [{ args: { command: 'x' }, options: { detach: true }, globalOptions: { timeoutMs: '99999999' } }, /21600000/],
    [{ args: { command: 'x' }, globalOptions: { timeoutMs: '10.5' } }, /--timeout-ms/],
  ];
  for (const [input, message] of cases) {
    const ctx = context(ccCommandSpecs, 'cc run', input);
    await assert.rejects(ctx.spec.handler(ctx), message);
  }
  assert.equal(calls.length, 0);
});

test('a refusal from the server is a CLI error with its code', async t => {
  mockTools(t, [{ status: 'error', error: 'cloud_computer_job_unknown', message: 'No such job.' }]);
  const ctx = context(ccCommandSpecs, 'cc job status', { args: { jobId: 'job-404' } });
  await assert.rejects(ctx.spec.handler(ctx), error => error.code === 'cloud_computer_job_unknown' && /No such job/.test(error.message));
});

test('cc job status and cancel use job_action; reads carry a fresh key each time', async t => {
  const job = { job_id: 'job-1', status: 'cancelled', exit_code: null, started_at: null, ended_at: null, log_bytes: 12 };
  const calls = mockTools(t, [job]);
  for (const [path, action] of [['cc job status', 'status'], ['cc job status', 'status'], ['cc job cancel', 'cancel']]) {
    const ctx = context(ccCommandSpecs, path, { args: { jobId: 'job-1' }, globalOptions: { idempotencyKey: 'pinned' } });
    const result = await ctx.spec.handler(ctx);
    assert.equal(result.humanSummary, 'Job job-1: cancelled, 12 bytes of output.');
    assert.equal(result.meta.mutating, action === 'cancel');
  }
  assert.deepEqual(calls.map(call => call.body.arguments), [
    { job_id: 'job-1', job_action: 'status' }, { job_id: 'job-1', job_action: 'status' }, { job_id: 'job-1', job_action: 'cancel' }]);
  assert.notEqual(calls[0].body.idempotency_key, calls[1].body.idempotency_key);
  assert.notEqual(calls[0].body.idempotency_key, 'pinned');
  assert.equal(calls[2].body.idempotency_key, 'pinned');
});

test('cc job logs reads once from an offset', async t => {
  const calls = mockTools(t, [{ job_id: 'job-1', status: 'running', text: 'hello', offset: 10, next_offset: 15, eof: false }]);
  const ctx = context(ccCommandSpecs, 'cc job logs', { args: { jobId: 'job-1' }, options: { offset: '10' } });
  const result = await ctx.spec.handler(ctx);
  assert.deepEqual(calls[0].body.arguments, { job_id: 'job-1', job_action: 'logs', log_offset: 10 });
  assert.deepEqual(result.data, { job_id: 'job-1', status: 'running', text: 'hello', offset: 10, next_offset: 15, eof: false });
  assert.equal(result.hints[0].command, 'notis cc job logs job-1 --offset 15 --follow');
  const bad = context(ccCommandSpecs, 'cc job logs', { args: { jobId: 'job-1' }, options: { offset: '-1' } });
  await assert.rejects(bad.spec.handler(bad), /--offset/);
});

test('cc job logs --follow polls every 2 s until eof and prints only new bytes', async t => {
  const calls = mockTools(t, [
    { job_id: 'job-1', status: 'running', text: 'a', offset: 0, next_offset: 1, eof: false },
    { job_id: 'job-1', status: 'running', text: '', offset: 1, next_offset: 1, eof: false },
    // A stale answer for an older offset must not print twice.
    { job_id: 'job-1', status: 'running', text: 'a', offset: 0, next_offset: 1, eof: false },
    { job_id: 'job-1', status: 'succeeded', text: 'bc', offset: 1, next_offset: 3, eof: false },
    { job_id: 'job-1', status: 'succeeded', text: 'd', offset: 3, next_offset: 4, eof: true },
  ]);
  const sleeps = [];
  const written = [];
  t.mock.method(process.stdout, 'write', chunk => { written.push(String(chunk)); return true; });
  const ctx = context(ccCommandSpecs, 'cc job logs', { args: { jobId: 'job-1' }, options: { follow: true }, machine: false });
  ctx.sleep = async ms => { sleeps.push(ms); };
  const result = await ctx.spec.handler(ctx);
  t.mock.restoreAll();
  assert.deepEqual(calls.map(call => call.body.arguments.log_offset), [0, 1, 1, 1, 3]);
  assert.deepEqual(sleeps, [2000, 2000, 2000]);
  assert.equal(written.join(''), 'abcd');
  assert.deepEqual(result.data, { job_id: 'job-1', status: 'succeeded', text: 'abcd', offset: 0, next_offset: 4, eof: true });
  assert.equal(result.renderHuman(), '');
  assert.deepEqual(ctx.notes, ['Job job-1 succeeded; all output read.']);
});

test('cc job logs --follow in JSON mode returns one envelope and stops on an ended job that never reports eof', async t => {
  const calls = mockTools(t, [{ job_id: 'job-1', status: 'lost', text: '', offset: 0, next_offset: 0, eof: false }]);
  const ctx = context(ccCommandSpecs, 'cc job logs', { args: { jobId: 'job-1' }, options: { follow: true } });
  ctx.sleep = async () => {};
  const result = await ctx.spec.handler(ctx);
  assert.equal(calls.length, 3);
  assert.equal(result.data.status, 'lost');
  assert.equal(result.data.eof, false);
});

test('spaces folder gets, maps and clears through the space-folder operation', async t => {
  const answers = [
    { space_id: SPACE, target: 'cloud', canonical_path: `/vercel/sandbox/spaces/${SPACE}`, mapped_path: null, path: `/vercel/sandbox/spaces/${SPACE}` },
    { space_id: SPACE, target: 'desktop', canonical_path: `~/Documents/Notis/spaces/${SPACE}`, mapped_path: '~/code/app', path: '~/code/app' },
    { space_id: SPACE, target: 'cloud', canonical_path: `/vercel/sandbox/spaces/${SPACE}`, mapped_path: null, path: `/vercel/sandbox/spaces/${SPACE}` },
  ];
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls.push({ url, body: JSON.parse(request.body), headers: request.headers });
    return new Response(JSON.stringify(answers[calls.length - 1]));
  });
  const run = async options => {
    const ctx = context(spacesCommandSpecs, 'spaces folder', { args: { spaceId: SPACE }, options });
    return ctx.spec.handler(ctx);
  };
  const got = await run({});
  assert.equal(got.humanSummary, `On the Cloud Computer this Space works in its own folder /vercel/sandbox/spaces/${SPACE} (not mapped).`);
  assert.equal(got.meta.mutating, false);
  const mapped = await run({ target: 'desktop', map: '~/code/app' });
  assert.equal(mapped.humanSummary, `On this computer this Space works in ~/code/app (mapped; its own folder is ~/Documents/Notis/spaces/${SPACE}).`);
  assert.equal(mapped.meta.mutating, true);
  await run({ unmap: true });
  assert.ok(calls.every(call => call.url === 'https://fixture.invalid/portal_spaces/space-folder'));
  assert.equal(calls[0].headers['X-Notis-Spaces-Protocol'], '2');
  assert.deepEqual(calls.map(call => call.body), [
    { space_id: SPACE, action: 'get', target: 'cloud' },
    { space_id: SPACE, action: 'set', target: 'desktop', path: '~/code/app' },
    { space_id: SPACE, action: 'clear', target: 'cloud' },
  ]);
});

test('spaces folder refuses unclear mappings before any request', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not request'); });
  for (const [options, message] of [
    [{ map: '/vercel/sandbox/a', unmap: true }, /not both/],
    [{ target: 'server' }, /cloud or desktop/],
    [{ map: '/etc' }, /inside \/vercel\/sandbox/],
    [{ map: 'relative/dir', target: 'desktop' }, /absolute/],
  ]) {
    const ctx = context(spacesCommandSpecs, 'spaces folder', { args: { spaceId: SPACE }, options });
    await assert.rejects(ctx.spec.handler(ctx), message);
  }
  assert.equal(fetch.mock.callCount(), 0);
});
