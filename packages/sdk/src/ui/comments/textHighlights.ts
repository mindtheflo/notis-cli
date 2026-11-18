/**
 * Which text comments of the page lost their words: the passage highlighter every Space page draws
 * (`SpaceTextComments`) reports them here, and a thread card on such a comment reads Passage changed (the thread stays
 * open with its old quote). One store per window, keyed by comment id.
 */

import { useSyncExternalStore } from 'react';

let changed: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

/** Sets the text comments whose words are gone (replaces the earlier set). */
export function setChangedPassages(ids: Iterable<string>): void {
  const next = new Set(ids);
  if (next.size === changed.size && [...next].every(id => changed.has(id))) return;
  changed = next;
  for (const listener of [...listeners]) listener();
}

/** The text comments whose words are gone, as last reported. */
export function changedPassages(): ReadonlySet<string> {
  return changed;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Whether this text comment's words are gone from the page (re-renders when that changes). */
export function usePassageChanged(id: string | null | undefined): boolean {
  return useSyncExternalStore(subscribe, () => Boolean(id) && changed.has(id!), () => false);
}
