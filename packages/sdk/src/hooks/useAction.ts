'use client';

import { useCallback, useState } from 'react';
import { useNotisRuntime } from '../provider';
import { useQuery, type UseQueryOptions, type UseQueryResult } from './useQuery';
import type { SpaceActionOptions } from '../space';

export function useAction<TInput extends Record<string, unknown> = Record<string, unknown>, TResult = unknown>(actionId: string): {
  call: (inputs: TInput, options?: SpaceActionOptions) => Promise<TResult>; loading: boolean; error: Error | null;
} {
  const runtime = useNotisRuntime();
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const call = useCallback(async (inputs: TInput, options?: SpaceActionOptions) => {
    if (runtime?.resource?.kind !== 'space' || !runtime.callAction) throw new Error('A Space action runtime is required.');
    setPending((value) => value + 1); setError(null);
    try { return await runtime.callAction<TResult>(actionId, inputs, options); }
    catch (cause) { const failure = cause instanceof Error ? cause : new Error(String(cause)); setError(failure); throw failure; }
    finally { setPending((value) => value - 1); }
  }, [runtime, actionId]);
  return { call, loading: pending > 0, error };
}

export interface UseActionQueryOptions extends UseQueryOptions {
  /**
   * Always the provider's current answer, even while the view opens (a check made right before a send, say): see
   * `SpaceActionOptions.fresh`. A fresh read keeps its own cached answer, apart from the same read without it.
   */
  fresh?: boolean;
}

export function useActionQuery<TResult = unknown>(actionId: string, inputs: Record<string, unknown>,
  options: UseActionQueryOptions = { readOnly: true }): UseQueryResult<TResult> {
  const { call } = useAction<Record<string, unknown>, TResult>(actionId);
  const fresh = options.fresh === true;
  return useQuery(fresh ? ['action', actionId, inputs, 'fresh'] : ['action', actionId, inputs],
    () => call(inputs, { readOnly: true, dedupe: true, ...(fresh ? { fresh: true } : {}) }), options);
}
