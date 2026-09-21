import { useEffect, useMemo } from 'react';
import { useNotisRuntime } from '../provider';
import type { ContextResource } from '../runtime';

function stableResource(resource: ContextResource | null): string {
  return JSON.stringify(resource);
}

/** Keep Notis aware of the resource currently open inside an app view. */
export function useActiveResource(resource: ContextResource | null): void {
  const runtime = useNotisRuntime();
  const signature = stableResource(resource);
  const stable = useMemo(() => resource, [signature]);

  useEffect(() => {
    runtime?.publishActiveResource?.(stable);
    return () => runtime?.publishActiveResource?.(null);
  }, [runtime, stable]);
}
