'use client';

import type { CSSProperties, ReactElement } from 'react';
import { useNotisRuntime } from '../provider';
import { useDocument } from '../hooks/useDocument';
import { Markdown } from './Markdown';
import type { NotisDocumentEditorProps } from '../runtime';

const fallbackNoticeStyle: CSSProperties = {
  marginTop: '0.75rem',
  fontSize: '12px',
  color: 'hsl(var(--muted-foreground))',
};

const fallbackFrameStyle: CSSProperties = {
  borderRadius: '0.5rem',
  border: '1px dashed hsl(var(--border))',
  padding: '1rem',
  fontSize: '13px',
  color: 'hsl(var(--muted-foreground))',
};

const fallbackTitleStyle: CSSProperties = {
  margin: '0 0 0.75rem',
  fontSize: '1.5rem',
  fontWeight: 700,
  letterSpacing: '-0.01em',
  color: 'hsl(var(--foreground))',
};

/**
 * Read-only stand-in used when no host editor is available (standalone dev
 * harness, snapshots). Markdown content renders via `Markdown`; other content
 * types get a typed placeholder.
 */
function DocumentEditorFallback({ documentId, variant = 'full', className }: NotisDocumentEditorProps) {
  const runtime = useNotisRuntime();
  const { document, loading, error } = useDocument(documentId);
  // Listing screenshots should show the app as it looks in the portal, so the
  // harness-only editing notice stays out of scenario captures.
  const isScreenshot = Boolean(runtime?.context?.screenshotScenario);

  if (loading) {
    return <div className={className} style={fallbackFrameStyle}>Loading document…</div>;
  }
  if (error || !document) {
    return (
      <div className={className} style={fallbackFrameStyle}>
        {error?.message ?? 'Document not found.'}
      </div>
    );
  }

  const isMarkdown = document.contentType !== 'file';
  return (
    <div className={className}>
      {variant === 'full' ? <h1 style={fallbackTitleStyle}>{document.title}</h1> : null}
      {isMarkdown ? (
        <>
          <Markdown value={document.contentMarkdown ?? ''} />
          {isScreenshot ? null : (
            <p style={fallbackNoticeStyle}>Read-only preview — editing is available inside the Notis portal.</p>
          )}
        </>
      ) : (
        <div style={fallbackFrameStyle}>
          {document.fileType ? `${document.fileType.toUpperCase()} document` : 'File document'} — open it in
          the Notis portal to view.
        </div>
      )}
    </div>
  );
}

/**
 * Embeds the document editor for a document anywhere in an app view. The host
 * (portal) provides the implementation through `runtime.ui.DocumentEditor` and
 * dispatches on the document's content type (markdown -> rich text editor,
 * files -> matching viewer). Outside the portal this falls back to a read-only
 * preview.
 *
 * ```tsx
 * <DocumentEditor documentId={entry.id} variant="body" className="min-h-[320px]" />
 * ```
 */
export function DocumentEditor(props: NotisDocumentEditorProps): ReactElement {
  const runtime = useNotisRuntime();
  const HostEditor = runtime?.ui?.DocumentEditor;
  if (HostEditor) {
    return <HostEditor {...props} />;
  }
  return <DocumentEditorFallback {...props} />;
}
