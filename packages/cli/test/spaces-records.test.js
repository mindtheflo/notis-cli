import assert from 'node:assert/strict';
import test from 'node:test';
import { spacesCommandSpecs } from '../src/command-specs/spaces.js';

const SORTS = [{ field: { column: 'created_at' }, direction: 'asc' }, { field: { column: 'record_key' }, direction: 'asc' }];

function context(options = {}, args = { spaceId: 'space-1', binding: 'tasks' }) {
  const spec = spacesCommandSpecs.find(value => value.command_path.join(' ') === 'spaces records');
  assert.ok(spec, 'spaces records');
  return { spec, options, args, globalOptions: {}, runtime: { credentialKind: 'env', profileName: 'spaces-unit-only',
    jwt: 'fixture-not-a-real-credential', apiBase: 'https://fixture.invalid', timeoutMs: 1000, cliVersion: 'fixture' },
    output: { emitSuccess: value => value } };
}

const LINKS = [
  { binding_id: 'skill-binding', alias: 'tasks', kind: 'skill', resource_id: 'skill-1' },
  { binding_id: 'tasks-binding', alias: 'tasks', kind: 'database', resource_id: 'db-1' },
];

function recordFetch(t, { links = LINKS, rows, hasMore = false, nextOffset = null, refusal = null } = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls.push({ url, method: request.method, body: request.body ? JSON.parse(request.body) : undefined });
    if (url.includes('/portal_spaces/space-links')) return new Response(JSON.stringify({ links }));
    if (refusal) return new Response(JSON.stringify(refusal), { status: 403 });
    return new Response(JSON.stringify({ rows, has_more: hasMore, next_offset: nextOffset, schema_revision: 4 }));
  });
  return calls;
}

test('spaces records lists the record keys and titles of a linked database, one page at a time', async t => {
  const rows = [{ record_key: 'rec-1', id: 'row-1', title: 'Write\tthe\nbrief', properties: { status: 'Done' } },
    { record_key: 'rec-2', id: 'row-2', title: null, properties: {} }];
  const calls = recordFetch(t, { rows, hasMore: true, nextOffset: 7 });
  const ctx = context({ limit: '2', offset: '5' });
  const result = await ctx.spec.handler(ctx);
  assert.deepEqual(calls, [
    { url: 'https://fixture.invalid/portal_spaces/space-links?space_id=space-1', method: 'GET', body: undefined },
    { url: 'https://fixture.invalid/portal_spaces/data', method: 'POST', body: { operation: 'query',
      target: { space_id: 'space-1', binding: 'tasks-binding' },
      input: { mode: 'rows', sorts: SORTS, page_size: 2, offset: 5, include_content: false } } },
  ]);
  assert.deepEqual(result.data, { space_id: 'space-1', alias: 'tasks', target: { space_id: 'space-1', binding: 'tasks-binding' },
    records: [{ record_key: 'rec-1', title: 'Write\tthe\nbrief' }, { record_key: 'rec-2', title: '' }],
    has_more: true, next_offset: 7, schema_revision: 4 });
  assert.equal(result.humanSummary, 'rec-1\tWrite the brief\nrec-2\t\nMore records: --offset 7');
  assert.equal(result.meta.mutating, false);
});

test('spaces records takes a binding ID too and reads a first page of 20 by default', async t => {
  const calls = recordFetch(t, { rows: [] });
  const ctx = context({}, { spaceId: 'space-1', binding: 'tasks-binding' });
  const result = await ctx.spec.handler(ctx);
  assert.deepEqual(calls[1].body.input, { mode: 'rows', sorts: SORTS, page_size: 20, offset: 0, include_content: false });
  assert.equal(result.humanSummary, 'No records.');
});

test('spaces records reads a record-scoped Space in its record, and tells a non-editor it is an editor read', async t => {
  const calls = recordFetch(t, { rows: [] });
  const scoped = context({ record: 'doc-1' });
  await scoped.spec.handler(scoped);
  assert.deepEqual(calls[1].body.target, { space_id: 'space-1', binding: 'tasks-binding', document_id: 'doc-1' });
  t.mock.restoreAll();
  recordFetch(t, { refusal: { error: 'action_required', message: "Use one of this Space's declared database actions." } });
  const viewer = context();
  await assert.rejects(() => viewer.spec.handler(viewer), /Only an editor of this Space can list a linked database's records/);
});

test('spaces records refuses a link that is not a database it can see, and bad paging, before reading rows', async t => {
  const calls = recordFetch(t, { rows: [] });
  const missing = context({}, { spaceId: 'space-1', binding: 'skill-binding' });
  await assert.rejects(() => missing.spec.handler(missing), /no database link "skill-binding".*spaces links list space-1/);
  assert.equal(calls.length, 1);
  for (const options of [{ limit: '0' }, { limit: '101' }, { limit: 'all' }, { offset: '-1' }]) {
    const refused = context(options);
    await assert.rejects(() => refused.spec.handler(refused), /--limit|--offset/);
  }
  assert.equal(calls.length, 1);
});
