/**
 * The controller for comments on passages of a record's text: a `useComments` controller (reading, live feed,
 * replies, Archive, Delete, Edit, where a thread goes) plus where each thread sits (its field and quoted words), the
 * comment being written on a selection, which threads read Passage changed (their words are gone; they stay open with
 * the old quote), and the reading order. `CommentableText`, `CommentableRichText` and `PassageCommentPane` render from
 * it. Its modes default to text (a selection) and the whole page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNativeMutation } from '../../hooks/useNativeDocuments';
import { useShown } from '../../hooks/useViewParams';
import { commentDraftKey, forgetCommentDraft, hasDraftContent, readCommentDraft, writeCommentDraft } from './commentDrafts';
import { commentColumns, commentRowsOf, newCommentId, type CommentThread } from './commentModel';
import { useCommentFocusParam } from './hostComments';
import { useComments, type CommentController, type CommentFile, type UseCommentsOptions } from './useComments';
import {
  passageColumns, passageOffset, passageProperties, readPassage, type PassageAnchor, type PassageColumns, type PassageField,
} from './passageModel';

/** Where a thread was opened: its highlight in the text, its card or its quote in the pane, or a link to one comment. */
export type PassageOpenedFrom = 'passage' | 'pane' | 'quote' | 'link';

export interface UsePassageCommentsOptions extends Omit<UseCommentsOptions, 'anchors' | 'anchorKey' | 'onSelectThread'> {
  /** The text properties comments can sit on, in reading order. */
  fields: readonly PassageField[];
  /** Column names of the passage (Field, Quote, Prefix, Suffix by default). */
  passageColumns?: Partial<PassageColumns>;
  /**
   * Each field's value as edited on screen, by field key: a thread whose words are no longer there reads Text
   * changed, and threads list in reading order. A field left out is never marked changed.
   */
  values?: Readonly<Record<string, string>>;
  /** The group of fields on screen (a language). Null: every field. */
  group?: string | null;
  /** A thread was opened. Show its field (switch to its group, open the pane) before its passage flashes. */
  onOpen?(thread: CommentThread, passage: PassageAnchor | undefined, from: PassageOpenedFrom): void;
  /** A selection started a new comment: show the pane, which holds its box. */
  onDraft?(passage: PassageAnchor): void;
  /**
   * Open the thread of this comment (a root or a reply) once it is read: a link to one comment. Default: the
   * `comment` view param (`useCommentFocusParam`); null turns that off.
   */
  focusKey?: string | null;
}

export interface PassageCommentController {
  /** The underlying comment controller: thread cards, Archive, Delete, Edit, the status filter, routing and the toast. */
  controller: CommentController;
  fields: readonly PassageField[];
  field(key: string): PassageField | undefined;
  /** The passage a thread's first comment sits on; undefined for a comment on the whole record. */
  passageOf(rootKey: string): PassageAnchor | undefined;
  group: string | null;
  /** Threads of a group (default: the group on screen; null: all), open ones first, each in reading order. */
  threads(group?: string | null): CommentThread[];
  /** Threads on one field, in reading order. */
  threadsOn(field: string): CommentThread[];
  /** Open threads of a group (default: the group on screen; null: all). */
  openCount(group?: string | null): number;
  /** Whether a thread's quoted words are gone from its field. */
  isChanged(rootKey: string): boolean;
  /** The comment being written on a selection. */
  draft: PassageAnchor | null;
  /** The comment being placed or written on the page (the New comment menu): the same as `controller.draftPin`. */
  draftPin: CommentController['draftPin'];
  startDraft(passage: PassageAnchor): void;
  cancelDraft(): void;
  /**
   * Saves the draft with its text and the pictures and files attached to it (SPC-131: paste, drop or the paperclip),
   * either one enough. True once saved; its thread is then selected.
   */
  send(body: string, files?: readonly CommentFile[]): Promise<boolean>;
  sending: boolean;
  /** The last send failed. */
  failed: boolean;
  /** The thread whose passage flashes, whether to scroll to it, and a count that changes on each flash. */
  flash: { key: string; scroll: boolean; n: number } | null;
  /**
   * Opens a thread: its passage flashes and the pane selects it. From the page ('passage': a highlight or a field's
   * Comment count) or a link ('link') it is a reveal: `revealRequest` goes up by one and the host shows its Comments
   * panel (C8). From the pane ('pane', 'quote') the panel stays as it is.
   */
  open(thread: CommentThread, from: PassageOpenedFrom): void;
  openKey(rootKey: string, from: PassageOpenedFrom): void;
  /** Starts at 0 and goes up by one on each comment picked on the page: the same number as `controller.revealRequest`. */
  revealRequest: number;
  /** Rich text on screen reports which passages it shows: Text changed then follows what is rendered. */
  reportFound(field: string, keys: ReadonlySet<string> | null): void;
}

const NO_FIELDS: readonly PassageField[] = Object.freeze([]);
const PASSAGE_MODES = Object.freeze(['text', 'page'] as const);

export function usePassageComments(options: UsePassageCommentsOptions): PassageCommentController {
  const { fields = NO_FIELDS, values, group = null, list = 'comments', database = 'comments', pageSize = 500 } = options;
  const urlFocus = useCommentFocusParam();
  const focusKey = options.focusKey === undefined ? urlFocus : options.focusKey;
  const columns = useMemo(() => passageColumns(options.passageColumns), [options.passageColumns]);
  const baseColumns = useMemo(() => commentColumns(options.columns), [options.columns]);
  const latest = useRef(options);
  latest.current = options;

  const query = useShown<Record<string, unknown>>(list, { pageSize });
  const insert = useNativeMutation(database, 'insert');
  const passages = useMemo(() => {
    const map = new Map<string, PassageAnchor>();
    for (const row of commentRowsOf(query.data)) {
      const passage = readPassage(row, fields, columns);
      const key = typeof row.record_key === 'string' ? row.record_key : '';
      if (passage && key) map.set(key, passage);
    }
    return map;
  }, [query.data, fields, columns]);
  const passagesRef = useRef(passages);
  passagesRef.current = passages;
  const fieldIndex = useMemo(() => new Map(fields.map((item, index) => [item.key, index])), [fields]);
  const field = useCallback((key: string) => fields.find(item => item.key === key), [fields]);

  const [flash, setFlash] = useState<PassageCommentController['flash']>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const openedFrom = useRef<PassageOpenedFrom>('pane');

  const controller = useComments({
    ...options,
    anchors: undefined,
    anchorKey: null,
    // This controller opens a linked comment itself, with its passage flash.
    focusKey: null,
    modes: options.modes ?? PASSAGE_MODES,
    onSelectThread: (thread) => {
      const passage = passagesRef.current.get(thread.root.recordKey);
      const from = openedFrom.current;
      openedFrom.current = 'pane';
      latest.current.onOpen?.(thread, passage, from);
      if (timer.current) clearTimeout(timer.current);
      setFlash(current => ({ key: thread.root.recordKey, scroll: from !== 'passage', n: (current?.n ?? 0) + 1 }));
      timer.current = setTimeout(() => setFlash(null), 1600);
    },
  });

  // What rich text on screen shows, by field: it wins over the value for Text changed.
  const [found, setFound] = useState<Readonly<Record<string, ReadonlySet<string>>>>({});
  const reportFound = useCallback((key: string, keys: ReadonlySet<string> | null) => {
    setFound(current => {
      const previous = current[key];
      if (!keys) {
        if (!previous) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      if (previous && previous.size === keys.size && [...keys].every(item => previous.has(item))) return current;
      return { ...current, [key]: new Set(keys) };
    });
  }, []);

  // Reading position and Text changed of every passage, from the values on screen.
  const placement = useMemo(() => {
    const changed = new Set<string>();
    const rank = new Map<string, number>();
    for (const [key, passage] of passages) {
      const index = fieldIndex.get(passage.field) ?? fields.length;
      const value = values?.[passage.field];
      const shown = found[passage.field];
      const at = value == null ? 0 : passageOffset(value, passage, field(passage.field)?.markdown);
      const gone = shown ? !shown.has(key) : value != null && at == null;
      if (gone) changed.add(key);
      rank.set(key, (gone ? fields.length + 1 : 0) + index + Math.min(at ?? 0, 999999) / 1000000);
    }
    return { changed, rank };
  }, [passages, fieldIndex, fields.length, values, found, field]);

  const inGroup = useCallback((thread: CommentThread, wanted: string | null) => {
    if (wanted == null) return true;
    const passage = passages.get(thread.root.recordKey);
    if (!passage) return true;
    return (field(passage.field)?.group ?? null) === wanted;
  }, [passages, field]);
  const ordered = useCallback((list: CommentThread[]) => {
    const rankOf = (thread: CommentThread) => placement.rank.get(thread.root.recordKey) ?? -1;
    const sorted = [...list].sort((a, b) => rankOf(a) - rankOf(b));
    return [...sorted.filter(thread => thread.root.status !== 'Resolved'), ...sorted.filter(thread => thread.root.status === 'Resolved')];
  }, [placement]);
  const threads = useCallback((wanted?: string | null) => {
    const target = wanted === undefined ? group : wanted;
    return ordered(controller.threads.filter(thread => inGroup(thread, target)));
  }, [controller.threads, group, inGroup, ordered]);
  const threadsOn = useCallback((key: string) => ordered(controller.threads.filter(thread =>
    passages.get(thread.root.recordKey)?.field === key)), [controller.threads, passages, ordered]);
  const openCount = useCallback((wanted?: string | null) =>
    threads(wanted).filter(thread => thread.root.status === 'Open').length, [threads]);

  // A new comment on a selection, saved with its passage.
  // A comment being written on a passage outlives the pane, like a new comment's pin: the passage comes back while its
  // box kept text (`commentDrafts`).
  const draftKey = commentDraftKey(controller.draftScope, 'passage');
  const restoredPassage = (key: string | null): PassageAnchor | null => {
    const stored = readCommentDraft(key);
    return hasDraftContent(stored) && stored?.place ? stored.place as PassageAnchor : null;
  };
  const [draft, setDraft] = useState<PassageAnchor | null>(() => restoredPassage(draftKey));
  const passageKeyRef = useRef(draftKey);
  useEffect(() => {
    if (passageKeyRef.current !== draftKey) {
      // Another page (record A to B while mounted): its own passage comes back, if one was left there, and A's passage
      // is never saved under B's key.
      passageKeyRef.current = draftKey;
      setDraft(restoredPassage(draftKey));
      return;
    }
    writeCommentDraft(draftKey, { place: draft ?? undefined });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, draft]);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const intent = useRef<{ key: string; id: string } | null>(null);
  const { setThreadKey, refetch, signed, canWrite, cancelMode, cancelPin, draftPin } = controller;
  const { linkNew, clearPick } = controller.routing;

  const startDraft = useCallback((passage: PassageAnchor) => {
    setFailed(false);
    cancelMode();
    cancelPin();
    setDraft(passage);
    setThreadKey(null);
    latest.current.onDraft?.(passage);
  }, [setThreadKey, cancelMode, cancelPin]);
  // A comment on the whole page started (the New comment menu): it replaces a comment on a selection.
  useEffect(() => { if (draftPin) setDraft(null); }, [draftPin]);
  // Cancelling forgets the conversation picked for it too: the next comment goes to the best match again.
  const cancelDraft = useCallback(() => { setDraft(null); setFailed(false); clearPick(); forgetCommentDraft(draftKey); },
    [clearPick, draftKey]);

  const send = useCallback(async (body: string, files: readonly CommentFile[] = []) => {
    const text = body.trim();
    const schemaRevision = query.data?.schema_revision;
    const target = draft ? field(draft.field) : undefined;
    // Files go only where the table has a files column (the pane offers the paperclip only then).
    const attached = baseColumns.attachments && controller.attach === 'on' ? files : [];
    if (!draft || !target || (!text && !attached.length) || schemaRevision == null || sending) return false;
    // The author is who is signed in (`me` is the viewer under the host): nothing is sent until they are known.
    if (!canWrite) { console.warn('[comments] the viewer is not known yet: nothing was sent'); return false; }
    const scope = latest.current.scope ?? null;
    const at = new Date().toISOString();
    const properties: Record<string, unknown> = {
      ...passageProperties(draft, target, columns),
      [baseColumns.status]: 'Open', [baseColumns.needs]: 'none', [baseColumns.example]: false,
      [baseColumns.change]: 'created', [baseColumns.changedAt]: at,
    };
    if (baseColumns.scope && scope) properties[baseColumns.scope] = [scope.id];
    if (baseColumns.attachments && attached.length) {
      properties[baseColumns.attachments] = attached.map(({ name, url }) => ({ name, url }));
    }
    // One request ID per intent: sending the same comment again replays it instead of adding a second one.
    const key = JSON.stringify([draft, text, attached.map(file => file.url)]);
    if (intent.current?.key !== key) intent.current = { key, id: newCommentId() };
    setSending(true);
    setFailed(false);
    try {
      // The intent's request ID replays one author; a retry under another author is a new request.
      const first = intent.current.id;
      const receipt = await signed(author => insert.mutate(
        { columns: { title: text }, properties: author ? { ...properties, [baseColumns.author]: author } : properties },
        { schemaRevision, requestId: author === controller.me ? first : newCommentId() }));
      intent.current = null;
      setDraft(null);
      setThreadKey(receipt.record_key);
      void refetch();
      // The new comment thread goes to the thread picked with the chip or @, else the best match (SPC-117).
      void linkNew(receipt.record_key);
      return true;
    } catch {
      setFailed(true);
      return false;
    } finally {
      setSending(false);
    }
  }, [query.data?.schema_revision, draft, field, sending, columns, baseColumns, signed, controller.me, canWrite, insert,
    setThreadKey, refetch, linkNew, controller.attach]);

  const { selectThread, revealThread } = controller;
  const open = useCallback((thread: CommentThread, from: PassageOpenedFrom) => {
    openedFrom.current = from;
    if (from === 'passage' || from === 'link') revealThread(thread); else selectThread(thread);
  }, [selectThread, revealThread]);
  const openKey = useCallback((rootKey: string, from: PassageOpenedFrom) => {
    const thread = controller.threads.find(item => item.root.recordKey === rootKey);
    if (thread) open(thread, from);
  }, [controller.threads, open]);

  // A link to one comment: open its thread once it is read.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    // A link the host took away is forgotten, so a later link to the same comment opens it again.
    if (!focusKey) { focused.current = null; return; }
    if (focused.current === focusKey) return;
    const thread = controller.threads.find(item => item.root.recordKey === focusKey
      || item.replies.some(reply => reply.recordKey === focusKey));
    if (!thread) return;
    focused.current = focusKey;
    open(thread, 'link');
  }, [focusKey, controller.threads, open]);

  return {
    controller, fields, field, passageOf: (rootKey: string) => passages.get(rootKey), group, threads, threadsOn, openCount,
    isChanged: (rootKey: string) => placement.changed.has(rootKey),
    draft, draftPin, startDraft, cancelDraft, send, sending, failed, flash, open, openKey, reportFound,
    revealRequest: controller.revealRequest,
  };
}
