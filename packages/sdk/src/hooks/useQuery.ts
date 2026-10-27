'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useNotisRuntime } from '../provider';
import { createQueryClient, queryKey, type RowsDescriptor } from '../queryCache';
import { spaceQueryKey } from '../space';
import { localizeQueryError } from '../queryErrors';

export interface UseQueryOptions {
  /** Required acknowledgement: only idempotent reads may run on mount or prefetch. */
  readOnly: true;
  enabled?: boolean;
  staleTimeMs?: number;
  /**
   * The native rows this read answers with, so a write to that database shows in it at once: `binding` is the
   * database binding, `at` the answer field holding the rows ('' when the answer is the list). Rows are native
   * rows unless `shape` says 'document'; give `query` (the native query the read runs) to let a write add a new
   * row, move a row to its sorted place, or take out a row its filter no longer keeps.
   */
  rows?: { binding: string; at?: string; shape?: RowsDescriptor['shape']; query?: unknown; list?: string };
}

export interface UseQueryResult<T> {
  data: T | undefined;
  hasData: boolean;
  loading: boolean;
  isFetching: boolean;
  error: Error | null;
  /** Reads again; resolves to the read's localized error, or null when it succeeded (never rejects). */
  refetch: () => Promise<Error | null>;
}

/** Cached read callback; scope and lifetime are provided by the host, never by app globals. */
export function useQuery<T>(key: readonly unknown[], read: () => Promise<T>, options: UseQueryOptions): UseQueryResult<T> {
  const runtime = useNotisRuntime();
  // Older hosts deliberately get a hook-local cache: no cross-runtime/account reuse.
  const fallback = useMemo(() => createQueryClient(), [runtime]);
  const client = runtime?.queryClient ?? fallback;
  const cacheKey = queryKey(spaceQueryKey(runtime, key));
  const enabled = Boolean(runtime) && options.enabled !== false && options.readOnly === true;
  const readRef = useRef(read);
  const rowsRef = useRef<RowsDescriptor | undefined>(undefined);
  rowsRef.current = options.rows ? { at: '', shape: 'native', ...options.rows } : undefined;
  useLayoutEffect(() => { readRef.current = read; });
  const subscribe = useCallback((listener: () => void) => enabled ? client.subscribe(cacheKey, listener) : () => {}, [cacheKey, client, enabled]);
  const snapshot = useSyncExternalStore(subscribe, () => client.getSnapshot<T>(cacheKey), () => client.getSnapshot<T>(cacheKey));
  const fetch = useCallback(() => {
    const capturedRead = readRef.current;
    return client.fetch(cacheKey, capturedRead, { staleTimeMs: options.staleTimeMs, rows: rowsRef.current });
  }, [cacheKey, client, options.staleTimeMs]);
  useEffect(() => {
    if (!enabled) return;
    void fetch().catch(() => {}); // Error belongs to the snapshot; no unhandled rejection.
  }, [enabled, fetch, snapshot.invalidation]);
  const locale = runtime?.context?.locale;
  const refetch = useCallback(async (): Promise<Error | null> => {
    if (!enabled) return null;
    client.invalidate(cacheKey);
    try {
      await fetch();
      return null;
    } catch (failure) {
      return localizeQueryError(failure instanceof Error ? failure : new Error(String(failure)), locale);
    }
  }, [cacheKey, client, enabled, fetch, locale]);
  const error = useMemo(() => localizeQueryError(snapshot.error, runtime?.context?.locale), [snapshot.error, runtime?.context?.locale]);
  return {
    data: enabled ? snapshot.data : undefined,
    hasData: enabled && snapshot.hasData,
    loading: enabled && !snapshot.hasData && !snapshot.error,
    isFetching: enabled && snapshot.isFetching,
    error: enabled ? error : null,
    refetch,
  };
}

/** Opt-in preparation for small, known read queries. Never use for writes or full-database crawls. */
export function useQueryClient(): {
  invalidate(key?: readonly unknown[]): void;
  prefetch<T>(key: readonly unknown[], read: () => Promise<T>, options: UseQueryOptions): Promise<T | undefined>;
} {
  const runtime = useNotisRuntime();
  return useMemo(() => ({
    invalidate: (key?: readonly unknown[]) => runtime?.queryClient?.invalidate(key ? queryKey(spaceQueryKey(runtime, key)) : undefined),
    prefetch: <T,>(key: readonly unknown[], read: () => Promise<T>, options: UseQueryOptions) => {
      if (!runtime?.queryClient || options.enabled === false || options.readOnly !== true) return Promise.resolve(undefined);
      return runtime.queryClient.prefetch(queryKey(spaceQueryKey(runtime, key)), read, { staleTimeMs: options.staleTimeMs });
    },
  }), [runtime]);
}
