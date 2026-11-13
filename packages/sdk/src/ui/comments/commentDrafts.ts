/**
 * Comment drafts kept for the session (in memory, never stored): the text of a new comment, a reply or an answer, its
 * attached files and where a new comment goes. A comment box unmounts whenever the page's comments leave the host panel
 * (another Space opens, a record page covers the view, a brief replaces the deck); what was typed comes back when the
 * box shows again. Keys name the Space, the comments table and page (`draftScope`) and the box (a thread's reply, the
 * new comment, an ask's answer). A send that saves, Cancel, and Escape on an empty box forget their draft.
 *
 * The store sits on `globalThis`, so two copies of the SDK in one page (two Space bundles) share it.
 */

import { useCallback, useState } from 'react';

/** A file attached to a draft: kept whole, so a picture's preview and an upload cut short can start again. */
export interface StoredCommentFile {
  name: string;
  file: File;
  state: 'uploading' | 'ready' | 'failed';
  uploaded: unknown;
  error: string | null;
  retryable: boolean;
}

export interface StoredCommentDraft {
  text?: string;
  files?: readonly StoredCommentFile[];
  /** Where a new comment goes (its pin, a passage): kept only while the draft has text or files. */
  place?: unknown;
}

/** Drafts kept at most; the oldest goes first. */
const LIMIT = 200;
const STORE_KEY = Symbol.for('notis.sdk.commentDrafts');

function store(): Map<string, StoredCommentDraft> {
  const holder = globalThis as unknown as Record<symbol, Map<string, StoredCommentDraft> | undefined>;
  return holder[STORE_KEY] ??= new Map();
}

/** True when a draft holds something worth bringing back. */
export function hasDraftContent(draft: StoredCommentDraft | undefined): boolean {
  return Boolean(draft && ((draft.text ?? '').trim() || draft.files?.length));
}

export function readCommentDraft(key: string | null | undefined): StoredCommentDraft | undefined {
  return key ? store().get(key) : undefined;
}

/** Merges `change` into the draft at `key`; a draft left with nothing in it is forgotten. */
export function writeCommentDraft(key: string | null | undefined, change: Partial<StoredCommentDraft>): void {
  if (!key) return;
  const drafts = store();
  const next = { ...drafts.get(key), ...change };
  drafts.delete(key);
  if (!hasDraftContent(next) && next.place == null) return;
  drafts.set(key, next);
  while (drafts.size > LIMIT) drafts.delete(drafts.keys().next().value as string);
}

export function forgetCommentDraft(key: string | null | undefined): void {
  if (key) store().delete(key);
}

/** Forgets every draft (tests). */
export function clearCommentDrafts(): void {
  store().clear();
}

/** The draft key of one box under a controller's `draftScope`, or null when the controller keeps no drafts. */
export function commentDraftKey(scope: string | null | undefined, box: string): string | null {
  return scope ? `${scope}\u0000${box}` : null;
}

/**
 * The text of a comment box, kept in the session store under `key` (null: kept in the box only). It comes back when
 * the box mounts again, and follows `key` when the box moves to another draft.
 */
export function useCommentDraftText(key: string | null): [string, (value: string) => void] {
  const [state, setState] = useState(() => ({ key, text: readCommentDraft(key)?.text ?? '' }));
  let current = state;
  if (state.key !== key) {
    current = { key, text: readCommentDraft(key)?.text ?? '' };
    setState(current);
  }
  const set = useCallback((text: string) => {
    setState(before => ({ key: before.key, text }));
    writeCommentDraft(key, { text });
  }, [key]);
  return [current.text, set];
}
