import '../ui/testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

import { NotisProvider } from '../provider';
import type { NotisDocumentEditorProps, NotisDocumentPageProps, NotisRuntime } from '../runtime';
import { guardSpaceRuntime, publicSpaceDescriptor, spaceQueryKey, type SpaceRuntimeDescriptor } from '../space';
import { publicDocumentPageProperties, publicRecordUI } from '../spacePublicUI';
import { Editors, Public, useAudience, ViewAsPublic } from './Audience';

const editorSpace = (): SpaceRuntimeDescriptor => ({
  id: 's1', revision: 3, cacheScope: 'scope', audience: 'editor',
  editorsOnly: { shows: ['drafts'], actions: ['publish'], params: ['status'], columns: { tickets: ['Internal notes'] } },
  viewerReads: ['databases'], cloudComputer: 'read',
  params: { month: { type: 'text', description: 'Month' }, status: { type: 'text', description: 'Status' } },
  shows: { published: { database: 'tickets' }, drafts: { database: 'tickets' } },
  actions: {
    queryTickets: { id: 'queryTickets', inputSchema: {}, readOnly: true },
    updateTicket: { id: 'updateTicket', inputSchema: {}, readOnly: false },
    publish: { id: 'publish', inputSchema: {}, readOnly: false },
  },
  bindings: { tickets: { kind: 'database', operations: { query: 'queryTickets', update: 'updateTicket' } },
    months: { kind: 'database', operations: { insert: 'publish' } } },
});

const row = { record_key: 'r1', title: 'One', properties: { Title: 'One', 'Internal notes': 'secret', Status: 'Draft' } };

function runtimeFor(space: SpaceRuntimeDescriptor, extra: Partial<NotisRuntime> = {}) {
  const calls: Array<{ kind: string; name: string; params?: unknown }> = [];
  const runtime = {
    resource: { kind: 'space', id: 's1', revision: 3 },
    space,
    context: { params: {}, locale: 'en' },
    callAction: async (id: string, inputs: Record<string, unknown>) => { calls.push({ kind: 'action', name: id, params: inputs }); return { rows: [row] }; },
    shown: async (name: string, params: Record<string, unknown>) => { calls.push({ kind: 'shown', name, params }); return { rows: [row], list: name, database: 'tickets', params }; },
    viewerRead: async () => ({}),
    spaceCloudComputer: {} as NotisRuntime['spaceCloudComputer'],
    ...extra,
  } as unknown as NotisRuntime;
  return { runtime, calls };
}

test('the public descriptor drops editor-only lists, actions, params, their row operations and signed-in reads', () => {
  const floor = publicSpaceDescriptor(editorSpace());
  assert.equal(floor.audience, 'public');
  assert.equal(floor.editorsOnly, undefined);
  assert.equal(floor.viewerReads, undefined);
  assert.equal(floor.cloudComputer, undefined);
  assert.deepEqual(Object.keys(floor.shows!), ['published']);
  assert.deepEqual(Object.keys(floor.params!), ['month']);
  assert.deepEqual(Object.keys(floor.actions).sort(), ['queryTickets', 'updateTicket']);
  assert.deepEqual(floor.bindings.months.operations, {});
  assert.deepEqual(floor.bindings.tickets.operations, { query: 'queryTickets', update: 'updateTicket' });
});

test('an editor runtime is unchanged and keeps editor-only columns', async () => {
  const { runtime } = runtimeFor(editorSpace());
  const guarded = guardSpaceRuntime(runtime)!;
  assert.equal(guarded.space!.audience, 'editor');
  const result = await guarded.shown!<{ rows: typeof row[] }>('drafts');
  assert.equal(result.rows[0].properties['Internal notes'], 'secret');
  assert.ok(guarded.viewerRead);
});

test('viewing as the public applies the floors in the page', async () => {
  const { runtime, calls } = runtimeFor({ ...editorSpace(), viewAs: 'public' });
  const guarded = guardSpaceRuntime(runtime)!;
  assert.equal(guarded.space!.audience, 'public');
  assert.equal(guarded.space!.viewAs, 'public');
  assert.equal(guarded.viewerRead, undefined);
  assert.equal(guarded.spaceCloudComputer, undefined);
  await assert.rejects(guarded.shown!('drafts'));
  await assert.rejects(guarded.callAction!('publish'));
  const shown = await guarded.shown!<{ rows: typeof row[] }>('published', { month: '2026-11', status: 'Draft' });
  assert.deepEqual(shown.rows[0].properties, { Title: 'One', Status: 'Draft' });
  assert.deepEqual(calls.at(-1)!.params, { month: '2026-11' });
  const queried = await guarded.callAction!<{ rows: typeof row[] }>('queryTickets', { request: {} }, { readOnly: true });
  assert.equal('Internal notes' in queried.rows[0].properties, false);
  await assert.rejects(guarded.callAction!('queryTickets', { request: { filter: { field: { property: 'internal notes' }, op: 'is_not_empty' } } },
    { readOnly: true }));
  await assert.rejects(guarded.callAction!('updateTicket', { request: { record_key: 'r1', expected_revision: 1, properties: { 'Internal notes': 'x' } } }));
  await guarded.callAction!('updateTicket', { request: { record_key: 'r1', expected_revision: 1, properties: { Title: 'x' } } });
});

test('viewing as the public never shares cache entries with editing', () => {
  const editing = runtimeFor(editorSpace()).runtime;
  const asPublic = runtimeFor({ ...editorSpace(), viewAs: 'public' }).runtime;
  assert.notDeepEqual(spaceQueryKey(editing, ['rows']), spaceQueryKey(asPublic, ['rows']));
});

async function render(runtime: NotisRuntime) {
  const seen: Record<string, unknown> = {};
  function Probe() {
    const audience = useAudience();
    seen.audience = audience.audience; seen.viewing = audience.viewingAsPublic; seen.can = audience.canViewAsPublic;
    return null;
  }
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  await act(async () => {
    root.render(<NotisProvider runtime={runtime}><Probe /><Editors><span id="editors">E</span></Editors>
      <Public><span id="public">P</span></Public><ViewAsPublic /></NotisProvider>);
  });
  return { seen, root };
}

test('Editors, Public and ViewAsPublic follow the audience', async () => {
  const modes: Array<'public' | null> = [];
  const setSpaceViewAs = (mode: 'public' | null) => { modes.push(mode); };
  let { seen, root } = await render(runtimeFor(editorSpace(), { setSpaceViewAs }).runtime);
  assert.deepEqual(seen, { audience: 'editor', viewing: false, can: true });
  assert.ok(document.getElementById('editors'));
  assert.equal(document.getElementById('public'), null);
  const button = document.querySelector<HTMLButtonElement>('[data-notis-view-as-public]')!;
  assert.equal(button.textContent, 'View as the public');
  await act(async () => { button.click(); });
  assert.deepEqual(modes, ['public']);
  await act(async () => { root.unmount(); });

  ({ seen, root } = await render(runtimeFor({ ...editorSpace(), viewAs: 'public' }, { setSpaceViewAs }).runtime));
  assert.deepEqual(seen, { audience: 'public', viewing: true, can: true });
  assert.equal(document.getElementById('editors'), null);
  assert.ok(document.getElementById('public'));
  assert.equal(document.querySelector('[data-notis-view-as-public]')!.textContent, 'Back to editing');
  await act(async () => { root.unmount(); });

  const { audience: _a, editorsOnly: _e, ...publicSpace } = editorSpace();
  ({ seen, root } = await render(runtimeFor({ ...publicSpace, audience: 'public' }).runtime));
  assert.deepEqual(seen, { audience: 'public', viewing: false, can: false });
  assert.equal(document.querySelector('[data-notis-view-as-public]'), null);
  await act(async () => { root.unmount(); });

  // Older servers send no audience: the page is drawn for the public.
  ({ seen, root } = await render(runtimeFor(publicSpace as SpaceRuntimeDescriptor).runtime));
  assert.equal(seen.audience, 'public');
  await act(async () => { root.unmount(); });
});

// View as the public: every runtime entry point that reads or writes rows is held to the floor.
const floorSpace = (): SpaceRuntimeDescriptor => ({
  ...editorSpace(), viewAs: 'public',
  editorsOnly: { ...editorSpace().editorsOnly, columns: { tickets: ['Internal notes', 'Name'], months: ['Budget'] } },
  actions: {
    ...editorSpace().actions,
    openTickets: { id: 'openTickets', inputSchema: {}, readOnly: true },
    shared: { id: 'shared', inputSchema: {}, readOnly: true },
    readTicket: { id: 'readTicket', inputSchema: {}, readOnly: true },
  },
  bindings: { tickets: { kind: 'database', operations: { query: 'queryTickets', update: 'updateTicket' } },
    months: { kind: 'database', operations: { insert: 'publish', query: 'shared' } },
    other: { kind: 'database', operations: { query: 'shared' } } },
});
const titled = { record_key: 'r1', title: 'One', properties: { Name: 'One', 'INTERNAL NOTES': 'secret', Budget: 9, Status: 'Draft' } };

function floorRuntime(answer: unknown, extra: Partial<NotisRuntime> = {}) {
  return runtimeFor(floorSpace(), { callAction: (async () => answer) as NotisRuntime['callAction'], ...extra });
}

test('a named action, or one several bindings share, strips every editor-only column (case-insensitively)', async () => {
  for (const id of ['openTickets', 'shared']) {
    const guarded = guardSpaceRuntime(floorRuntime({ rows: [titled] }).runtime)!;
    const result = await guarded.callAction!<{ rows: Array<Record<string, unknown>> }>(id, {}, { readOnly: true });
    assert.deepEqual(result.rows[0].properties, { Status: 'Draft' });
  }
  // A binding's own row operation strips that binding's columns only.
  const guarded = guardSpaceRuntime(floorRuntime({ rows: [titled] }).runtime)!;
  const queried = await guarded.callAction!<{ rows: Array<Record<string, unknown>> }>('queryTickets', {}, { readOnly: true });
  assert.deepEqual(queried.rows[0].properties, { Budget: 9, Status: 'Draft' });
});

test('the title goes when its column is editor-only, in every row and single-record shape', async () => {
  const answers = [{ rows: [titled] }, { row: titled }, { record: titled }, { document: titled }, titled, [titled]];
  for (const answer of answers) {
    const guarded = guardSpaceRuntime(floorRuntime(answer).runtime)!;
    const result = await guarded.callAction!<unknown>('readTicket', {}, { readOnly: true });
    const read = Array.isArray(result) ? result[0] : (result as Record<string, unknown>).rows
      ? ((result as { rows: unknown[] }).rows[0]) : (['row', 'record', 'document'].map(key => (result as Record<string, unknown>)[key]).find(Boolean) ?? result);
    assert.equal('title' in (read as object), false, JSON.stringify(answer));
    assert.deepEqual((read as { properties: unknown }).properties, { Status: 'Draft' });
  }
  // A public title column keeps the title.
  const guarded = guardSpaceRuntime(floorRuntime({ row: { ...titled, properties: { Title: 'One', Name: 'x' } } }).runtime)!;
  const kept = await guarded.callAction!<{ row: Record<string, unknown> }>('queryTickets', {}, { readOnly: true });
  assert.equal(kept.row.title, 'One');
  // A row without properties carries its columns itself.
  const flat = guardSpaceRuntime(floorRuntime({ rows: [{ record_key: 'r1', 'internal notes': 'secret', Status: 'Draft' }] }).runtime)!;
  assert.deepEqual((await flat.callAction!<{ rows: unknown[] }>('queryTickets', {}, { readOnly: true })).rows[0], { record_key: 'r1', Status: 'Draft' });
});

test('property_id references and title writes are refused once known, and schemas are floored', async () => {
  const schema = { properties: { p1: { name: 'Internal notes', type: 'rich_text' }, p2: { name: 'Name', type: 'title' }, p3: { name: 'Status', type: 'status' } },
    property_order: ['p2', 'p1', 'p3'], title_property_id: 'p2' };
  const guarded = guardSpaceRuntime(floorRuntime({ schema, rows: [] }).runtime)!;
  // Before a schema is known, an id equal to an editor-only name is refused.
  await assert.rejects(guarded.callAction!('queryTickets', { request: { sorts: [{ field: { property_id: 'internal notes' }, direction: 'asc' }] } }, { readOnly: true }));
  await guarded.callAction!('queryTickets', { request: { filter: { field: { property_id: 'p1' }, op: 'is_empty' } } }, { readOnly: true });
  const described = await guarded.callAction!<{ schema: typeof schema }>('queryTickets', {}, { readOnly: true });
  assert.deepEqual(Object.keys(described.schema.properties), ['p3']);
  assert.deepEqual(described.schema.property_order, ['p3']);
  // Learned from the schema: the ids and the title column.
  await assert.rejects(guarded.callAction!('queryTickets', { request: { filter: { field: { property_id: 'p1' }, op: 'is_empty' } } }, { readOnly: true }));
  await assert.rejects(guarded.callAction!('queryTickets', { request: { sorts: [{ field: { column: 'title' }, direction: 'asc' }] } }, { readOnly: true }));
  await assert.rejects(guarded.callAction!('updateTicket', { request: { record_key: 'r1', expected_revision: 1, columns: { title: 'x' } } }));
  await assert.rejects(guarded.callAction!('updateTicket', { request: { record_key: 'r1', expected_revision: 1, properties: { p1: 'x' } } }));
  await guarded.callAction!('updateTicket', { request: { record_key: 'r1', expected_revision: 1, properties: { Status: 'Done' } } });
});

test('writes and reads through a named action that name an editor-only column are refused', async () => {
  const guarded = guardSpaceRuntime(floorRuntime({ rows: [] }).runtime)!;
  await assert.rejects(guarded.callAction!('openTickets', { filter: { field: { property: 'BUDGET' }, op: 'is_empty' } }, { readOnly: true }));
  await assert.rejects(guarded.callAction!('openTickets', { properties: { 'internal notes': 'x' } }, { readOnly: true }));
  await guarded.callAction!('openTickets', { filter: { field: { property: 'Status' }, op: 'is_empty' } }, { readOnly: true });
});

test('a declared list refuses caller sorts on an editor-only column and floors single rows', async () => {
  const { runtime } = runtimeFor(floorSpace(), { shown: (async () => ({ rows: [titled], record: titled, list: 'published', database: 'tickets', params: {} })) as NotisRuntime['shown'] });
  const guarded = guardSpaceRuntime(runtime)!;
  await assert.rejects(guarded.shown!('published', {}, { sorts: [{ field: { property: 'name' }, direction: 'asc' }] }));
  const shown = await guarded.shown!<{ rows: Array<Record<string, unknown>>; record: Record<string, unknown> }>('published');
  assert.equal('title' in shown.rows[0], false);
  assert.deepEqual(shown.record.properties, { Budget: 9, Status: 'Draft' });
});

test('document bodies, change signals and Manager drafts take the public descriptor', async () => {
  const bodies: unknown[] = [];
  const subscribed: string[] = [];
  const drafts: unknown[] = [];
  const { runtime } = runtimeFor(floorSpace(), {
    databases: [{ slug: 'tickets', title: 'Tickets', properties: [{ id: 'p2', name: 'Name', type: 'title' }] }],
    documentBody: (async (request: unknown) => { bodies.push(request); return { record_key: 'r1', title: 'One', revision: 1, schema_revision: 1, content_markdown: 'body' }; }) as NotisRuntime['documentBody'],
    subscribeDatabase: (slug: string) => { subscribed.push(slug); return () => {}; },
    draftHandover: (async (payload: unknown) => { drafts.push(payload); return { status: 'drafted' }; }) as NotisRuntime['draftHandover'],
  });
  const guarded = guardSpaceRuntime(runtime)!;
  const recordKey = '00000000-0000-0000-0000-000000000001';
  await assert.rejects(guarded.documentBody!({ operation: 'read', binding: 'tickets', recordKey, readAction: 'publish' }));
  await assert.rejects(guarded.documentBody!({ operation: 'read', binding: 'nope', recordKey, readAction: 'queryTickets' }));
  await assert.rejects(guarded.documentBody!({ operation: 'save', binding: 'tickets', recordKey, readAction: 'queryTickets', writeAction: 'publish',
    contentMarkdown: 'x', expectedRevision: 1, schemaRevision: 1, requestId: 'q' }));
  // The title column (learned from runtime.databases) is editor-only: the body's title goes.
  const read = await guarded.documentBody!({ operation: 'read', binding: 'tickets', recordKey, readAction: 'queryTickets' });
  assert.deepEqual(read, { record_key: 'r1', title: null, revision: 1, schema_revision: 1, content_markdown: 'body' });
  assert.equal(bodies.length, 1);

  const statuses: boolean[] = [];
  guarded.subscribeDatabase!('nope', () => {}, { onStatusChange: live => statuses.push(live) });
  guarded.subscribeDatabase!('tickets', () => {});
  assert.deepEqual(statuses, [false]);
  assert.deepEqual(subscribed, ['tickets']);

  await assert.rejects(guarded.draftHandover!({ record: { binding: 'months', recordKey, readAction: 'publish' } }));
  await guarded.draftHandover!({ record: { binding: 'tickets', recordKey, readAction: 'queryTickets' } });
  await guarded.draftHandover!({ prompt: 'hi' });
  assert.equal(drafts.length, 2);
});

test('host record components and the collection item are held to the floor', async () => {
  const seen: Record<string, unknown> = {};
  const ui: NotisRuntime['ui'] = {
    DocumentPage: (props => { seen.page = props; return null; }),
    DocumentEditor: (props => { seen.editor = props; return null; }),
    RecordProperties: () => null,
    HtmlFrame: () => null,
  };
  const { runtime } = runtimeFor(floorSpace(), { ui, callAction: (async () => ({ rows: [titled] })) as NotisRuntime['callAction'],
    context: { params: {}, locale: 'en', collectionItem: { id: 'r1', title: 'One', properties: { Name: 'One', Status: 'Draft' } } } });
  const guarded = guardSpaceRuntime(runtime, undefined, { publicRecordUI })!;
  // The wrappers are function components: called directly they return the host element with its props.
  type Draw<P> = (props: P) => ReactElement<P>;
  const page = (props: NotisDocumentPageProps) => (guarded.ui!.DocumentPage as unknown as Draw<NotisDocumentPageProps>)(props).props.properties;
  assert.equal(guarded.ui!.RecordProperties, undefined);
  assert.equal(guarded.ui!.HtmlFrame, ui.HtmlFrame);
  // A read teaches the real name of a column declared in another case.
  await guarded.callAction!('queryTickets', {}, { readOnly: true });
  assert.deepEqual(page({ recordKey: 'r1', properties: { include: ['Status', 'internal notes'] } }),
    { include: ['Status'], exclude: ['Internal notes', 'Name', 'Budget', 'INTERNAL NOTES'] });
  assert.deepEqual((page({ recordKey: 'r1' }) as { exclude: string[] }).exclude.slice(0, 3), ['Internal notes', 'Name', 'Budget']);
  assert.equal(page({ recordKey: 'r1', properties: 'hidden' }), 'hidden');
  const editor = guarded.ui!.DocumentEditor as unknown as Draw<NotisDocumentEditorProps>;
  assert.equal(editor({ recordKey: 'r1' }).props.showProperties, false);
  assert.deepEqual(guarded.context.collectionItem, { id: 'r1', title: '', properties: { Status: 'Draft' } });

  // Without the React wrapper, the components that draw properties are left out.
  const bare = guardSpaceRuntime(runtimeFor(floorSpace(), { ui }).runtime)!;
  assert.equal(bare.ui!.DocumentPage, undefined);
  assert.equal(bare.ui!.DocumentEditor, undefined);
  assert.equal(bare.ui!.HtmlFrame, ui.HtmlFrame);
  assert.deepEqual(publicDocumentPageProperties('panel', []), 'panel');
});

test('editing (not viewing as the public) leaves every entry point exactly as the host gave it', async () => {
  const documentBody = (async () => ({})) as unknown as NotisRuntime['documentBody'];
  const subscribeDatabase = () => () => {};
  const draftHandover = (async () => ({ status: 'drafted' })) as NotisRuntime['draftHandover'];
  const ui: NotisRuntime['ui'] = { DocumentPage: () => null, RecordProperties: () => null };
  const context = { params: {}, locale: 'en' as const, collectionItem: { id: 'r1', title: 'One', properties: { Name: 'One' } } };
  const editing = { ...floorSpace(), viewAs: undefined };
  const { runtime } = runtimeFor(editing, { documentBody, subscribeDatabase, draftHandover, ui, context,
    callAction: (async () => ({ rows: [titled] })) as NotisRuntime['callAction'] });
  const guarded = guardSpaceRuntime(runtime, undefined, { publicRecordUI })!;
  assert.equal(guarded.documentBody, documentBody);
  assert.equal(guarded.subscribeDatabase, subscribeDatabase);
  assert.equal(guarded.draftHandover, draftHandover);
  assert.equal(guarded.ui, ui);
  assert.equal(guarded.context, context);
  const result = await guarded.callAction!<{ rows: unknown[] }>('openTickets', { properties: { 'Internal notes': 'x' } }, { readOnly: true });
  assert.deepEqual(result.rows[0], titled);
});
