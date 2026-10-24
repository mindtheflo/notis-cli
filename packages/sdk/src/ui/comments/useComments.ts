/**
 * The comment controller: reads a Comments database through the view's declared list, follows its live feed, writes
 * through the normal native mutations and keeps every change on screen at once (optimistic patches and drafts) until
 * the server rows carry it. `CommentPane`, `CommentPins` and `CommentThreadCard` render from it.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent } from 'react';
import { useNativeMutation } from '../../hooks/useNativeDocuments';
import { useShown } from '../../hooks/useViewParams';
import { useNotisRuntime } from '../../provider';
import { fillWords, pick, type Locale, type Words } from '../../words';
import { useToast, type ToastController } from '../actions/useToast';
import { ESCAPE_PRIORITY } from '../engine/core';
import { useEscapeLayer, useToolkitLocale } from '../engine/hooks';
import {
  applyCommentPatches, clipCommentAnswer, commentChangesSince, commentColumns, commentDigest, commentRowsOf,
  commentThreads, commentTimeOf, inCommentScope, newCommentId, readCommentRow, writeCommentClipboard,
  type CommentAnchor, type CommentChange, type CommentColumns, type CommentDigestOptions, type CommentPatch,
  type CommentRecord, type CommentScope, type CommentThread,
} from './commentModel';
import { commentCopiedWords, commentWords, type CommentWordKey, type CommentWords } from './commentWords';

/** Which threads the pane lists: the current anchor's, or every thread in the scope. */
export type CommentAnchorFilter = 'anchor' | 'all';
/** Open threads, or resolved ones. */
export type CommentStatusFilter = 'open' | 'resolved';

/**
 * A new comment being written: on an anchor, with a pin (x and y, 0 to 1), a zone (w and h too, 0 to 1 of the
 * anchor's size) or neither (on the whole anchor).
 */
export interface CommentDraftPin { anchorKey: string | null; x: number | null; y: number | null; w: number | null; h: number | null }

/** The zone being dragged on an anchor, 0 to 1 of its size. */
export interface CommentDragZone { anchorKey: string | null; x: number; y: number; w: number; h: number }

/** Pointer handlers for the element the anchor is drawn in: a click drops a pin, a drag marks a zone. */
export interface CommentZoneHandlers {
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(event: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(event: ReactPointerEvent<HTMLElement>): void;
}

/** A drag shorter than this (in pixels, either way) is a click: it drops a pin. */
const ZONE_MIN_PX = 4;

export interface CommentActions {
  /** Adds a reply. A reply reopens a resolved thread and answers an open input ask. True once saved. */
  reply(thread: CommentThread, body: string): Promise<boolean>;
  /** Answers a check or choice ask. */
  answer(root: CommentRecord, answer: string): void;
  setStatus(root: CommentRecord, status: 'Open' | 'Resolved'): void;
  /** Opens the delete confirmation for the thread. */
  askDelete(root: CommentRecord): void;
  notify(words: Words | string): void;
}

export interface UseCommentsOptions {
  /** The list the view declares in `shows` for the Comments database. Default 'comments'. */
  list?: string;
  /** The database alias the list reads and writes (insert and update actions). Default 'comments'. */
  database?: string;
  /** The record the comments belong to. Null: every comment is shown and none is written with a scope. */
  scope?: CommentScope | null;
  /** The records threads sit on, in order. Empty: comments are not anchored. */
  anchors?: readonly CommentAnchor[];
  /** The anchor on screen (its record key): the pane's "this item" filter and where pins are placed. */
  anchorKey?: string | null;
  /** The person using the Space; their comments count as changes and never as new activity. Default 'Flo'. */
  me?: string;
  /** Authors the Author select knows; anyone else reads as `fallbackAuthor`. Default: any name. */
  authors?: readonly string[];
  fallbackAuthor?: string;
  columns?: Partial<CommentColumns>;
  /** Wording of the digest Copy changes puts on the clipboard. */
  digest?: CommentDigestOptions;
  /** Saves the checkpoint after a copy (for example the scope's "Last turn at"). A throw rolls the checkpoint back. */
  onCheckpoint?(at: string): Promise<void>;
  /** The Space's own wording on top of the defaults. */
  words?: Partial<Record<CommentWordKey, Words>>;
  pageSize?: number;
  /** Follow the database's live feed where the host has one. Default true. */
  live?: boolean;
  /** Called when a thread is picked (a pin, a card): the Space can move to its anchor and open its panel. */
  onSelectThread?(thread: CommentThread): void;
}

export interface CommentController {
  comments: CommentRecord[];
  /** Threads in the scope, deleted ones left out, in anchor order. */
  threads: CommentThread[];
  /** The threads the pane lists for the current filters. */
  visibleThreads: CommentThread[];
  /** Changes since the checkpoint: what Copy changes puts on the clipboard. */
  changes: CommentRecord[];
  checkpoint: string | null;
  isNew(comment: CommentRecord): boolean;
  threadsOn(anchorKey: string | null | undefined): CommentThread[];
  /** The thread's pin number on its anchor (1-based), 0 when it is not there. */
  numberOf(thread: CommentThread): number;
  scope: CommentScope | null;
  anchors: readonly CommentAnchor[];
  anchorKey: string | null;
  anchor: CommentAnchor | undefined;

  filter: CommentAnchorFilter;
  setFilter(filter: CommentAnchorFilter): void;
  statusFilter: CommentStatusFilter;
  setStatusFilter(filter: CommentStatusFilter): void;
  threadKey: string | null;
  setThreadKey(key: string | null): void;
  selectThread(thread: CommentThread): void;

  actions: CommentActions;
  /** Add comment mode: the next click on the anchor drops a pin. Escape leaves it. */
  commenting: boolean;
  setCommenting(on: boolean): void;
  toggleCommenting(): void;
  draftPin: CommentDraftPin | null;
  /**
   * Starts a new comment on `anchorKey` at x, y (0 to 1), on a zone when w and h are given too, or on the whole
   * anchor when x and y are null.
   */
  placePin(anchorKey: string | null, x: number | null, y: number | null, w?: number | null, h?: number | null): void;
  /** In Add comment mode, drops a pin where the anchor element was clicked. True when a pin was placed. */
  placePinFromEvent(event: ReactMouseEvent<HTMLElement>, anchorKey: string | null): boolean;
  /** True when the table has zone columns: a drag in Add comment mode marks a zone instead of dropping a pin. */
  zones: boolean;
  /** The zone being dragged, while the button is held. */
  dragZone: CommentDragZone | null;
  /** In Add comment mode: a click on the element drops a pin, a press and drag marks a zone. */
  zoneHandlers(anchorKey: string | null): CommentZoneHandlers;
  cancelPin(): void;
  /** Saves the new comment. True once saved. */
  sendNew(body: string): Promise<boolean>;

  deleting: CommentRecord | null;
  cancelDelete(): void;
  confirmDelete(): Promise<void>;

  /** Copies the digest and records the checkpoint. `host` is the Space's own element, for the selection fallback. */
  copyChanges(host: HTMLElement | null): Promise<boolean>;
  copying: boolean;

  /** Record keys with a write in flight. */
  busy: ReadonlySet<string>;
  now: number;
  toaster: ToastController;
  words: CommentWords;
  /** A word in the reader's language, with `{n}`-style values filled. */
  say(key: CommentWordKey, vars?: Readonly<Record<string, string | number>>): string;
  locale: Locale;
  me: string;
  loading: boolean;
  hasData: boolean;
  error: Error | null;
  refetch(): Promise<unknown>;
}

/** A comment inserted here, shown until the server lists `serverKey`. */
interface CommentDraft { comment: CommentRecord; serverKey: string | null }

const NO_ANCHORS: readonly CommentAnchor[] = Object.freeze([]);

export function useComments(options: UseCommentsOptions = {}): CommentController {
  const {
    list = 'comments', database = 'comments', scope = null, anchors = NO_ANCHORS, anchorKey = null, me = 'Flo',
    authors, fallbackAuthor = 'Notis', pageSize = 500, live = true,
  } = options;
  const runtime = useNotisRuntime();
  const locale = useToolkitLocale();
  const words = useMemo(() => commentWords(options.words), [options.words]);
  const say = useCallback((key: CommentWordKey, vars?: Readonly<Record<string, string | number>>) =>
    pick(vars ? fillWords(words[key], vars) : words[key], locale), [words, locale]);
  const columns = useMemo(() => commentColumns(options.columns), [options.columns]);
  const latest = useRef(options);
  latest.current = options;

  const query = useShown<Record<string, unknown>>(list, { pageSize });
  const refetch = query.refetch;
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    if (!live || !runtime?.subscribeDatabase) return undefined;
    const stop = runtime.subscribeDatabase(database, () => { void refetchRef.current(); });
    return () => { stop?.(); };
  }, [runtime, database, live]);

  const insertMutation = useNativeMutation(database, 'insert');
  const updateMutation = useNativeMutation(database, 'update');
  const toaster = useToast();
  const notify = toaster.notify;

  const [patches, setPatches] = useState<Record<string, CommentPatch>>({});
  const [drafts, setDrafts] = useState<CommentDraft[]>([]);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [marker, setMarker] = useState<string | null>(null);

  const authorsKey = authors?.join('|') ?? null;
  const serverComments = useMemo(() => commentRowsOf(query.data).map(row =>
    readCommentRow(row, { columns, authors: authorsKey == null ? undefined : authorsKey.split('|'), fallbackAuthor })),
  [query.data, columns, authorsKey, fallbackAuthor]);

  const comments = useMemo(() => {
    const serverKeys = new Set(serverComments.map(comment => comment.recordKey));
    const pending = drafts.filter(draft => !draft.serverKey || !serverKeys.has(draft.serverKey)).map(draft => draft.comment);
    return [...applyCommentPatches(serverComments, patches), ...pending];
  }, [serverComments, patches, drafts]);

  // Forget drafts and patches the server has caught up with.
  useEffect(() => {
    const serverKeys = new Set(serverComments.map(comment => comment.recordKey));
    setDrafts(current => current.some(draft => draft.serverKey && serverKeys.has(draft.serverKey))
      ? current.filter(draft => !(draft.serverKey && serverKeys.has(draft.serverKey))) : current);
    setPatches(current => {
      let changed = false;
      const next: Record<string, CommentPatch> = {};
      for (const [key, patch] of Object.entries(current)) {
        const row = serverComments.find(comment => comment.recordKey === key);
        if (row && patch.revision != null && row.revision >= patch.revision) { changed = true; continue; }
        next[key] = patch;
      }
      return changed ? next : current;
    });
  }, [serverComments]);

  const scopeKey = scope ? `${scope.id}|${scope.recordKey}` : null;
  const inScope = useMemo(() => comments.filter(comment => inCommentScope(comment, scope)),
    // The scope is compared by identity of its record, not of the object a render builds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comments, scopeKey]);
  const threads = useMemo(() => commentThreads(inScope, anchors).filter(thread => thread.root.status !== 'Deleted'),
    [inScope, anchors]);

  const checkpoint = useMemo(() => {
    const saved = scope?.checkpoint ?? null;
    if (marker && (commentTimeOf(saved) || 0) < commentTimeOf(marker)) return marker;
    return saved;
  }, [scope?.checkpoint, marker]);
  const changes = useMemo(() => commentChangesSince(inScope, checkpoint, me), [inScope, checkpoint, me]);

  const lastTurn = commentTimeOf(checkpoint) || 0;
  const isNew = useCallback((comment: CommentRecord) =>
    comment.author !== me && (commentTimeOf(comment.createdAt) || 0) > lastTurn, [me, lastTurn]);

  const threadsOn = useCallback((key: string | null | undefined) =>
    threads.filter(thread => (thread.anchor?.recordKey ?? null) === (key ?? null)), [threads]);
  const numberOf = useCallback((thread: CommentThread) =>
    threadsOn(thread.anchor?.recordKey).findIndex(item => item.root.recordKey === thread.root.recordKey) + 1, [threadsOn]);
  const anchor = useMemo(() => anchors.find(item => item.recordKey === anchorKey), [anchors, anchorKey]);

  const [filter, setFilter] = useState<CommentAnchorFilter>('anchor');
  const [statusFilter, setStatusFilter] = useState<CommentStatusFilter>('open');
  const [threadKey, setThreadKey] = useState<string | null>(null);
  const [draftPin, setDraftPin] = useState<CommentDraftPin | null>(null);
  const [deleting, setDeleting] = useState<CommentRecord | null>(null);
  const [commenting, setCommentingState] = useState(false);
  const [copying, setCopying] = useState(false);

  // No anchors: the anchor filter would list nothing, so the pane shows every thread.
  const effectiveFilter: CommentAnchorFilter = anchors.length ? filter : 'all';
  const visibleThreads = useMemo(() => {
    const wanted = statusFilter === 'resolved' ? 'Resolved' : 'Open';
    const base = effectiveFilter === 'anchor' ? threadsOn(anchorKey) : threads;
    return base.filter(thread => thread.root.status === wanted);
  }, [effectiveFilter, statusFilter, threadsOn, anchorKey, threads]);

  const selectThread = useCallback((thread: CommentThread) => {
    setThreadKey(thread.root.recordKey);
    setDraftPin(null);
    setCommentingState(false);
    setStatusFilter(thread.root.status === 'Resolved' ? 'resolved' : 'open');
    latest.current.onSelectThread?.(thread);
  }, []);

  // Ticking clock for relative times.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  const schemaRevision = query.data?.schema_revision;

  const fail = useCallback((error: unknown) => {
    console.warn('[comments] write failed', error);
    notify(words.saveError, { tone: 'danger' });
  }, [notify, words]);

  const setBusyKey = useCallback((key: string, on: boolean) => setBusy(current => {
    const next = new Set(current);
    if (on) next.add(key); else next.delete(key);
    return next;
  }), []);

  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const patchesRef = useRef(patches);
  patchesRef.current = patches;

  const updateRoot = useCallback(async (root: CommentRecord, fields: Partial<CommentRecord>, properties: Record<string, unknown>) => {
    if (schemaRevision == null) { fail(new Error('Comments schema revision unknown')); return false; }
    const key = root.recordKey;
    const previous = patchesRef.current[key];
    const revision = commentsRef.current.find(comment => comment.recordKey === key)?.revision ?? root.revision;
    setPatches(current => ({ ...current, [key]: { fields: { ...(current[key]?.fields ?? {}), ...fields }, revision: null } }));
    setBusyKey(key, true);
    try {
      const receipt = await updateMutation.mutate({ record_key: key, expected_revision: revision, properties },
        { schemaRevision, requestId: newCommentId() });
      setPatches(current => current[key] ? { ...current, [key]: { ...current[key], revision: receipt.revision } } : current);
      void refetch();
      return true;
    } catch (error) {
      setPatches(current => {
        const next = { ...current };
        if (previous) next[key] = previous; else delete next[key];
        return next;
      });
      fail(error);
      return false;
    } finally {
      setBusyKey(key, false);
    }
  }, [schemaRevision, updateMutation, refetch, fail, setBusyKey]);

  /** Status fields and the Change columns, for an update. */
  const changeProps = useCallback((change: CommentChange, at: string, extra: Record<string, unknown> = {}) => ({
    ...extra, [columns.change]: change, [columns.changedAt]: at,
  }), [columns]);

  const insert = useCallback(async (fields: {
    body: string; anchor: CommentAnchor | undefined; thread: string; x: number | null; y: number | null;
    w: number | null; h: number | null; change: 'created' | 'replied';
  }): Promise<string | false> => {
    if (schemaRevision == null) { fail(new Error('Comments schema revision unknown')); return false; }
    const at = new Date().toISOString();
    const tempKey = `draft-${newCommentId()}`;
    const currentScope = latest.current.scope ?? null;
    const comment: CommentRecord = {
      id: tempKey, recordKey: tempKey, revision: 0, body: fields.body,
      scopeIds: currentScope ? [currentScope.id] : [], anchorIds: fields.anchor ? [fields.anchor.id] : [],
      thread: fields.thread, author: me, x: fields.x, y: fields.y,
      w: columns.w && columns.h ? fields.w : null, h: columns.w && columns.h ? fields.h : null, status: 'Open', needs: 'none', options: [], answer: '',
      answeredAt: null, change: fields.change, changedAt: at, example: false, createdAt: at,
    };
    setDrafts(current => [...current, { comment, serverKey: null }]);
    const properties: Record<string, unknown> = {
      [columns.author]: me, [columns.status]: 'Open', [columns.needs]: 'none', [columns.example]: false,
      ...changeProps(fields.change, at),
    };
    if (columns.scope && currentScope) properties[columns.scope] = [currentScope.id];
    if (columns.anchor && fields.anchor) properties[columns.anchor] = [fields.anchor.id];
    if (fields.thread) properties[columns.thread] = fields.thread;
    if (fields.x != null && fields.y != null) {
      properties[columns.x] = Number(fields.x.toFixed(4));
      properties[columns.y] = Number(fields.y.toFixed(4));
      if (columns.w && columns.h && fields.w != null && fields.h != null) {
        properties[columns.w] = Number(fields.w.toFixed(4));
        properties[columns.h] = Number(fields.h.toFixed(4));
      }
    }
    try {
      const receipt = await insertMutation.mutate({ columns: { title: fields.body }, properties },
        { schemaRevision, requestId: newCommentId() });
      setDrafts(current => current.map(draft => draft.comment.recordKey === tempKey ? { ...draft, serverKey: receipt.record_key } : draft));
      void refetch();
      return receipt.record_key;
    } catch (error) {
      setDrafts(current => current.filter(draft => draft.comment.recordKey !== tempKey));
      fail(error);
      return false;
    }
  }, [schemaRevision, me, columns, changeProps, insertMutation, refetch, fail]);

  const actions: CommentActions = useMemo(() => ({
    reply: async (thread, body) => {
      const { root } = thread;
      if (root.recordKey.startsWith('draft-')) return false;
      const rootFields: Partial<CommentRecord> = {};
      const rootProps: Record<string, unknown> = {};
      const at = new Date().toISOString();
      if (root.status === 'Resolved') {
        Object.assign(rootFields, { status: 'Open', change: 'reopened', changedAt: at });
        Object.assign(rootProps, changeProps('reopened', at, { [columns.status]: 'Open' }));
      }
      if (root.needs === 'input' && !root.answer) {
        const answer = clipCommentAnswer(body);
        Object.assign(rootFields, { answer, answeredAt: at });
        Object.assign(rootProps, { [columns.answer]: answer, [columns.answeredAt]: at });
      }
      const [inserted] = await Promise.all([
        insert({ body, anchor: thread.anchor, thread: root.recordKey, x: null, y: null, w: null, h: null, change: 'replied' }),
        Object.keys(rootProps).length ? updateRoot(root, rootFields, rootProps) : Promise.resolve(true),
      ]);
      if (inserted && root.status === 'Resolved') setStatusFilter('open');
      return Boolean(inserted);
    },
    answer: (root, answer) => {
      const at = new Date().toISOString();
      void updateRoot(root, { answer, answeredAt: at, change: 'answered', changedAt: at },
        changeProps('answered', at, { [columns.answer]: answer, [columns.answeredAt]: at }));
    },
    setStatus: (root, status) => {
      const at = new Date().toISOString();
      const change = status === 'Resolved' ? 'resolved' : 'reopened';
      void updateRoot(root, { status, change, changedAt: at }, changeProps(change, at, { [columns.status]: status }));
    },
    askDelete: root => setDeleting(root),
    notify: text => notify(text),
  }), [insert, updateRoot, changeProps, columns, notify]);

  const confirmDelete = useCallback(async () => {
    const root = deleting;
    if (!root) return;
    const at = new Date().toISOString();
    setDeleting(null);
    setThreadKey(current => current === root.recordKey ? null : current);
    await updateRoot(root, { status: 'Deleted', change: 'deleted', changedAt: at },
      changeProps('deleted', at, { [columns.status]: 'Deleted' }));
  }, [deleting, updateRoot, changeProps, columns]);

  const placePin = useCallback((key: string | null, x: number | null, y: number | null,
    w: number | null = null, h: number | null = null) => {
    setCommentingState(false);
    setDraftPin({ anchorKey: key, x, y, w: x == null || y == null ? null : w, h: x == null || y == null ? null : h });
    setThreadKey(null);
    setFilter('anchor');
    setStatusFilter('open');
  }, []);

  const placePinFromEvent = useCallback((event: ReactMouseEvent<HTMLElement>, key: string | null) => {
    if (!commenting) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.width ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0.5;
    const y = rect.height ? Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) : 0.5;
    placePin(key, x, y);
    return true;
  }, [commenting, placePin]);

  const cancelPin = useCallback(() => setDraftPin(null), []);

  const zones = Boolean(columns.w && columns.h);
  const [dragZone, setDragZone] = useState<CommentDragZone | null>(null);
  const dragRef = useRef<{ key: string | null; rect: DOMRect; x0: number; y0: number; pointerId: number; moved: boolean } | null>(null);
  const endDrag = useCallback(() => { dragRef.current = null; setDragZone(null); }, []);

  const zoneHandlers = useCallback((key: string | null): CommentZoneHandlers => {
    const zoneOf = (drag: NonNullable<typeof dragRef.current>, clientX: number, clientY: number): CommentDragZone => {
      const { rect } = drag;
      const clamp = (value: number) => Math.min(1, Math.max(0, value));
      const ax = clamp((drag.x0 - rect.left) / (rect.width || 1));
      const ay = clamp((drag.y0 - rect.top) / (rect.height || 1));
      const bx = clamp((clientX - rect.left) / (rect.width || 1));
      const by = clamp((clientY - rect.top) / (rect.height || 1));
      return { anchorKey: drag.key, x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
    };
    return {
      onPointerDown: event => {
        if (!commenting || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture is best effort */ }
        dragRef.current = {
          key, rect: event.currentTarget.getBoundingClientRect(), x0: event.clientX, y0: event.clientY,
          pointerId: event.pointerId, moved: false,
        };
      },
      onPointerMove: event => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId || !zones) return;
        if (!drag.moved && Math.abs(event.clientX - drag.x0) < ZONE_MIN_PX && Math.abs(event.clientY - drag.y0) < ZONE_MIN_PX) return;
        drag.moved = true;
        setDragZone(zoneOf(drag, event.clientX, event.clientY));
      },
      onPointerUp: event => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        event.stopPropagation();
        const { rect } = drag;
        const wide = Math.abs(event.clientX - drag.x0) >= ZONE_MIN_PX && rect.width > 0;
        const high = Math.abs(event.clientY - drag.y0) >= ZONE_MIN_PX && rect.height > 0;
        endDrag();
        if (zones && drag.moved && wide && high) {
          const zone = zoneOf(drag, event.clientX, event.clientY);
          placePin(drag.key, zone.x, zone.y, zone.w, zone.h);
          return;
        }
        const x = rect.width ? Math.min(1, Math.max(0, (drag.x0 - rect.left) / rect.width)) : 0.5;
        const y = rect.height ? Math.min(1, Math.max(0, (drag.y0 - rect.top) / rect.height)) : 0.5;
        placePin(drag.key, x, y);
      },
      onPointerCancel: () => endDrag(),
    };
  }, [commenting, zones, placePin, endDrag]);

  const sendNew = useCallback(async (body: string) => {
    const pin = draftPin;
    if (!pin || !body.trim()) return false;
    const target = anchors.find(item => item.recordKey === pin.anchorKey);
    const key = await insert({ body: body.trim(), anchor: target, thread: '', x: pin.x, y: pin.y, w: pin.w, h: pin.h, change: 'created' });
    if (!key) return false;
    setDraftPin(null);
    setThreadKey(key);
    return true;
  }, [draftPin, anchors, insert]);

  const setCommenting = useCallback((on: boolean) => {
    if (on) setDraftPin(null);
    else endDrag();
    setCommentingState(on);
  }, [endDrag]);
  const toggleCommenting = useCallback(() => {
    setDraftPin(null);
    endDrag();
    setCommentingState(current => !current);
  }, [endDrag]);

  // Escape leaves Add comment mode (and drops a zone being dragged) before anything else on the page reacts.
  useEscapeLayer(`comments.${database}.mode`, () => { endDrag(); setCommentingState(false); return true; },
    { priority: ESCAPE_PRIORITY.selection + 2, enabled: commenting });

  const copyChanges = useCallback(async (host: HTMLElement | null) => {
    if (!changes.length || copying) return false;
    setCopying(true);
    const at = new Date().toISOString();
    const count = changes.length;
    const text = commentDigest({ scope: scope ? { ...scope, checkpoint } : null, comments: inScope, anchors, changes, nowIso: at },
      { me, columns: options.columns, ...(latest.current.digest ?? {}) });
    const ok = await writeCommentClipboard(text, host);
    if (!ok) { notify(words.copyFailed, { tone: 'danger' }); setCopying(false); return false; }
    notify(commentCopiedWords(words, count));
    const previous = marker;
    setMarker(at);
    try {
      await latest.current.onCheckpoint?.(at);
    } catch (error) {
      setMarker(previous);
      fail(error);
    } finally {
      setCopying(false);
    }
    return true;
  }, [changes, copying, scope, checkpoint, inScope, anchors, me, options.columns, notify, words, marker, fail]);

  return {
    comments: inScope, threads, visibleThreads, changes, checkpoint, isNew, threadsOn, numberOf,
    scope, anchors, anchorKey, anchor,
    filter: effectiveFilter, setFilter, statusFilter, setStatusFilter, threadKey, setThreadKey, selectThread,
    actions, commenting, setCommenting, toggleCommenting, draftPin, placePin, placePinFromEvent, cancelPin, sendNew,
    zones, dragZone, zoneHandlers,
    deleting, cancelDelete: () => setDeleting(null), confirmDelete, copyChanges, copying,
    busy, now, toaster, words, say, locale, me,
    loading: query.loading && !query.hasData, hasData: query.hasData, error: query.error ?? null, refetch,
  };
}
