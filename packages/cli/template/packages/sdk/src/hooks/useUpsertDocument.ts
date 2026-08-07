'use client';

import { useCallback, useState } from 'react';
import { useNotisRuntime } from '../provider';
import { normalizeDocumentRecord } from '../documents';
import type { DocumentRecord } from '../runtime';

export interface UpsertDocumentArgs {
  documentId?: string;
  title?: string;
  /** Property values keyed by property name (already-plain values). */
  properties?: Record<string, unknown>;
  /** Markdown content; converted server-side to BlockNote. Exclusive with contentBlocknote. */
  contentMarkdown?: string | null;
  /** BlockNote block JSON. Exclusive with contentMarkdown. */
  contentBlocknote?: Array<Record<string, unknown>> | null;
  /** 'archive' soft-deletes the document (sets archived_at); 'restore' undoes it. */
  operation?: 'create' | 'update' | 'archive' | 'restore';
}

interface UpsertToolResult {
  status?: string;
  document?: unknown;
  message?: string;
  error?: string;
}

export interface UseUpsertDocumentResult {
  upsert: (args: UpsertDocumentArgs) => Promise<DocumentRecord>;
  loading: boolean;
  error: Error | null;
}

function upsertToolName(databaseSlug: string): string {
  return `LOCAL_NOTIS_DATABASE_UPSERT_${databaseSlug.replace(/-/g, '_').toUpperCase()}`;
}

function buildToolArgs(args: UpsertDocumentArgs): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (args.documentId) payload.document_id = args.documentId;
  if (typeof args.title === 'string') payload.title = args.title;
  if (args.properties) Object.assign(payload, args.properties);
  if ('contentMarkdown' in args) payload.content_markdown = args.contentMarkdown ?? '';
  if ('contentBlocknote' in args) payload.content_blocknote = args.contentBlocknote ?? null;
  if (args.operation) payload.operation = args.operation;
  return payload;
}

/**
 * Create/update/archive documents in a Notis database.
 *
 * ```tsx
 * const { upsert } = useUpsertDocument('journal_entries');
 * await upsert({ documentId, properties: { Mood: 'Great' }, contentMarkdown: reflection });
 * ```
 */
export function useUpsertDocument(databaseSlug: string): UseUpsertDocumentResult {
  const runtime = useNotisRuntime();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const upsert = useCallback(
    async (args: UpsertDocumentArgs): Promise<DocumentRecord> => {
      if (!runtime) {
        throw new Error('Notis runtime not available. Ensure NotisProvider is mounted.');
      }
      if ('contentMarkdown' in args && 'contentBlocknote' in args) {
        throw new Error('Provide contentMarkdown or contentBlocknote, not both.');
      }

      setLoading(true);
      setError(null);

      try {
        const result = await runtime.callTool<UpsertToolResult>(
          upsertToolName(databaseSlug),
          buildToolArgs(args),
        );
        if (!result.document) {
          throw new Error(result.error ?? result.message ?? 'Failed to save document');
        }
        return normalizeDocumentRecord(result.document);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [runtime, databaseSlug],
  );

  return { upsert, loading, error };
}
