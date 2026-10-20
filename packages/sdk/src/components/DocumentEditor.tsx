'use client';

import type { CSSProperties, ReactElement } from 'react';
import { useNotisRuntime } from '../provider';
import { DOCUMENT_HOOK_WORDS, useDocument } from '../hooks/useDocument';
import { fillWords, pick, type Locale, type Words } from '../words/types';
import { Markdown } from './Markdown';
import { RecordComponentUnavailable } from './RecordComponents';
import type { NotisDocumentEditorProps } from '../runtime';

/** The words of the read-only document preview, in English and French (C7). */
export const DOCUMENT_EDITOR_WORDS = Object.freeze({
  loading: { en: 'Loading document', fr: 'Chargement du document' },
  readOnly: { en: 'Read-only preview. Edit it in Notis.', fr: 'Aperçu en lecture seule. Modifie-le dans Notis.' },
  report: { en: 'Interactive report. Open it in its Space to use it.', fr: 'Rapport interactif. Ouvre-le dans son Space pour l’utiliser.' },
  html: { en: 'Interactive page. Open it in its Space to use it.', fr: 'Page interactive. Ouvre-la dans son Space pour l’utiliser.' },
  view: { en: 'View. Open it in its Space to see it.', fr: 'Vue. Ouvre-la dans son Space pour la voir.' },
  file: { en: '{type} file. Open it in Notis to see it.', fr: 'Fichier {type}. Ouvre-le dans Notis pour le voir.' },
  anyFile: { en: 'File. Open it in Notis to see it.', fr: 'Fichier. Ouvre-le dans Notis pour le voir.' },
}) satisfies Readonly<Record<string, Words>>;

const fallbackNoticeStyle: CSSProperties = {
  marginTop: '0.75rem',
  fontSize: '12px',
  color: 'hsl(var(--muted-foreground))',
};

// Flat, like a callout: a tinted block, no border (C7).
const fallbackFrameStyle: CSSProperties = {
  borderRadius: '0.5rem',
  background: 'hsl(var(--muted) / .5)',
  padding: '12px 16px',
  fontSize: '13px',
  lineHeight: '20px',
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
  const { document, loading, error } = useDocument(documentId ?? null);
  const locale: Locale = useNotisRuntime()?.context?.locale === 'fr' ? 'fr' : 'en';
  const t = (words: Words) => pick(words, locale);

  if (loading) {
    return <div role="status" aria-busy="true" className={className} style={fallbackFrameStyle}>{t(DOCUMENT_EDITOR_WORDS.loading)}</div>;
  }
  if (error || !document) {
    return (
      <div role="status" className={className} style={fallbackFrameStyle}>
        {error?.message ?? t(DOCUMENT_HOOK_WORDS.notFound)}
      </div>
    );
  }

  const isMarkdown = document.contentType === 'markdown' || !document.contentType;
  return (
    <div className={className}>
      {variant === 'full' ? <h1 style={fallbackTitleStyle}>{document.title}</h1> : null}
      {isMarkdown ? (
        <>
          <Markdown value={document.contentMarkdown ?? ''} />
          <p style={fallbackNoticeStyle}>{t(DOCUMENT_EDITOR_WORDS.readOnly)}</p>
        </>
      ) : document.contentType === 'view' ? (
        <div style={fallbackFrameStyle}>
          {t(document.viewType === 'report' ? DOCUMENT_EDITOR_WORDS.report
            : document.viewType === 'html' ? DOCUMENT_EDITOR_WORDS.html : DOCUMENT_EDITOR_WORDS.view)}
        </div>
      ) : (
        <div style={fallbackFrameStyle}>
          {document.fileType
            ? t(fillWords(DOCUMENT_EDITOR_WORDS.file, { type: document.fileType.toUpperCase() }))
            : t(DOCUMENT_EDITOR_WORDS.anyFile)}
        </div>
      )}
    </div>
  );
}

/**
 * Embeds the document editor for a document anywhere in an app view. The host
 * (portal) provides the implementation through `runtime.ui.DocumentEditor` and
 * dispatches on the document's content type (markdown -> rich text editor,
 * files -> matching viewer, views -> their trusted native Documents surface).
 * Outside the portal this falls back to a read-only preview or an explicit
 * open-in-Space notice for native views.
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
  // A Space must never fall back to the legacy account-wide document reader.
  if (runtime?.resource?.kind === 'space' || props.recordKey) return <RecordComponentUnavailable className={props.className} />;
  return <DocumentEditorFallback {...props} />;
}
