'use client';

import { useEffect, useState } from 'react';
import { useNotisRuntime } from '../provider';
import type { ToolDescriptor } from '../runtime';

interface UseToolsResult {
  tools: ToolDescriptor[];
  loading: boolean;
  error: Error | null;
}

/**
 * List all tools available to this app.
 *
 * ```tsx
 * const { tools, loading } = useTools();
 * ```
 */
export function useTools(): UseToolsResult {
  const runtime = useNotisRuntime();
  const [tools, setTools] = useState<ToolDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!runtime) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    runtime
      .listTools()
      .then((result) => {
        if (!cancelled) {
          setTools(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runtime]);

  return { tools, loading, error };
}
