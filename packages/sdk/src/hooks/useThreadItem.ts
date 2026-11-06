'use client';

import { useCallback, useEffect } from 'react';
import { useQuery } from './useQuery';
import { useNotisRuntime } from '../provider';
import type { SpaceThreadItem, SpaceThreadItemRun } from '../space';

export interface UseThreadItemResult {
  /** The attached item this page draws, or null while reading or when the page is not opened for one. */
  item: SpaceThreadItem | null;
  loading: boolean;
  error: Error | null;
  /**
   * Run one of the item's actions (its `actions[].id`). Notis asks the person first when the action
   * confirms, then reads the item again; `ran` is false when they cancelled. Resolves `{ ran: false }`
   * on hosts that cannot run actions.
   */
  run: (actionId: string) => Promise<SpaceThreadItemRun>;
  /** False outside a thread's panel and on hosts without thread items (Sites, links, the dev harness). */
  available: boolean;
  refresh: () => Promise<Error | null>;
}

/**
 * The live item (a pull request, an order) a thread's panel shows on this page, from the view's
 * `threadItems` declaration. Notis keeps it fresh; the page reads it again about every minute.
 *
 * ```tsx
 * const { item, run } = useThreadItem();
 * if (!item) return null;
 * return <>{item.title} {item.actions.map(action =>
 *   <Button key={action.id} onClick={() => void run(action.id)}>{text(action.label)}</Button>)}</>;
 * ```
 */
export function useThreadItem(): UseThreadItemResult {
  const runtime = useNotisRuntime();
  const transport = runtime?.resource?.kind === 'space' ? runtime.spaceThreadItem : undefined;
  const query = useQuery<SpaceThreadItem | null>(['thread-item'], async () => (transport ? transport.current() : null),
    { readOnly: true, enabled: Boolean(transport), staleTimeMs: 30_000 });
  const { refetch } = query;
  // The panel's host reads the item again about every minute while the thread is open (SPC-098).
  useEffect(() => {
    if (!transport) return undefined;
    const timer = setInterval(() => { void refetch(); }, 60_000);
    return () => clearInterval(timer);
  }, [refetch, transport]);
  const run = useCallback(async (actionId: string): Promise<SpaceThreadItemRun> => {
    const item = query.data;
    if (!transport || !item) return { ran: false };
    const result = await transport.run(item.id, actionId);
    if (result.ran) await refetch();
    return result;
  }, [query.data, refetch, transport]);
  return { item: query.data ?? null, loading: query.loading, error: query.error, run,
    available: Boolean(transport), refresh: query.refetch };
}
