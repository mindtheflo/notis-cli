'use client';

import { useCallback, useState } from 'react';
import { useNotisRuntime } from '../provider';
import { useQuery, type UseQueryOptions, type UseQueryResult } from './useQuery';
import type { SpaceFunctionCallOptions } from '../functions';

/**
 * Call one of this Space's functions exposed to its views (`expose: ['page']`). The handler runs on Notis's side;
 * the page only gets its result.
 *
 * ```tsx
 * const settle = useFunction<{ thread: string }, { settled: boolean }>('settle_thread');
 * <Button disabled={settle.loading} onClick={() => void settle.call({ thread: id })}>Settle</Button>
 * ```
 */
export function useFunction<TInput extends Record<string, unknown> = Record<string, unknown>, TResult = unknown>(name: string): {
  call: (input: TInput, options?: SpaceFunctionCallOptions) => Promise<TResult>; loading: boolean; error: Error | null;
  /** False on hosts that cannot run functions, or when this view may not call this one. */
  available: boolean;
} {
  const runtime = useNotisRuntime();
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const available = runtime?.resource?.kind === 'space' && Boolean(runtime.callFunction)
    && Boolean(runtime.space?.functions && Object.hasOwn(runtime.space.functions, name));
  const call = useCallback(async (input: TInput, options?: SpaceFunctionCallOptions) => {
    if (runtime?.resource?.kind !== 'space' || !runtime.callFunction) throw new Error('A Space function runtime is required.');
    setPending((value) => value + 1); setError(null);
    try { return await runtime.callFunction<TResult>(name, input, options); }
    catch (cause) { const failure = cause instanceof Error ? cause : new Error(String(cause)); setError(failure); throw failure; }
    finally { setPending((value) => value - 1); }
  }, [runtime, name]);
  return { call, loading: pending > 0, error, available };
}

/** A `read` function as a cached query: it runs again when `input` changes. */
export function useFunctionQuery<TResult = unknown>(name: string, input: Record<string, unknown>,
  options: UseQueryOptions = { readOnly: true }): UseQueryResult<TResult> {
  const { call } = useFunction<Record<string, unknown>, TResult>(name);
  return useQuery(['function', name, input], () => call(input), options);
}
