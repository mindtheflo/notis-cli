import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { scaffoldProject } from './app-platform.js';
import { validateViewPath } from './space-view-manifest.js';
import { usageError } from './errors.js';

/** A local, editable collection layout. No remote database or Space mutation. */
export async function scaffoldSpaceCollection({ projectDir, name, databaseKey, path = 'records', titleProperty = 'title' }) {
  if (typeof databaseKey !== 'string' || !databaseKey.trim() || databaseKey.length > 200) throw usageError('Pass the portable --database-key for the database this Space links.');
  if (typeof name !== 'string' || !name.trim() || typeof titleProperty !== 'string' || !titleProperty.trim()) throw usageError('Choose a Space name and title property.');
  validateViewPath(path);
  await scaffoldProject({ projectDir, appName: name });
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
    actions: { read: { tool: 'LOCAL_NOTIS_DATABASE_QUERY', inputs: { type: 'object', additionalProperties: false,
      required: ['request'], properties: { request: { type: 'object' } } }, arguments: { database_id: { $asset: 'items' }, request: { $input: 'request' } } } },
  };
  writeFileSync(join(projectDir, 'spaces/collection/space.config.ts'), `import { defineSpace } from '@notis/sdk/config';\nexport default defineSpace(${JSON.stringify(definition, null, 2)});\n`);
  writeFileSync(join(projectDir, 'spaces/collection/view.tsx'), COLLECTION_VIEW);
  writeFileSync(join(projectDir, 'spaces/collection/verification.json'), JSON.stringify({
    actions: {}, shown: { items: [{ params: {}, result: { rows: [], has_more: false, schema_revision: 1 } }] },
  }, null, 2) + '\n');
  return { projectDir, key: 'collection', databaseKey };
}

export const COLLECTION_VIEW = `'use client';
import { DocumentPage, useNotis, useNotisNavigation, useNotisRuntime, usePrefetchRecord, useShown, useViewParams, ViewSkeleton } from '@notis/sdk';
import definition from './space.config';
import { Button } from '@/components/ui/button';

const copy = {
  en: { empty: 'No records yet.', all: 'All records', untitled: 'Untitled', retry: 'Retry' },
  fr: { empty: 'Aucun enregistrement pour le moment.', all: 'Tous les enregistrements', untitled: 'Sans titre', retry: 'Réessayer' },
};
export default function CollectionView() {
  const runtime = useNotisRuntime();
  const t = copy[runtime?.context.locale === 'fr' ? 'fr' : 'en'];
  const { resource } = useNotis();
  const navigation = useNotisNavigation();
  const { params } = useViewParams<typeof definition>();
  const { data, loading, error, refetch } = useShown<{ record_key: string; title: string | null }>('items');
  const prefetch = usePrefetchRecord();
  // A record is the main content: the host's document page (breadcrumb back here, title, properties, body).
  if (params.item) return <DocumentPage recordKey={params.item} onSaved={refetch}
    breadcrumb={[{ label: t.all, onSelect: () => resource && navigation.toSpace(resource.id) }]} />;
  return <main className="notis-app-shell space-y-2">
    {error ? <div role="alert">{error.message}<Button onClick={refetch}>{t.retry}</Button></div> : null}
    {loading ? <ViewSkeleton variant="table" rows={5} /> : null}
    {data?.rows.length === 0 ? <p className="text-sm text-muted-foreground">{t.empty}</p> : null}
    {data?.rows.map(record => <Button key={record.record_key} variant="ghost" className="w-full justify-start truncate"
      onPointerEnter={() => prefetch(record.record_key)} onFocus={() => prefetch(record.record_key)}
      onClick={() => resource && navigation.toSpace(resource.id, { recordKey: record.record_key })}>
      {record.title || t.untitled}
    </Button>)}
  </main>;
}
`;
