/**
 * Handing what a page's comments show from one mounted view to the view that takes its place.
 *
 * When a Space is published again the host mounts the new version beside the one on screen and swaps the two once the
 * new one is ready. Comments do not depend on the page's version, so the reader's selected thread, filters, the new
 * comment being placed and who it goes to must not go back to their defaults at the swap. That state is plain React
 * state inside each view (`useComments`, `useCommentRouting`, `usePassageComments`, the pane's own key), so the host
 * names each view with a token on its comments transport (`SpaceCommentsTransport.viewToken`) and, at the swap, calls
 * `handOverCommentState(old, next)`: every hook of the new view takes the state of the hook with the same id in the
 * old one. Hooks that mount a moment later (the host's own pane) take it as their first state, for a few seconds.
 *
 * Nothing here runs without a token: a pane on a host that names no view keeps its state to itself, as before.
 */

import { useEffect, useRef, useState } from 'react';
import { useNotisRuntime } from '../../provider';

interface Member { take(): unknown; give(state: unknown): void }

const members = new WeakMap<object, Map<string, Set<Member>>>();
const inherited = new WeakMap<object, { at: number; states: Map<string, unknown> }>();

/** How long a hook that mounts after the swap still takes the old view's state as its own first state. */
export const COMMENT_HANDOVER_CLAIM_MS = 10_000;

/** Copies the comment state of the view named `from` to the view named `to` (see the file's note). */
export function handOverCommentState(from: object, to: object): void {
  const states = new Map<string, unknown>();
  for (const [id, set] of members.get(from) ?? []) {
    const first = set.values().next().value as Member | undefined;
    if (!first) continue;
    try { states.set(id, first.take()); } catch (error) { console.warn('[comments] handover read failed', error); }
  }
  inherited.set(to, { at: Date.now(), states });
  for (const [id, set] of members.get(to) ?? []) {
    if (!states.has(id)) continue;
    for (const member of [...set]) {
      try { member.give(states.get(id)); } catch (error) { console.warn('[comments] handover failed', error); }
    }
  }
}

/** The state handed to the view named `group` under `id` a moment ago, for a hook's first state; else undefined. */
export function inheritedCommentState<S>(group: object | null | undefined, id: string | null | undefined): S | undefined {
  if (!group || !id) return undefined;
  const kept = inherited.get(group);
  if (!kept || Date.now() - kept.at > COMMENT_HANDOVER_CLAIM_MS) return undefined;
  return kept.states.get(id) as S | undefined;
}

/**
 * Lists the calling hook under `id` in the view named `group` while it is mounted: `take` reads its state for the
 * view that replaces this one, `give` receives the state of the view this one replaces.
 */
export function useCommentHandover<S>(group: object | null | undefined, id: string | null | undefined,
  take: () => S, give: (state: S) => void): void {
  const latest = useRef({ take, give });
  latest.current = { take, give };
  useEffect(() => {
    if (!group || !id) return undefined;
    const member: Member = { take: () => latest.current.take(), give: state => latest.current.give(state as S) };
    let byId = members.get(group);
    if (!byId) { byId = new Map(); members.set(group, byId); }
    let set = byId.get(id);
    if (!set) { set = new Set(); byId.set(id, set); }
    set.add(member);
    return () => {
      set.delete(member);
      if (!set.size) byId.delete(id);
    };
  }, [group, id]);
}

/** The token the host names the calling view with (`SpaceCommentsTransport.viewToken`), or null. */
export function useCommentViewToken(): object | null {
  return useNotisRuntime()?.spaceComments?.viewToken ?? null;
}

let paneSeq = 0;

/**
 * The key the host draws a pane under (`usePaneOutlet`): its own, or the key of the pane it replaces when a new
 * version of the view took the old one's place, so React keeps the pane's elements. `kind` tells a pane on pins from
 * a pane on passages.
 */
export function useHandedPaneKey(controller: { draftScope: string }, kind: string): string {
  const group = useCommentViewToken();
  const id = `pane\u0000${kind}\u0000${controller.draftScope}`;
  const [key, setKey] = useState(() => inheritedCommentState<string>(group, id) ?? `pane-${paneSeq += 1}`);
  useCommentHandover<string>(group, id, () => key, setKey);
  return key;
}
