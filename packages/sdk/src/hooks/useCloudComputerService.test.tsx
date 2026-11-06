import '../ui/testDom';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { NotisProvider } from '../provider';
import type { NotisRuntime } from '../runtime';
import { guardSpaceRuntime, spaceCloudComputerAccess, spaceCloudComputerAllows, type SpaceCloudComputerJobInput,
  type SpaceCloudComputerJobOperation, type SpaceCloudComputerLeaseInput, type SpaceCloudComputerLeaseResult,
  type SpaceCloudComputerTransport, type SpaceRuntimeDescriptor, type SpaceCloudComputerAccessInput } from '../space';
import { CloudComputerWaking } from '../ui/cloud/CloudComputerWaking';
import { CloudComputerFrame, FRAME_GREETING_MS } from '../ui/cloud/CloudComputerFrame';
import { cloudComputerPriceWords, formatHourlyPrice } from '../cloudComputerWords';
import { SERVICE_PULSE_MS, useCloudComputerService, type UseCloudComputerServiceResult } from './useCloudComputerService';
import { useCloudComputerJob, type UseCloudComputerJobResult } from './useCloudComputerJob';
import { useCloudComputerShell, type UseCloudComputerShellResult } from './useCloudComputerShell';

type Answer = Partial<SpaceCloudComputerLeaseResult> | Error;

function leaseAnswer(status: SpaceCloudComputerLeaseResult['status'], more: Partial<SpaceCloudComputerLeaseResult> = {}): SpaceCloudComputerLeaseResult {
  return { service: 'preview', status, lease_expires_at: null, retry_after_seconds: null, gate_url: null, pass: null, pass_expires_at: null,
    price: { hourly_usd: 0.14, size: 'standard' }, ...more };
}

function transportWith(answer: (input: SpaceCloudComputerLeaseInput) => Answer, calls: SpaceCloudComputerLeaseInput[] = []):
  SpaceCloudComputerTransport {
  return {
    status: async () => ({ level: 'shell', approved: true, reason: null }),
    requestApproval: async () => ({ level: 'shell', approved: true, reason: null }),
    facts: async () => { throw new Error('facts not used'); },
    run: async () => ({ status: 'success' }),
    upload: async () => ({ status: 'success' }),
    lease: async (input) => {
      calls.push(input);
      const result = answer(input);
      if (result instanceof Error) throw result;
      return leaseAnswer(result.status ?? 'ready', result);
    },
  };
}

function runtimeWith(transport: SpaceCloudComputerTransport | undefined, more: Partial<SpaceRuntimeDescriptor> = {}, locale = 'en'): NotisRuntime {
  return {
    resource: { kind: 'space', id: 'space-a', revision: 2 },
    space: { id: 'space-a', revision: 2, cacheScope: 'scope', actions: {}, bindings: {}, cloudComputer: 'shell',
      cloudComputerServices: ['preview'], ...more },
    app: { id: 'space-a', name: 'A' }, route: { slug: 'view', path: '/', name: 'View' }, databases: [], context: { locale },
    callTool: async () => { throw new Error('no'); }, listTools: async () => { throw new Error('no'); },
    request: async () => { throw new Error('no'); }, callAction: async <T,>() => ({}) as T,
    spaceCloudComputer: transport,
  } as unknown as NotisRuntime;
}

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new window.Event('visibilitychange'));
}

async function flush() { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }

async function mount(t: TestContext, runtime: NotisRuntime, render: () => React.ReactNode): Promise<Root> {
  visibility = 'visible';
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  await act(async () => { root.render(<NotisProvider runtime={runtime}>{render()}</NotisProvider>); await flush(); });
  return root;
}
async function tick(t: TestContext, ms: number) {
  await act(async () => { t.mock.timers.tick(ms); await flush(); });
}

test('a visible service pulses at once and every 30 s, stops when hidden and resumes when visible', async (t) => {
  const calls: SpaceCloudComputerLeaseInput[] = [];
  const transport = transportWith(() => ({ status: 'ready' }), calls);
  let seen: UseCloudComputerServiceResult | undefined;
  function Probe() { seen = useCloudComputerService('preview'); return null; }
  const root = await mount(t, runtimeWith(transport), () => <Probe />);
  assert.equal(seen!.status, 'ready');
  assert.equal(calls.length, 1);
  assert.deepEqual({ service: calls[0].service, visible: calls[0].visible }, { service: 'preview', visible: true });
  assert.match(calls[0].holder, /^[A-Za-z0-9._:-]{8,100}$/);
  await tick(t, SERVICE_PULSE_MS - 1);
  assert.equal(calls.length, 1);
  await tick(t, 1);
  assert.equal(calls.length, 2);
  await tick(t, SERVICE_PULSE_MS);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.holder === calls[0].holder), 'one holder for the life of the view');

  await act(async () => { setVisibility('hidden'); await flush(); });
  assert.deepEqual(calls.at(-1)!.visible, false, 'hidden sends one visible: false');
  const afterHide = calls.length;
  await tick(t, SERVICE_PULSE_MS * 4);
  assert.equal(calls.length, afterHide, 'no pulse while hidden');

  await act(async () => { setVisibility('visible'); await flush(); });
  assert.equal(calls.length, afterHide + 1);
  assert.equal(calls.at(-1)!.visible, true, 'visible again pulses at once');

  await act(async () => { root.unmount(); await flush(); });
  assert.equal(calls.at(-1)!.visible, false, 'unmount lets the lease go');
});

test('a start re-asks after retry_after (clamped) and turns failed after the bounded wait; retry starts again', async (t) => {
  const calls: SpaceCloudComputerLeaseInput[] = [];
  let retryAfter: number | null = 0.2;
  let ready = false;
  const transport = transportWith(() => (ready ? { status: 'ready' } : { status: 'starting', retry_after_seconds: retryAfter }), calls);
  let seen: UseCloudComputerServiceResult | undefined;
  function Probe() { seen = useCloudComputerService('preview', { waitSeconds: 20 }); return null; }
  const root = await mount(t, runtimeWith(transport), () => <Probe />);
  assert.equal(seen!.status, 'starting');
  assert.equal(calls.length, 1);
  await tick(t, 999);
  assert.equal(calls.length, 1, 'a 0.2 s hint is clamped to 1 s');
  await tick(t, 1);
  assert.equal(calls.length, 2);
  retryAfter = 600;
  await tick(t, 1000);
  assert.equal(calls.length, 3);
  await tick(t, 9_999);
  assert.equal(calls.length, 3, 'a 600 s hint is clamped to 10 s');
  await tick(t, 1);
  assert.equal(calls.length, 4);
  await tick(t, 8_000);
  assert.equal(seen!.status, 'failed', 'never an endless spinner');
  assert.match(seen!.error!.message, /did not start within 20 seconds/);
  assert.equal(calls.at(-1)!.visible, false, 'a failed start lets its lease go');
  const afterFail = calls.length;
  await tick(t, SERVICE_PULSE_MS * 2);
  assert.equal(calls.length, afterFail, 'no pulse after a failure');

  ready = true;
  await act(async () => { seen!.retry(); await flush(); });
  assert.equal(seen!.status, 'ready');
  assert.equal(calls.at(-1)!.visible, true);
  assert.equal(seen!.error, null);
  await act(async () => { root.unmount(); await flush(); });
});

test('a service launching on the machine keeps the view waiting past its wait, until the machine stops saying so', async (t) => {
  let answer: { status: 'starting' | 'ready'; reason?: string; retry_after_seconds: number } =
    { status: 'starting', reason: 'launching', retry_after_seconds: 3 };
  const transport = transportWith(() => answer);
  let seen: UseCloudComputerServiceResult | undefined;
  function Probe() { seen = useCloudComputerService('preview', { waitSeconds: 20 }); return null; }
  const root = await mount(t, runtimeWith(transport), () => <Probe />);
  for (let second = 0; second < 60; second += 3) await tick(t, 3_000);
  assert.equal(seen!.status, 'starting', 'three times the wait: the service process runs, so no failure');
  answer = { status: 'starting', retry_after_seconds: 3 };
  for (let second = 0; second < 21; second += 3) await tick(t, 3_000);
  assert.equal(seen!.status, 'failed', 'once the machine stops saying it launches, the usual wait runs out');
  await act(async () => { root.unmount(); await flush(); });
});

test('a wake still in flight when the wait runs out lets its answer decide', async (t) => {
  const pending: Array<(value: ReturnType<typeof leaseAnswer>) => void> = [];
  const transport = { ...transportWith(() => ({ status: 'ready' })),
    lease: (input: SpaceCloudComputerLeaseInput) => (input.visible
      ? new Promise<ReturnType<typeof leaseAnswer>>((resolve) => { pending.push(resolve); })
      : Promise.resolve(leaseAnswer('released'))) };
  let seen: UseCloudComputerServiceResult | undefined;
  function Probe() { seen = useCloudComputerService('preview', { waitSeconds: 20 }); return null; }
  const root = await mount(t, runtimeWith(transport), () => <Probe />);
  await tick(t, 30_000);
  assert.equal(seen!.status, 'starting', 'the server is still waking the machine: no verdict yet');
  await act(async () => { pending.shift()!(leaseAnswer('starting', { reason: 'launching', retry_after_seconds: 3 })); await flush(); });
  assert.equal(seen!.status, 'starting', 'the machine woke and the service launches');
  await tick(t, 3_000);
  await act(async () => { pending.shift()!(leaseAnswer('starting', { retry_after_seconds: 3 })); await flush(); });
  await tick(t, 21_000);
  await act(async () => { pending.shift()?.(leaseAnswer('starting', { retry_after_seconds: 3 })); await flush(); });
  assert.equal(seen!.status, 'failed', 'an answer after the wait with no progress ends it');
  await act(async () => { root.unmount(); await flush(); });
});

test('a machine restoring its files reads as restoring, and a wait that runs out says to come back later', async (t) => {
  let restoring = true;
  const transport = transportWith(() => (restoring ? { status: 'starting', reason: 'restoring', retry_after_seconds: 30 }
    : { status: 'starting', retry_after_seconds: 2 }));
  let seen: UseCloudComputerServiceResult | undefined;
  function Probe() { seen = useCloudComputerService('preview', { waitSeconds: 25 }); return null; }
  const root = await mount(t, runtimeWith(transport, {}, 'fr'), () => <Probe />);
  assert.equal(seen!.status, 'starting');
  assert.equal(seen!.restoring, true);
  restoring = false;
  await tick(t, 10_000);
  assert.equal(seen!.restoring, false, 'a plain start is not restoring');
  restoring = true;
  await tick(t, 2_000);
  assert.equal(seen!.restoring, true);
  await tick(t, 13_000);
  assert.equal(seen!.status, 'failed');
  assert.equal(seen!.restoring, false);
  assert.match(seen!.error!.message, /restaure encore ses fichiers/);
  await act(async () => { root.unmount(); await flush(); });
});

test('a failed answer says the server message; a lost pulse while ready is tolerated', async (t) => {
  let answer: Answer = { status: 'failed', reason: 'exited', message: 'npm run dev exited with code 1.' };
  const transport = transportWith(() => answer);
  let seen: UseCloudComputerServiceResult | undefined;
  function Probe() { seen = useCloudComputerService('preview'); return null; }
  const root = await mount(t, runtimeWith(transport), () => <Probe />);
  assert.equal(seen!.status, 'failed');
  assert.equal(seen!.error!.message, 'npm run dev exited with code 1.');
  answer = { status: 'ready' };
  await act(async () => { seen!.retry(); await flush(); });
  assert.equal(seen!.status, 'ready');
  answer = new Error('network down');
  await tick(t, SERVICE_PULSE_MS);
  assert.equal(seen!.status, 'ready', 'one lost pulse does not end a ready service');
  await tick(t, SERVICE_PULSE_MS);
  await tick(t, SERVICE_PULSE_MS);
  assert.equal(seen!.status, 'failed');
  assert.equal(seen!.error!.message, 'network down');
  await act(async () => { root.unmount(); await flush(); });
});

test('a start refused for a missing approval offers Allow in EN and FR, and starts once the viewer allows', async (t) => {
  let approved = false;
  let prompts = 0;
  const calls: SpaceCloudComputerLeaseInput[] = [];
  const transport: SpaceCloudComputerTransport = {
    ...transportWith(() => (approved ? { status: 'ready' } : new Error('Allow this Space to use your Cloud Computer first.')), calls),
    status: async () => ({ level: 'shell', approved, reason: approved ? null : 'approval_required' }),
    requestApproval: async () => { prompts += 1; approved = true; return { level: 'shell', approved: true, reason: null }; },
  };
  for (const [locale, title, allow] of [['en', 'Allow this Space to use your Cloud Computer', 'Allow'],
    ['fr', 'Autorise ce Space à utiliser ton Cloud Computer', 'Autoriser']] as const) {
    approved = false;
    document.documentElement.setAttribute('lang', locale);
    let seen: UseCloudComputerServiceResult | undefined;
    function Probe() { seen = useCloudComputerService('preview'); return <CloudComputerWaking service={seen}><p>ready</p></CloudComputerWaking>; }
    const root = await mount(t, runtimeWith(transport, {}, locale), () => <Probe />);
    assert.equal(seen!.status, 'failed');
    assert.equal(seen!.approvalRequired, true);
    const panel = document.querySelector('[data-state="approval"]');
    assert.ok(panel, 'the approval panel shows instead of Try again');
    assert.match(panel!.textContent ?? '', new RegExp(title));
    const button = [...panel!.querySelectorAll('button')].find((item) => item.textContent?.includes(allow));
    assert.ok(button);
    await act(async () => { button!.click(); await flush(); });
    assert.equal(seen!.status, 'ready');
    assert.equal(seen!.approvalRequired, false);
    assert.equal(document.querySelector('p')?.textContent, 'ready');
    t.mock.timers.reset();
    await act(async () => { root.unmount(); await flush(); });
  }
  document.documentElement.setAttribute('lang', 'en');
  assert.equal(prompts, 2);
});

test('a failure with the approval given keeps Try again', async (t) => {
  const transport = transportWith(() => ({ status: 'failed', reason: 'exited', message: 'npm run dev exited with code 1.' }));
  let seen: UseCloudComputerServiceResult | undefined;
  function Probe() { seen = useCloudComputerService('preview'); return <CloudComputerWaking service={seen} />; }
  const root = await mount(t, runtimeWith(transport), () => <Probe />);
  assert.equal(seen!.approvalRequired, false);
  assert.ok(document.querySelector('[data-state="failed"]'));
  await act(async () => { root.unmount(); await flush(); });
});

test('url and fetch use the gate and its pass; without a gate fetch throws', async (t) => {
  let gate: Partial<SpaceCloudComputerLeaseResult> = { status: 'ready' };
  const transport = transportWith(() => gate);
  let seen: UseCloudComputerServiceResult | undefined;
  function Probe() { seen = useCloudComputerService('preview'); return null; }
  const root = await mount(t, runtimeWith(transport), () => <Probe />);
  assert.equal(seen!.url('/'), null);
  assert.equal(seen!.mediaUrl('/a.mp4'), null);
  await assert.rejects(seen!.fetch('/api'), /cannot be reached yet/);
  gate = { status: 'ready', gate_url: 'https://gate.example/', pass: 'pass-123' };
  await tick(t, SERVICE_PULSE_MS);
  assert.equal(seen!.url('/api/items?x=1'), 'https://gate.example/s/space-a/preview/api/items?x=1');
  assert.equal(seen!.url('api'), 'https://gate.example/s/space-a/preview/api');
  const requests: Array<{ url: string; auth: string | null; method?: string }> = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, auth: new Headers(init?.headers).get('Authorization'), method: init?.method });
    return new Response('ok');
  }) as typeof fetch;
  try {
    await seen!.fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  } finally { globalThis.fetch = savedFetch; }
  assert.deepEqual(requests, [{ url: 'https://gate.example/s/space-a/preview/api', auth: 'Bearer pass-123', method: 'POST' }]);
  assert.deepEqual(seen!.price, { hourly_usd: 0.14, size: 'standard' });
  await act(async () => { root.unmount(); await flush(); });
});

test('without a host transport or a declaration the service is unavailable and nothing is asked', async (t) => {
  const calls: SpaceCloudComputerLeaseInput[] = [];
  const transport = transportWith(() => ({ status: 'ready' }), calls);
  const results: Record<string, UseCloudComputerServiceResult> = {};
  function Probe({ name }: { name: string }) { results[name] = useCloudComputerService(name === 'undeclared' ? 'other' : 'preview'); return null; }
  const noHost = await mount(t, runtimeWith(undefined), () => <Probe name="site" />);
  await act(async () => { noHost.unmount(); });
  t.mock.timers.reset();
  const oldHost = await mount(t, runtimeWith({ ...transport, lease: undefined }), () => <Probe name="old" />);
  await act(async () => { oldHost.unmount(); });
  t.mock.timers.reset();
  const undeclared = await mount(t, runtimeWith(transport), () => <Probe name="undeclared" />);
  await act(async () => { undeclared.unmount(); });
  t.mock.timers.reset();
  const readOnly = await mount(t, runtimeWith(transport, { cloudComputer: 'read' }), () => <Probe name="read" />);
  await act(async () => { readOnly.unmount(); });
  for (const name of ['site', 'old', 'undeclared', 'read']) assert.equal(results[name].status, 'unavailable', name);
  assert.equal(calls.length, 0);
});

test('the guard passes services, jobs and the folder only as declared', async () => {
  const calls: string[] = [];
  const transport: SpaceCloudComputerTransport = {
    ...transportWith(() => ({ status: 'ready' })),
    lease: async (input) => { calls.push(`lease:${input.service}`); return leaseAnswer('ready'); },
    job: async <O extends SpaceCloudComputerJobOperation>(operation: O, input: SpaceCloudComputerJobInput) => {
      calls.push(`${operation}:${input.job_id}`);
      return { job_id: input.job_id, status: 'running', exit_code: null, started_at: null, ended_at: null, log_bytes: 0 } as never;
    },
    folder: async () => { calls.push('folder'); return { path: '/vercel/sandbox/spaces/space-a', canonical_path: '/vercel/sandbox/spaces/space-a', mapped: false }; },
  };
  const shell = guardSpaceRuntime(runtimeWith(transport))!.spaceCloudComputer!;
  await shell.lease!({ service: 'preview', visible: true, holder: 'holder-0001' });
  await assert.rejects(shell.lease!({ service: 'other', visible: true, holder: 'holder-0001' }), /does not declare that Cloud Computer service/);
  await shell.job!('job.status', { job_id: 'j1' });
  await shell.job!('job.logs', { job_id: 'j1' });
  await shell.job!('job.cancel', { job_id: 'j1' });
  await assert.rejects(shell.job!('job.delete' as never, { job_id: 'j1' }), /supported Cloud Computer job operation/);
  await shell.folder!();
  assert.deepEqual(calls, ['lease:preview', 'job.status:j1', 'job.logs:j1', 'job.cancel:j1', 'folder']);

  const reader = guardSpaceRuntime(runtimeWith(transport, { cloudComputer: 'read' }))!.spaceCloudComputer!;
  await assert.rejects(reader.lease!({ service: 'preview', visible: true, holder: 'holder-0001' }), /cloudComputer: shell/);
  await assert.rejects(reader.job!('job.status', { job_id: 'j1' }), /cloudComputer: shell/);
  await reader.folder!();
  const noServices = guardSpaceRuntime(runtimeWith(transport, { cloudComputerServices: undefined }))!.spaceCloudComputer!;
  await assert.rejects(noServices.lease!({ service: 'preview', visible: true, holder: 'holder-0001' }), /does not declare/);
  // An older host has none of them: the guard offers none.
  const old = guardSpaceRuntime(runtimeWith({ ...transport, lease: undefined, job: undefined, folder: undefined }))!.spaceCloudComputer!;
  assert.equal(old.lease, undefined);
  assert.equal(old.job, undefined);
  assert.equal(old.folder, undefined);

  assert.equal(spaceCloudComputerAllows('read', 'folder'), true);
  assert.equal(spaceCloudComputerAllows('read', 'job.logs'), false);
  assert.equal(spaceCloudComputerAllows('shell', 'service.lease'), true);
  assert.equal(spaceCloudComputerAllows('shell', 'env' as never), false);
  assert.equal(spaceCloudComputerAccess('read'), 'read');
  assert.equal(spaceCloudComputerAccess({ access: 'shell', services: [{ id: 'preview', command: 'npm run dev' }] }), 'shell');
  assert.equal(spaceCloudComputerAccess(undefined), null);
});

test('useCloudComputerShell sends cwd as a Space path, detach, and the job operations', async (t) => {
  const sent: unknown[] = [];
  const transport: SpaceCloudComputerTransport = {
    ...transportWith(() => ({ status: 'ready' })),
    run: async (input) => { sent.push(input); return { status: 'success', job_id: 'j1' }; },
    job: async <O extends SpaceCloudComputerJobOperation>(operation: O, input: SpaceCloudComputerJobInput) => {
      sent.push([operation, input]);
      return {} as never;
    },
  };
  let shell: UseCloudComputerShellResult | undefined;
  function Probe() { shell = useCloudComputerShell(); return null; }
  const root = await mount(t, runtimeWith(transport), () => <Probe />);
  await shell!.run('npm run build', { cwd: { space: '' }, detach: true, timeoutMs: 600_000 });
  await shell!.run('ls', { cwd: 'repo' });
  await shell!.jobStatus('j1');
  await shell!.jobLogs('j1', { offset: 10, maxBytes: 100 });
  await shell!.cancelJob('j1');
  assert.deepEqual(sent, [
    { command: 'npm run build', cwd: { space: '' }, detach: true, timeout_ms: 600_000 },
    { command: 'ls', cwd: 'repo' },
    ['job.status', { job_id: 'j1' }],
    ['job.logs', { job_id: 'j1', offset: 10, max_bytes: 100 }],
    ['job.cancel', { job_id: 'j1' }],
  ]);
  await act(async () => { root.unmount(); });
});

test('useCloudComputerJob appends the log until the job ends and pauses while hidden', async (t) => {
  const output = 'line 1\nline 2\nline 3\n';
  let written = 7;
  let state: 'running' | 'succeeded' = 'running';
  const reads: string[] = [];
  const transport: SpaceCloudComputerTransport = {
    ...transportWith(() => ({ status: 'ready' })),
    job: async <O extends SpaceCloudComputerJobOperation>(operation: O, input: SpaceCloudComputerJobInput) => {
      reads.push(operation);
      if (operation === 'job.logs') {
        const offset = input.offset ?? 0;
        const text = output.slice(offset, written);
        return { job_id: 'j1', status: state, text, offset, next_offset: offset + text.length,
          eof: state !== 'running' && offset + text.length >= written } as never;
      }
      return { job_id: 'j1', status: state, exit_code: state === 'running' ? null : 0, started_at: null, ended_at: null, log_bytes: written } as never;
    },
  };
  let seen: UseCloudComputerJobResult | undefined;
  function Probe() { seen = useCloudComputerJob('j1', { pollMs: 1000 }); return null; }
  const root = await mount(t, runtimeWith(transport), () => <Probe />);
  assert.equal(seen!.log, 'line 1\n');
  assert.equal(seen!.running, true);
  written = 14;
  await tick(t, 1000);
  assert.equal(seen!.log, 'line 1\nline 2\n');
  await act(async () => { setVisibility('hidden'); await flush(); });
  const hiddenReads = reads.length;
  await tick(t, 5000);
  assert.equal(reads.length, hiddenReads, 'no reads while hidden');
  written = output.length; state = 'succeeded';
  await act(async () => { setVisibility('visible'); await flush(); });
  assert.equal(seen!.log, output);
  assert.equal(seen!.job!.status, 'succeeded');
  assert.equal(seen!.running, false);
  const doneReads = reads.length;
  await tick(t, 5000);
  assert.equal(reads.length, doneReads, 'an ended job is not read again');
  await act(async () => { root.unmount(); });
});

test('CloudComputerWaking says each state in English and French, and shows the price behind its info button', async (t) => {
  const result = (status: UseCloudComputerServiceResult['status'], more: Partial<UseCloudComputerServiceResult> = {}): UseCloudComputerServiceResult => ({
    id: 'preview', status, lease: null, restoring: false, error: null, waitSeconds: 90, price: { hourly_usd: 0.14, size: null },
    url: () => null, fetch: async () => new Response(), mediaUrl: () => null, retry: () => undefined,
    media: async () => [], frameCode: async () => { throw new Error('no frame'); }, approvalRequired: false,
    allow: async () => undefined, ...more });
  const texts: Record<string, string> = {};
  for (const lang of ['en', 'fr'] as const) {
    document.documentElement.setAttribute('lang', lang);
    for (const [name, value] of Object.entries({
      starting: result('starting'), restoring: result('starting', { restoring: true }), ready: result('ready'),
      failed: result('failed', { error: new Error('Port 3000 is busy.') }),
    })) {
      const root = await mount(t, runtimeWith(undefined), () => <CloudComputerWaking service={value} retryDelaySeconds={3}><p>Page</p></CloudComputerWaking>);
      texts[`${lang}:${name}`] = document.getElementById('app')!.textContent ?? '';
      if (name === 'failed') {
        const button = [...document.querySelectorAll('button')].find((item) => !item.getAttribute('aria-label'))!;
        assert.equal(button.disabled, true, 'Try again waits first');
        await tick(t, 3000);
        assert.equal(button.disabled, false);
        texts[`${lang}:failed-later`] = button.textContent ?? '';
      }
      if (name === 'starting') {
        const info = document.querySelector<HTMLButtonElement>('button[aria-label]')!;
        texts[`${lang}:info`] = info.getAttribute('aria-label')!;
      }
      await act(async () => { root.unmount(); });
      t.mock.timers.reset();
    }
    const unavailable = await mount(t, runtimeWith(undefined), () => <CloudComputerWaking service="preview"><p>Page</p></CloudComputerWaking>);
    texts[`${lang}:unavailable`] = document.getElementById('app')!.textContent ?? '';
    await act(async () => { unavailable.unmount(); });
    t.mock.timers.reset();
  }
  document.documentElement.setAttribute('lang', 'en');
  assert.match(texts['en:starting'], /Starting your Cloud Computer/);
  assert.match(texts['fr:starting'], /Démarrage de ton Cloud Computer/);
  assert.match(texts['en:restoring'], /Your Cloud Computer is restoring its files.*few minutes/);
  assert.match(texts['fr:restoring'], /Ton Cloud Computer restaure ses fichiers.*quelques minutes/);
  assert.doesNotMatch(texts['en:restoring'], /Starting/);
  assert.equal(texts['en:ready'], 'Page');
  assert.equal(texts['fr:ready'], 'Page');
  assert.match(texts['en:failed'], /Port 3000 is busy\./);
  assert.match(texts['en:failed'], /Try again in 3 s/);
  assert.match(texts['fr:failed'], /Réessayer dans 3/);
  assert.equal(texts['en:failed-later'], 'Try again');
  assert.equal(texts['fr:failed-later'], 'Réessayer');
  assert.equal(texts['en:info'], 'What it costs');
  assert.equal(texts['fr:info'], 'Ce que ça coûte');
  assert.match(texts['en:unavailable'], /needs the Cloud Computer in Notis/);
  assert.match(texts['fr:unavailable'], /besoin du Cloud Computer dans Notis/);
  // The price, in each language's number format; no price, no button.
  assert.equal(formatHourlyPrice(0.14, 'en'), '$0.14');
  assert.match(formatHourlyPrice(0.14, 'fr'), /^0,14\s\$$/);
  assert.deepEqual(cloudComputerPriceWords(0.14)!.en, 'About $0.14 per hour while it runs, from your credit.');
  assert.match(cloudComputerPriceWords(0.14)!.fr, /^Environ 0,14\s\$ par heure tant qu’il tourne/);
  assert.equal(cloudComputerPriceWords(null), null);
});

function accessTransport(calls: SpaceCloudComputerAccessInput[], ttlMs = 600_000): SpaceCloudComputerTransport {
  return {
    ...transportWith(() => ({ status: 'ready', gate_url: 'https://gate.example', pass: 'pass-1' })),
    access: async (input) => {
      calls.push(input);
      const expires = new Date(Date.now() + ttlMs).toISOString();
      return {
        service: input.service, gate_url: 'https://gate.example',
        media: (input.media ?? []).map((path) => ({ path, url: `https://gate.example/m/t${calls.length}${path}`, expires_at: expires })),
        frame: input.frame ? { frame: 'https://gate.example/__notis_gate/frame', action: 'https://gate.example/__notis_gate/bootstrap',
          code: `code-${calls.length}`, next: input.path ?? '/', expires_at: expires } : null,
      };
    },
  };
}

test('mediaUrl asks once for every file a render names, then renews each link before it ends', async (t) => {
  const calls: SpaceCloudComputerAccessInput[] = [];
  let seen: UseCloudComputerServiceResult | undefined;
  let urls: Array<string | null> = [];
  function Probe() {
    seen = useCloudComputerService('preview');
    urls = [seen.mediaUrl('/out/cut.mp4'), seen.mediaUrl('/out/poster.jpg'), seen.mediaUrl('relative.mp4')];
    return null;
  }
  const root = await mount(t, runtimeWith(accessTransport(calls)), () => <Probe />);
  await act(async () => { await flush(); });
  assert.deepEqual(calls, [{ service: 'preview', media: ['/out/cut.mp4', '/out/poster.jpg'] }]);
  assert.deepEqual(urls, ['https://gate.example/m/t1/out/cut.mp4', 'https://gate.example/m/t1/out/poster.jpg', null]);
  // Eight minutes in, the links are renewed (two minutes before they end), in one request.
  await tick(t, 8 * 60_000);
  await act(async () => { await flush(); });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].media, ['/out/cut.mp4', '/out/poster.jpg']);
  assert.equal(urls[0], 'https://gate.example/m/t2/out/cut.mp4');
  const links = await seen!.media(['/a.wav']);
  assert.equal(links[0].url, 'https://gate.example/m/t3/a.wav');
  await act(async () => { root.unmount(); await flush(); });
});

test('media links and frame codes wait for a ready service and a host that offers them', async (t) => {
  const calls: SpaceCloudComputerAccessInput[] = [];
  let seen: UseCloudComputerServiceResult | undefined;
  function Probe() { seen = useCloudComputerService('preview'); return null; }
  const transport = { ...accessTransport(calls), lease: async () => leaseAnswer('starting', { retry_after_seconds: 3 }) };
  const starting = await mount(t, runtimeWith(transport), () => <Probe />);
  assert.equal(seen!.mediaUrl('/a.mp4'), null);
  await assert.rejects(seen!.frameCode('/'), /cannot be reached yet/);
  await act(async () => { starting.unmount(); await flush(); });
  t.mock.timers.reset();
  const old = await mount(t, runtimeWith({ ...accessTransport(calls), access: undefined }), () => <Probe />);
  assert.equal(seen!.status, 'ready');
  assert.equal(seen!.mediaUrl('/a.mp4'), null);
  await assert.rejects(seen!.media(['/a.mp4']), /cannot be reached yet/);
  await act(async () => { old.unmount(); await flush(); });
  assert.equal(calls.length, 0);
  // The guard passes access for declared services only.
  const guarded = guardSpaceRuntime(runtimeWith(accessTransport(calls)))!.spaceCloudComputer!;
  await guarded.access!({ service: 'preview', frame: true });
  await assert.rejects(guarded.access!({ service: 'other', frame: true }), /does not declare that Cloud Computer service/);
  const reader = guardSpaceRuntime(runtimeWith(accessTransport(calls), { cloudComputer: 'read' }))!.spaceCloudComputer!;
  await assert.rejects(reader.access!({ service: 'preview', frame: true }), /cloudComputer: shell/);
  assert.equal(spaceCloudComputerAllows('shell', 'service.access'), true);
  assert.equal(spaceCloudComputerAllows('read', 'service.access'), false);
});

test('CloudComputerFrame signs its frame in with a one-time code posted only to the gate, in English and French', async (t) => {
  const calls: SpaceCloudComputerAccessInput[] = [];
  document.documentElement.setAttribute('lang', 'fr');
  t.after(() => document.documentElement.setAttribute('lang', 'en'));
  const root = await mount(t, runtimeWith(accessTransport(calls), {}, 'fr'),
    () => <CloudComputerFrame service="preview" path="/projects/launch" />);
  const frame = document.querySelector('iframe')!;
  assert.equal(frame.getAttribute('src'), 'https://gate.example/__notis_gate/frame');
  assert.equal(frame.getAttribute('title'), 'Service du Cloud Computer');
  assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
  assert.match(document.body.textContent || '', /Ouverture/);
  const posted: Array<{ message: unknown; origin: string }> = [];
  const child = frame.contentWindow!;
  Object.defineProperty(child, 'postMessage', { configurable: true,
    value: (message: unknown, origin: string) => posted.push({ message, origin }) });
  const say = (data: unknown, origin: string, source: unknown = child) => act(async () => {
    window.dispatchEvent(new window.MessageEvent('message', { data, origin, source: source as Window }));
    await flush();
  });
  // Another origin, or another window, is ignored.
  await say({ type: 'notis-gate-ready' }, 'https://evil.example');
  await say({ type: 'notis-gate-ready' }, 'https://gate.example', window);
  assert.equal(calls.length, 0);
  await say({ type: 'notis-gate-ready' }, 'https://gate.example');
  assert.deepEqual(calls, [{ service: 'preview', frame: true, path: '/projects/launch' }]);
  assert.deepEqual(posted, [{ message: { type: 'notis-gate-code', code: 'code-1' }, origin: 'https://gate.example' }]);
  // A refused code is asked again, then the frame says it failed and offers Try again.
  await say({ type: 'notis-gate-failed' }, 'https://gate.example');
  await say({ type: 'notis-gate-failed' }, 'https://gate.example');
  await say({ type: 'notis-gate-failed' }, 'https://gate.example');
  assert.equal(calls.length, 3);
  assert.match(document.body.textContent || '', /Ce service n’a pas pu s’ouvrir ici/);
  assert.ok([...document.querySelectorAll('button')].some((button) => button.textContent === 'Réessayer'));
  await act(async () => { root.unmount(); await flush(); });
});

test('CloudComputerFrame that loads without the gate saying ready shows it failed instead of opening forever', async (t) => {
  // A browser that refuses to frame the gate (its frame-ancestors) still fires load, on its own error page.
  const calls: SpaceCloudComputerAccessInput[] = [];
  const root = await mount(t, runtimeWith(accessTransport(calls)), () => <CloudComputerFrame service="preview" />);
  const frame = document.querySelector('iframe')!;
  await act(async () => { frame.dispatchEvent(new window.Event('load')); await flush(); });
  await tick(t, FRAME_GREETING_MS - 1);
  assert.match(document.body.textContent || '', /Opening it/);
  await tick(t, 1);
  assert.match(document.body.textContent || '', /This service could not open here/);
  assert.equal(calls.length, 0);
  // Try again opens a new frame, which the gate greets this time: it stays open past the bound.
  const again = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Try again')!;
  await act(async () => { again.click(); await flush(); });
  const next = document.querySelector('iframe')!;
  assert.notEqual(next, frame);
  await act(async () => { next.dispatchEvent(new window.Event('load')); await flush(); });
  await act(async () => {
    window.dispatchEvent(new window.MessageEvent('message', { data: { type: 'notis-gate-ready' }, origin: 'https://gate.example',
      source: next.contentWindow as Window }));
    await flush();
  });
  await tick(t, FRAME_GREETING_MS * 2);
  assert.doesNotMatch(document.body.textContent || '', /could not open/);
  assert.equal(calls.length, 1);
  await act(async () => { root.unmount(); await flush(); });
});

test('CloudComputerFrame shows the waking state until the service is ready', async (t) => {
  const transport = { ...accessTransport([]), lease: async () => leaseAnswer('starting', { retry_after_seconds: 3 }) };
  const root = await mount(t, runtimeWith(transport), () => <CloudComputerFrame service="preview" />);
  assert.equal(document.querySelector('iframe'), null);
  assert.match(document.body.textContent || '', /Starting your Cloud Computer/);
  await act(async () => { root.unmount(); await flush(); });
});
