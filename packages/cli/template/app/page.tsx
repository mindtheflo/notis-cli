'use client';

import { getDocumentPreview, useDocuments, useNotis } from '@notis/sdk';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function HomePage() {
  const { app, ready } = useNotis();
  // Documents come back normalized: plain property values, camelCase fields,
  // and typed content (contentMarkdown / contentBlocknote / plainText).
  const { documents, loading } = useDocuments('items', { pageSize: 25 });

  return (
    <main className="notis-app-shell space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <Badge variant="secondary" className="w-fit">Installed app</Badge>
          <div className="space-y-2">
            <CardTitle>{ready ? app?.name : 'Loading...'}</CardTitle>
            <CardDescription>
              {ready ? app?.description : 'Loading app metadata...'}
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
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : documents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              No items yet. Deploy the app and create some.
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
