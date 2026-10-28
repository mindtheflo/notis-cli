'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useNotisRuntime } from '../provider';
import { createQueryClient, queryKey, type NotisQueryClient, type QueryRead, type QuerySnapshot, type RowsDescriptor } from '../queryCache';
import { spaceQueryKey } from '../space';
import { localizeQueryError } from '../queryErrors';
import { beginWait, endWait } from '../perf';

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
  /**
   * When the key changes (a filter, a search, a tab), keep answering with the last key's result, from the same
   * cache and access scope, until the new one is read: `isPreviousData` is then true and `loading` false. Default
   * true for reads that declare `rows` (lists), false otherwise (a read keyed by one record must not show another).
   */
  keepPrevious?: boolean;
}

export interface UseQueryResult<T> {
  data: T | undefined;
  hasData: boolean;
  loading: boolean;
  isFetching: boolean;
  /** `data` is the previous key's result, shown while this key is read (see `keepPrevious`). */
  isPreviousData?: boolean;
  error: Error | null;
  /** Reads again; resolves to the read's localized error, or null when it succeeded (never rejects). */
  refetch: () => Promise<Error | null>;
}

type Shown = { key: string; scope: string; client: NotisQueryClient };

/**
 * The previous key's snapshot to keep showing while `key` loads: only from the same client and access scope, only
 * while that client still holds it (a cleared scope or a refused read takes it away), never over an error.
 */
function previousSnapshot<T>(client: NotisQueryClient, scope: string, key: string, current: QuerySnapshot<T>,
  previous: Shown | null): QuerySnapshot<T> | null {
  if (current.hasData || current.error || !previous || previous.key === key || previous.client !== client || previous.scope !== scope) return null;
  const prior = client.getSnapshot<T>(previous.key);
  return prior.hasData && !prior.error ? prior : null;
}

/** Cached read callback; scope and lifetime are provided by the host, never by app globals. */
export function useQuery<T>(key: readonly unknown[], read: (publish?: (partial: NoInfer<T>) => void) => Promise<T>, options: UseQueryOptions): UseQueryResult<T> {
  const runtime = useNotisRuntime();
  // Older hosts deliberately get a hook-local cache: no cross-runtime/account reuse.
  const fallback = useMemo(() => createQueryClient(), [runtime]);
  const client = runtime?.queryClient ?? fallback;
  const cacheKey = queryKey(spaceQueryKey(runtime, key));
  const scope = queryKey(spaceQueryKey(runtime, []));
  const enabled = Boolean(runtime) && options.enabled !== false && options.readOnly === true;
  const keep = options.keepPrevious ?? Boolean(options.rows);
  const readRef = useRef(read);
  const rowsRef = useRef<RowsDescriptor | undefined>(undefined);
  rowsRef.current = options.rows ? { at: '', shape: 'native', ...options.rows } : undefined;
  useLayoutEffect(() => { readRef.current = read; });
  const subscribe = useCallback((listener: () => void) => enabled ? client.subscribe(cacheKey, listener) : () => {}, [cacheKey, client, enabled]);
  const snapshot = useSyncExternalStore(subscribe, () => client.getSnapshot<T>(cacheKey), () => client.getSnapshot<T>(cacheKey));
  // The last key this hook showed an answer for.
  const shownRef = useRef<Shown | null>(null);
  const prior = enabled && keep ? previousSnapshot(client, scope, cacheKey, snapshot, shownRef.current) : null;
  const hasData = enabled && (snapshot.hasData || prior !== null);
  // A changed key waits from the key press or click that changed it until its own answer paints (perf.ts).
  const waitPart = useRef({});
  const waitedKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    const previous = shownRef.current;
    if (previous && previous.key !== cacheKey && waitedKey.current !== cacheKey) {
      if (waitedKey.current !== null) endWait('notis:query-change', waitPart.current);
      waitedKey.current = cacheKey;
      beginWait('notis:query-change', waitPart.current);
    }
    if (snapshot.hasData) {
      shownRef.current = { key: cacheKey, scope, client };
      if (waitedKey.current === cacheKey) { waitedKey.current = null; endWait('notis:query-change', waitPart.current); }
    }
  }, [cacheKey, client, enabled, scope, snapshot.hasData]);
  // A hook that stops reading never holds a wait open.
  useEffect(() => () => { if (waitedKey.current !== null) endWait('notis:query-change', waitPart.current); }, []);
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
    data: enabled ? (prior ?? snapshot).data : undefined,
    hasData,
    loading: enabled && !hasData && !snapshot.error,
    isFetching: enabled && (snapshot.isFetching || prior !== null),
    isPreviousData: prior !== null,
    error: enabled ? error : null,
    refetch,
  };
}

/** Opt-in preparation for small, known read queries. Never use for writes or full-database crawls. */
export function useQueryClient(): {
  invalidate(key?: readonly unknown[]): void;
  prefetch<T>(key: readonly unknown[], read: QueryRead<T>, options: UseQueryOptions): Promise<T | undefined>;
} {
  const runtime = useNotisRuntime();
  return useMemo(() => ({
    invalidate: (key?: readonly unknown[]) => runtime?.queryClient?.invalidate(key ? queryKey(spaceQueryKey(runtime, key)) : undefined),
    prefetch: <T,>(key: readonly unknown[], read: QueryRead<T>, options: UseQueryOptions) => {
      if (!runtime?.queryClient || options.enabled === false || options.readOnly !== true) return Promise.resolve(undefined);
      return runtime.queryClient.prefetch(queryKey(spaceQueryKey(runtime, key)), read, { staleTimeMs: options.staleTimeMs,
        rows: options.rows ? { at: '', shape: 'native', ...options.rows } : undefined });
    },
  }), [runtime]);
}
