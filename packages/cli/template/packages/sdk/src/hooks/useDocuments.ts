'use client';

import { useCallback, useEffect, useState } from 'react';
import { useNotisRuntime } from '../provider';
import { normalizeDocumentRecord } from '../documents';
import type { DocumentRecord, QueryFilter } from '../runtime';

interface QueryDatabaseResult {
  documents?: unknown[];
  has_more?: boolean;
  next_offset?: number | null;
  message?: string;
  error?: string;
}

export interface UseDocumentsOptions {
  filter?: QueryFilter;
  pageSize?: number;
  offset?: number;
  /** Fetch every page, starting at offset, instead of returning only one page. */
  fetchAll?: boolean;
  enabled?: boolean;
}

export interface UseDocumentsResult {
  documents: DocumentRecord[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Query a Notis database and get normalized `DocumentRecord`s.
 *
 * ```tsx
 * const { documents, loading, refetch } = useDocuments('notes', {
 *   filter: { filters: [{ property: 'Folder', operator: 'contains', type: 'relation', value: folderId }] },
 *   pageSize: 250,
 * });
 * ```
 */
export function useDocuments(
  databaseSlug: string,
  options: UseDocumentsOptions = {},
): UseDocumentsResult {
  const runtime = useNotisRuntime();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const enabled = options.enabled !== false;
  const filterKey = JSON.stringify(options.filter ?? null);

  const refetch = useCallback(() => {
    setFetchKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (!runtime || !enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const filter = filterKey === 'null' ? null : (JSON.parse(filterKey) as QueryFilter);

    const fetchDocuments = async (): Promise<unknown[]> => {
      const allDocuments: unknown[] = [];
      let offset = options.offset ?? 0;

      while (true) {
        const result = await runtime.callTool<QueryDatabaseResult>('LOCAL_NOTIS_DATABASE_QUERY', {
          database_slug: databaseSlug,
          query: {
            ...(filter ?? {}),
            ...(options.pageSize !== undefined ? { page_size: options.pageSize } : {}),
          },
          ...(offset > 0 ? { offset } : {}),
        });
        const message = result.error ?? result.message;
        if (!result.documents && message) {
          throw new Error(message);
        }
        allDocuments.push(...(result.documents ?? []));
        if (!options.fetchAll || !result.has_more) return allDocuments;

        const nextOffset = result.next_offset;
        if (typeof nextOffset !== 'number' || nextOffset <= offset) {
          throw new Error('Database query returned an invalid pagination offset');
        }
        offset = nextOffset;
      }
    };

    fetchDocuments()
      .then((result) => {
        if (cancelled) return;
        setDocuments(
          result
            .map(normalizeDocumentRecord)
            .filter((document) => document.id),
        );
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
  }, [runtime, databaseSlug, enabled, fetchKey, filterKey, options.fetchAll, options.offset, options.pageSize]);

  return { documents, loading, error, refetch };
}
