/**
 * Comment drafts kept for the session: the text of a new comment, a reply or an answer, its
 * attached files (the pane's own chips, or the files the host's composer holds) and where a new comment goes. A comment box unmounts whenever the page's comments leave the host panel
 * (another Space opens, a record page covers the view, a brief replaces the deck); what was typed comes back when the
 * box shows again. Keys name the Space, the comments table and page (`draftScope`) and the box (a thread's reply, the
 * new comment, an ask's answer). A send that saves, Cancel, and Escape on an empty box forget their draft.
 *
 * The store sits on `globalThis`, so two copies of the SDK in one page (two Space bundles) share it.
 *
 * In memory unless the host gives a place to keep them (`keepCommentDraftsIn`, the Portal's per-person draft storage):
 * then the text, where a new comment goes and who it goes to also survive a reload of the browser, as a chat draft
 * does. Files are never stored: a file's bytes stay in the page that picked it. The place is shared by every tab of
 * the person: a tab writes only the drafts it changed, so a draft being written in another tab stays.
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
  /** The files the host's own composer holds for this box (`useHostComposer`): not uploaded yet, they go up on Send. */
  hostFiles?: readonly File[];
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

/** Where the host keeps the drafts between page loads: one string under one key (`Storage`'s shape). */
export interface CommentDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEPT_KEY = 'notis:comment-drafts:v1';
const SAVE_DELAY_MS = 250;
let kept: CommentDraftStorage | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * The drafts this page changed since it last wrote: only those are written, the others stay as the place has them.
 * Shared like the store itself, so a draft changed by another copy of the SDK in the page is written too.
 */
const CHANGED_KEY = Symbol.for('notis.sdk.commentDrafts.changed');
const changed: Set<string> = ((globalThis as unknown as Record<symbol, Set<string> | undefined>)[CHANGED_KEY] ??= new Set());

type KeptRow = { text?: string; place?: unknown };

/** What the host's place holds now, oldest first. */
function keptRows(storage: CommentDraftStorage): Map<string, KeptRow> {
  const rows = new Map<string, KeptRow>();
  let raw: unknown = null;
  try { raw = JSON.parse(storage.getItem(KEPT_KEY) || '[]'); } catch { raw = null; }
  if (!Array.isArray(raw)) return rows;
  for (const row of raw) {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[1] || typeof row[1] !== 'object') continue;
    const value = row[1] as { text?: unknown; place?: unknown };
    rows.set(row[0], { ...(typeof value.text === 'string' ? { text: value.text } : {}),
      ...(value.place != null ? { place: value.place } : {}) });
  }
  return rows;
}

/** What of a draft is stored: its text and its place, never its files. */
function storable(draft: StoredCommentDraft): KeptRow | null {
  const text = draft.text ?? '';
  if (!text.trim() && draft.place == null) return null;
  return { ...(text ? { text } : {}), ...(draft.place != null ? { place: draft.place } : {}) };
}

/** Writes the drafts to the host's storage now (the page is going away). */
export function flushCommentDrafts(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!kept || !changed.size) return;
  // Another tab of the same person writes to the same place: its drafts are read again and kept, and only what this
  // page changed (written, sent or cancelled) is set or removed.
  const rows = keptRows(kept);
  const drafts = store();
  for (const key of changed) {
    const draft = drafts.get(key);
    const row = draft ? storable(draft) : null;
    rows.delete(key);
    if (row) rows.set(key, row);
  }
  changed.clear();
  while (rows.size > LIMIT) rows.delete(rows.keys().next().value as string);
  try {
    if (rows.size) kept.setItem(KEPT_KEY, JSON.stringify([...rows]));
    else kept.removeItem(KEPT_KEY);
  } catch { /* Storage full or refused: the drafts stay for this page. */ }
}

function save(): void {
  if (!kept || saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; flushCommentDrafts(); }, SAVE_DELAY_MS);
}

/**
 * The host gives the drafts a place between page loads (null: in memory only, and the drafts of the person before
 * are forgotten). What the storage holds comes back at once; a draft this page already holds wins over a stored one.
 */
export function keepCommentDraftsIn(storage: CommentDraftStorage | null): void {
  if (kept === storage) return;
  if (kept) flushCommentDrafts();
  const before = kept;
  kept = storage;
  changed.clear();
  const drafts = store();
  // Another person's drafts never show for this one.
  if (before) drafts.clear();
  if (!storage) return;
  const here = [...drafts];
  drafts.clear();
  for (const [key, row] of keptRows(storage)) drafts.set(key, row);
  // What this page held before it was given the place is written there with the next change.
  for (const [key, draft] of here) { drafts.delete(key); drafts.set(key, draft); changed.add(key); }
  while (drafts.size > LIMIT) drafts.delete(drafts.keys().next().value as string);
}

/** True when a draft holds something worth bringing back. */
export function hasDraftContent(draft: StoredCommentDraft | undefined): boolean {
  return Boolean(draft && ((draft.text ?? '').trim() || draft.files?.length || draft.hostFiles?.length));
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
  changed.add(key);
  save();
  if (!hasDraftContent(next) && next.place == null) return;
  drafts.set(key, next);
  while (drafts.size > LIMIT) drafts.delete(drafts.keys().next().value as string);
}

export function forgetCommentDraft(key: string | null | undefined): void {
  if (key && store().delete(key)) { changed.add(key); save(); }
}

/** Forgets every draft (tests). */
export function clearCommentDrafts(): void {
  for (const key of store().keys()) changed.add(key);
  store().clear();
  save();
}

/** The files the host's composer held in the box at `key` when it went away, to attach again. */
export function readHostDraftFiles(key: string | null | undefined): readonly File[] {
  return readCommentDraft(key)?.hostFiles ?? NO_HOST_FILES;
}
const NO_HOST_FILES: readonly File[] = Object.freeze([]);

/** Keeps the files the host's composer holds in the box at `key`; none forgets them (sent, removed, dropped). */
export function writeHostDraftFiles(key: string | null | undefined, files: readonly File[]): void {
  writeCommentDraft(key, { hostFiles: files.length ? [...files] : undefined });
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
