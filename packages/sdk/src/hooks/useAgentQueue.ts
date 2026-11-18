'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useQuery } from './useQuery';
import { useNotisRuntime } from '../provider';
import { pick, w, type Words } from '../words/types';
import type { SpaceAgentQueue } from '../space';

/** What the viewer sees of one agent's latest wake-up. `idle`: nothing woke it yet. */
export type AgentQueueStatus = SpaceAgentQueue['status'];

export const AGENT_QUEUE_WORDS = Object.freeze({
  idle: w('Idle', 'Inactif'),
  queued: w('Queued', 'En file d’attente'),
  working: w('Working', 'En cours'),
  failed: w('Failed', 'Échec'),
  done: w('Done', 'Terminé'),
  openThread: w('Open the conversation', 'Ouvrir la conversation'),
  unavailable: w('Agents are not available here', 'Les agents ne sont pas disponibles ici'),
} satisfies Record<string, Words>);

export interface UseAgentQueueResult {
  status: AgentQueueStatus;
  /** The status in the viewer's language. */
  label: string;
  /** The thread the agent works in for this scope; null until it first woke. */
  threadId: string | null;
  /** Items waiting in the quiet window. */
  pending: number;
  /** Open the agent's thread in the side chat. Resolves false when there is none or the host has no side chat. */
  openThread: () => Promise<boolean>;
  /** The link label in the viewer's language. */
  openLabel: string;
  loading: boolean;
  error: Error | null;
  /** False on hosts without agents (Sites, links, the dev harness). */
  available: boolean;
  refresh: () => Promise<Error | null>;
}

const IDLE: SpaceAgentQueue = { status: 'idle', thread_id: null, pending: 0, updated_at: null };
const ACTIVE_POLL_MS = 4_000;
const IDLE_POLL_MS = 15_000;

function visible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * One declared agent's latest wake-up for the signed-in viewer: Queued (in the 20 second quiet window),
 * Working, Failed or Done, with a link to its thread. A comment wakes its agent with no approval first.
 *
 * ```tsx
 * const queue = useAgentQueue('editor', deckKey);
 * return (
 *   <span>
 *     {queue.label}
 *     {queue.threadId ? <Button onClick={() => void queue.openThread()}>{queue.openLabel}</Button> : null}
 *   </span>
 * );
 * ```
 *
 * `scope` narrows to one item scope (the `Deck` column, or a root comment's key); omit it for the
 * agent's latest wake-up anywhere in the Space. While the page is visible the status is read again every
 * 4 seconds while the agent is queued or working, and every 15 seconds otherwise.
 */
export function useAgentQueue(agentId: string, scope?: string | null): UseAgentQueueResult {
  const runtime = useNotisRuntime();
  const transport = runtime?.resource?.kind === 'space' ? runtime.spaceThreads : undefined;
  const locale = runtime?.context?.locale === 'fr' ? 'fr' : 'en';
  const scopeKey = typeof scope === 'string' && scope ? scope : null;
  const query = useQuery<SpaceAgentQueue>(['agent-queue', agentId, scopeKey], async () => {
    if (!transport) return IDLE;
    const status = await transport.agentStatus(agentId, scopeKey ?? undefined);
    return status.queue ? { ...IDLE, ...status.queue } : IDLE;
  }, { readOnly: true, enabled: Boolean(transport) && Boolean(agentId), staleTimeMs: 2_000 });
  const queue = query.data ?? IDLE;
  const active = queue.status === 'queued' || queue.status === 'working' || queue.pending > 0;
  const refetch = query.refetch;
  // A read still on its way is never replaced by the next tick: a refetch drops the read in flight, so a status read
  // slower than the 4 second tick (a busy account) never landed and the label kept its first answer for good.
  const fetching = useRef(false);
  fetching.current = query.isFetching;
  // An interval, not a timeout keyed on the answer: a run reads the same "working" for minutes, and a
  // timeout that waits for a changed answer stopped after one read and left "Working" on screen. While
  // idle it still reads now and then, so a comment (yours or someone else's) shows "Queued" without a reload.
  useEffect(() => {
    if (!transport) return undefined;
    let reading = false;
    const timer = setInterval(() => {
      if (!visible() || reading || fetching.current) return;
      reading = true;
      void refetch().finally(() => { reading = false; });
    }, active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [active, refetch, transport]);
  const openThread = useCallback(async () => {
    if (!transport || !queue.thread_id) return false;
    return transport.open(queue.thread_id);
  }, [queue.thread_id, transport]);
  return {
    status: queue.status,
    // A status this SDK has no word for (an older API's 'waiting', or none) reads as idle, never a crash.
    label: pick(transport ? (AGENT_QUEUE_WORDS[queue.status] ?? AGENT_QUEUE_WORDS.idle) : AGENT_QUEUE_WORDS.unavailable, locale),
    threadId: queue.thread_id,
    pending: queue.pending,
    openThread,
    openLabel: pick(AGENT_QUEUE_WORDS.openThread, locale),
    loading: query.loading,
    error: query.error,
    available: Boolean(transport),
    refresh: refetch,
  };
}
