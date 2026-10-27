import '../ui/testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { NotisProvider } from '../provider';
import { createQueryClient, optimisticRowState, type NotisQueryClient } from '../queryCache';
import type { NotisRuntime } from '../runtime';
import type { NativeMutationReceipt } from '../nativeData';
import { useNativeDocuments, useNativeMutation } from './useNativeDocuments';
import { useShown } from './useViewParams';

const T = (content: string) => [{ type: 'text', text: { content } }];
const row = (key: string, title: string, status: string) => ({
  record_key: key, id: `id-${key}`, title, revision: 1,
  properties: { Name: { type: 'title', title: T(title), rich_text: T(title) },
    Status: { type: 'select', select: { id: `opt_${status.toLowerCase()}`, name: status, color: 'gray' } } },
});

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function setup() {
  let rows = [row('a', 'Alpha', 'Todo'), row('b', 'Beta', 'Done')];
  const writes: Array<ReturnType<typeof deferred<NativeMutationReceipt>> & { request: Record<string, unknown> }> = [];
  const client = createQueryClient();
  let invalidations = 0;
  const queryClient: NotisQueryClient = { ...client, invalidate: (key) => { invalidations += 1; client.invalidate(key); } };
  const runtime = {
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: 'test',
      shows: { open: { database: 'tasks' } },
      actions: { 'tasks.query': { readOnly: true }, 'tasks.insert': { readOnly: false }, 'tasks.update': { readOnly: false } },
      bindings: { tasks: { kind: 'database', operations: { query: 'tasks.query', insert: 'tasks.insert', update: 'tasks.update' } } } },
    context: { params: {}, locale: 'en' },
    queryClient,
    shown: async () => ({ rows, list: 'open', database: 'tasks', params: {} }),
    callAction: async (action: string, inputs?: Record<string, unknown>) => {
      if (action === 'tasks.query') return { rows, schema_revision: 1, has_more: false };
      const gate = Object.assign(deferred<NativeMutationReceipt>(), { request: inputs!.request as Record<string, unknown> });
      writes.push(gate);
      return gate.promise;
    },
  } as unknown as NotisRuntime;
  return { runtime, writes, setRows: (next: typeof rows) => { rows = next; }, invalidations: () => invalidations };
}

async function settle() {
  for (let turn = 0; turn < 5; turn += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

test('an edit shows at once in every read of its database; a failed one puts the server rows back', async () => {
  const { runtime, writes, invalidations } = setup();
  let documents: Array<{ recordKey?: string; properties: Record<string, unknown> }> = [];
  let listed: Array<Record<string, unknown>> = [];
  let update: ReturnType<typeof useNativeMutation<'update'>>['mutate'] | null = null;
  function Probe() {
    documents = useNativeDocuments('tasks').documents;
    listed = useShown('open').data?.rows ?? [];
    update = useNativeMutation('tasks', 'update').mutate;
    return null;
  }
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  await act(async () => { root.render(<NotisProvider runtime={runtime}><Probe /></NotisProvider>); });
  await settle();
  assert.equal(documents[0]!.properties.Status, 'Todo');
  let done = null as Promise<unknown> | null;
  await act(async () => {
    done = update!({ record_key: 'a', expected_revision: 1, properties: { Status: 'Done' } }, { schemaRevision: 1, requestId: 'r1' })
      .catch((error: Error) => error);
  });
  assert.equal(documents[0]!.properties.Status, 'Done', 'the document read shows the edit before the server answers');
  assert.deepEqual((listed[0]!.properties as Record<string, unknown>).Status,
    { type: 'select', select: { id: 'opt_done', name: 'Done', color: 'gray' } }, 'and so does the Space list');
  assert.ok(optimisticRowState(listed[0]), 'the row is marked as saving');
  const before = invalidations();
  await act(async () => { writes[0]!.reject(new Error('refused')); await done; });
  assert.equal(documents[0]!.properties.Status, 'Todo', 'a failed edit takes its change back');
  assert.ok(invalidations() > before, 'and reads the rows again, in case it landed');
  await act(async () => { root.unmount(); });
});

test('a new row shows in the only list of the view over its database at once, then becomes the server row', async () => {
  const { runtime, writes, setRows } = setup();
  let listed: Array<Record<string, unknown>> = [];
  let insert: ReturnType<typeof useNativeMutation<'insert'>>['mutate'] | null = null;
  function Probe() {
    listed = useShown('open').data?.rows ?? [];
    insert = useNativeMutation('tasks', 'insert').mutate;
    return null;
  }
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  await act(async () => { root.render(<NotisProvider runtime={runtime}><Probe /></NotisProvider>); });
  await settle();
  let done = null as Promise<unknown> | null;
  await act(async () => {
    done = insert!({ columns: { title: 'New' }, properties: { Status: 'Todo' } }, { schemaRevision: 1, requestId: 'r2' });
  });
  assert.equal(listed.length, 3);
  assert.equal(listed[0]!.title, 'New');
  assert.equal(optimisticRowState(listed[0])?.creating, true, 'a row being created is marked as such');
  setRows([row('n', 'New', 'Todo'), row('a', 'Alpha', 'Todo'), row('b', 'Beta', 'Done')]);
  await act(async () => {
    writes[0]!.resolve({ record_key: 'n', id: 'id-n', database_id: 'd', revision: 1, schema_revision: 1, receipt_id: 'x', operation: 'insert' });
    await done;
  });
  assert.equal(listed[0]!.record_key, 'n', 'the temporary key becomes the real one');
  await act(async () => { runtime.queryClient!.invalidate(); });
  await settle();
  assert.deepEqual(listed.map((item) => item.record_key), ['n', 'a', 'b'], 'never twice once the server holds it');
  await act(async () => { root.unmount(); });
});

test('a list read again while a new row is saved never shows it twice, under its temporary and its real key', async () => {
  const { runtime, writes, setRows } = setup();
  let listed: Array<Record<string, unknown>> = [];
  let documents: Array<{ recordKey?: string }> = [];
  let insert: ReturnType<typeof useNativeMutation<'insert'>>['mutate'] | null = null;
  const seen: string[] = [];
  function Probe() {
    listed = useShown('open').data?.rows ?? [];
    documents = useNativeDocuments('tasks').documents;
    insert = useNativeMutation('tasks', 'insert').mutate;
    seen.push(listed.map((item) => item.record_key).join(','));
    return null;
  }
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  await act(async () => { root.render(<NotisProvider runtime={runtime}><Probe /></NotisProvider>); });
  await settle();
  let done = null as Promise<unknown> | null;
  await act(async () => {
    done = insert!({ columns: { title: 'New' }, properties: { Status: 'Todo' } }, { schemaRevision: 1, requestId: 'r4' });
  });
  // The server saved it before answering, and the live feed reads the lists again meanwhile.
  setRows([row('n', 'New', 'Todo'), row('a', 'Alpha', 'Todo'), row('b', 'Beta', 'Done')]);
  await act(async () => { runtime.queryClient!.invalidate(); });
  await settle();
  assert.equal(listed.length, 3, 'still one new row while the write is unanswered');
  assert.equal(documents.length, 3);
  await act(async () => {
    writes[0]!.resolve({ record_key: 'n', id: 'id-n', database_id: 'd', revision: 1, schema_revision: 1, receipt_id: 'x', operation: 'insert' });
    await done;
  });
  await settle();
  assert.deepEqual(listed.map((item) => item.record_key), ['n', 'a', 'b']);
  assert.equal(documents.length, 3);
  assert.ok(seen.every((keys) => keys.split(',').filter(Boolean).length <= 3), `never four rows: ${seen.join(' | ')}`);
  await act(async () => { root.unmount(); });
});

test('a new row the list does not keep is gone once the write is confirmed and the list reads again', async () => {
  const { runtime, writes, setRows } = setup();
  let listed: Array<Record<string, unknown>> = [];
  let insert: ReturnType<typeof useNativeMutation<'insert'>>['mutate'] | null = null;
  function Probe() {
    listed = useShown('open').data?.rows ?? [];
    insert = useNativeMutation('tasks', 'insert').mutate;
    return null;
  }
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  await act(async () => { root.render(<NotisProvider runtime={runtime}><Probe /></NotisProvider>); });
  await settle();
  let done = null as Promise<unknown> | null;
  await act(async () => {
    done = insert!({ columns: { title: 'Closed' }, properties: { Status: 'Done' } }, { schemaRevision: 1, requestId: 'r3' });
  });
  assert.equal(listed.length, 3);
  // The server keeps it out of this list: its rows do not change.
  setRows([row('a', 'Alpha', 'Todo'), row('b', 'Beta', 'Done')]);
  await act(async () => {
    writes[0]!.resolve({ record_key: 'n', id: 'id-n', database_id: 'd', revision: 1, schema_revision: 1, receipt_id: 'x', operation: 'insert' });
    await done;
  });
  await settle();
  assert.deepEqual(listed.map((item) => item.record_key), ['a', 'b']);
  await act(async () => { root.unmount(); });
});
