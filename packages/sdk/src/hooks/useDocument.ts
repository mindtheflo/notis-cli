'use client';

import { useQuery } from './useQuery';
import { useNotisRuntime } from '../provider';
import { normalizeDocumentRecord } from '../documents';
import type { DocumentRecord } from '../runtime';
import { pick, type Words } from '../words/types';

/** The words of the document hook's own failures, in English and French (C8). */
export const DOCUMENT_HOOK_WORDS = Object.freeze({
  notFound: { en: 'Document not found', fr: 'Document introuvable' },
}) satisfies Readonly<Record<string, Words>>;

interface GetDocumentResult {
  status?: string;
  document?: unknown;
  message?: string;
  error?: string;
}

export interface UseDocumentOptions {
  enabled?: boolean;
}

export interface UseDocumentResult {
  document: DocumentRecord | null;
  loading: boolean;
  isFetching: boolean;
  hasData: boolean;
  error: Error | null;
  /** Reads again; resolves to the read's error, or null when it succeeded. */
  refetch: () => Promise<Error | null>;
}

/** Fetch a single document (with content) by id, normalized. */
export function useDocument(
  documentId: string | null | undefined,
  options: UseDocumentOptions = {},
): UseDocumentResult {
  const runtime = useNotisRuntime();
  const locale = runtime?.context?.locale === 'fr' ? 'fr' : 'en';
  const query = useQuery<DocumentRecord>(['document', documentId ?? null, locale], async () => {
    if (!runtime || !documentId) throw new Error(pick(DOCUMENT_HOOK_WORDS.notFound, locale));
    const result = await runtime.callTool<GetDocumentResult>('LOCAL_NOTIS_DATABASE_GET_DOCUMENT', {
      document_id: documentId,
    }, { dedupe: true, readOnly: true });
    if (!result.document) throw new Error(result.error ?? result.message ?? pick(DOCUMENT_HOOK_WORDS.notFound, locale));
    return normalizeDocumentRecord(result.document, { locale });
  }, { readOnly: true, enabled: options.enabled !== false && Boolean(documentId) });
  return { document: query.data ?? null, loading: query.loading, isFetching: query.isFetching, hasData: query.hasData, error: query.error, refetch: query.refetch };
}
