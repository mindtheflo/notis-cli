import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { scaffoldProject, syncSpaceSdk } from './app-platform.js';
import { validateViewPath } from './space-view-manifest.js';
import { usageError } from './errors.js';

/** A local, editable collection layout. No remote database or Space mutation. */
export async function scaffoldSpaceCollection({ projectDir, name, databaseKey, path = 'records', titleProperty = 'title' }) {
  if (typeof databaseKey !== 'string' || !databaseKey.trim() || databaseKey.length > 200) throw usageError('Pass the portable --database-key for the database this Space links.');
  if (typeof name !== 'string' || !name.trim() || typeof titleProperty !== 'string' || !titleProperty.trim()) throw usageError('Choose a Space name and title property.');
  validateViewPath(path);
  await scaffoldProject({ projectDir, appName: name });
  // A Space installs only the SDK's types and build-time entries; the host provides the rest.
  syncSpaceSdk(projectDir, { log: () => {} });
  mkdirSync(join(projectDir, 'spaces', 'collection'), { recursive: true });
  writeFileSync(join(projectDir, 'notis.config.ts'), `import { defineSpaces } from '@notis/sdk/config';
export default defineSpaces({ spaces: { collection: { definition: 'spaces/collection/space.config.ts' } } });\n`);
  const definition = { specVersion: 2, name, description: `Browse and edit ${name} records.`, path, entry: './view.tsx', layout: '../../app/layout.tsx',
    readableContext: `Browse ${name} records. The item parameter opens one record with its properties, collaborative body and sharing controls.`,
    verificationFixtures: './verification.json',
    resources: { items: { kind: 'database', key: databaseKey } },
    collection: { database: 'items', titleProperty },
    params: { item: { type: 'record', database: 'items', main: true, description: 'The record opened beside the list.' } },
    shows: { items: { database: 'items', where: {}, open: 'item' } },
    memory: { markdown: true, attachments: true, screenshot: false, snapshots: [] },
    // Each action is the linked database's own query, insert or trash: Notis turns it into the binding operation
    // that useNativeMutation calls, so the view never names an account-wide database.
    actions: { read: rowAction('LOCAL_NOTIS_DATABASE_QUERY'), create: rowAction('LOCAL_NOTIS_DATABASE_INSERT'),
      delete: rowAction('LOCAL_NOTIS_DATABASE_DELETE') },
  };
  writeFileSync(join(projectDir, 'spaces/collection/space.config.ts'), `import { defineSpace } from '@notis/sdk/config';\nexport default defineSpace(${JSON.stringify(definition, null, 2)});\n`);
  writeFileSync(join(projectDir, 'spaces/collection/view.tsx'), COLLECTION_VIEW);
  writeFileSync(join(projectDir, 'spaces/collection/verification.json'), JSON.stringify({
    actions: {}, shown: { items: [{ params: {}, result: { rows: [], has_more: false, schema_revision: 1 } }] },
  }, null, 2) + '\n');
  return { projectDir, key: 'collection', databaseKey };
}

/** One declared action over the linked database: the tool gets the binding and the view's request, nothing else. */
function rowAction(tool) {
  return { tool, inputs: { type: 'object', additionalProperties: false, required: ['request'], properties: { request: { type: 'object' } } },
    arguments: { database_id: { $asset: 'items' }, request: { $input: 'request' } } };
}

/**
 * The scaffolded view: one ListReader over the linked records, with the host top bar search, an All pill, a "+" that
 * creates and opens a record, and the record's document page in the reader. The title lives in the host top bar.
 */
export const COLLECTION_VIEW = `'use client';
import { useRef } from 'react';
import { DocumentPage, useNativeMutation, useShown, useViewParams } from '@notis/sdk';
import { EmptyState, ListReader, Notice, Row, type ListReaderApi } from '@notis/sdk/ui';
import definition from './space.config';

type Item = { record_key: string; revision: number; title: string | null; last_edited_time: string | null };

/** The view's words. Spaces are English only; the toolkit's own words follow the Notis language. */
const t = { list: 'Records', search: 'Search records…', all: 'All', create: 'New record', untitled: 'Untitled',
  empty: 'No records yet.', remove: 'Delete', failed: 'Could not create the record. Try again.' };

export default function CollectionView() {
  const { setParams } = useViewParams<typeof definition>();
  const { data, loading, error, refetch } = useShown<Item>('items', { allPages: true });
  const insert = useNativeMutation('items', 'insert');
  const trash = useNativeMutation('items', 'delete');
  const list = useRef<ListReaderApi>(null);
  const rows = data?.rows ?? [];
  const write = () => ({ schemaRevision: data?.schema_revision ?? 0, requestId: crypto.randomUUID() });
  const title = (record: Item) => record.title || t.untitled;

  async function create() {
    try {
      const receipt = await insert.mutate({}, write());
      await refetch();
      await setParams({ item: receipt.record_key });
    } catch {
      list.current?.notify(t.failed);
    }
  }

  async function remove(records: Item[]) {
    for (const record of records) {
      await trash.mutate({ record_key: record.record_key, expected_revision: record.revision }, write());
    }
    await refetch();
  }

  // The host top bar shows the Space and view name; the open record joins it as the last crumb.
  return <ListReader apiRef={list} label={t.list} items={rows} getId={record => record.record_key} openParam="item"
    loading={loading}
    search={{ placeholder: t.search, match: (record, query) => title(record).toLocaleLowerCase().includes(query.toLocaleLowerCase()) }}
    // One real view so far; add a pill per saved filter once the database has one.
    tabs={{ role: 'filter', items: [{ id: 'all', label: t.all, count: rows.length }], value: 'all', onChange: () => undefined }}
    create={{ label: t.create, onCreate: () => void create() }}
    actions={[{ id: 'delete', run: remove }]}
    empty={error ? <Notice tone="danger" onRetry={() => void refetch()}>{error.message}</Notice> : <EmptyState title={t.empty} />}
    row={record => <Row title={title(record)} time={record.last_edited_time ?? undefined} />}
    readerLabel={title}
    crumbLabel={title}
    readerActions={(_record, ctx) => [{ id: 'delete', label: t.remove, icon: 'trash', run: () => void ctx.run('delete') }]}
    reader={record => <DocumentPage key={record.record_key} recordKey={record.record_key} onSaved={refetch} />} />;
}
`;
