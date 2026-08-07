'use client';

import { useCallback, useEffect, useState } from 'react';
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
  error: Error | null;
  refetch: () => void;
}

/** Fetch a single document (with content) by id, normalized. */
export function useDocument(
  documentId: string | null | undefined,
  options: UseDocumentOptions = {},
): UseDocumentResult {
  const runtime = useNotisRuntime();
  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [loading, setLoading] = useState(Boolean(documentId));
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const enabled = options.enabled !== false && Boolean(documentId);

  const refetch = useCallback(() => {
    setFetchKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (!runtime || !enabled || !documentId) {
      setDocument(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    runtime
      .callTool<GetDocumentResult>('LOCAL_NOTIS_DATABASE_GET_DOCUMENT', {
        document_id: documentId,
      })
      .then((result) => {
        if (cancelled) return;
        if (!result.document) {
          throw new Error(result.error ?? result.message ?? 'Document not found');
        }
        setDocument(normalizeDocumentRecord(result.document));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runtime, documentId, enabled, fetchKey]);

  return { document, loading, error, refetch };
}
