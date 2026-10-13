'use client';

import { useCallback } from 'react';
import { useNotisRuntime } from '../provider';

interface UseBackendResult {
  /**
   * Make an authenticated request to the Notis backend.
   * The path should be an absolute backend path (e.g. `/portal_composio/toolkits`).
   */
  request: (path: string, options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  }) => Promise<unknown>;
}

/**
 * Raw backend request proxy. Use this for custom server endpoints or
 * integration APIs not covered by the typed hooks.
 * Spaces deny raw requests; use useAction or useActionQuery for declared actions.
 *
 * ```tsx
 * const { request } = useBackend();
 * const data = await request('/portal_composio/toolkits', { method: 'GET' });
 * ```
 */
export function useBackend(): UseBackendResult {
  const runtime = useNotisRuntime();

  const request = useCallback(
    async (path: string, options?: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
      if (!runtime) {
        throw new Error('Notis runtime not available. Ensure NotisProvider is mounted.');
      }
      return runtime.request(path, options);
    },
    [runtime],
  );

  return { request };
}
