import assert from 'node:assert/strict';
import test from 'node:test';

import { createQueryClient, NATIVE_ROWS, optimisticRowState, type NotisQueryClient, type RowsDescriptor } from './queryCache';
import { insertChange, isTempRecordKey, tempRecordKey, updateChange } from './optimisticRows';
import { normalizeDocumentRecord } from './documents';

const T = (content: string) => [{ type: 'text', text: { content } }];
const TODO = { id: 'opt_todo', name: 'Todo', color: 'gray' };
const DONE = { id: 'opt_done', name: 'Done', color: 'green' };

function nativeRow(key: string, title: string, status: typeof TODO | null, points: number | null) {
  return {
    record_key: key, id: `id-${key}`, title, revision: 1,
    properties: {
      Name: { type: 'title', title: T(title), rich_text: T(title) },
      Status: { type: 'status', status: status },
      Points: { type: 'number', number: points },
    },
  };
}

const SERVER = () => [nativeRow('a', 'Alpha', TODO, 3), nativeRow('b', 'Beta', DONE, 1), nativeRow('c', 'Gamma', TODO, 2)];

type Answer = { rows: Array<Record<string, unknown>> };
async function read(client: NotisQueryClient, key: string, rows: RowsDescriptor, data: () => unknown) {
  await client.fetch(key, async () => data(), { rows, force: true });
}
const keys = (client: NotisQueryClient, key: string, at = 'rows') =>
  ((client.getSnapshot<Record<string, Array<{ record_key?: string; recordKey?: string }>>>(key).data?.[at]) ?? [])
    .map((row) => row.record_key ?? row.recordKey);
const rowOf = (client: NotisQueryClient, key: string, record: string, at = 'rows') =>
  (client.getSnapshot<Record<string, Array<Record<string, unknown>>>>(key).data?.[at] ?? [])
    .find((row) => (row.record_key ?? row.recordKey) === record);

test('an edit shows at once in native and document reads, in the shape of each, with options learned from the rows', async () => {
  const client = createQueryClient();
  await read(client, 'list', { binding: 'tasks', at: 'rows', shape: 'native', list: 'open', query: {} }, () => ({ rows: SERVER() }));
  await read(client, 'docs', { binding: 'tasks', at: 'documents', shape: 'document', query: {} },
    () => ({ documents: SERVER().map((row) => normalizeDocumentRecord(row)) }));
  const write = client.optimistic!([updateChange('tasks', { record_key: 'a', expected_revision: 1,
    properties: { status: 'opt_done', Points: 8, Name: 'Alpha 2' } })]);
  const native = rowOf(client, 'list', 'a')!;
  assert.deepEqual((native.properties as Record<string, unknown>).Status, { type: 'status', status: DONE });
  assert.deepEqual((native.properties as Record<string, unknown>).Points, { type: 'number', number: 8 });
  assert.equal(native.title, 'Alpha 2');
  const document = rowOf(client, 'docs', 'a', 'documents')!;
  assert.deepEqual(document.properties, { Name: 'Alpha 2', Status: 'Done', Points: 8 });
  assert.equal(optimisticRowState(native)?.creating, false, 'the row is marked as saving');
  write.commit({ revision: 2 });
  assert.equal(optimisticRowState(rowOf(client, 'list', 'a')), null, 'a confirmed row is no longer saving');
  assert.equal(rowOf(client, 'list', 'a')!.revision, 2, 'the next edit names the revision this write made');
});

test('a value that cannot be shown for certain keeps its old value', async () => {
  const client = createQueryClient();
  await read(client, 'list', { binding: 'tasks', at: 'rows', shape: 'native', query: {} }, () => ({ rows: SERVER() }));
  client.optimistic!([updateChange('tasks', { record_key: 'a', expected_revision: 1,
    properties: { Status: 'Blocked', prop_123: 'x', Points: 'many' } })]);
  const row = rowOf(client, 'list', 'a')!;
  assert.deepEqual((row.properties as Record<string, unknown>).Status, { type: 'status', status: TODO });
  assert.deepEqual((row.properties as Record<string, unknown>).Points, { type: 'number', number: 3 });
  assert.equal('prop_123' in (row.properties as object), false);
});

test('a committed edit stays shown until the read reads again; the newer rows then win and the write goes', async () => {
  const client = createQueryClient();
  let server = SERVER();
  const rows: RowsDescriptor = { binding: 'tasks', at: 'rows', shape: 'native', query: {} };
  await read(client, 'list', rows, () => ({ rows: server }));
  const write = client.optimistic!([updateChange('tasks', { record_key: 'b', expected_revision: 1, properties: { Points: 5 } })]);
  write.commit({ revision: 2 });
  const points = () => ((rowOf(client, 'list', 'b')!.properties as Record<string, { number: number }>).Points.number);
  assert.equal(points(), 5, 'the old rows still show the write');
  server = server.map((row) => (row.record_key === 'b' ? { ...nativeRow('b', 'Beta', DONE, 7), revision: 3 } : row));
  await read(client, 'list', rows, () => ({ rows: server }));
  assert.equal(points(), 7, 'the newer server rows win');
  server = SERVER();
  await read(client, 'list', rows, () => ({ rows: server }));
  assert.equal(points(), 1, 'the write is gone once every read holds newer rows');
});

test('a read that started before the write was confirmed but holds it already drops the layered change', async () => {
  const client = createQueryClient();
  const rows: RowsDescriptor = { binding: 'tasks', at: 'rows', shape: 'native', query: {} };
  await read(client, 'list', rows, () => ({ rows: SERVER() }));
  const write = client.optimistic!([updateChange('tasks', { record_key: 'b', expected_revision: 1, properties: { Points: 5 } })]);
  // The host reads again as soon as the server answers, before the page hears back.
  let answer!: (value: unknown) => void;
  const reading = client.fetch('list', () => new Promise((resolve) => { answer = resolve; }), { rows, force: true });
  write.commit({ revision: 2 });
  await Promise.resolve();
  answer({ rows: SERVER().map((row) => (row.record_key === 'b' ? { ...nativeRow('b', 'Beta', DONE, 6), revision: 3 } : row)) });
  await reading;
  const points = (rowOf(client, 'list', 'b')!.properties as Record<string, { number: number }>).Points.number;
  assert.equal(points, 6, 'a later revision from the server wins over the confirmed write');
});

test('a failed edit takes only its own change back', async () => {
  const client = createQueryClient();
  await read(client, 'list', { binding: 'tasks', at: 'rows', shape: 'native', query: {} }, () => ({ rows: SERVER() }));
  const first = client.optimistic!([updateChange('tasks', { record_key: 'a', expected_revision: 1, properties: { Points: 9 } })]);
  client.optimistic!([updateChange('tasks', { record_key: 'a', expected_revision: 1, properties: { Name: 'Renamed' } })]);
  first.rollback();
  const row = rowOf(client, 'list', 'a')!;
  assert.equal(row.title, 'Renamed');
  assert.deepEqual((row.properties as Record<string, unknown>).Points, { type: 'number', number: 3 });
});

test('a row leaves a read whose filter the page sent and it no longer passes, and moves to its sorted place', async () => {
  const client = createQueryClient();
  const open = { filter: { field: { property: 'Status' }, op: 'equals', value: 'Todo' },
    sorts: [{ field: { property: 'Points' }, direction: 'desc' }] };
  await read(client, 'open', { binding: 'tasks', at: 'rows', shape: 'native', query: open },
    () => ({ rows: [nativeRow('a', 'Alpha', TODO, 3), nativeRow('c', 'Gamma', TODO, 2)] }));
  await read(client, 'shown', { binding: 'tasks', at: 'rows', shape: 'native', list: 'all', query: {} }, () => ({ rows: SERVER() }));
  await read(client, 'search', { binding: 'tasks', at: 'rows', shape: 'native',
    query: { filter: { field: { property: 'Owner' }, op: 'equals', value: 'me' } } }, () => ({ rows: SERVER() }));
  client.optimistic!([updateChange('tasks', { record_key: 'c', expected_revision: 1, properties: { Points: 10 } })]);
  assert.deepEqual(keys(client, 'open'), ['c', 'a'], 'moved to its place by the sort');
  client.optimistic!([updateChange('tasks', { record_key: 'a', expected_revision: 1, properties: { Status: 'Done' } })]);
  assert.deepEqual(keys(client, 'open'), ['c'], 'a done task leaves the open list');
  assert.deepEqual(keys(client, 'shown'), ['a', 'b', 'c'], 'a Space list (filter on the server) changes in place');
  assert.deepEqual(keys(client, 'search'), ['a', 'b', 'c'], 'a filter on an unknown field keeps the row');
});

test('a new row joins the reads whose filter it passes and the lists it was created from, then takes its real key', async () => {
  const client = createQueryClient();
  const sorted = { sorts: [{ field: { property: 'Points' }, direction: 'asc' }] };
  const [a, b, c] = SERVER();
  await read(client, 'all', { binding: 'tasks', at: 'rows', shape: 'native', query: sorted }, () => ({ rows: [b, c, a] }));
  await read(client, 'done', { binding: 'tasks', at: 'rows', shape: 'native',
    query: { filter: { field: { property: 'Status' }, op: 'equals', value: 'opt_done' } } }, () => ({ rows: [SERVER()[1]] }));
  await read(client, 'mine', { binding: 'tasks', at: 'rows', shape: 'native', list: 'mine', query: {} }, () => ({ rows: SERVER() }));
  await read(client, 'theirs', { binding: 'tasks', at: 'rows', shape: 'native', list: 'theirs', query: {} }, () => ({ rows: SERVER() }));
  await read(client, 'other', { binding: 'notes', at: 'rows', shape: 'native', query: {} }, () => ({ rows: [] }));
  const temp = tempRecordKey();
  assert.ok(isTempRecordKey(temp));
  const write = client.optimistic!([insertChange('tasks', { columns: { title: 'New' }, properties: { Status: 'Todo', Points: 2 } },
    temp, ['mine'])]);
  assert.deepEqual(keys(client, 'all'), ['b', 'c', temp, 'a'], 'at its sorted place, after the rows it ties with');
  assert.deepEqual(keys(client, 'done'), ['b'], 'a Todo row is not in the done read');
  assert.equal(keys(client, 'mine')[0], temp, 'the list it was created from shows it at the top');
  assert.deepEqual(keys(client, 'theirs'), ['a', 'b', 'c'], 'another Space list does not');
  assert.deepEqual(keys(client, 'other'), [], 'another database does not');
  const created = rowOf(client, 'mine', temp)!;
  assert.equal(optimisticRowState(created)?.creating, true);
  assert.equal(created.title, 'New');
  assert.deepEqual((created.properties as Record<string, unknown>).Name, { type: 'title', title: T('New'), rich_text: T('New') });
  write.commit({ recordKey: 'n', id: 'id-n', revision: 1 });
  const confirmed = rowOf(client, 'mine', 'n')!;
  assert.equal(confirmed.id, 'id-n');
  assert.equal(optimisticRowState(confirmed), null);
  assert.equal(keys(client, 'mine').includes(temp), false);
  // Once a newer read holds the row, it is the server's row, never twice.
  await read(client, 'mine', { binding: 'tasks', at: 'rows', shape: 'native', list: 'mine', query: {} },
    () => ({ rows: [nativeRow('n', 'New', TODO, 2), ...SERVER()] }));
  assert.deepEqual(keys(client, 'mine'), ['n', 'a', 'b', 'c']);
});

test('a failed insert leaves no row behind; clearing the scope drops every write', async () => {
  const client = createQueryClient();
  await read(client, 'all', { binding: 'tasks', at: 'rows', shape: 'native', query: {} }, () => ({ rows: SERVER() }));
  const temp = tempRecordKey();
  const write = client.optimistic!([insertChange('tasks', { columns: { title: 'New' } }, temp)]);
  assert.equal(keys(client, 'all')[0], temp);
  write.rollback();
  assert.deepEqual(keys(client, 'all'), ['a', 'b', 'c']);
  client.optimistic!([updateChange('tasks', { record_key: 'a', expected_revision: 1, columns: { title: 'X' } })]);
  client.clear();
  await read(client, 'all', { binding: 'tasks', at: 'rows', shape: 'native', query: {} }, () => ({ rows: SERVER() }));
  assert.equal(rowOf(client, 'all', 'a')!.title, 'Alpha');
});

test('reads that never said what rows they hold are left alone', async () => {
  const client = createQueryClient();
  const answer: Answer = { rows: SERVER() };
  await client.fetch('opaque', async () => answer);
  client.optimistic!([updateChange('tasks', { record_key: 'a', expected_revision: 1, columns: { title: 'X' } })]);
  assert.equal(client.getSnapshot('opaque').data, answer);
});

test('a row an earlier write took out of a read comes back when a later write brings it back', async () => {
  const client = createQueryClient();
  const open = { filter: { field: { property: 'Status' }, op: 'equals', value: 'Todo' } };
  await read(client, 'open', { binding: 'tasks', at: 'rows', shape: 'native', query: open },
    () => ({ rows: [nativeRow('a', 'Alpha', TODO, 3), nativeRow('c', 'Gamma', TODO, 2)] }));
  await read(client, 'all', { binding: 'tasks', at: 'rows', shape: 'native', query: {} }, () => ({ rows: SERVER() }));
  client.optimistic!([updateChange('tasks', { record_key: 'a', expected_revision: 1, properties: { Status: 'Done' } })]);
  assert.deepEqual(keys(client, 'open'), ['c']);
  client.optimistic!([updateChange('tasks', { record_key: 'a', expected_revision: 2, properties: { Status: 'Todo' } })]);
  assert.deepEqual(keys(client, 'open').sort(), ['a', 'c']);
});

test('a row that could not show every written value keeps its revision until the server rows arrive', async () => {
  const client = createQueryClient();
  await read(client, 'list', { binding: 'tasks', at: 'rows', shape: 'native', query: {} }, () => ({ rows: SERVER() }));
  const write = client.optimistic!([updateChange('tasks', { record_key: 'a', expected_revision: 1,
    properties: { Status: 'Blocked', Points: 4 } })]);
  write.commit({ revision: 2 });
  assert.equal(rowOf(client, 'list', 'a')!.revision, 1);
});

test('a new row deleted before the reads hold it leaves every read and stays gone', async () => {
  const client = createQueryClient();
  await read(client, 'all', { binding: 'tasks', at: 'rows', shape: 'native', query: {} }, () => ({ rows: SERVER() }));
  const write = client.optimistic!([insertChange('tasks', { columns: { title: 'New' } }, tempRecordKey())]);
  write.commit({ recordKey: 'n', id: 'id-n', revision: 1 });
  assert.equal(keys(client, 'all')[0], 'n');
  const hidden = client.hideRecords!(['n']);
  assert.deepEqual(keys(client, 'all'), ['a', 'b', 'c']);
  hidden.commit();
  assert.deepEqual(keys(client, 'all'), ['a', 'b', 'c'], 'the delete outlives the new row layered over older reads');
});

test('document reads: option ids become labels through the native rows, and a filter on the title is left alone', async () => {
  const client = createQueryClient();
  const untitled = { ...nativeRow('u', '', TODO, 1), title: '' };
  const raw = [...SERVER(), untitled];
  const titled = { filter: { field: { column: 'title' }, op: 'is_empty' } };
  await read(client, 'docs', { binding: 'tasks', at: 'documents', shape: 'document', query: titled }, () => {
    const answer = { documents: raw.map((row) => normalizeDocumentRecord(row)) };
    Object.defineProperty(answer, NATIVE_ROWS, { value: raw, enumerable: false });
    return answer;
  });
  client.optimistic!([updateChange('tasks', { record_key: 'u', expected_revision: 1, properties: { Status: 'opt_done' } })]);
  const row = rowOf(client, 'docs', 'u', 'documents')!;
  assert.equal((row.properties as Record<string, unknown>).Status, 'Done');
  assert.ok(row, 'an "Untitled" document still passes an empty-title filter');
});

test('document reads without native rows leave values whose meaning is unknown unchanged', async () => {
  const client = createQueryClient();
  await read(client, 'docs', { binding: 'tasks', at: 'documents', shape: 'document', query: {} },
    () => ({ documents: SERVER().map((row) => normalizeDocumentRecord(row)) }));
  client.optimistic!([updateChange('tasks', { record_key: 'a', expected_revision: 1, properties: { Status: 'opt_done' } })]);
  assert.equal((rowOf(client, 'docs', 'a', 'documents')!.properties as Record<string, unknown>).Status, 'Todo');
});
