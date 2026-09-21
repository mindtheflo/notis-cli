'use client';

import { useQuery } from './useQuery';
import { useNotisRuntime } from '../provider';
import { normalizeDocumentRecord } from '../documents';
import type { DocumentRecord } from '../runtime';

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
  refetch: () => void;
}

/** Fetch a single document (with content) by id, normalized. */
export function useDocument(
  documentId: string | null | undefined,
  options: UseDocumentOptions = {},
): UseDocumentResult {
  const runtime = useNotisRuntime();
  const query = useQuery<DocumentRecord>(['document', documentId ?? null], async () => {
    if (!runtime || !documentId) throw new Error('Document not found');
    const result = await runtime.callTool<GetDocumentResult>('LOCAL_NOTIS_DATABASE_GET_DOCUMENT', {
      document_id: documentId,
    }, { dedupe: true, readOnly: true });
    if (!result.document) throw new Error(result.error ?? result.message ?? 'Document not found');
    return normalizeDocumentRecord(result.document);
  }, { readOnly: true, enabled: options.enabled !== false && Boolean(documentId) });
  return { document: query.data ?? null, loading: query.loading, isFetching: query.isFetching, hasData: query.hasData, error: query.error, refetch: query.refetch };
}
