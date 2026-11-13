/**
 * The comment controller: reads a Comments database through the view's declared list, follows its live feed, writes
 * through the normal native mutations and keeps every change on screen at once (optimistic patches and drafts) until
 * the server rows carry it. `CommentPane`, `CommentPins`, `CommentToolBar` and `CommentThreadCard` render from it.
 *
 * People archive (Status `Resolved`, shown Done) and delete at once with a 6-second Undo toast and Z (SPC-124,
 * SPC-133); agents never archive through it. Deleting a first comment deletes its thread; a later one leaves a "Comment
 * deleted" line (SPC-127). Rights come from the host's viewer (SPC-128): you edit and delete your own comments, and a
 * whole thread or someone else's comment needs Space edit rights. Without a viewer nothing can be edited or deleted.
 * Under the host Comments panel a comment is written as the viewer (their name in Author, which the server stamps too)
 * and nothing can be sent until the viewer is known (`canWrite`).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent } from 'react';
import { useNativeMutation } from '../../hooks/useNativeDocuments';
import { useShown } from '../../hooks/useViewParams';
import { useNotisRuntime } from '../../provider';
import { SdkQueryError } from '../../queryErrors';
import { SPACE_FILE_MAX_BYTES, SpaceFileError, type SpaceCommentViewer, type SpaceFileUploadResult } from '../../space';
import { fillWords, pick, type Locale, type Words } from '../../words';
import { useToast, type ToastController } from '../actions/useToast';
import { ESCAPE_PRIORITY } from '../engine/core';
import { useEscapeLayer, useToolkitLocale } from '../engine/hooks';
import {
  COMMENT_COLUMNS, applyCommentPatches, clipCommentAnswer, commentAttachmentList, commentChangesSince, commentRowsHaveColumn, commentColumns, commentDigest, commentRowsOf,
  commentThreads, commentTimeOf, formatCommentTime, inCommentScope, newCommentId, readCommentRow, writeCommentClipboard,
  type CommentAnchor, type CommentChange, type CommentColumns, type CommentDigestOptions, type CommentGroup, type CommentPatch,
  type CommentRecord, type CommentScope, type CommentStatus, type CommentThread,
} from './commentModel';
import { commentDraftKey, forgetCommentDraft, hasDraftContent, readCommentDraft, writeCommentDraft } from './commentDrafts';
import { commentCopiedWords, commentWords, type CommentWordKey, type CommentWords } from './commentWords';
import { COMMENT_FOCUS_PARAM, useCommentFocusParam } from './hostComments';
import { useCommentRouting, type CommentRouting } from './useCommentRouting';

/** Which threads the pane lists: the current anchor's, or every thread in the scope. */
export type CommentAnchorFilter = 'anchor' | 'all';
/** Open threads (default), archived ones (Done, stored as `Resolved`) or both (SPC-126): what the pane shows. */
export type CommentStatusView = 'open' | 'done' | 'all';
/** A status filter as `setStatusFilter` takes it: 'resolved' is an older name of 'done' and reads as 'done'. */
export type CommentStatusFilter = CommentStatusView | 'resolved';

/**
 * What a new comment points at (SPC-118): words of the text, a point or a box on an anchor, some items (records or
 * rows), a moment of a recording, or the whole page (no anchor).
 */
export type CommentMode = 'text' | 'point' | 'box' | 'items' | 'time' | 'page';

/**
 * A new comment being written: on an anchor, with a pin (x and y, 0 to 1), a zone (w and h too, 0 to 1 of the
 * anchor's size) or neither (on the whole anchor; `anchorKey` null: on the whole page). `items` lists the record keys
 * (records or rows) of an items comment, `time` the seconds of a time comment.
 */
export interface CommentDraftPin {
  anchorKey: string | null; x: number | null; y: number | null; w: number | null; h: number | null;
  items?: readonly CommentAnchor[] | null; time?: number | null;
}

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
   * Adds a reply, with the files already uploaded for it. It answers `answers` (an input ask on the first comment or a
   * reply), else the latest open input ask in the thread; an archived thread stays archived (the server brings it back
   * when a reply waits for someone). True once saved.
   */
  reply(thread: CommentThread, body: string, files?: readonly CommentFile[], answers?: CommentRecord): Promise<boolean>;
  /** Answers a check or choice ask. */
  answer(root: CommentRecord, answer: string): void;
  /** Writes the status without a toast. People archive with `archive` and `unarchive`. */
  setStatus(root: CommentRecord, status: 'Open' | 'Resolved'): void;
  /** Archives an open thread (Done) with a 6-second Undo toast; Z undoes. */
  archive(root: CommentRecord): void;
  /** Brings an archived thread back to Open, with Undo. */
  unarchive(root: CommentRecord): void;
  /**
   * Deletes at once with Undo (no dialog): a first comment deletes its whole thread, a later one leaves a "Comment
   * deleted" line. Does nothing unless `canDelete` allows it.
   */
  remove(comment: CommentRecord): void;
  /** Same as `remove` on a thread's first comment. */
  askDelete(root: CommentRecord): void;
  /**
   * Saves new text for your own comment and marks it edited (Edited at, which Copy changes reports). Change keeps what
   * it said (an archive or an answer is never overwritten); without an Edited at column Change and Changed at mark the
   * edit unless they say resolved or answered. True once saved (or unchanged).
   */
  edit(comment: CommentRecord, body: string): Promise<boolean>;
  /**
   * Copies the link that opens this page with the thread revealed (`comment=<root key>`, as a push or a chat pill
   * opens it): the host's address for it (`commentLink`), else the page's own address with that param. A toast says
   * Link copied, or that it could not be copied. `host` (the card) holds the selection copy when the clipboard API is
   * refused. True once copied.
   */
  copyLink(root: CommentRecord, host?: HTMLElement | null): Promise<boolean>;
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
   * then no author. Pass it to sign comments with a fixed name. Ignored under the host Comments panel: the viewer's
   * name is used, for reading and writing.
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
  /**
   * Open this comment's thread (a root or a reply key) once it is read, and scroll to it. Default: the `comment` view
   * param of a link (`useCommentFocusParam`); null turns that off.
   */
  focusKey?: string | null;
  /**
   * The comment modes the Space offers (SPC-118), in the order the New comment menu and the tool bar list them.
   * Default: point (and box with zone columns) when there are anchors, items and time when their call-backs are given,
   * and the whole page. 'items' needs `onStartItems`, 'time' needs `currentTime`.
   */
  modes?: readonly CommentMode[];
  /**
   * Items mode: show your way of picking records or rows (checkboxes, a selection), then call
   * `controller.startItems(items)` with the anchors picked. The hint shows until then; Escape cancels.
   */
  onStartItems?(): void;
  /** Time mode: the current moment of the recording, in seconds. The new comment is written at that moment. */
  currentTime?(): number | null | undefined;
  /** Names of the pages (scope records, by id or record key) the Space home groups comments under. */
  scopeNames?: Readonly<Record<string, string>>;
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
  /**
   * The thread's pin number (1-based), 0 when it has none: per page (scope record), in the order its first comments
   * were written, deleted ones keeping theirs, so a number never moves and reads the same on the page and the Space home.
   */
  numberOf(thread: CommentThread): number;
  scope: CommentScope | null;
  anchors: readonly CommentAnchor[];
  anchorKey: string | null;
  anchor: CommentAnchor | undefined;

  filter: CommentAnchorFilter;
  setFilter(filter: CommentAnchorFilter): void;
  /** What the pane shows: never 'resolved' (typed wide so older comparisons with 'resolved' still compile). */
  statusFilter: CommentStatusFilter;
  /** 'resolved' is read as 'done'. */
  setStatusFilter(filter: CommentStatusFilter): void;
  /** Threads per status filter, for the current anchor filter. */
  counts: Readonly<Record<CommentStatusView, number>>;
  /** Threads per anchor filter ("This item", "All items"), for the current status filter. */
  scopeCounts: Readonly<Record<CommentAnchorFilter, number>>;
  /** True when the controller covers the whole Space (no scope record): the pane groups threads by page. */
  wholeSpace: boolean;
  /** The page a thread sits on, for grouping on the Space home: its scope record, else its anchor, else the Space. */
  groupOf(thread: CommentThread): CommentGroup | null;
  threadKey: string | null;
  setThreadKey(key: string | null): void;
  /** Picks a thread from the pane (a card): the page follows, the host panel stays as it is. */
  selectThread(thread: CommentThread): void;
  /**
   * Picks a thread from the page (a pin, a highlight, a key on the page): like `selectThread`, and asks the host to
   * show it in its Comments panel (`revealRequest` goes up by one).
   */
  revealThread(thread: CommentThread): void;
  /**
   * Starts at 0 and goes up by one each time a comment is picked on the page (C8). The host opens its Comments panel
   * on each increase and the pane scrolls the thread into view; picking inside the pane leaves it as it is.
   */
  revealRequest: number;

  actions: CommentActions;
  /** The signed-in viewer from the host (name and Space edit rights), or null while unknown. */
  viewer: SpaceCommentViewer | null;
  /** Whether the viewer may edit this comment: their own, never an agent's. */
  canEdit(comment: CommentRecord): boolean;
  /** Whether the viewer may delete it: their own comment; a whole thread or someone else's needs Space edit rights. */
  canDelete(comment: CommentRecord): boolean;
  /** False while the host's viewer is not known: Send stays off, so no comment is written under a wrong name. */
  canWrite: boolean;
  /** Threads, Goes to and the To chip (SPC-113, SPC-114, SPC-117). */
  routing: CommentRouting;

  /** The comment modes this Space offers, in order. */
  modes: readonly CommentMode[];
  /** The mode waiting for you to point at something (its hint shows), or null. */
  commentMode: CommentMode | null;
  /** Starts a mode: point and box wait for a click or drag, text for a selection, items for `startItems`; time and page open the box at once. */
  startMode(mode: CommentMode): void;
  cancelMode(): void;
  /** Items mode: starts a new comment on these anchors (records or rows). */
  startItems(items: readonly CommentAnchor[]): void;
  /** Whether the page comment tool bar shows (`CommentToolBar`, C toggles it). */
  toolBar: boolean;
  setToolBar(on: boolean): void;
  /** Add comment mode (point or box): the next click on the anchor drops a pin. Escape leaves it. */
  commenting: boolean;
  setCommenting(on: boolean): void;
  toggleCommenting(): void;
  draftPin: CommentDraftPin | null;
  /**
   * Names this page's comments (the Space, the table and the scope record) for the drafts the boxes keep while they are
   * away (`commentDrafts`): a reply, a new comment and an answer come back with what was typed and attached.
   */
  draftScope: string;
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
  /** Drops the new comment, and the thread picked for it. */
  cancelPin(): void;
  /** Saves the new comment with the files already uploaded for it. True once saved. */
  sendNew(body: string, files?: readonly CommentFile[]): Promise<boolean>;

  /** @deprecated Delete happens at once with Undo (SPC-133): always null. */
  deleting: CommentRecord | null;
  /** @deprecated Nothing to cancel: delete happens at once with Undo. */
  cancelDelete(): void;
  /** @deprecated Deletes `comment` at once with Undo (`actions.remove`); without one it does nothing. */
  confirmDelete(comment?: CommentRecord): Promise<void>;

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
/** The code of useShown's answer for a list this view cannot read (yet). */
const LIST_UNAVAILABLE = new SdkQueryError('listUnavailable').code;
/** How long a comment list that is not readable yet keeps the loading state before it reads as empty. */
const LIST_WAIT_MS = 8000;
const noop = () => {};

const MODE_ORDER: readonly CommentMode[] = ['text', 'point', 'box', 'items', 'time', 'page'];
/** Modes that wait for you to point at the page: on a phone the full-screen panel steps aside for them (SPC-132). */
const PAGE_MODES: ReadonlySet<CommentMode> = new Set(['point', 'box', 'items', 'time']);

/** A phone-width screen, where the host Comments panel covers the page. */
function narrowScreen(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 767px)').matches;
  } catch {
    return false;
  }
}

/** How long a delete's Undo toast stays on a touch screen (a coarse pointer, or a phone-width window). */
export const DELETE_UNDO_TOUCH_MS = 8000;

/** A touch screen: a coarse pointer or a window narrower than 768px. Desktop keeps the usual toast time. */
function touchScreen(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(pointer: coarse)').matches) return true;
  } catch { /* no media queries: read the width */ }
  return window.innerWidth > 0 && window.innerWidth < 768;
}

/**
 * The link that opens the page with one comment thread revealed: the host's (`commentLink`, a full address that names
 * the thread's own page, possibly later as a promise), else the page's own address with `comment=<root key>` (any
 * earlier comment param replaced). Null when neither is known.
 */
export function commentLinkFor(
  host: { commentLink?(input: { rootKey: string; database?: string }): string | null | Promise<string | null> } | null | undefined,
  rootKey: string, database?: string): string | null | Promise<string | null> {
  if (!rootKey) return null;
  if (host?.commentLink) {
    try {
      const link = host.commentLink(database ? { rootKey, database } : { rootKey });
      return typeof link === 'string' || link == null ? link || null : link.then(value => value || null, () => null);
    } catch {
      return null;
    }
  }
  if (typeof window === 'undefined' || !/^https?:$/.test(window.location.protocol)) return null;
  const url = new URL(window.location.href);
  url.hash = '';
  url.searchParams.set(COMMENT_FOCUS_PARAM, rootKey);
  return url.toString();
}

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
  const runtime = useNotisRuntime();
  const host = runtime?.spaceComments;
  const hostRef = useRef(host);
  hostRef.current = host;
  const hosted = Boolean(host);
  const viewer = host?.viewer ?? null;
  const {
    list = 'comments', database = 'comments', scope = null, anchors = NO_ANCHORS, anchorKey = null, me: fixedAuthor,
    authors: spaceAuthors, fallbackAuthor = 'Notis', pageSize = 500, live = true,
  } = options;
  // Under the host panel a comment is the viewer's: their name is the Author written (the server stamps it too) and
  // nothing is sent before it is known, never under `me` or a default name (C5). Elsewhere the viewer's first name
  // from the host context signs it, then "Person", then no author (SPC-267).
  const viewerName = runtime?.context?.viewerName?.trim() || null;
  const authorChoices = useMemo(() => commentAuthorCandidates(fixedAuthor, viewerName, spaceAuthors),
    [fixedAuthor, viewerName, spaceAuthors]);
  // The first author the Author column accepted this session (an index into the choices).
  const [authorIndex, setAuthorIndex] = useState(0);
  const authorIndexRef = useRef(0);
  useEffect(() => { authorIndexRef.current = 0; setAuthorIndex(0); }, [authorChoices]);
  const author: string | null = hosted ? viewer?.name || null
    : authorChoices[Math.min(authorIndex, authorChoices.length - 1)] ?? null;
  const me = author ?? fixedAuthor ?? '';
  const canWrite = hosted ? Boolean(author) : true;
  const signed = useCallback(async <T,>(write: (author: string | null) => Promise<T>): Promise<T> => {
    // The host panel's viewer is the only author there: no other name is tried.
    if (hosted) return write(author);
    for (let index = authorIndexRef.current; ; index += 1) {
      const candidate = authorChoices[index] ?? null;
      try {
        const result = await write(candidate);
        if (index !== authorIndexRef.current) { authorIndexRef.current = index; setAuthorIndex(index); }
        return result;
      } catch (error) {
        if (index >= authorChoices.length || !isRefusedChoice(error)) throw error;
      }
    }
  }, [hosted, author, authorChoices]);
  // The viewer's name reads as itself even when the Space lists its own authors.
  const authors = spaceAuthors && author && !spaceAuthors.includes(author) ? [...spaceAuthors, author] : spaceAuthors;
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
  // Loading until the first read settles, with rows or a read error (C4). Under the host panel a list not readable yet
  // (the page still opening in a new tab) is still loading, never an empty list for a moment.
  // A list that is still not readable after LIST_WAIT_MS was never declared: stop waiting and show the empty state.
  const listNotReady = (query.error as { code?: unknown } | null | undefined)?.code === LIST_UNAVAILABLE;
  const [listWaitOver, setListWaitOver] = useState(false);
  useEffect(() => {
    if (!listNotReady) return undefined;
    const timer = setTimeout(() => setListWaitOver(true), LIST_WAIT_MS);
    return () => clearTimeout(timer);
  }, [listNotReady]);
  const firstReadPending = !query.hasData
    && (query.loading || (Boolean(host) && (listNotReady ? !listWaitOver : !query.error)));
  const refetch = query.refetch;
  const queryDataRef = useRef(query.data);
  queryDataRef.current = query.data;
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
  // Each toast shown gets a number: a toast that comes late (a partial delete) shows only when none came after it.
  const toastSeq = useRef(0);
  const showToast = toaster.notify;
  const notify = useCallback<ToastController['notify']>((...args) => {
    toastSeq.current += 1;
    return showToast(...args);
  }, [showToast]);

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
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const anchorsRef = useRef(anchors);
  anchorsRef.current = anchors;
  const anchorKeyRef = useRef(anchorKey);
  anchorKeyRef.current = anchorKey;

  const rootKeys = useMemo(() => threads.map(thread => thread.root.recordKey).filter(key => !key.startsWith('draft-')), [threads]);
  // The page's drafts (`commentDrafts`) and the thread its next new comment goes to are kept under this key.
  const draftScope = `${runtime?.resource?.id ?? runtime?.app?.id ?? ''}|${list}|${database}|${scopeKey ?? ''}`;
  const routing = useCommentRouting({
    database, rootKeys, recordKey: scope?.recordKey ?? null, draftScope, fallbackOpen: openThread,
    onLinkFailed: () => notify(words.saveError, { tone: 'danger' }),
  });
  const linkNew = routing.linkNew;
  const rereadLinks = routing.reread;

  const checkpoint = useMemo(() => {
    const saved = scope?.checkpoint ?? null;
    if (marker && (commentTimeOf(saved) || 0) < commentTimeOf(marker)) return marker;
    return saved;
  }, [scope?.checkpoint, marker]);
  const changes = useMemo(() => commentChangesSince(inScope, checkpoint, me), [inScope, checkpoint, me]);

  // Written by the viewer: the row's creator when the server names it (a renamed person keeps their comments), else
  // the Author name. Sent drafts count: they carry the viewer's name.
  const byViewer = useCallback((comment: CommentRecord) => {
    if (comment.agent) return false;
    if (viewer && comment.createdByYou != null) return comment.createdByYou;
    if (viewer?.id && comment.createdBy) return comment.createdBy === viewer.id;
    return comment.author === me;
  }, [viewer, me]);

  const lastTurn = commentTimeOf(checkpoint) || 0;
  // The time of the viewer's latest comment in each thread: what came before it in that thread was seen.
  const seenUntil = useMemo(() => {
    const seen = new Map<string, number>();
    for (const comment of inScope) {
      if (!byViewer(comment)) continue;
      const rootKey = comment.thread || comment.recordKey;
      const at = commentTimeOf(comment.createdAt) || 0;
      if (at > (seen.get(rootKey) ?? 0)) seen.set(rootKey, at);
    }
    return seen;
  }, [inScope, byViewer]);
  // An agent's ask that has its answer is no longer new: answering it clears its dot. A reply of the viewer's in the
  // thread clears the dots of what came before it.
  const isNew = useCallback((comment: CommentRecord) => {
    if (byViewer(comment) || (comment.needs !== 'none' && comment.answer)) return false;
    const at = commentTimeOf(comment.createdAt) || 0;
    return at > lastTurn && at > (seenUntil.get(comment.thread || comment.recordKey) ?? 0);
  }, [byViewer, lastTurn, seenUntil]);

  const threadsOn = useCallback((key: string | null | undefined) =>
    threads.filter(thread => (thread.anchor?.recordKey ?? null) === (key ?? null)), [threads]);
  // Pin numbers per page, by when each thread's first comment was written, deleted ones included (SPC-118).
  const pinNumbers = useMemo(() => {
    const pages = new Map<string, CommentRecord[]>();
    for (const comment of comments) {
      if (comment.thread) continue;
      const page = comment.scopeIds[0] ?? '';
      pages.set(page, [...(pages.get(page) ?? []), comment]);
    }
    const numbers = new Map<string, number>();
    const created = (comment: CommentRecord) => commentTimeOf(comment.createdAt) || 0;
    for (const roots of pages.values()) {
      roots.sort((a, b) => created(a) - created(b) || (a.recordKey < b.recordKey ? -1 : a.recordKey > b.recordKey ? 1 : 0));
      roots.forEach((root, index) => numbers.set(root.recordKey, index + 1));
    }
    return numbers;
  }, [comments]);
  const numberOf = useCallback((thread: CommentThread) => pinNumbers.get(thread.root.recordKey) ?? 0, [pinNumbers]);
  const anchor = useMemo(() => anchors.find(item => item.recordKey === anchorKey), [anchors, anchorKey]);

  const [filter, setFilter] = useState<CommentAnchorFilter>('anchor');
  const [statusFilter, setStatusFilterState] = useState<CommentStatusView>('open');
  const setStatusFilter = useCallback((value: CommentStatusFilter) =>
    setStatusFilterState(value === 'resolved' ? 'done' : value), []);
  const [revealRequest, setRevealRequest] = useState(0);
  const [threadKey, setThreadKey] = useState<string | null>(null);
  // A new comment being written outlives the pane (another Space, a page over the view): its pin comes back with the
  // text and files its box kept (`commentDrafts`), and a draft with nothing in it does not.
  const newDraftKey = commentDraftKey(draftScope, 'new');
  const restoredPin = (key: string | null): CommentDraftPin | null => {
    const stored = readCommentDraft(key);
    return hasDraftContent(stored) && stored?.place ? stored.place as CommentDraftPin : null;
  };
  const [draftPin, setDraftPin] = useState<CommentDraftPin | null>(() => restoredPin(newDraftKey));
  const pinKeyRef = useRef(newDraftKey);
  useEffect(() => {
    if (pinKeyRef.current !== newDraftKey) {
      // Another page: its own new comment, if one was left there.
      pinKeyRef.current = newDraftKey;
      setDraftPin(restoredPin(newDraftKey));
      return;
    }
    writeCommentDraft(newDraftKey, { place: draftPin ?? undefined });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newDraftKey, draftPin]);
  const [commentMode, setCommentMode] = useState<CommentMode | null>(null);
  const [toolBar, setToolBar] = useState(false);
  const [copying, setCopying] = useState(false);
  const commenting = commentMode === 'point' || commentMode === 'box';

  // No anchors: the anchor filter would list nothing, so the pane shows every thread.
  const effectiveFilter: CommentAnchorFilter = anchors.length ? filter : 'all';
  const scoped = useMemo(() => effectiveFilter === 'anchor' ? threadsOn(anchorKey) : threads,
    [effectiveFilter, threadsOn, anchorKey, threads]);
  const counts = useMemo(() => ({
    open: scoped.filter(thread => thread.root.status === 'Open').length,
    done: scoped.filter(thread => thread.root.status === 'Resolved').length,
    all: scoped.length,
  }), [scoped]);
  const visibleThreads = useMemo(() => statusFilter === 'all' ? scoped
    : scoped.filter(thread => thread.root.status === (statusFilter === 'done' ? 'Resolved' : 'Open')), [statusFilter, scoped]);
  const scopeCounts = useMemo(() => {
    const shown = (thread: CommentThread) => statusFilter === 'all'
      || thread.root.status === (statusFilter === 'done' ? 'Resolved' : 'Open');
    return { anchor: threadsOn(anchorKey).filter(shown).length, all: threads.filter(shown).length };
  }, [statusFilter, threadsOn, anchorKey, threads]);

  const selectThread = useCallback((thread: CommentThread) => {
    setThreadKey(thread.root.recordKey);
    setDraftPin(null);
    setCommentMode(null);
    setStatusFilterState(current => current === 'all' ? current : thread.root.status === 'Resolved' ? 'done' : 'open');
    latest.current.onSelectThread?.(thread);
  }, []);
  const revealThread = useCallback((thread: CommentThread) => {
    selectThread(thread);
    setRevealRequest(current => current + 1);
  }, [selectThread]);

  // A link to one comment (a push, a chat pill): open its thread once it is read, in the host panel (a reveal), and the
  // pane scrolls it into view.
  const urlFocus = useCommentFocusParam();
  const focusKey = options.focusKey === undefined ? urlFocus : options.focusKey;
  const focused = useRef<string | null>(null);
  useEffect(() => {
    // A link the host took away is forgotten, so a later link to the same comment opens it again.
    if (!focusKey) { focused.current = null; return; }
    if (focused.current === focusKey) return;
    const thread = threads.find(item => item.root.recordKey === focusKey || item.replies.some(reply => reply.recordKey === focusKey));
    if (!thread) return;
    focused.current = focusKey;
    if (anchors.length && (thread.anchor?.recordKey ?? null) !== anchorKey) setFilter('all');
    revealThread(thread);
  }, [focusKey, threads, anchors.length, anchorKey, revealThread]);

  // Grouping on the Space home: the page (scope record) a thread is on, numbered in the order pages first come.
  const wholeSpace = scope == null;
  const pageNumbers = useMemo(() => {
    const numbers = new Map<string, number>();
    for (const thread of threads) {
      const id = thread.root.scopeIds[0];
      if (id && !numbers.has(id)) numbers.set(id, numbers.size + 1);
    }
    return numbers;
  }, [threads]);
  const groupOf = useCallback((thread: CommentThread): CommentGroup | null => {
    const id = thread.root.scopeIds[0];
    const names = latest.current.scopeNames;
    if (id) return { key: `page:${id}`, label: names?.[id] ?? say('pageN', { n: pageNumbers.get(id) ?? 1 }) };
    if (thread.anchor) return { key: `anchor:${thread.anchor.recordKey}`, label: thread.anchor.title || say('anchorLabel', { n: thread.anchor.order }) };
    return { key: 'space', label: say('wholeSpace') };
  }, [pageNumbers, say]);

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

  // Writes in flight and the revisions they returned, by record key: a write (an Undo right after an archive) waits for
  // the one before it and sends the revision that one returned, never the stale one the list still shows.
  const inFlight = useRef(new Map<string, Promise<unknown>>());
  const written = useRef(new Map<string, number>());

  /**
   * Writes one comment row and shows the change at once. `title` also writes the comment's text; `quiet` leaves the
   * failure toast to the caller (an Undo, whose toast says it could not undo). True once saved.
   */
  const updateRoot = useCallback(async (root: CommentRecord, fields: Partial<CommentRecord>, properties: Record<string, unknown>,
    write: { title?: string; quiet?: boolean } = {}) => {
    if (schemaRevision == null) {
      if (!write.quiet) fail(new Error('Comments schema revision unknown'));
      return false;
    }
    const key = root.recordKey;
    if (key.startsWith('draft-')) return false;
    const previous = patchesRef.current[key];
    setPatches(current => ({ ...current, [key]: { fields: { ...(current[key]?.fields ?? {}), ...fields }, revision: null } }));
    setBusyKey(key, true);
    const before = inFlight.current.get(key);
    let done: () => void = () => {};
    const mine = new Promise<void>(resolve => { done = resolve; });
    inFlight.current.set(key, mine);
    try {
      if (before) await before.catch(() => undefined);
      const listed = commentsRef.current.find(comment => comment.recordKey === key)?.revision ?? root.revision;
      const revision = Math.max(listed, written.current.get(key) ?? 0);
      const sent = onlyKnown(properties);
      if (!Object.keys(sent).length && write.title === undefined) {
        throw new Error(`The Comments database has none of the columns ${Object.keys(properties).join(', ')}`);
      }
      const receipt = await updateMutation.mutate({ record_key: key, expected_revision: revision, properties: sent,
        ...(write.title !== undefined ? { columns: { title: write.title } } : {}) }, { schemaRevision, requestId: newCommentId() });
      if (typeof receipt.revision === 'number') written.current.set(key, receipt.revision);
      // Only the latest write on this row stamps its patch: a queued write (an Undo) owns the fields shown, and a
      // revision stamped now would let the list drop them before that write is saved.
      if (inFlight.current.get(key) === mine) {
        setPatches(current => current[key] ? { ...current, [key]: { ...current[key], revision: receipt.revision } } : current);
      }
      void refetch();
      return true;
    } catch (error) {
      // A failed write puts back what was shown before it, unless a later write already shows its own fields.
      if (inFlight.current.get(key) === mine) {
        const back = previous && previous.revision == null && written.current.has(key)
          ? { ...previous, revision: written.current.get(key)! } : previous;
        setPatches(current => {
          const next = { ...current };
          if (back) next[key] = back; else delete next[key];
          return next;
        });
      }
      if (write.quiet) console.warn('[comments] write failed', error); else fail(error);
      return false;
    } finally {
      if (inFlight.current.get(key) === mine) inFlight.current.delete(key);
      done();
      if (!inFlight.current.has(key)) setBusyKey(key, false);
    }
  }, [schemaRevision, updateMutation, refetch, fail, setBusyKey, onlyKnown]);

  /** Status fields and the Change columns, for an update. */
  const changeProps = useCallback((change: CommentChange, at: string, extra: Record<string, unknown> = {}) => ({
    ...extra, [columns.change]: change, [columns.changedAt]: at,
  }), [columns]);

  /** True when the Comments database has this column: as its list answer names them, else as its rows show. */
  const hasColumn = useCallback((name: string | null) => {
    if (!name) return false;
    const known = knownRef.current;
    if (known) return known.has(name.toLowerCase());
    return commentRowsHaveColumn(commentRowsOf(queryDataRef.current), name) === true;
  }, []);

  const insert = useCallback(async (fields: {
    body: string; anchor: CommentAnchor | undefined; thread: string; x: number | null; y: number | null;
    w: number | null; h: number | null; change: 'created' | 'replied'; files?: readonly CommentFile[];
    items?: readonly CommentAnchor[]; time?: number | null; answerTo?: string | null;
  }): Promise<string | false> => {
    const files = columns.attachments ? fields.files ?? [] : [];
    if (schemaRevision == null) { fail(new Error('Comments schema revision unknown')); return false; }
    // Send stays off until the viewer is known; nothing is written under another name meanwhile.
    if (!canWrite) { console.warn('[comments] the viewer is not known yet: nothing was sent'); return false; }
    const at = new Date().toISOString();
    const tempKey = `draft-${newCommentId()}`;
    const currentScope = latest.current.scope ?? null;
    const on = fields.items?.length ? fields.items : fields.anchor ? [fields.anchor] : [];
    // Time mode: the Time column when the table has it, else the moment starts the text.
    const time = fields.time ?? null;
    const timeColumn = time != null && columns.time && (!knownRef.current || hasColumn(columns.time)) ? columns.time : null;
    const body = time != null && !timeColumn ? `${formatCommentTime(time)} ${fields.body}`.trim() : fields.body;
    // The ask a reply answers is always sent: a table without the Answer to column yet gets it from the server on its
    // first answer (or takes a plain reply when that fails). A renamed column is sent only once the table has it, since
    // the server adds only the default name (or a Space agent's declared rename).
    const answerToColumn = fields.answerTo && columns.answerTo
      && (hasColumn(columns.answerTo) || columns.answerTo === COMMENT_COLUMNS.answerTo) ? columns.answerTo : null;
    const comment: CommentRecord = {
      id: tempKey, recordKey: tempKey, revision: 0, body,
      scopeIds: currentScope ? [currentScope.id] : [], anchorIds: on.map(item => item.id),
      thread: fields.thread, author: me, x: fields.x, y: fields.y,
      w: columns.w && columns.h ? fields.w : null, h: columns.w && columns.h ? fields.h : null, status: 'Open', needs: 'none', options: [], answer: '',
      answeredAt: null, change: fields.change, changedAt: at, example: false, createdAt: at,
      attachments: commentAttachmentList(files.map(file => ({ name: file.name, url: file.previewUrl || file.url }))),
      time: timeColumn ? time : null,
      answerTo: answerToColumn ? fields.answerTo! : null,
    };
    setDrafts(current => [...current, { comment, serverKey: null }]);
    const properties: Record<string, unknown> = {
      [columns.status]: 'Open', [columns.needs]: 'none', [columns.example]: false,
      ...changeProps(fields.change, at),
    };
    if (columns.scope && currentScope) properties[columns.scope] = [currentScope.id];
    if (columns.anchor && on.length) properties[columns.anchor] = on.map(item => item.id);
    if (timeColumn) properties[timeColumn] = Number(time!.toFixed(2));
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
      const receipt = await signed(signer => insertMutation.mutate({ columns: { title: body }, properties: {
        ...onlyKnown(signer ? { ...properties, [columns.author]: signer } : properties),
        ...(answerToColumn ? { [answerToColumn]: fields.answerTo } : {}),
      } }, { schemaRevision, requestId: newCommentId(), showIn: [] }));
      setDrafts(current => current.map(draft => draft.comment.recordKey === tempKey ? { ...draft, serverKey: receipt.record_key } : draft));
      void refetch();
      return receipt.record_key;
    } catch (error) {
      setDrafts(current => current.filter(draft => draft.comment.recordKey !== tempKey));
      fail(error);
      return false;
    }
  }, [schemaRevision, me, canWrite, signed, columns, changeProps, insertMutation, refetch, fail, onlyKnown, hasColumn]);

  // Rights (SPC-128): your own comments; a whole thread or someone else's comment needs Space edit rights. Yours means
  // you created the row (the server says so, or its creator id is yours): a renamed person keeps their comments. The
  // Author name decides only for a row that names no creator.
  const own = useCallback((comment: CommentRecord) => Boolean(viewer) && !comment.recordKey.startsWith('draft-')
    && byViewer(comment), [viewer, byViewer]);
  const canEdit = useCallback((comment: CommentRecord) => own(comment) && comment.status !== 'Deleted', [own]);
  const canDelete = useCallback((comment: CommentRecord) => {
    if (!viewer || comment.recordKey.startsWith('draft-') || comment.status === 'Deleted') return false;
    if (viewer.canEditSpace) return true;
    if (comment.thread) return own(comment);
    const thread = threadsRef.current.find(item => item.root.recordKey === comment.recordKey);
    return own(comment) && (thread?.replies ?? []).every(reply => reply.status === 'Deleted' || own(reply));
  }, [viewer, own]);

  /**
   * Puts rows back as they were (an Undo). Throws when one fails, so the toast says it could not undo. Change and
   * Changed at that were empty are written empty again (null), so Copy changes never reports what was undone.
   */
  const restore = useCallback(async (snapshot: ReadonlyArray<CommentRecord>) => {
    const results = await Promise.all(snapshot.map(before => {
      const properties: Record<string, unknown> = {
        [columns.status]: before.status, [columns.change]: before.change ?? null, [columns.changedAt]: before.changedAt ?? null,
      };
      return updateRoot(before, { status: before.status, change: before.change, changedAt: before.changedAt }, properties,
        { quiet: true });
    }));
    if (results.some(ok => !ok)) throw new Error('Comments could not be restored');
  }, [columns, updateRoot]);

  const writeStatus = useCallback((root: CommentRecord, status: CommentStatus) => {
    const at = new Date().toISOString();
    const change: CommentChange = status === 'Resolved' ? 'resolved' : status === 'Deleted' ? 'deleted' : 'reopened';
    return updateRoot(root, { status, change, changedAt: at }, changeProps(change, at, { [columns.status]: status }));
  }, [updateRoot, changeProps, columns]);

  /** Status writes for a delete, without their own failure toast: the delete says one outcome for all of them. */
  const writeDeleted = useCallback((target: CommentRecord) => {
    const at = new Date().toISOString();
    return updateRoot(target, { status: 'Deleted', change: 'deleted', changedAt: at },
      changeProps('deleted', at, { [columns.status]: 'Deleted' }), { quiet: true });
  }, [updateRoot, changeProps, columns]);

  const remove = useCallback((comment: CommentRecord) => {
    if (!canDelete(comment)) return;
    const root = !comment.thread;
    const thread = root ? threadsRef.current.find(item => item.root.recordKey === comment.recordKey) : undefined;
    const targets = [comment, ...(thread?.replies ?? []).filter(reply => reply.status !== 'Deleted' && !reply.recordKey.startsWith('draft-'))];
    if (root) setThreadKey(current => current === comment.recordKey ? null : current);
    // Every row at once; Undo puts back the ones whose delete was saved (it waits for them first).
    const writes = Promise.allSettled(targets.map(target => writeDeleted(target)));
    const saved = writes.then(results => targets.filter((_, index) => {
      const result = results[index]!;
      return result.status === 'fulfilled' && result.value;
    }));
    let undone = false;
    const undo = async () => { undone = true; await restore(await saved); };
    // On a touch screen the Undo is harder to reach in time: it stays DELETE_UNDO_TOUCH_MS there, or until dismissed.
    const durationMs = touchScreen() ? DELETE_UNDO_TOUCH_MS : undefined;
    notify(root ? words.threadDeleted : words.commentDeletedToast, { undo, durationMs });
    const shown = toastSeq.current;
    void saved.then(done => {
      // A newer toast (another delete's Undo) stays: this late outcome never replaces it.
      if (done.length === targets.length || undone || toastSeq.current !== shown) return;
      // One outcome: nothing deleted says so; part of a thread deleted keeps Undo for that part.
      if (!done.length) notify(words.saveError, { tone: 'danger' });
      else notify(words.deletePartial, { tone: 'danger', undo, durationMs });
    });
  }, [canDelete, writeDeleted, notify, words, restore]);

  const actions: CommentActions = useMemo(() => ({
    reply: async (thread, body, files = [], answers) => {
      const { root } = thread;
      if (root.recordKey.startsWith('draft-') || (!body.trim() && !files.length)) return false;
      const at = new Date().toISOString();
      // The reply answers the latest open input ask in the thread: the first comment's, or an agent reply's.
      const open = (item: CommentRecord) => item.needs === 'input' && !item.answer && item.status !== 'Deleted'
        && !item.recordKey.startsWith('draft-');
      const asking = answers && open(answers) ? answers : [...thread.replies].reverse().concat(root).find(open);
      const answer = asking ? clipCommentAnswer(body.trim() || files.map(file => file.name).join(', ')) : null;
      // The ask's Answer is written first, then the one reply that shows it, naming the ask in Answer to: the server
      // reads that reply as the answer, sends it to the asking agent's thread only (never the comment thread's first
      // link, W1) and re-arms nobody's waiting inbox with it (W3).
      if (asking && answer != null) {
        await updateRoot(asking, { answer, answeredAt: at }, { [columns.answer]: answer, [columns.answeredAt]: at });
      }
      const inserted = await insert({ body: body.trim(), anchor: thread.anchor, thread: root.recordKey, x: null, y: null,
        w: null, h: null, change: 'replied', files, answerTo: asking && answer != null ? asking.recordKey : null });
      // The wake may now start the thread this reply goes to: read where it goes again until it names it (K30).
      if (inserted) rereadLinks(root.recordKey);
      return Boolean(inserted);
    },
    answer: (root, answer) => {
      const at = new Date().toISOString();
      void updateRoot(root, { answer, answeredAt: at, change: 'answered', changedAt: at },
        changeProps('answered', at, { [columns.answer]: answer, [columns.answeredAt]: at }));
    },
    setStatus: (root, status) => { void writeStatus(root, status); },
    archive: root => {
      if (root.status !== 'Open' || root.recordKey.startsWith('draft-')) return;
      void writeStatus(root, 'Resolved');
      notify(words.archived, { undo: () => restore([root]) });
    },
    unarchive: root => {
      if (root.status !== 'Resolved') return;
      void writeStatus(root, 'Open');
      notify(words.unarchived, { undo: () => restore([root]) });
    },
    remove,
    askDelete: root => remove(root),
    edit: async (comment, body) => {
      const text = body.trim();
      if (!canEdit(comment) || (!text && !comment.attachments.length)) return false;
      if (text === comment.body) return true;
      const at = new Date().toISOString();
      // Edited at marks the edit and Copy changes reports it from there; Change keeps what it says (an archive or an
      // answer stays). A table without Edited at marks the edit in Change and Changed at, unless they say resolved or
      // answered.
      if (hasColumn(columns.editedAt)) {
        return updateRoot(comment, { body: text, editedAt: at }, { [columns.editedAt!]: at }, { title: text });
      }
      if (comment.change === 'resolved' || comment.change === 'answered') {
        return updateRoot(comment, { body: text }, {}, { title: text });
      }
      const change: CommentChange = comment.thread ? 'replied' : 'created';
      return updateRoot(comment, { body: text, editedAt: at, change, changedAt: at }, changeProps(change, at), { title: text });
    },
    copyLink: async (root, element = null) => {
      const link = root.recordKey.startsWith('draft-') ? null : commentLinkFor(hostRef.current, root.recordKey, database);
      const copied = link ? await writeCommentClipboard(link, element) : false;
      notify(copied ? words.linkCopied : words.linkCopyFailed, copied ? undefined : { tone: 'danger' });
      return copied;
    },
    notify: text => notify(text),
  }), [insert, updateRoot, changeProps, columns, notify, writeStatus, words, restore, remove, canEdit, hasColumn, rereadLinks,
    database]);

  const shownToaster = useMemo<ToastController>(() => ({ ...toaster, notify }), [toaster, notify]);

  const confirmDelete = useCallback(async (comment?: CommentRecord) => { if (comment) remove(comment); }, [remove]);

  /** Opens the new comment box. A comment with no anchor on a page that has anchors shows under All. */
  const openDraft = useCallback((pin: CommentDraftPin) => {
    setCommentMode(null);
    setDraftPin(pin);
    setThreadKey(null);
    // The list's filters change only when they would hide the new comment once sent. "This item" lists the threads of
    // the item shown: a comment on another item, or on the whole page (it has no item), would be hidden by it, so the
    // list widens to every item; a comment on items, or on the item shown, keeps the filter as it is. Done hides an
    // open comment, so it goes back to Open; Open and All both show it.
    setFilter(current => {
      if (current === 'all' || !anchorsRef.current.length || pin.items?.length) return current;
      return (pin.anchorKey ?? null) === anchorKeyRef.current ? current : 'all';
    });
    setStatusFilterState(current => current === 'done' ? 'open' : current);
  }, []);

  const placePin = useCallback((key: string | null, x: number | null, y: number | null,
    w: number | null = null, h: number | null = null) => {
    openDraft({ anchorKey: key, x, y, w: x == null || y == null ? null : w, h: x == null || y == null ? null : h });
  }, [openDraft]);

  const placePinFromEvent = useCallback((event: ReactMouseEvent<HTMLElement>, key: string | null) => {
    if (!commenting) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.width ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0.5;
    const y = rect.height ? Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) : 0.5;
    placePin(key, x, y);
    return true;
  }, [commenting, placePin]);

  const clearPick = routing.clearPick;
  // Cancel forgets what the new comment kept (text, files, pin), as Escape on an empty box does.
  const cancelPin = useCallback(() => { setDraftPin(null); clearPick(); forgetCommentDraft(newDraftKey); }, [clearPick, newDraftKey]);

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
    const target = pin.items?.length ? pin.items[0] : anchors.find(item => item.recordKey === pin.anchorKey);
    const key = await insert({ body: body.trim(), anchor: target, thread: '', x: pin.x, y: pin.y, w: pin.w, h: pin.h,
      change: 'created', files, items: pin.items ?? undefined, time: pin.time ?? null });
    if (!key) return false;
    setDraftPin(null);
    setThreadKey(key);
    // The new comment thread goes to the thread picked with the chip or @, else the best match (SPC-117).
    void linkNew(key);
    return true;
  }, [draftPin, anchors, insert, linkNew]);

  const setCommenting = useCallback((on: boolean) => {
    if (on) setDraftPin(null);
    else endDrag();
    setCommentMode(current => on ? current === 'box' ? 'box' : 'point' : current === 'point' || current === 'box' ? null : current);
  }, [endDrag]);
  const toggleCommenting = useCallback(() => {
    setDraftPin(null);
    endDrag();
    setCommentMode(current => current === 'point' || current === 'box' ? null : 'point');
  }, [endDrag]);

  // The modes this Space offers (SPC-118): its own list, else what its anchors and call-backs allow.
  const modesKey = options.modes?.join('|') ?? null;
  const hasItems = Boolean(options.onStartItems);
  const hasTime = Boolean(options.currentTime);
  const modes = useMemo<readonly CommentMode[]>(() => {
    if (modesKey != null) {
      const asked = modesKey ? modesKey.split('|') as CommentMode[] : [];
      return asked.filter((mode, index) => MODE_ORDER.includes(mode) && asked.indexOf(mode) === index);
    }
    const list: CommentMode[] = [];
    if (anchors.length) list.push('point');
    if (anchors.length && zones) list.push('box');
    if (hasItems) list.push('items');
    if (hasTime) list.push('time');
    list.push('page');
    return list;
  }, [modesKey, anchors.length, zones, hasItems, hasTime]);

  const cancelMode = useCallback(() => { endDrag(); setCommentMode(null); }, [endDrag]);
  const startItems = useCallback((items: readonly CommentAnchor[]) => {
    if (!items.length) { setCommentMode(null); return; }
    openDraft({ anchorKey: items[0].recordKey, x: null, y: null, w: null, h: null, items: [...items] });
  }, [openDraft]);
  const startMode = useCallback((mode: CommentMode) => {
    endDrag();
    // On a phone the full-screen panel covers the page: it steps aside and the page tool bar shows the hint; the panel
    // comes back when the new comment starts (SPC-132).
    const showPage = hostRef.current?.showPage;
    if (PAGE_MODES.has(mode) && showPage && narrowScreen()) {
      setToolBar(true);
      try { showPage.call(hostRef.current); } catch (error) { console.warn('[comments] showPage failed', error); }
    }
    if (mode === 'page') { openDraft({ anchorKey: null, x: null, y: null, w: null, h: null }); return; }
    if (mode === 'time') {
      const at = latest.current.currentTime?.();
      openDraft({ anchorKey: latest.current.anchorKey ?? null, x: null, y: null, w: null, h: null,
        time: typeof at === 'number' && Number.isFinite(at) ? Math.max(0, at) : 0 });
      return;
    }
    setDraftPin(null);
    setThreadKey(null);
    setCommentMode(mode);
    if (mode === 'items') latest.current.onStartItems?.();
  }, [endDrag, openDraft]);

  // Escape leaves a comment mode (and drops a zone being dragged) before anything else on the page reacts.
  useEscapeLayer(`comments.${database}.mode`, () => { cancelMode(); return true; },
    { priority: ESCAPE_PRIORITY.selection + 2, enabled: commentMode != null });

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
    const text = commentDigest({ scope: scope ? { ...scope, checkpoint } : null, comments: inScope, anchors, changes, nowIso: at,
      since: checkpoint }, { me, columns: options.columns, ...(latest.current.digest ?? {}) });
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
    filter: effectiveFilter, setFilter, statusFilter, setStatusFilter, counts, scopeCounts, wholeSpace, groupOf,
    threadKey, setThreadKey, selectThread, revealThread, revealRequest,
    actions, viewer, canEdit, canDelete, canWrite, routing,
    modes, commentMode, startMode, cancelMode, startItems, toolBar, setToolBar,
    commenting, setCommenting, toggleCommenting, draftPin, draftScope, placePin, placePinFromEvent, cancelPin, sendNew,
    deleting: null, cancelDelete: noop, confirmDelete,
    attach, maxFileBytes, uploadFile, refreshFiles,
    zones, dragZone, zoneHandlers,
    copyChanges, copying,
    busy, now, toaster: shownToaster, words, say, locale, me, signed, openThread,
    loading: firstReadPending, hasData: query.hasData, error: query.error ?? null, refetch,
  };
}
