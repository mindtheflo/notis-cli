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
import { SPACE_FILE_MAX_BYTES, SpaceFileError, type SpaceFileUploadResult } from '../../space';
import { fillWords, pick, type Locale, type Words } from '../../words';
import { useToast, type ToastController } from '../actions/useToast';
import { ESCAPE_PRIORITY } from '../engine/core';
import { useEscapeLayer, useToolkitLocale } from '../engine/hooks';
import {
  applyCommentPatches, clipCommentAnswer, commentAttachmentList, commentChangesSince, commentRowsHaveColumn, commentColumns, commentDigest, commentRowsOf,
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

/**
 * A file uploaded for a comment that is not sent yet: `name` and `url` go into the Attachments column, `previewUrl`
 * shows it until the saved comment is read back.
 */
export interface CommentFile { name: string; url: string; previewUrl?: string | null }

/** Whether new comments and replies can carry pictures and files. */
export type CommentAttachMode = 'on' | 'off' | 'checking';

export interface CommentActions {
  /**
   * Adds a reply, with the files already uploaded for it. A reply reopens a resolved thread and answers an open input
   * ask. True once saved.
   */
  reply(thread: CommentThread, body: string, files?: readonly CommentFile[]): Promise<boolean>;
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
  /**
   * The person using the Space; their comments count as changes and never as new activity. Default: the viewer's
   * first name from the host, and when the Author column refuses it (a choice list without that name) "Person",
   * then no author. Pass it to sign comments with a fixed name.
   */
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
  /** Saves the new comment with the files already uploaded for it. True once saved. */
  sendNew(body: string, files?: readonly CommentFile[]): Promise<boolean>;

  /**
   * 'on' when people can attach pictures and files: the table has the Attachments column and the host uploads files
   * (signed-in Editors in Notis; never on a Site, a link or a preview). 'off' leaves the pane text only.
   */
  attach: CommentAttachMode;
  /** The largest file the host takes, in bytes. */
  maxFileBytes: number;
  /** Uploads one file for a comment not sent yet. Throws a `SpaceFileError` with a code the pane words. */
  uploadFile(file: File, options?: { onProgress?(sent: number, total: number): void; signal?: AbortSignal }): Promise<CommentFile>;
  /** A shown picture failed to load (its signed address expired): reads the comments again, at most twice a minute. */
  refreshFiles(): void;

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
  /**
   * Runs one comment write signed by the viewer: with the default author, a write the Author column refuses as a
   * choice is tried again as "Person", then without an author, and the author that worked is kept for the session.
   */
  signed<T>(write: (author: string | null) => Promise<T>): Promise<T>;
  /** Opens an agent's thread in the side chat; undefined on hosts without one. */
  openThread?: (threadId: string) => void;
  loading: boolean;
  hasData: boolean;
  error: Error | null;
  refetch(): Promise<unknown>;
}

/** A comment inserted here, shown until the server lists `serverKey`. */
interface CommentDraft { comment: CommentRecord; serverKey: string | null }

const NO_ANCHORS: readonly CommentAnchor[] = Object.freeze([]);

/** The neutral author a Comments database's choice list can offer for anyone it does not name. */
export const COMMENT_PERSON_AUTHOR = 'Person';

/**
 * Who signs the viewer's comments, in the order to try: a fixed `me` alone; else the viewer's first name (when the
 * known `authors` include it, or none are given), then "Person". Never a name that belongs to someone else.
 */
export function commentAuthorCandidates(fixed: string | undefined, viewerName: string | null,
  authors?: readonly string[]): string[] {
  if (fixed) return [fixed];
  const allowed = (name: string) => !authors || authors.includes(name);
  return [...new Set([viewerName, COMMENT_PERSON_AUTHOR].filter((name): name is string => Boolean(name) && allowed(name!)))];
}

/** The Author column refused the name: it is a choice list without that option. */
export function isRefusedChoice(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${(error as { code?: unknown }).code ?? ''}` : String(error ?? '');
  return /choice is missing|missing or ambiguous|invalid_property_value/i.test(text);
}

export function useComments(options: UseCommentsOptions = {}): CommentController {
  const {
    list = 'comments', database = 'comments', scope = null, anchors = NO_ANCHORS, anchorKey = null, me: fixedAuthor,
    authors, fallbackAuthor = 'Notis', pageSize = 500, live = true,
  } = options;
  const runtime = useNotisRuntime();
  const viewerName = runtime?.context?.viewerName?.trim() || null;
  const authorChoices = useMemo(() => commentAuthorCandidates(fixedAuthor, viewerName, authors), [fixedAuthor, viewerName, authors]);
  // The first author the Author column accepted this session (an index into the choices).
  const [authorIndex, setAuthorIndex] = useState(0);
  const authorIndexRef = useRef(0);
  useEffect(() => { authorIndexRef.current = 0; setAuthorIndex(0); }, [authorChoices]);
  const me = authorChoices[Math.min(authorIndex, authorChoices.length - 1)] ?? '';
  const signed = useCallback(async <T,>(write: (author: string | null) => Promise<T>): Promise<T> => {
    for (let index = authorIndexRef.current; ; index += 1) {
      const author = authorChoices[index] ?? null;
      try {
        const result = await write(author);
        if (index !== authorIndexRef.current) { authorIndexRef.current = index; setAuthorIndex(index); }
        return result;
      } catch (error) {
        if (index >= authorChoices.length || !isRefusedChoice(error)) throw error;
      }
    }
  }, [authorChoices]);
  const locale = useToolkitLocale();
  const words = useMemo(() => commentWords(options.words), [options.words]);
  const say = useCallback((key: CommentWordKey, vars?: Readonly<Record<string, string | number>>) =>
    pick(vars ? fillWords(words[key], vars) : words[key], locale), [words, locale]);
  const columns = useMemo(() => commentColumns(options.columns), [options.columns]);
  const threadTransport = runtime?.resource?.kind === 'space' ? runtime.spaceThreads : undefined;
  const openThread = useMemo(() => threadTransport
    ? (threadId: string) => { void threadTransport.open(threadId).catch(() => undefined); }
    : undefined, [threadTransport]);
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
  // The columns the Comments database has, as its list answer names them: optional columns it lacks (Needs,
  // Change, Example...) are left out of a write instead of failing it. Unknown (an older host): every column is sent.
  const propertyNames = query.data?.property_names;
  const knownColumns = useMemo(() => Array.isArray(propertyNames)
    ? new Set(propertyNames.filter((name): name is string => typeof name === 'string').map(name => name.toLowerCase()))
    : null, [propertyNames]);
  const knownRef = useRef(knownColumns);
  knownRef.current = knownColumns;
  const onlyKnown = useCallback((properties: Record<string, unknown>) => {
    const known = knownRef.current;
    return known ? Object.fromEntries(Object.entries(properties).filter(([name]) => known.has(name.toLowerCase()))) : properties;
  }, []);

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
      const sent = onlyKnown(properties);
      if (!Object.keys(sent).length) throw new Error(`The Comments database has none of the columns ${Object.keys(properties).join(', ')}`);
      const receipt = await updateMutation.mutate({ record_key: key, expected_revision: revision, properties: sent },
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
  }, [schemaRevision, updateMutation, refetch, fail, setBusyKey, onlyKnown]);

  /** Status fields and the Change columns, for an update. */
  const changeProps = useCallback((change: CommentChange, at: string, extra: Record<string, unknown> = {}) => ({
    ...extra, [columns.change]: change, [columns.changedAt]: at,
  }), [columns]);

  const insert = useCallback(async (fields: {
    body: string; anchor: CommentAnchor | undefined; thread: string; x: number | null; y: number | null;
    w: number | null; h: number | null; change: 'created' | 'replied'; files?: readonly CommentFile[];
  }): Promise<string | false> => {
    const files = columns.attachments ? fields.files ?? [] : [];
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
      attachments: commentAttachmentList(files.map(file => ({ name: file.name, url: file.previewUrl || file.url }))),
    };
    setDrafts(current => [...current, { comment, serverKey: null }]);
    const properties: Record<string, unknown> = {
      [columns.status]: 'Open', [columns.needs]: 'none', [columns.example]: false,
      ...changeProps(fields.change, at),
    };
    if (columns.scope && currentScope) properties[columns.scope] = [currentScope.id];
    if (columns.anchor && fields.anchor) properties[columns.anchor] = [fields.anchor.id];
    if (fields.thread) properties[columns.thread] = fields.thread;
    if (columns.attachments && files.length) properties[columns.attachments] = files.map(({ name, url }) => ({ name, url }));
    if (fields.x != null && fields.y != null) {
      properties[columns.x] = Number(fields.x.toFixed(4));
      properties[columns.y] = Number(fields.y.toFixed(4));
      if (columns.w && columns.h && fields.w != null && fields.h != null) {
        properties[columns.w] = Number(fields.w.toFixed(4));
        properties[columns.h] = Number(fields.h.toFixed(4));
      }
    }
    try {
      // A reply is only a reply through its Thread column: never save it as a new thread instead.
      if (fields.thread && knownRef.current && !knownRef.current.has(columns.thread.toLowerCase())) {
        throw new Error(`The Comments database has no ${columns.thread} column for replies`);
      }
      // The draft is the new comment on screen: the list does not add a second one.
      const receipt = await signed(author => insertMutation.mutate(
        { columns: { title: fields.body }, properties: onlyKnown(author ? { ...properties, [columns.author]: author } : properties) },
        { schemaRevision, requestId: newCommentId(), showIn: [] }));
      setDrafts(current => current.map(draft => draft.comment.recordKey === tempKey ? { ...draft, serverKey: receipt.record_key } : draft));
      void refetch();
      return receipt.record_key;
    } catch (error) {
      setDrafts(current => current.filter(draft => draft.comment.recordKey !== tempKey));
      fail(error);
      return false;
    }
  }, [schemaRevision, me, signed, columns, changeProps, insertMutation, refetch, fail, onlyKnown]);

  const actions: CommentActions = useMemo(() => ({
    reply: async (thread, body, files = []) => {
      const { root } = thread;
      if (root.recordKey.startsWith('draft-') || (!body.trim() && !files.length)) return false;
      const rootFields: Partial<CommentRecord> = {};
      const rootProps: Record<string, unknown> = {};
      const at = new Date().toISOString();
      if (root.status === 'Resolved') {
        Object.assign(rootFields, { status: 'Open', change: 'reopened', changedAt: at });
        Object.assign(rootProps, changeProps('reopened', at, { [columns.status]: 'Open' }));
      }
      if (root.needs === 'input' && !root.answer) {
        const answer = clipCommentAnswer(body.trim() || files.map(file => file.name).join(', '));
        Object.assign(rootFields, { answer, answeredAt: at });
        Object.assign(rootProps, { [columns.answer]: answer, [columns.answeredAt]: at });
      }
      const [inserted] = await Promise.all([
        insert({ body: body.trim(), anchor: thread.anchor, thread: root.recordKey, x: null, y: null, w: null, h: null,
          change: 'replied', files }),
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

  const sendNew = useCallback(async (body: string, files: readonly CommentFile[] = []) => {
    const pin = draftPin;
    if (!pin || (!body.trim() && !files.length)) return false;
    const target = anchors.find(item => item.recordKey === pin.anchorKey);
    const key = await insert({ body: body.trim(), anchor: target, thread: '', x: pin.x, y: pin.y, w: pin.w, h: pin.h,
      change: 'created', files });
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

  // Files: the host's transport and the table's files column. Rows tell whether the column exists; an empty table
  // asks the host once. A missing column leaves the pane text only and tells the Space's developer in the console.
  const files = runtime?.spaceFiles;
  const fileColumn = columns.attachments;
  const rowsHaveFiles = useMemo(() => query.hasData ? commentRowsHaveColumn(commentRowsOf(query.data), fileColumn) : null,
    [query.hasData, query.data, fileColumn]);
  const [checked, setChecked] = useState<{ key: string; mode: CommentAttachMode; maxBytes: number } | null>(null);
  const checkKey = `${database}|${fileColumn ?? ''}`;
  useEffect(() => {
    if (!files || !fileColumn || rowsHaveFiles !== null || !query.hasData || checked?.key === checkKey) return undefined;
    let current = true;
    files.check(database, fileColumn).then(
      answer => { if (current) setChecked({ key: checkKey, mode: 'on', maxBytes: answer.maxBytes }); },
      (error: unknown) => {
        if (!current) return;
        const code = error instanceof SpaceFileError ? error.code : '';
        // No answer is not a refusal: the pane offers files and an upload says what went wrong.
        const refused = ['space_file_column_missing', 'space_file_write_required', 'editor_required', 'sign_in_required',
          'space_unavailable', 'unknown_database'].includes(code);
        setChecked({ key: checkKey, mode: refused ? 'off' : 'on', maxBytes: SPACE_FILE_MAX_BYTES });
      });
    return () => { current = false; };
  }, [files, fileColumn, rowsHaveFiles, query.hasData, checked?.key, checkKey, database]);
  const attach: CommentAttachMode = !files || !fileColumn || rowsHaveFiles === false ? 'off'
    : rowsHaveFiles ? 'on' : checked?.key === checkKey ? checked.mode : 'checking';
  const warned = useRef(false);
  useEffect(() => {
    if (warned.current || !files || !fileColumn || !(rowsHaveFiles === false || checked?.key === checkKey && checked.mode === 'off')) return;
    warned.current = true;
    console.warn(`[comments] "${database}" has no files column named "${fileColumn}" this view can write, so comments `
      + `take text only. Add a files column named "${fileColumn}" to the Comments database (or pass columns.attachments).`);
  }, [files, fileColumn, rowsHaveFiles, checked, checkKey, database]);
  const maxFileBytes = checked?.key === checkKey ? checked.maxBytes : SPACE_FILE_MAX_BYTES;

  const uploadFile = useCallback(async (file: File, upload: {
    onProgress?(sent: number, total: number): void; signal?: AbortSignal;
  } = {}): Promise<CommentFile> => {
    if (!files || !fileColumn) throw new SpaceFileError('Files cannot be attached here.', 'space_file_column_missing');
    const result: SpaceFileUploadResult = await files.upload({ database, column: fileColumn, file, name: file.name,
      onProgress: upload.onProgress, signal: upload.signal });
    return { name: result.file.name, url: result.file.url, previewUrl: result.previewUrl };
  }, [files, fileColumn, database]);

  const refreshedAt = useRef(0);
  const refreshFiles = useCallback(() => {
    if (Date.now() - refreshedAt.current < 30000) return;
    refreshedAt.current = Date.now();
    void refetchRef.current();
  }, []);

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
    attach, maxFileBytes, uploadFile, refreshFiles,
    zones, dragZone, zoneHandlers,
    deleting, cancelDelete: () => setDeleting(null), confirmDelete, copyChanges, copying,
    busy, now, toaster, words, say, locale, me, signed, openThread,
    loading: query.loading && !query.hasData, hasData: query.hasData, error: query.error ?? null, refetch,
  };
}
