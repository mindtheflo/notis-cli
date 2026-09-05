'use client';

import { useQuery } from './useQuery';
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
  isFetching: boolean;
  hasData: boolean;
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
  const query = useQuery<DocumentRecord[]>(
    ['documents', databaseSlug, options.filter ?? null, options.pageSize ?? null, options.offset ?? 0, Boolean(options.fetchAll)],
    async () => {
      if (!runtime) throw new Error('Notis runtime not available');
      const allDocuments: unknown[] = [];
      let offset = options.offset ?? 0;
      while (true) {
        const result = await runtime.callTool<QueryDatabaseResult>('LOCAL_NOTIS_DATABASE_QUERY', {
          database_slug: databaseSlug,
          query: {
            ...(options.filter ?? {}),
            ...(options.pageSize !== undefined ? { page_size: options.pageSize } : {}),
          },
          ...(offset > 0 ? { offset } : {}),
        }, { dedupe: true, readOnly: true });
        const message = result.error ?? result.message;
        if (!result.documents && message) throw new Error(message);
        allDocuments.push(...(result.documents ?? []));
        if (!options.fetchAll || !result.has_more) break;
        const nextOffset = result.next_offset;
        if (typeof nextOffset !== 'number' || nextOffset <= offset) {
          throw new Error('Database query returned an invalid pagination offset');
        }
        offset = nextOffset;
      }
      return allDocuments.map(normalizeDocumentRecord).filter((document) => document.id);
    },
    { readOnly: true, enabled: options.enabled },
  );
  return { documents: query.data ?? EMPTY_DOCUMENTS, loading: query.loading, isFetching: query.isFetching, hasData: query.hasData, error: query.error, refetch: query.refetch };
}

const EMPTY_DOCUMENTS: DocumentRecord[] = [];
