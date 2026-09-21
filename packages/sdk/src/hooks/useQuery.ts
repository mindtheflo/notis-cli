'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useNotisRuntime } from '../provider';
import { createQueryClient, queryKey } from '../queryCache';

export interface UseQueryOptions {
  /** Required acknowledgement: only idempotent reads may run on mount or prefetch. */
  readOnly: true;
  enabled?: boolean;
  staleTimeMs?: number;
}

export interface UseQueryResult<T> {
  data: T | undefined;
  hasData: boolean;
  loading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/** Cached read callback; scope and lifetime are provided by the host, never by app globals. */
export function useQuery<T>(key: readonly unknown[], read: () => Promise<T>, options: UseQueryOptions): UseQueryResult<T> {
  const runtime = useNotisRuntime();
  // Older hosts deliberately get a hook-local cache: no cross-runtime/account reuse.
  const fallback = useMemo(() => createQueryClient(), [runtime]);
  const client = runtime?.queryClient ?? fallback;
  const cacheKey = queryKey(key);
  const enabled = Boolean(runtime) && options.enabled !== false && options.readOnly === true;
  const readRef = useRef(read);
  useLayoutEffect(() => { readRef.current = read; });
  const subscribe = useCallback((listener: () => void) => enabled ? client.subscribe(cacheKey, listener) : () => {}, [cacheKey, client, enabled]);
  const snapshot = useSyncExternalStore(subscribe, () => client.getSnapshot<T>(cacheKey), () => client.getSnapshot<T>(cacheKey));
  const fetch = useCallback(() => {
    const capturedRead = readRef.current;
    return client.fetch(cacheKey, capturedRead, { staleTimeMs: options.staleTimeMs });
  }, [cacheKey, client, options.staleTimeMs]);
  useEffect(() => {
    if (!enabled) return;
    void fetch().catch(() => {}); // Error belongs to the snapshot; no unhandled rejection.
  }, [enabled, fetch, snapshot.invalidation]);
  const refetch = useCallback(async () => {
    if (!enabled) return;
    client.invalidate(cacheKey);
    await fetch().catch(() => {});
  }, [cacheKey, client, enabled, fetch]);
  return {
    data: enabled ? snapshot.data : undefined,
    hasData: enabled && snapshot.hasData,
    loading: enabled && !snapshot.hasData && !snapshot.error,
    isFetching: enabled && snapshot.isFetching,
    error: enabled ? snapshot.error : null,
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
    invalidate: (key?: readonly unknown[]) => runtime?.queryClient?.invalidate(key ? queryKey(key) : undefined),
    prefetch: <T,>(key: readonly unknown[], read: () => Promise<T>, options: UseQueryOptions) => {
      if (!runtime?.queryClient || options.enabled === false || options.readOnly !== true) return Promise.resolve(undefined);
      return runtime.queryClient.prefetch(queryKey(key), read, { staleTimeMs: options.staleTimeMs });
    },
  }), [runtime]);
}
