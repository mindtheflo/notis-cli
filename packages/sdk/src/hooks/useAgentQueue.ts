'use client';

import { useCallback, useEffect } from 'react';
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
  waiting: w('Waiting for you', 'Attend ta réponse'),
  failed: w('Failed', 'Échec'),
  done: w('Done', 'Terminé'),
  approvalRequired: w('Allow this agent to answer your comments', 'Autorise cet agent à répondre à tes commentaires'),
  approve: w('Allow', 'Autoriser'),
  openThread: w('Open the conversation', 'Ouvrir la conversation'),
  unavailable: w('Agents are not available here', 'Les agents ne sont pas disponibles ici'),
} satisfies Record<string, Words>);

export interface UseAgentQueueResult {
  status: AgentQueueStatus;
  /** The status in the viewer's language. */
  label: string;
  /** The thread the agent works in for this scope; null until it first woke. */
  threadId: string | null;
  /** Items waiting in the quiet window (or for approval). */
  pending: number;
  /** True until the viewer allows this version's agents; offer `approve()`. */
  approvalRequired: boolean;
  /** Ask the viewer's permission for this Space version's agents. Held comments then wake their thread. */
  approve: () => Promise<boolean>;
  /** Open the agent's thread in the side chat. Resolves false when there is none or the host has no side chat. */
  openThread: () => Promise<boolean>;
  /** The link label in the viewer's language. */
  openLabel: string;
  /** Why to allow (`approvalRequired`) and the Allow button, in the viewer's language. */
  approvalLabel: string;
  approveLabel: string;
  loading: boolean;
  error: Error | null;
  /** False on hosts without agents (Sites, links, the dev harness). */
  available: boolean;
  refresh: () => Promise<Error | null>;
}

const IDLE: SpaceAgentQueue = { status: 'idle', thread_id: null, pending: 0, approval_required: false, updated_at: null };
const ACTIVE_POLL_MS = 4_000;
const IDLE_POLL_MS = 15_000;

function visible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * One declared agent's latest wake-up for the signed-in viewer: Queued (in the 20 second quiet window),
 * Working, Waiting for you, Failed or Done, with a link to its thread.
 *
 * ```tsx
 * const queue = useAgentQueue('editor', deckKey);
 * return (
 *   <span>
 *     {queue.label}
 *     {queue.approvalRequired ? <Button onClick={() => void queue.approve()}>{queue.approveLabel}</Button> : null}
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
    return status.queue ? { ...IDLE, ...status.queue } : { ...IDLE, approval_required: !status.approved };
  }, { readOnly: true, enabled: Boolean(transport) && Boolean(agentId), staleTimeMs: 2_000 });
  const queue = query.data ?? IDLE;
  const active = queue.status === 'queued' || queue.status === 'working' || queue.pending > 0;
  const refetch = query.refetch;
  // An interval, not a timeout keyed on the answer: a run reads the same "working" for minutes, and a
  // timeout that waits for a changed answer stopped after one read and left "Working" on screen. While
  // idle it still reads now and then, so a comment (yours or someone else's) shows "Queued" without a reload.
  useEffect(() => {
    if (!transport) return undefined;
    const timer = setInterval(() => { if (visible()) void refetch(); }, active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [active, refetch, transport]);
  const approve = useCallback(async () => {
    if (!transport) return false;
    const result = await transport.approveAgents();
    await refetch();
    return result.approved === true;
  }, [refetch, transport]);
  const openThread = useCallback(async () => {
    if (!transport || !queue.thread_id) return false;
    return transport.open(queue.thread_id);
  }, [queue.thread_id, transport]);
  return {
    status: queue.status,
    label: pick(transport ? AGENT_QUEUE_WORDS[queue.status] : AGENT_QUEUE_WORDS.unavailable, locale),
    threadId: queue.thread_id,
    pending: queue.pending,
    approvalRequired: queue.approval_required,
    approve,
    openThread,
    openLabel: pick(AGENT_QUEUE_WORDS.openThread, locale),
    approvalLabel: pick(AGENT_QUEUE_WORDS.approvalRequired, locale),
    approveLabel: pick(AGENT_QUEUE_WORDS.approve, locale),
    loading: query.loading,
    error: query.error,
    available: Boolean(transport),
    refresh: refetch,
  };
}
