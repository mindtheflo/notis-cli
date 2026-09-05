'use client';

import { useNotisRuntime } from '../provider';
import { useQuery, type UseQueryOptions } from './useQuery';

/** An explicitly identified read-only tool, cached by tool name and exact arguments. */
export function useToolQuery<T = unknown>(name: string, args: Record<string, unknown> = {}, options: UseQueryOptions) {
  const runtime = useNotisRuntime();
  return useQuery<T>(['tool', name, args], () => runtime!.callTool<T>(name, args, {
    readOnly: true, dedupe: true,
  }), options);
}
