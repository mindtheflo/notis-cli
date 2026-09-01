'use client';

import { useCallback } from 'react';
import { useNotisRuntime } from '../provider';

interface NavigationActions {
  /** Navigate to a route within the app by its path. */
  toRoute: (path: string, options?: { resourceId?: string | null }) => void;
  /** Navigate to a document detail view. */
  toDocument: (documentId: string, title?: string | null) => void;
  /** Navigate to the app's default route. */
  toApp: () => void;
}

/**
 * Navigation helpers for moving between routes and documents within the app.
 * When rendered inside the portal, uses the runtime.navigate() bridge.
 * Without a portal runtime, falls back to window.location for route navigation.
 *
 * ```tsx
 * const nav = useNotisNavigation();
 * nav.toRoute('/settings');
 * ```
 */
export function useNotisNavigation(): NavigationActions {
  const runtime = useNotisRuntime();

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

  const toDocument = useCallback((documentId: string, title?: string | null) => {
    if (runtime?.navigate) {
      runtime.navigate({ kind: 'document', documentId, title: title ?? undefined });
    }
  }, [runtime]);

  const toApp = useCallback(() => {
    if (runtime?.navigate) {
      runtime.navigate({ kind: 'app' });
    }
  }, [runtime]);

  return { toRoute, toDocument, toApp };
}
