'use client';

import { useCallback } from 'react';
import { useQuery } from './useQuery';
import { useNotisRuntime } from '../provider';
import type { SpaceItemThread } from '../space';

export interface UseItemThreadResult {
  /** The matched thread, or null while reading or when nothing matches yet. */
  thread: SpaceItemThread | null;
  loading: boolean;
  error: Error | null;
  /**
   * Open the item's thread in the side chat, with an optional unsent draft. When nothing matches yet it
   * opens a new chat with the draft; the first message creates the thread and links it to the item.
   * Resolves false on hosts without a side chat.
   */
  open: (options?: { draft?: string }) => Promise<boolean>;
  /** False on hosts without the resolver (Sites, links, the dev harness): keep the Space's own fallback. */
  available: boolean;
  refresh: () => Promise<Error | null>;
}

const NONE: SpaceItemThread = { thread_id: null, rule: 'best_match', level: null };

/**
 * The thread an item continues, from the Space's thread rule: the same thread the side chat, `useHandover`
 * and the Space's agents use.
 *
 * ```tsx
 * const { thread, open } = useItemThread(recordKey);
 * return <Button onClick={() => void open()}>{thread?.thread_id ? 'Continue the chat' : 'Ask Notis'}</Button>;
 * ```
 *
 * Omit `recordKey` for the Space itself. With the `best_match` rule a record's own thread wins, then the
 * current view with its params, then the view, then the Space; with `space` there is one thread per Space
 * and person.
 */
export function useItemThread(recordKey?: string | null): UseItemThreadResult {
  const runtime = useNotisRuntime();
  const transport = runtime?.resource?.kind === 'space' ? runtime.spaceThreads : undefined;
  const key = typeof recordKey === 'string' && recordKey ? recordKey : null;
  const query = useQuery<SpaceItemThread>(['item-thread', key], async () => {
    if (!transport) return NONE;
    return transport.resolve(key ? { recordKey: key } : undefined);
  }, { readOnly: true, enabled: Boolean(transport), staleTimeMs: 15_000 });
  const open = useCallback(async (options?: { draft?: string }) => {
    if (!transport) return false;
    // Resolve again at the click: another surface may have linked a thread since the last read.
    const thread = await transport.resolve(key ? { recordKey: key } : undefined);
    if (thread.thread_id) return transport.open(thread.thread_id, options);
    if (!runtime?.draftHandover) return false;
    await runtime.draftHandover({ prompt: options?.draft });
    return true;
  }, [key, runtime, transport]);
  return { thread: query.data ?? null, loading: query.loading, error: query.error, open,
    available: Boolean(transport), refresh: query.refetch };
}
