'use client';

import { useEffect, useRef, useState } from 'react';
import { useNotisRuntime } from '../provider';
import { useDocuments, type UseDocumentsOptions, type UseDocumentsResult } from './useDocuments';
import type { DocumentRecord } from '../runtime';

export interface UseDatabaseSubscriptionOptions extends UseDocumentsOptions {
  /** Set to false to keep the query but skip the change feed. */
  subscribe?: boolean;
}

export interface UseDatabaseSubscriptionResult extends UseDocumentsResult {
  /** Alias of `documents`, for views that think in rows. */
  rows: DocumentRecord[];
  /** True while a live change feed is attached to this database. */
  live: boolean;
}

/**
 * Query a Notis database and keep it fresh without polling.
 *
 * ```tsx
 * const { rows, live, refetch } = useDatabaseSubscription('workspaces');
 * ```
 *
 * A change on the database wakes the hook, which then refetches through the
 * usual `LOCAL_NOTIS_DATABASE_QUERY` path — the change feed is a signal only
 * and never carries row data. Hosts without a change feed (the dev harness,
 * the screenshot stub, the vite preview) still return rows; `live` is false
 * there and the app should keep offering its manual refresh.
 */
export function useDatabaseSubscription(
  databaseSlug: string,
  options: UseDatabaseSubscriptionOptions = {},
): UseDatabaseSubscriptionResult {
  const runtime = useNotisRuntime();
  const { subscribe = true, ...documentOptions } = options;
  const { documents, loading, error, refetch } = useDocuments(databaseSlug, documentOptions);
  const [live, setLive] = useState(false);

  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  const enabled = options.enabled !== false && subscribe;

  useEffect(() => {
    if (!runtime?.subscribeDatabase || !enabled || !databaseSlug) {
      setLive(false);
      return;
    }

    let cancelled = false;
    const unsubscribe = runtime.subscribeDatabase(
      databaseSlug,
      () => {
        refetchRef.current();
      },
      {
        onStatusChange: (isLive) => {
          if (!cancelled) setLive(isLive);
        },
      },
    );

    return () => {
      cancelled = true;
      setLive(false);
      unsubscribe?.();
    };
  }, [runtime, databaseSlug, enabled]);

  return { documents, rows: documents, loading, error, refetch, live };
}
