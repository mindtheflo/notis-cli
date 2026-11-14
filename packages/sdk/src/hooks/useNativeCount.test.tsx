import '../ui/testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { NotisProvider } from '../provider';
import { createQueryClient } from '../queryCache';
import type { NotisRuntime } from '../runtime';
import type { SpaceActionOptions } from '../space';
import type { NativeFilter } from '../nativeData';
import { useNativeCount, useNativeDocuments } from './useNativeDocuments';

interface Call { action: string; inputs: Record<string, unknown> | undefined; options: SpaceActionOptions | undefined }

function setup(answer: (request: Record<string, unknown>) => unknown) {
  const calls: Call[] = [];
  const runtime = {
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: 'test',
      actions: { 'deals.query': { readOnly: true } },
      bindings: { deals: { kind: 'database', operations: { query: 'deals.query' } } } },
    context: { params: {}, locale: 'en' },
    queryClient: createQueryClient(),
    callAction: async (action: string, inputs?: Record<string, unknown>, options?: SpaceActionOptions) => {
      calls.push({ action, inputs, options });
      return answer(inputs?.request as Record<string, unknown>);
    },
  } as unknown as NotisRuntime;
  return { runtime, calls };
}

async function mount(runtime: NotisRuntime, Probe: () => null) {
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  await act(async () => { root.render(<NotisProvider runtime={runtime}><Probe /></NotisProvider>); });
  for (let turn = 0; turn < 5; turn += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return root;
}

const STAGES: NativeFilter = { field: { property: 'Stage' }, op: 'in', value: ['Lead', 'Won'] };

test('useNativeCount asks the query action for a count of its filter and loads no row', async () => {
  const { runtime, calls } = setup(() => ({ count: 42, schema_revision: 3 }));
  let seen: ReturnType<typeof useNativeCount> | null = null;
  function Probe() { seen = useNativeCount('deals', { query: { filter: STAGES } }); return null; }
  const root = await mount(runtime, Probe);
  assert.deepEqual(calls.map(({ action, inputs, options }) => ({ action, inputs, options })), [
    { action: 'deals.query', inputs: { request: { filter: STAGES, mode: 'count' } }, options: { readOnly: true, dedupe: true } }]);
  assert.equal(seen!.count, 42);
  assert.equal(seen!.schemaRevision, 3);
  assert.equal(seen!.loading, false);
  assert.equal(seen!.error, null);
  assert.equal(seen!.live, false);
  await act(async () => root.unmount());
});

test('useNativeCount waits while disabled and refuses an answer without a whole count', async () => {
  const { runtime, calls } = setup(() => ({ rows: [], schema_revision: 3 }));
  let seen: ReturnType<typeof useNativeCount> | null = null;
  let enabled = false;
  function Probe() { seen = useNativeCount('deals', { enabled }); return null; }
  const root = await mount(runtime, Probe);
  assert.equal(calls.length, 0);
  assert.equal(seen!.count, undefined);
  assert.equal(seen!.loading, false);
  enabled = true;
  await act(async () => { root.render(<NotisProvider runtime={runtime}><Probe /></NotisProvider>); });
  for (let turn = 0; turn < 5; turn += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(calls[0]!.inputs, { request: { mode: 'count' } });
  assert.equal(seen!.count, undefined);
  assert.equal(seen!.error?.message, 'This database could not be loaded. Refresh the page and try again.');
  await act(async () => root.unmount());
});

test('useNativeCount keeps the last count while a changed filter loads', async () => {
  let release: (() => void) | null = null;
  const { runtime, calls } = setup((request) => {
    if (!request.filter) return { count: 7, schema_revision: 1 };
    return new Promise((resolve) => { release = () => resolve({ count: 2, schema_revision: 1 }); });
  });
  let seen: ReturnType<typeof useNativeCount> | null = null;
  let filter: NativeFilter | undefined;
  function Probe() { seen = useNativeCount('deals', { query: filter ? { filter } : {} }); return null; }
  const root = await mount(runtime, Probe);
  assert.equal(seen!.count, 7);
  filter = STAGES;
  await act(async () => { root.render(<NotisProvider runtime={runtime}><Probe /></NotisProvider>); });
  for (let turn = 0; turn < 5; turn += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(calls.length, 2);
  assert.equal(seen!.count, 7);
  assert.equal(seen!.isPreviousData, true);
  assert.equal(seen!.loading, false);
  await act(async () => { release!(); });
  for (let turn = 0; turn < 5; turn += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(seen!.count, 2);
  assert.equal(seen!.isPreviousData, false);
  await act(async () => root.unmount());
});

test('useNativeCount never shows another binding\'s count while a new binding loads', async () => {
  let release: (() => void) | null = null;
  const { runtime } = setup(() => ({ count: 7, schema_revision: 1 }));
  const space = (runtime as unknown as { space: { actions: Record<string, unknown>; bindings: Record<string, unknown> } }).space;
  space.actions['tasks.query'] = { readOnly: true };
  space.bindings.tasks = { kind: 'database', operations: { query: 'tasks.query' } };
  const call = runtime.callAction!;
  (runtime as { callAction: unknown }).callAction = async (action: string, inputs?: Record<string, unknown>, options?: SpaceActionOptions) => {
    if (action === 'tasks.query') return new Promise((resolve) => { release = () => resolve({ count: 3, schema_revision: 1 }); });
    return call(action, inputs, options);
  };
  let seen: ReturnType<typeof useNativeCount> | null = null;
  let binding = 'deals';
  function Probe() { seen = useNativeCount(binding); return null; }
  const root = await mount(runtime, Probe);
  assert.equal(seen!.count, 7);
  binding = 'tasks';
  await act(async () => { root.render(<NotisProvider runtime={runtime}><Probe /></NotisProvider>); });
  for (let turn = 0; turn < 5; turn += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(seen!.count, undefined);
  assert.equal(seen!.loading, true);
  await act(async () => { release!(); });
  for (let turn = 0; turn < 5; turn += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(seen!.count, 3);
  await act(async () => root.unmount());
});

test('useNativeDocuments sends a count to useNativeCount instead of reading rows', async () => {
  const { runtime, calls } = setup(() => ({ count: 1, schema_revision: 1 }));
  let seen: ReturnType<typeof useNativeDocuments> | null = null;
  function Probe() { seen = useNativeDocuments('deals', { query: { mode: 'count' } }); return null; }
  const root = await mount(runtime, Probe);
  assert.equal(calls.length, 0);
  assert.match(seen!.error?.message ?? '', /useNativeCount/);
  await act(async () => root.unmount());
});
