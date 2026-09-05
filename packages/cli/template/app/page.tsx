'use client';

import { getDocumentPreview, useDocuments, useNotis, Skeleton, ViewSkeleton } from '@notis/sdk';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function HomePage() {
  const { app, ready } = useNotis();
  // Documents come back normalized: plain property values, camelCase fields,
  // and typed content (contentMarkdown / contentBlocknote / plainText).
  const { documents, loading, hasData, error, refetch } = useDocuments('items', { pageSize: 25 });

  return (
    <main className="notis-app-shell space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <Badge variant="secondary" className="w-fit">Installed app</Badge>
          <div className="space-y-2">
            <CardTitle>{ready ? app?.name : <Skeleton style={{ width: 160 }} />}</CardTitle>
            <CardDescription>
              {ready ? app?.description : <Skeleton style={{ width: 240 }} />}
            </CardDescription>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
          <CardDescription>Use shadcn surfaces and portal tokens so the app feels native inside Notis.</CardDescription>
        </CardHeader>
        <CardContent>
          {error && <p role="alert" className="mb-3 text-sm text-destructive">{error.message} <button onClick={refetch}>Retry</button></p>}
          {loading ? (
            <ViewSkeleton variant="table" rows={4} />
          ) : !hasData ? null : documents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              No items yet. Create your first item.
            </div>
          ) : (
            <div className="space-y-3">
              {documents.map((doc) => (
                <div key={doc.id} className="rounded-xl border border-border bg-background px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{doc.title || 'Untitled'}</p>
                    {typeof doc.properties.status === 'string' ? (
                      <Badge variant="outline">{doc.properties.status}</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                    {getDocumentPreview(doc)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
