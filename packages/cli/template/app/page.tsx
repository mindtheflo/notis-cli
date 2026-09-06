'use client';

import { getDocumentPreview, useDocuments, useNotis, Skeleton, ViewSkeleton } from '@notis/sdk';
import { Badge } from '@/components/ui/badge';
import { PageHeading } from '@/components/page-heading';

// Reference page for the flat Notis design bar: a plain page header, bare
// figures, and a hairline-free list. No bordered boxes, no dividers, no
// palette colors, no loading text. `notis apps build` enforces these rules.
export default function HomePage() {
  const { app, ready } = useNotis();
  // Documents come back normalized: plain property values, camelCase fields,
  // and typed content (contentMarkdown / contentBlocknote / plainText).
  const { documents, loading, hasData, error, refetch } = useDocuments('items', { pageSize: 25 });

  return (
    <main className="notis-app-shell space-y-8">
      <PageHeading
        title={ready ? app?.name ?? 'Items' : <Skeleton style={{ width: 160, height: 28 }} />}
        description={ready ? app?.description ?? undefined : <Skeleton style={{ width: 240 }} />}
      />

      <section className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Items</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {hasData ? documents.length : <Skeleton style={{ width: 48, height: 28 }} />}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Recent items</h2>
        {error ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error.message}{' '}
            <button type="button" className="font-medium underline" onClick={refetch}>Retry</button>
          </p>
        ) : null}
        {loading ? (
          <ViewSkeleton variant="table" rows={4} />
        ) : !hasData ? null : documents.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No items yet. Create your first item.</p>
        ) : (
          <div className="space-y-2 lg:space-y-0">
            {documents.map((doc) => (
              <div key={doc.id} className="list-row flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{doc.title || 'Untitled'}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{getDocumentPreview(doc)}</p>
                </div>
                {typeof doc.properties.status === 'string' ? (
                  <Badge variant="secondary" className="shrink-0">{doc.properties.status}</Badge>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
