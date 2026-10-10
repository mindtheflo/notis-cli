'use client';

import { useCallback } from 'react';
import { useNotisRuntime } from '../provider';

export interface SpaceNavigationOptions {
  recordKey?: string | null;
  /** Declared view parameters. The destination authorizes records and drops unknown names. */
  params?: Record<string, string | number | boolean | null | undefined>;
  selection?: string | null;
}

interface NavigationActions {
  /** Resolve a declared portable destination under the current viewer's access. */
  toNamedSpace: (alias: string, options?: SpaceNavigationOptions) => Promise<void>;
  /** Open an exact Space, optionally at a native record's stable record_key. */
  toSpace: (spaceId: string, options?: SpaceNavigationOptions) => void;
  /** Navigate to a route within the app by its path. */
  toRoute: (path: string, options?: { resourceId?: string | null }) => void;
  /** Navigate to the app's default route. */
  toApp: () => void;
}

/**
 * Navigation helpers for Spaces and app routes.
 * When rendered inside the portal, uses the runtime.navigate() bridge.
 * Without a portal runtime, falls back to window.location for route navigation.
 *
 * ```tsx
 * const nav = useNotisNavigation();
 * nav.toSpace(spaceId, { recordKey });
 * ```
 */
export function useNotisNavigation(): NavigationActions {
  const runtime = useNotisRuntime();

  const toNamedSpace = useCallback(async (alias: string, options?: SpaceNavigationOptions) => {
    if (runtime?.resource?.kind !== 'space' || !runtime.navigate) throw new Error('Open this Space in a current Notis host to navigate.');
    await runtime.navigate({ kind: 'space-reference', alias, documentId: options?.recordKey ?? null, selection: options?.selection ?? null,
      ...(options?.params ? { params: options.params } : {}) });
  }, [runtime]);

  const toSpace = useCallback((spaceId: string, options?: SpaceNavigationOptions) => {
    if (!runtime?.navigate) throw new Error('Open this Space in a current Notis host to navigate.');
    runtime.navigate({ kind: 'space', spaceId, documentId: options?.recordKey ?? null,
      ...(options?.params ? { params: options.params } : {}), ...(options?.selection ? { selection: options.selection } : {}) });
  }, [runtime]);

  const toRoute = useCallback((path: string, options?: { resourceId?: string | null }) => {
    if (runtime?.navigate) {
      runtime.navigate({ kind: 'route', path, resourceId: options?.resourceId ?? null });
    } else if (typeof window !== 'undefined') {
      const url = new URL(path, window.location.href);
      if (options?.resourceId) url.searchParams.set('resource', options.resourceId);
      else url.searchParams.delete('resource');
      window.location.href = url.toString();
    }
  }, [runtime]);

  const toApp = useCallback(() => {
    if (runtime?.navigate) {
      runtime.navigate({ kind: 'app' });
    }
  }, [runtime]);

  return { toNamedSpace, toSpace, toRoute, toApp };
}
