'use client';

import { useCallback, useState } from 'react';
import { useQuery } from './useQuery';
import { useNotisRuntime } from '../provider';
import { queryKey } from '../queryCache';
import { SPACE_TOOLKIT_SLUG, spaceQueryKey, type SpaceConnection } from '../space';
import type { NotisRuntime } from '../runtime';

/** Cache key of one toolkit's read; every mounted `useConnection(toolkit)` reads again after a connect. */
export function connectionQueryKey(toolkit: string) {
  return ['connection', toolkit] as const;
}

/** Marks a toolkit's read stale in the host cache, so every mounted `useConnection` of it reads again. */
export function invalidateConnection(runtime: NotisRuntime | null, toolkit: string): void {
  try {
    runtime?.queryClient?.invalidate(queryKey(spaceQueryKey(runtime, connectionQueryKey(toolkit))));
  } catch {
    // A host without a Space access context has no shared cache to refresh.
  }
}

export interface UseConnectionResult {
  /** False where the host cannot answer (Sites, shared links, verification, previews offline, older hosts). */
  available: boolean;
  /** The viewer's own account in this app works now. */
  connected: boolean;
  /** The GitHub login for GitHub, else the name the person gave the account, else null. */
  account: string | null;
  /** The newest account's state (`ACTIVE`, `EXPIRED`, `FAILED`...), null when there is none or while loading. */
  status: string | null;
  loading: boolean;
  /** The connect window is open and the host is waiting for the account to work. */
  connecting: boolean;
  error: Error | null;
  /**
   * Opens the Portal's connect flow for this app (a sign-in window on the web, the browser in Desktop). Call it from
   * the person's own click: the host refuses a call no click started. Resolves true once the account works, false
   * when the person closed the window or it timed out, and rejects with a message to show when the host refused.
   */
  connect: () => Promise<boolean>;
  /** Read again. */
  refresh: () => Promise<void>;
}

const unavailable = (toolkit: string): SpaceConnection =>
  ({ toolkit, available: false, connected: false, account: null, status: null });

/**
 * The signed-in viewer's own account in one connected app, and a button's way to connect it.
 *
 * ```tsx
 * const github = useConnection('github');
 * if (!github.available) return <OpenInNotis />;
 * return github.connected
 *   ? <p>GitHub: {github.account}</p>
 *   : <Button onClick={() => github.connect()} disabled={github.connecting}>Connect GitHub</Button>;
 * ```
 *
 * Needs no declaration: it reads only the viewer's own account and never a credential. On a Site, a shared link, in
 * verification and in the vite preview it answers `available: false`; keep a fallback (a link to Integrations).
 */
export function useConnection(toolkit: string): UseConnectionResult {
  const runtime = useNotisRuntime();
  const slug = typeof toolkit === 'string' ? toolkit.trim().toLowerCase() : '';
  const valid = SPACE_TOOLKIT_SLUG.test(slug);
  const transport = valid ? runtime?.spaceConnections : undefined;
  const [connecting, setConnecting] = useState(false);
  const query = useQuery<SpaceConnection>(connectionQueryKey(slug), async () => (
    transport ? transport.read(slug) : unavailable(slug)
  ), { readOnly: true, staleTimeMs: 30_000 });

  const connect = useCallback(async () => {
    if (!transport) throw new Error('Connect this app from the Space in Notis.');
    setConnecting(true);
    try {
      // Called before anything awaits: the host opens its window inside the person's click.
      const after = await transport.connect(slug);
      invalidateConnection(runtime, slug);
      await query.refetch();
      return after.connected;
    } finally {
      setConnecting(false);
    }
  }, [query.refetch, runtime, slug, transport]);

  const refresh = useCallback(async () => { await query.refetch(); }, [query.refetch]);
  const data = query.data ?? (!transport ? unavailable(slug) : null);
  return {
    // A read that failed keeps the hook available: `error` says why, and `refresh` or `connect` still work.
    available: Boolean(transport) && data?.available !== false,
    connected: data?.connected === true,
    account: data?.account ?? null,
    status: data?.status ?? null,
    loading: query.loading,
    connecting,
    error: query.error,
    connect,
    refresh,
  };
}
