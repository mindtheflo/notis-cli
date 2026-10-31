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
  /**
   * Open an exact Space, optionally at a native record's stable record_key. Resolves once the host has taken the
   * navigation; rejects when the host refuses it (the Space closed, or the view it came from is no longer active).
   */
  toSpace: (spaceId: string, options?: SpaceNavigationOptions) => Promise<void>;
  /** Navigate to a route within the app by its path. */
  toRoute: (path: string, options?: { resourceId?: string | null }) => Promise<void>;
  /** Navigate to the app's default route. */
  toApp: () => Promise<void>;
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
/**
 * A navigation the host refuses (its Manager draft context ended, the Space closed) is reported
 * and returned to the caller, never left as an unhandled rejection: `toRoute` and `toApp` are
 * fire-and-forget in most Spaces (PostHog "This Space context is no longer active." unhandled on
 * app-nightly, 2026-10-30).
 */
function settled(navigate: () => void | Promise<void>): Promise<void> {
  let outcome: Promise<void>;
  try { outcome = Promise.resolve(navigate()); } catch (error) { outcome = Promise.reject(error); }
  outcome.catch((error: unknown) => {
    console.warn('The Notis host refused the navigation.', error instanceof Error ? error.message : error);
  });
  return outcome;
}

export function useNotisNavigation(): NavigationActions {
  const runtime = useNotisRuntime();

  const toNamedSpace = useCallback(async (alias: string, options?: SpaceNavigationOptions) => {
    if (runtime?.resource?.kind !== 'space' || !runtime.navigate) throw new Error('Open this Space in a current Notis host to navigate.');
    await runtime.navigate({ kind: 'space-reference', alias, documentId: options?.recordKey ?? null, selection: options?.selection ?? null,
      ...(options?.params ? { params: options.params } : {}) });
  }, [runtime]);

  const toSpace = useCallback(async (spaceId: string, options?: SpaceNavigationOptions) => {
    if (!runtime?.navigate) throw new Error('Open this Space in a current Notis host to navigate.');
    await runtime.navigate({ kind: 'space', spaceId, documentId: options?.recordKey ?? null,
      ...(options?.params ? { params: options.params } : {}), ...(options?.selection ? { selection: options.selection } : {}) });
  }, [runtime]);

  const toRoute = useCallback((path: string, options?: { resourceId?: string | null }) => {
    if (runtime?.navigate) {
      return settled(() => runtime.navigate!({ kind: 'route', path, resourceId: options?.resourceId ?? null }));
    } else if (typeof window !== 'undefined') {
      const url = new URL(path, window.location.href);
      if (options?.resourceId) url.searchParams.set('resource', options.resourceId);
      else url.searchParams.delete('resource');
      window.location.href = url.toString();
    }
    return Promise.resolve();
  }, [runtime]);

  const toApp = useCallback(() => {
    if (runtime?.navigate) {
      return settled(() => runtime.navigate!({ kind: 'app' }));
    }
    return Promise.resolve();
  }, [runtime]);

  return { toNamedSpace, toSpace, toRoute, toApp };
}
