/**
 * The controller for comments on passages of a record's text: a `useComments` controller (reading, live feed,
 * replies, Resolve, Delete) plus where each thread sits (its field and quoted words), the comment being written on a
 * selection, which threads read Text changed, and the reading order. `CommentableText`, `CommentableRichText` and
 * `PassageCommentPane` render from it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNativeMutation } from '../../hooks/useNativeDocuments';
import { useShown } from '../../hooks/useViewParams';
import { commentColumns, commentRowsOf, newCommentId, type CommentThread } from './commentModel';
import { useComments, type CommentController, type UseCommentsOptions } from './useComments';
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
  /** Open the thread of this comment (a root or a reply) once it is read: a link to one comment. */
  focusKey?: string | null;
}

export interface PassageCommentController {
  /** The underlying comment controller: thread cards, Resolve, Delete, the status filter and the toast. */
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
  startDraft(passage: PassageAnchor): void;
  cancelDraft(): void;
  /** Saves the draft. True once saved; its thread is then selected. */
  send(body: string): Promise<boolean>;
  sending: boolean;
  /** The last send failed. */
  failed: boolean;
  /** The thread whose passage flashes, whether to scroll to it, and a count that changes on each flash. */
  flash: { key: string; scroll: boolean; n: number } | null;
  open(thread: CommentThread, from: PassageOpenedFrom): void;
  openKey(rootKey: string, from: PassageOpenedFrom): void;
  /** Rich text on screen reports which passages it shows: Text changed then follows what is rendered. */
  reportFound(field: string, keys: ReadonlySet<string> | null): void;
}

const NO_FIELDS: readonly PassageField[] = Object.freeze([]);

export function usePassageComments(options: UsePassageCommentsOptions): PassageCommentController {
  const { fields = NO_FIELDS, values, group = null, focusKey = null, list = 'comments', database = 'comments', pageSize = 500 } = options;
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
  const [draft, setDraft] = useState<PassageAnchor | null>(null);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const intent = useRef<{ key: string; id: string } | null>(null);
  const { setThreadKey, refetch, signed } = controller;

  const startDraft = useCallback((passage: PassageAnchor) => {
    setFailed(false);
    setDraft(passage);
    setThreadKey(null);
    latest.current.onDraft?.(passage);
  }, [setThreadKey]);
  const cancelDraft = useCallback(() => { setDraft(null); setFailed(false); }, []);

  const send = useCallback(async (body: string) => {
    const text = body.trim();
    const schemaRevision = query.data?.schema_revision;
    const target = draft ? field(draft.field) : undefined;
    if (!draft || !target || !text || schemaRevision == null || sending) return false;
    const scope = latest.current.scope ?? null;
    const at = new Date().toISOString();
    const properties: Record<string, unknown> = {
      ...passageProperties(draft, target, columns),
      [baseColumns.status]: 'Open', [baseColumns.needs]: 'none', [baseColumns.example]: false,
      [baseColumns.change]: 'created', [baseColumns.changedAt]: at,
    };
    if (baseColumns.scope && scope) properties[baseColumns.scope] = [scope.id];
    // One request ID per intent: sending the same comment again replays it instead of adding a second one.
    const key = JSON.stringify([draft, text]);
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
      return true;
    } catch {
      setFailed(true);
      return false;
    } finally {
      setSending(false);
    }
  }, [query.data?.schema_revision, draft, field, sending, columns, baseColumns, signed, controller.me, insert, setThreadKey, refetch]);

  const { selectThread } = controller;
  const open = useCallback((thread: CommentThread, from: PassageOpenedFrom) => {
    openedFrom.current = from;
    selectThread(thread);
  }, [selectThread]);
  const openKey = useCallback((rootKey: string, from: PassageOpenedFrom) => {
    const thread = controller.threads.find(item => item.root.recordKey === rootKey);
    if (thread) open(thread, from);
  }, [controller.threads, open]);

  // A link to one comment: open its thread once it is read.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!focusKey || focused.current === focusKey) return;
    const thread = controller.threads.find(item => item.root.recordKey === focusKey
      || item.replies.some(reply => reply.recordKey === focusKey));
    if (!thread) return;
    focused.current = focusKey;
    open(thread, 'link');
  }, [focusKey, controller.threads, open]);

  return {
    controller, fields, field, passageOf: (rootKey: string) => passages.get(rootKey), group, threads, threadsOn, openCount,
    isChanged: (rootKey: string) => placement.changed.has(rootKey),
    draft, startDraft, cancelDraft, send, sending, failed, flash, open, openKey, reportFound,
  };
}
