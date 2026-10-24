import '../ui/testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { NotisProvider } from '../provider';
import { createQueryClient, type NotisQueryClient } from '../queryCache';
import type { NotisRuntime } from '../runtime';
import type { SpaceActionOptions } from '../space';
import { useActions, type ActionsController } from '../ui/actions/useActions';
import { useNativeDelete, useNativeDocuments, useNativeMutation, type NativeDeleteManyResult } from './useNativeDocuments';

interface Call { action: string; inputs: Record<string, unknown> | undefined; options: SpaceActionOptions | undefined }

function setup(write: (call: Call) => Promise<unknown>) {
  const calls: Call[] = [];
  let rows = ['a', 'b', 'c'];
  const client = createQueryClient();
  let invalidations = 0;
  const queryClient: NotisQueryClient = { ...client, invalidate: (key) => { invalidations += 1; client.invalidate(key); } };
  queryClient.hideRecords = client.hideRecords;
  const runtime = {
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: 'test',
      actions: { 'decks.query': { readOnly: true }, 'decks.delete': { readOnly: false } },
      bindings: { decks: { kind: 'database', operations: { query: 'decks.query', delete: 'decks.delete' } } } },
    context: { params: {}, locale: 'en' },
    queryClient,
    callAction: async (action: string, inputs?: Record<string, unknown>, options?: SpaceActionOptions) => {
      if (action === 'decks.query') {
        return { rows: rows.map((key) => ({ record_key: key, title: key })), schema_revision: 1, has_more: false };
      }
      const call = { action, inputs, options };
      calls.push(call);
      const result = await write(call);
      rows = rows.filter((key) => key !== (inputs?.request as { record_key: string }).record_key);
      return result;
    },
  } as unknown as NotisRuntime;
  return { runtime, calls, invalidations: () => invalidations };
}

function deferred() {
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

async function mount(runtime: NotisRuntime, Probe: () => null) {
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  await act(async () => { root.render(<NotisProvider runtime={runtime}><Probe /></NotisProvider>); });
  await settle();
  return root;
}

async function settle() {
  for (let turn = 0; turn < 5; turn += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

test('deleteMany hides every row at once, refreshes once and brings back the rows whose write failed', async () => {
  const pending = new Map<string, ReturnType<typeof deferred>>();
  const { runtime, calls, invalidations } = setup((call) => {
    const gate = deferred();
    pending.set((call.inputs?.request as { record_key: string }).record_key, gate);
    return gate.promise;
  });
  let shown: string[] = [];
  let remove: ReturnType<typeof useNativeDelete>['deleteMany'] | null = null;
  function Probe() {
    shown = useNativeDocuments('decks').documents.map((doc) => doc.recordKey!);
    remove = useNativeDelete('decks').deleteMany;
    return null;
  }
  const root = await mount(runtime, Probe);
  assert.deepEqual(shown, ['a', 'b', 'c']);
  let finished = null as Promise<NativeDeleteManyResult> | null;
  await act(async () => {
    finished = remove!([{ record_key: 'a', expected_revision: 1 }, { record_key: 'b', expected_revision: 1 }],
      { schemaRevision: 1, requestId: 'batch' });
  });
  assert.deepEqual(shown, ['c'], 'both rows leave the list before any write answers');
  assert.deepEqual(calls.map((call) => call.options), [
    { schemaRevision: 1, requestId: 'batch:a', deferRefresh: true },
    { schemaRevision: 1, requestId: 'batch:b', deferRefresh: true },
  ], 'each row has its own request ID and leaves the refresh to the batch');
  const before = invalidations();
  await act(async () => { pending.get('a')!.resolve({}); pending.get('b')!.reject(new Error('conflict')); await finished; });
  const result = await finished!;
  assert.deepEqual(result.done.map((input) => input.record_key), ['a']);
  assert.deepEqual(result.failed.map((item) => [item.input.record_key, item.error.message]), [['b', 'conflict']]);
  assert.equal(invalidations() - before, 1, 'the reads refresh once for the whole batch');
  assert.deepEqual(shown, ['b', 'c'], 'the failed row comes back and the trashed one stays gone');
  await act(async () => { root.unmount(); });
});

test('a single trash hides its row until the write answers and restores it when the write fails', async () => {
  const gate = deferred();
  const { runtime } = setup(() => gate.promise);
  let shown: string[] = [];
  let mutate: ReturnType<typeof useNativeMutation<'delete'>>['mutate'] | null = null;
  function Probe() {
    shown = useNativeDocuments('decks').documents.map((doc) => doc.recordKey!);
    mutate = useNativeMutation('decks', 'delete').mutate;
    return null;
  }
  const root = await mount(runtime, Probe);
  let done: Promise<unknown> | null = null;
  await act(async () => { done = mutate!({ record_key: 'b', expected_revision: 1 }, { schemaRevision: 1, requestId: 'one' }).catch((error) => error); });
  assert.deepEqual(shown, ['a', 'c']);
  await act(async () => { gate.reject(new Error('down')); await done; });
  assert.deepEqual(shown, ['a', 'b', 'c'], 'the row is back after the failed write');
  await act(async () => { root.unmount(); });
});

test('the standard delete action hides its records while it runs and keeps only the failed ones on screen', async () => {
  const { runtime } = setup(async () => ({}));
  let shown: string[] = [];
  let controller: ActionsController<{ recordKey?: string }> | null = null;
  const gate = deferred();
  function Probe() {
    const documents = useNativeDocuments('decks').documents;
    shown = documents.map((doc) => doc.recordKey!);
    controller = useActions<{ recordKey?: string }>(['delete'], {
      delete: async (items) => { await gate.promise; return { failed: items.filter((item) => item.recordKey === 'c') }; },
    });
    return null;
  }
  const root = await mount(runtime, Probe);
  let outcome: ReturnType<ActionsController<{ recordKey?: string }>['run']> | null = null;
  await act(async () => { outcome = controller!.run('delete', [{ recordKey: 'a' }, { recordKey: 'c' }]); });
  assert.deepEqual(shown, ['b'], 'both records leave the list while the delete runs');
  await act(async () => { gate.resolve(undefined); await outcome; });
  assert.deepEqual(shown, ['b', 'c'], 'the record the delete could not remove comes back');
  await act(async () => { root.unmount(); });
});

test('a delete action that throws brings every record back', async () => {
  const { runtime } = setup(async () => ({}));
  let shown: string[] = [];
  let controller: ActionsController<{ recordKey?: string }> | null = null;
  function Probe() {
    shown = useNativeDocuments('decks').documents.map((doc) => doc.recordKey!);
    controller = useActions<{ recordKey?: string }>(['delete'], { delete: async () => { throw new Error('down'); } });
    return null;
  }
  const root = await mount(runtime, Probe);
  await act(async () => { await controller!.run('delete', [{ recordKey: 'a' }]); });
  assert.deepEqual(shown, ['a', 'b', 'c']);
  await act(async () => { root.unmount(); });
});

test('a stalled delete restores its rows and busy state without resending, and its late result cannot settle a newer run', async (t) => {
  const { runtime } = setup(async () => ({}));
  const old = deferred(), newer = deferred();
  let calls = 0, settled = false;
  let shown: string[] = [];
  let controller: ActionsController<{ recordKey?: string }> | null = null;
  function Probe() {
    shown = useNativeDocuments('decks').documents.map((doc) => doc.recordKey!);
    controller = useActions<{ recordKey?: string }>(['delete'], {
      delete: async () => { calls += 1; await (calls === 1 ? old.promise : newer.promise); },
    });
    return null;
  }
  const root = await mount(runtime, Probe);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let first: ReturnType<ActionsController<{ recordKey?: string }>['run']> | null = null;
    await act(async () => {
      first = controller!.run('delete', [{ recordKey: 'a' }]);
      void first.then(() => { settled = true; });
    });
    assert.deepEqual(shown, ['b', 'c']);
    await act(async () => { t.mock.timers.tick(120_000); await Promise.resolve(); });
    assert.equal(settled, true, 'the handler deadline must release the UI even when the handler has not answered');
    assert.equal((await first!).status, 'failed');
    assert.equal(controller!.isBusy('delete'), false);
    assert.deepEqual(shown, ['a', 'b', 'c']);
    assert.equal(calls, 1, 'the uncertain write is never resent automatically');
    assert.match(controller!.toast!.words.en, /could not confirm/i);
    assert.match(controller!.toast!.words.fr, /confirmer/i);

    let second: ReturnType<ActionsController<{ recordKey?: string }>['run']> | null = null;
    await act(async () => { second = controller!.run('delete', [{ recordKey: 'b' }]); });
    assert.deepEqual(shown, ['a', 'c']);
    await act(async () => { old.resolve(undefined); await Promise.resolve(); });
    assert.equal(controller!.isBusy('delete'), true, 'the obsolete completion cannot clear the newer run');
    assert.deepEqual(shown, ['a', 'c'], 'the obsolete completion cannot re-hide its restored row');
    await act(async () => { newer.resolve(undefined); await second; });
    assert.equal(controller!.isBusy('delete'), false);
    assert.deepEqual(shown, ['a', 'c']);
    assert.equal(calls, 2, 'only the two explicit runs invoke the handler');
  } finally {
    t.mock.timers.reset();
    await act(async () => { root.unmount(); });
  }
});
