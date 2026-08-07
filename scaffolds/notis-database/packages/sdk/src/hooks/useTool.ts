'use client';

import { useCallback, useState } from 'react';
import { useNotisRuntime } from '../provider';

type ToolArguments = Record<string, unknown>;

type ToolCall<TArgs extends ToolArguments | undefined, TResult> = undefined extends TArgs
  ? (args?: Exclude<TArgs, undefined>) => Promise<TResult>
  : (args: TArgs) => Promise<TResult>;

export interface ToolCallState {
  loading: boolean;
  error: Error | null;
}

export interface UseToolResult<
  TArgs extends ToolArguments | undefined = ToolArguments | undefined,
  TResult = unknown,
> extends ToolCallState {
  call: ToolCall<TArgs, TResult>;
}

/**
 * Call a specific Notis tool by name.
 *
 * ```tsx
 * const { call, loading } = useTool('LOCAL_NOTIS_WEB_SEARCH');
 * const result = await call({ query: 'latest news' });
 * ```
 */
export function useTool<
  TArgs extends ToolArguments | undefined = ToolArguments | undefined,
  TResult = unknown,
>(toolName: string): UseToolResult<TArgs, TResult> {
  const runtime = useNotisRuntime();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const call = useCallback(
    async (args?: ToolArguments): Promise<TResult> => {
      if (!runtime) {
        throw new Error('Notis runtime not available. Ensure NotisProvider is mounted.');
      }

      setLoading(true);
      setError(null);

      try {
        const result = await runtime.callTool<TResult>(toolName, args);
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [runtime, toolName],
  ) as ToolCall<TArgs, TResult>;

  return { call, loading, error };
}
