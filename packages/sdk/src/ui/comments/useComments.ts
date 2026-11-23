/**
 * The comment controller: reads the page's comments from the Space's one comment store through the host Comments
 * transport (`runtime.spaceComments`), lists them again whenever the host says they may have changed, writes through
 * the same transport and keeps every change on screen at once (optimistic patches and drafts) until the stored row
 * comes back. `CommentPane`, `CommentPins` and `CommentToolBar` render from it.
 *
 * People archive (shown Done) and delete at once with a 6-second Undo toast and Z (SPC-124, SPC-133); agents never
 * archive through it. Deleting a first comment deletes its thread; a later one leaves a "Comment deleted" line
 * (SPC-127). Rights come from the host's viewer (SPC-128): you edit and delete your own comments, and a whole thread or
 * someone else's comment needs Space edit rights. Without a viewer nothing can be sent, edited or deleted. Without the
 * transport (comments off, a Site, a link, a preview, an older host) there are no comments at all.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent } from 'react';
import { useNotisRuntime } from '../../provider';
import {
  SPACE_FILE_MAX_BYTES, SpaceFileError, type SpaceCommentAnchor, type SpaceCommentFile, type SpaceCommentInsert,
  type SpaceCommentPageKey, type SpaceCommentRow, type SpaceCommentsTransport, type SpaceCommentThreadsAnswer,
  type SpaceCommentViewer,
} from '../../space';
import { fillWords, pick, type Locale, type Words } from '../../words';
import { useToast, type ToastController } from '../actions/useToast';
import { ESCAPE_PRIORITY } from '../engine/core';
import { useEscapeLayer, useToolkitLocale } from '../engine/hooks';
import {
  applyCommentPatches, clipCommentAnswer, commentAttachmentList, commentChangesSince, commentDigest, commentFromRow,
  commentThreads, commentTimeOf, inCommentScope, isCommentOnAnchor, newCommentId, writeCommentClipboard,
  type CommentAnchor, type CommentDigestOptions, type CommentGroup, type CommentMode,
  type CommentPassage, type CommentPatch, type CommentRecord, type CommentScope, type CommentThread,
} from './commentModel';
import { commentDraftKey, forgetCommentDraft, hasDraftContent, readCommentDraft, writeCommentDraft } from './commentDrafts';
import { commentCopiedWords, commentWords, type CommentWordKey, type CommentWords } from './commentWords';
import { inheritedCommentState, useCommentHandover } from './handover';
import { COMMENT_FOCUS_PARAM, useCommentFocusParam } from './hostComments';
import { useWaitingCommentThreads } from './hostPanel';
import { reviewRunAnswered, reviewRunKept, useReviewRunAnswered } from './reviewRun';
import { useCommentRouting, type CommentRouting } from './useCommentRouting';

/** Which threads the pane lists: the current anchor's, or every thread in the scope. */
export type CommentAnchorFilter = 'anchor' | 'all';
/** Open threads (default), archived ones (Done) or both (SPC-126): what the pane shows. */
export type CommentStatusView = 'open' | 'done' | 'all';
/** A status filter as `setStatusFilter` takes it: 'resolved' is an older name of 'done' and reads as 'done'. */
export type CommentStatusFilter = CommentStatusView | 'resolved';

/**
 * A new comment being written: on an anchor, with a pin (x and y, 0 to 1), a zone (w and h too, 0 to 1 of the
 * anchor's size) or neither (on the whole anchor; `anchorKey` null: on the whole page). `items` lists the record keys
 * (records or rows) of an items comment, `time` the seconds of a time comment, `text` the words of a text comment.
 */
export interface CommentDraftPin {
  anchorKey: string | null; x: number | null; y: number | null; w: number | null; h: number | null;
  items?: readonly CommentAnchor[] | null; time?: number | null;
  text?: CommentPassage | null;
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
 * A file uploaded for a comment that is not sent yet: what the host's upload returned (`path`, `type` and `size` go
 * back with the comment), `previewUrl` shows it until the saved comment is read back.
 */
export interface CommentFile {
  name: string; url: string; previewUrl?: string | null;
  path?: string | null; type?: string | null; size?: number | null;
}

/** Whether new comments and replies can carry pictures and files. */
export type CommentAttachMode = 'on' | 'off' | 'checking';

export interface CommentActions {
  /**
   * Adds a reply, with the files already uploaded for it. It answers `answers` (an input ask on the first comment or a
   * reply), else the latest open input ask in the thread; an archived thread stays archived (the server brings it back
   * when a reply waits for someone). True once saved.
   */
  reply(thread: CommentThread, body: string, files?: readonly CommentFile[], answers?: CommentRecord): Promise<boolean>;
  /** Answers a check or choice ask with one of its options. The answer shows at once; true once saved, false when refused. */
  answer(root: CommentRecord, answer: string): Promise<boolean>;
  /** Archives (Resolved) or brings back (Open) a thread without a toast. People archive with `archive` and `unarchive`. */
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
  /** Saves new text for your own comment (the server marks it edited, which Copy changes reports). True once saved. */
  edit(comment: CommentRecord, body: string): Promise<boolean>;
  /**
   * Copies the link that opens this page with the thread revealed (`comment=<root id>`, as a push or a chat pill
   * opens it): the host's address for it (`commentLink`), else the page's own address with that param. A toast says
   * Link copied, or that it could not be copied. `host` (the card) holds the selection copy when the clipboard API is
   * refused. True once copied.
   */
  copyLink(root: CommentRecord, host?: HTMLElement | null): Promise<boolean>;
  notify(words: Words | string): void;
}

export interface UseCommentsOptions {
  /**
   * The page (record) the comments belong to: they are read from and written on it. Default: the page the host shows
   * (`spaceComments.page`), else the Space home. Null: the Space home, which lists every comment of the Space grouped
   * by page and writes new ones on no page.
   */
  scope?: CommentScope | null;
  /** The records threads sit on, in order. Empty: comments are not anchored. */
  anchors?: readonly CommentAnchor[];
  /** The anchor on screen (its record key): the pane's "this item" filter and where pins are placed. */
  anchorKey?: string | null;
  /** Wording of the digest Copy changes puts on the clipboard. */
  digest?: CommentDigestOptions;
  /** Saves the checkpoint after a copy (for example the scope's "Last turn at"). A throw rolls the checkpoint back. */
  onCheckpoint?(at: string): Promise<void>;
  /** The Space's own wording on top of the defaults. */
  words?: Partial<Record<CommentWordKey, Words>>;
  /** Lists the comments again whenever the host says they may have changed. Default true. */
  live?: boolean;
  /** Called when a thread is picked (a pin, a card): the Space can move to its anchor and open its panel. */
  onSelectThread?(thread: CommentThread): void;
  /**
   * Open this comment's thread (a root or a reply id) once it is read, and scroll to it. Default: the `comment` view
   * param of a link (`useCommentFocusParam`); null turns that off.
   */
  focusKey?: string | null;
  /**
   * The comment modes the Space offers (SPC-118), in the order the New comment menu and the tool bar list them.
   * Default: text, then point and box when there are anchors, items and time when their call-backs are given, and the
   * whole page. 'items' needs `onStartItems`, 'time' needs `currentTime`.
   */
  modes?: readonly CommentMode[];
  /**
   * Items mode: show your way of picking records or rows (checkboxes, a selection), then call
   * `controller.startItems(items)` with the anchors picked. The hint shows until then; Escape cancels.
   */
  onStartItems?(): void;
  /** Time mode: the current moment of the recording, in seconds. The new comment is written at that moment. */
  currentTime?(): number | null | undefined;
  /** Names of the pages (scope records, by record key) the Space home groups comments under. */
  scopeNames?: Readonly<Record<string, string>>;
  /**
   * A comment a link names, when the caller opens it itself (`focusKey` null): where the controller covers a whole
   * Space its thread is read whatever its status, so the caller finds it among `threads`.
   */
  linkKey?: string | null;
  /**
   * Only these comment threads (the ids of their first comments): the others of the scope are not listed, counted or
   * walked. For a host that shows a part of a Space's comments (those linked to one conversation). Default: every
   * thread of the scope.
   */
  only?: readonly string[] | null;
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
   * The thread's pin number (1-based), 0 when it has none: per page, in the order its first comments were written,
   * deleted ones keeping theirs, so a number never moves and reads the same on the page and the Space home.
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
  /**
   * "Waiting for you" is on: the pane lists only the open threads that wait for the viewer (`waits`), for the current
   * anchor filter. Picking Open, Done or All turns it off; turning it on goes back to open threads.
   */
  waitingFilter: boolean;
  setWaitingFilter(on: boolean): void;
  /**
   * Whether an open thread waits for the viewer: the host's own list when it gave one (a mention, an agent's question,
   * a reply in a thread they started or replied to), else an agent's unanswered question.
   */
  waits(thread: CommentThread): boolean;
  /** The open threads that wait for the viewer, for the current anchor filter: the one number the filter shows. */
  waitingCount: number;
  /** True when the controller covers the whole Space (no scope record): the pane groups threads by page. */
  wholeSpace: boolean;
  /** The page a thread sits on, for grouping on the Space home: its page, else its anchor, else the Space. */
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
  /** False while the host's viewer is not known (or there is no comment store): Send stays off. */
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
  /** Text mode: starts a new comment on these words (of `anchorKey`'s record when given). */
  placeText(passage: CommentPassage, anchorKey?: string | null): void;
  /**
   * Starts a new comment on a place the host names (Comment on a text selection, `SpaceCommentSource.start`). True
   * when this controller took it.
   */
  startAnchor(anchor: SpaceCommentAnchor): boolean;
  /** Whether the page comment tool bar shows (`CommentToolBar`, C toggles it). */
  toolBar: boolean;
  setToolBar(on: boolean): void;
  /** Add comment mode (point or box): the next click on the anchor drops a pin. Escape leaves it. */
  commenting: boolean;
  setCommenting(on: boolean): void;
  toggleCommenting(): void;
  draftPin: CommentDraftPin | null;
  /**
   * Names this page's comments (the Space and the page) for the drafts the boxes keep while they are away
   * (`commentDrafts`): a reply, a new comment and an answer come back with what was typed and attached.
   */
  draftScope: string;
  /**
   * Starts a new comment on `anchorKey` at x, y (0 to 1), on a zone when w and h are given too, or on the whole
   * anchor when x and y are null.
   */
  placePin(anchorKey: string | null, x: number | null, y: number | null, w?: number | null, h?: number | null): void;
  /** In Add comment mode, drops a pin where the anchor element was clicked. True when a pin was placed. */
  placePinFromEvent(event: ReactMouseEvent<HTMLElement>, anchorKey: string | null): boolean;
  /** True: a drag in Add comment mode marks a zone instead of dropping a pin. */
  zones: boolean;
  /** The zone being dragged, while the button is held. */
  dragZone: CommentDragZone | null;
  /** In Add comment mode: a click on the element drops a pin, a press and drag marks a zone. */
  zoneHandlers(anchorKey: string | null): CommentZoneHandlers;
  /** Drops the new comment, and the thread picked for it. */
  cancelPin(): void;
  /** Saves the new comment with the files already uploaded for it. True once saved. */
  sendNew(body: string, files?: readonly CommentFile[]): Promise<boolean>;
  /**
   * Saves a new thread on `place` (a passage's own box), selects it and links it to where it goes. The new comment's
   * id once saved, else null (the failure toast showed).
   */
  sendAt(place: CommentDraftPin, body: string, files?: readonly CommentFile[]): Promise<string | null>;

  /** @deprecated Delete happens at once with Undo (SPC-133): always null. */
  deleting: CommentRecord | null;
  /** @deprecated Nothing to cancel: delete happens at once with Undo. */
  cancelDelete(): void;
  /** @deprecated Deletes `comment` at once with Undo (`actions.remove`); without one it does nothing. */
  confirmDelete(comment?: CommentRecord): Promise<void>;

  /**
   * 'on' when people can attach pictures and files: the host uploads files for comments (signed-in people in Notis;
   * never on a Site, a link or a preview). 'off' leaves the pane text only.
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

  /** Comment ids with a write in flight. */
  busy: ReadonlySet<string>;
  now: number;
  toaster: ToastController;
  words: CommentWords;
  /** A word in the reader's language, with `{n}`-style values filled. */
  say(key: CommentWordKey, vars?: Readonly<Record<string, string | number>>): string;
  locale: Locale;
  /** The viewer's name ('' while unknown). */
  me: string;
  /** @deprecated The server signs every comment with the viewer: runs `write` with the viewer's name. */
  signed<T>(write: (author: string | null) => Promise<T>): Promise<T>;
  /** Opens an agent's thread in the side chat; undefined on hosts without one. */
  openThread?: (threadId: string) => void;
  /**
   * Opens the thread's page with the thread shown on it; undefined beside the page itself (the host gives it where it
   * draws comments away from their page, `spaceComments.showOnPage`).
   */
  showOnPage?: (rootKey: string) => void;
  loading: boolean;
  hasData: boolean;
  error: Error | null;
  refetch(): Promise<unknown>;
  /**
   * How many changes Copy changes would copy. Where the pane holds a part of the Space (its home), the host counts
   * them; default `changes.length`.
   */
  changeCount?: number;
  /**
   * True while older Done threads are left to read, where the pane shows a whole Space and its Filter shows Done
   * threads: they come a page at a time. The pane asks for the next page (`loadMore`) when its list's end is in view.
   */
  hasMore?: boolean;
  /** Reads the next page of Done threads. Does nothing while a page is on its way. */
  loadMore?(): void;
  /** True while Done threads the Filter asked for are on their way: the list says it is loading, never "No comments". */
  loadingMore?: boolean;
}

/** A comment inserted here, shown until its stored row comes back. */
interface CommentDraft { comment: CommentRecord }

const NO_ANCHORS: readonly CommentAnchor[] = Object.freeze([]);
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
 * the thread's own page, possibly later as a promise), else the page's own address with `comment=<root id>` (any
 * earlier comment param replaced). Null when neither is known.
 */
export function commentLinkFor(
  host: { commentLink?(input: { rootId: string }): string | null | Promise<string | null> } | null | undefined,
  rootKey: string): string | null | Promise<string | null> {
  if (!rootKey) return null;
  if (host?.commentLink) {
    try {
      const link = host.commentLink({ rootId: rootKey });
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

/** Rounds a 0 to 1 position for the store. */
function at4(value: number): number {
  return Number(value.toFixed(4));
}

/**
 * Where a new comment sits, in the store's words, from the draft the box shows: words of the text, items, a moment, a
 * zone, a point, a whole anchor (a page comment on that anchor) or the whole page.
 */
export function commentAnchorOfDraft(pin: CommentDraftPin | null | undefined): SpaceCommentAnchor {
  if (!pin) return { mode: 'page', anchor_keys: [] };
  const on = pin.anchorKey ? [pin.anchorKey] : [];
  if (pin.text?.quote) {
    return { mode: 'text', anchor_keys: on, quote: pin.text.quote, prefix: pin.text.prefix || '', suffix: pin.text.suffix || '',
      ...(pin.text.field ? { field: pin.text.field } : {}) };
  }
  if (pin.items?.length) return { mode: 'items', anchor_keys: pin.items.map(item => item.recordKey) };
  if (pin.time != null) return { mode: 'time', anchor_keys: on, time_start: Number(Math.max(0, pin.time).toFixed(2)) };
  if (pin.x != null && pin.y != null) {
    if (pin.w != null && pin.h != null) {
      return { mode: 'box', anchor_keys: on, x: at4(pin.x), y: at4(pin.y), w: at4(pin.w), h: at4(pin.h) };
    }
    return { mode: 'point', anchor_keys: on, x: at4(pin.x), y: at4(pin.y) };
  }
  return { mode: 'page', anchor_keys: on };
}

/** The draft a place named by the host opens (the reverse of `commentAnchorOfDraft`). */
export function commentDraftOfAnchor(anchor: SpaceCommentAnchor, anchors: readonly CommentAnchor[] = NO_ANCHORS): CommentDraftPin {
  const keys = anchor.anchor_keys ?? [];
  const anchorKey = keys[0] ?? null;
  const base: CommentDraftPin = { anchorKey, x: null, y: null, w: null, h: null };
  switch (anchor.mode) {
    case 'text':
      return { ...base, text: { quote: anchor.quote ?? '', prefix: anchor.prefix ?? '', suffix: anchor.suffix ?? '',
        field: anchor.field ?? null } };
    case 'items': {
      const items = keys.map((key, index) => anchors.find(item => item.recordKey === key || item.id === key)
        ?? { id: key, recordKey: key, order: index + 1, title: '' });
      return { ...base, items };
    }
    case 'time':
      return { ...base, time: anchor.time_start ?? 0 };
    case 'box':
      return { ...base, x: anchor.x ?? null, y: anchor.y ?? null, w: anchor.w ?? null, h: anchor.h ?? null };
    case 'point':
      return { ...base, x: anchor.x ?? null, y: anchor.y ?? null };
    default:
      return base;
  }
}

/** The files of a comment as the store takes them back. */
function sentFiles(files: readonly CommentFile[]): SpaceCommentFile[] {
  return files.map(file => ({ path: file.path ?? '', name: file.name, type: file.type ?? '', size: file.size ?? 0, url: file.url || null }));
}

/** The error a failed write rejects with, for the console. */
function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

/** How many Done threads a pane that shows a whole Space asks for at a time. */
export const COMMENT_DONE_PAGE = 50;

/**
 * What a pane that shows a whole Space reads (`SpaceCommentsTransport.threads`): the open threads always, `done` Done
 * threads once the Filter asks for them, only the threads named (`only`), and the thread of a linked comment.
 */
interface CommentWindow {
  done: number;
  only: readonly string[] | null;
  include: string | null;
}

/** What the host counted for a pane that holds a part of the Space; null with `list` (the pane holds every comment). */
type CommentWindowFacts = Pick<SpaceCommentThreadsAnswer, 'counts' | 'numbers' | 'changes' | 'moreDone'> & {
  /** How many Done threads the answer was asked for. */
  done: number;
};

/**
 * The store reader: the rows of `page`, listed again whenever the host signals a change. Results that come back out
 * of order are dropped (only the latest list counts). Without a transport: nothing, never loading.
 *
 * With `wanted` (a whole Space) and a host that reads by thread, only the threads the pane lists are read
 * (`threads`); the host says null when its server cannot, and the reader goes back to `list` for good.
 */
function useCommentRows(host: SpaceCommentsTransport | undefined, page: SpaceCommentPageKey, live: boolean,
  wanted: CommentWindow | null = null) {
  const [state, setState] = useState<{ key: string; rows: SpaceCommentRow[]; hasData: boolean; error: Error | null;
    facts: CommentWindowFacts | null }>({ key: '', rows: [], hasData: false, error: null, facts: null });
  const [listing, setListing] = useState(false);
  const pageKey = page === null ? '\u0000home' : page;
  const seq = useRef(0);
  const hostRef = useRef(host);
  hostRef.current = host;
  const hasHost = Boolean(host);
  // The whole page, as before the bounded read: a host without it, or one whose server refused it.
  const [whole, setWhole] = useState(false);
  const bounded = Boolean(wanted) && !whole && typeof host?.threads === 'function';
  const wantedRef = useRef(wanted);
  wantedRef.current = wanted;
  const wantedKey = bounded && wanted ? `${wanted.done}|${wanted.include ?? ''}|${wanted.only ? wanted.only.join('\n') : '\u0000'}` : '';
  const relist = useCallback(async () => {
    const transport = hostRef.current;
    if (!transport) return undefined;
    const mine = ++seq.current;
    setListing(true);
    try {
      const asked = bounded ? wantedRef.current : null;
      if (asked && transport.threads) {
        const answer = await transport.threads({ done: asked.done, only: asked.only, include: asked.include ? [asked.include] : [] });
        if (answer) {
          if (mine !== seq.current) return answer;
          setState({ key: pageKey, rows: Array.isArray(answer.comments) ? answer.comments : [], hasData: true, error: null,
            facts: { counts: answer.counts ?? null, numbers: answer.numbers ?? {}, changes: answer.changes ?? null,
              moreDone: answer.moreDone === true, done: asked.done } });
          return answer;
        }
        // The server does not know this read: every comment of the page, as before.
        setWhole(true);
      }
      const answer = await transport.list({ page });
      if (mine !== seq.current) return answer;
      const rows = Array.isArray(answer?.comments) ? answer.comments : [];
      setState({ key: pageKey, rows, hasData: true, error: null, facts: null });
      return answer;
    } catch (error) {
      if (mine === seq.current) {
        console.warn('[comments] list failed', errorCode(error) || error);
        setState(current => ({ ...current, key: pageKey, error: error instanceof Error ? error : new Error(String(error)) }));
      }
      return undefined;
    } finally {
      if (mine === seq.current) setListing(false);
    }
  // `page` is read through `pageKey`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey, bounded]);
  useEffect(() => {
    if (!hasHost) return undefined;
    void relist();
    const transport = hostRef.current;
    if (!live || !transport?.subscribe) return undefined;
    let stop: (() => void) | undefined;
    try {
      stop = transport.subscribe({ page }, () => { void relist(); });
    } catch (error) {
      console.warn('[comments] subscribe failed', error);
    }
    return () => { stop?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHost, relist, live]);
  // What the pane lists changed (the Filter asks for Done threads, more of them, other threads): read again.
  const readKey = useRef(wantedKey);
  useEffect(() => {
    if (readKey.current === wantedKey) return;
    readKey.current = wantedKey;
    if (hasHost && wantedKey) void relist();
  }, [wantedKey, hasHost, relist]);
  const current = state.key === pageKey;
  const facts = current && bounded ? state.facts : null;
  return {
    rows: current ? state.rows : [],
    hasData: current && state.hasData,
    error: current ? state.error : null,
    // Loading until the first list of this page settles, with rows or an error.
    loading: hasHost && !(current && (state.hasData || state.error)),
    listing,
    relist,
    /** What the host counted, when the pane holds a part of the Space; null when it holds every comment. */
    facts,
    /** True while Done threads the pane asked for have not been answered yet. */
    doneAwaited: Boolean(bounded && wanted && wanted.done > 0 && !wanted.only && (!facts || facts.done < wanted.done) && !(current && state.error)),
  };
}

/** What a comment controller hands the controller of the view that replaces its own (`handover`). */
interface CommentPaneHandover {
  filter: CommentAnchorFilter;
  statusFilter: CommentStatusView;
  waitingFilter: boolean;
  revealRequest: number;
  threadKey: string | null;
  draftPin: CommentDraftPin | null;
}

export function useComments(options: UseCommentsOptions = {}): CommentController {
  const runtime = useNotisRuntime();
  const host = runtime?.spaceComments;
  const hostRef = useRef(host);
  hostRef.current = host;
  const viewer = host?.viewer ?? null;
  const { anchors = NO_ANCHORS, anchorKey = null, live = true } = options;
  // The page: the one given, else the one the host shows, else the Space home.
  const hostPage = host?.page ?? null;
  const hostScope = useMemo<CommentScope | null>(() => hostPage?.recordKey
    ? { id: hostPage.recordKey, recordKey: hostPage.recordKey, name: hostPage.name ?? '', checkpoint: null } : null,
  [hostPage?.recordKey, hostPage?.name]);
  const scope = options.scope === undefined ? hostScope : options.scope;
  const pageKey = scope?.recordKey ?? null;
  const view = hostPage?.view ?? null;
  const me = viewer?.name ?? '';
  const canWrite = Boolean(host) && Boolean(viewer);
  const signed = useCallback(<T,>(write: (author: string | null) => Promise<T>): Promise<T> => write(me || null), [me]);
  const locale = useToolkitLocale();
  const words = useMemo(() => commentWords(options.words), [options.words]);
  const say = useCallback((key: CommentWordKey, vars?: Readonly<Record<string, string | number>>) =>
    pick(vars ? fillWords(words[key], vars) : words[key], locale), [words, locale]);
  const threadTransport = runtime?.resource?.kind === 'space' ? runtime.spaceThreads : undefined;
  const openThread = useMemo(() => threadTransport
    ? (threadId: string) => { void threadTransport.open(threadId).catch(() => undefined); }
    : undefined, [threadTransport]);
  const hostShowOnPage = host?.showOnPage;
  const showOnPage = useMemo(() => hostShowOnPage
    ? (rootKey: string) => { hostShowOnPage({ rootId: rootKey }); }
    : undefined, [hostShowOnPage]);
  const latest = useRef(options);
  latest.current = options;

  // A page lists its own comments. The Space home lists the Space's threads: the open ones, the Done ones a page at a
  // time once the Filter shows them, only the ones named (`only`), and the one a link opens, never every comment of
  // the Space (a host without that read answers them all, as before).
  const [doneWanted, setDoneWanted] = useState(0);
  const urlFocus = useCommentFocusParam();
  const focusKey = options.focusKey === undefined ? urlFocus : options.focusKey;
  const linkKey = focusKey ?? options.linkKey ?? null;
  const onlyThreads = options.only ?? null;
  const onlyKey = onlyThreads ? onlyThreads.join('\n') : null;
  const wholeSpaceRead = scope == null;
  const wanted = useMemo<CommentWindow | null>(() => (wholeSpaceRead
    ? { done: doneWanted, only: onlyKey === null ? null : onlyKey ? onlyKey.split('\n') : [], include: linkKey } : null),
  [wholeSpaceRead, doneWanted, onlyKey, linkKey]);
  const store = useCommentRows(host, scope ? scope.recordKey : 'all', live, wanted);
  const facts = store.facts;
  const refetch = store.relist;
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  const toaster = useToast();
  // Each toast shown gets a number: a toast that comes late (a failed delete) shows only when none came after it.
  const toastSeq = useRef(0);
  const showToast = toaster.notify;
  const notify = useCallback<ToastController['notify']>((...args) => {
    toastSeq.current += 1;
    return showToast(...args);
  }, [showToast]);

  const [patches, setPatches] = useState<Record<string, CommentPatch>>({});
  const [drafts, setDrafts] = useState<CommentDraft[]>([]);
  // Rows the writes returned: shown until a list brings the same revision or a newer one.
  const [written, setWritten] = useState<Record<string, SpaceCommentRow>>({});
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [marker, setMarker] = useState<string | null>(null);

  const serverComments = useMemo(() => {
    const byId = new Map<string, SpaceCommentRow>();
    for (const row of store.rows) if (row && typeof row.id === 'string') byId.set(row.id, row);
    for (const row of Object.values(written)) {
      const listed = byId.get(row.id);
      if (!listed || (listed.revision ?? 0) < (row.revision ?? 0)) byId.set(row.id, row);
    }
    return [...byId.values()].map(row => commentFromRow(row));
  }, [store.rows, written]);

  const comments = useMemo(() => [...applyCommentPatches(serverComments, patches), ...drafts.map(draft => draft.comment)],
    [serverComments, patches, drafts]);

  // Forget written rows the list has caught up with.
  useEffect(() => {
    setWritten(current => {
      const listed = new Map(store.rows.map(row => [row.id, row.revision ?? 0]));
      const keep = Object.entries(current).filter(([id, row]) => (listed.get(id) ?? -1) < (row.revision ?? 0));
      return keep.length === Object.keys(current).length ? current : Object.fromEntries(keep);
    });
  }, [store.rows]);

  const scopeKey = scope ? `${scope.id}|${scope.recordKey}` : null;
  const inScope = useMemo(() => comments.filter(comment => inCommentScope(comment, scope)),
    // The scope is compared by identity of its record, not of the object a render builds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comments, scopeKey]);
  // `only` is compared by what it lists, not by the array a render builds (`onlyKey`).
  const threads = useMemo(() => {
    const listed = commentThreads(inScope, anchors).filter(thread => thread.root.status !== 'Deleted');
    if (onlyKey === null) return listed;
    const kept = new Set(onlyKey ? onlyKey.split('\n') : []);
    return listed.filter(thread => kept.has(thread.root.recordKey));
  }, [inScope, anchors, onlyKey]);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const anchorsRef = useRef(anchors);
  anchorsRef.current = anchors;
  const anchorKeyRef = useRef(anchorKey);
  anchorKeyRef.current = anchorKey;

  const rootKeys = useMemo(() => threads.map(thread => thread.root.recordKey).filter(key => !key.startsWith('draft-')), [threads]);
  // The page's drafts (`commentDrafts`) and the thread its next new comment goes to are kept under this key.
  const draftScope = `${runtime?.resource?.id ?? runtime?.app?.id ?? ''}|comments|${scopeKey ?? ''}`;
  const routing = useCommentRouting({
    rootKeys, recordKey: pageKey, draftScope, fallbackOpen: openThread,
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
  // A pane that holds a part of the Space, before its first copy: the host counted what Copy changes reports of the
  // whole Space. After a copy only what changed since counts, and every change since the pane opened is held.
  const hostChanges = facts && facts.changes != null && onlyKey === null && !checkpoint ? facts.changes : null;
  const changeCount = hostChanges === null ? changes.length : Math.max(hostChanges, changes.length);

  // Written by the viewer: the server says so (`author.you`), else its creator id is the viewer's; a draft is theirs.
  const byViewer = useCallback((comment: CommentRecord) => {
    if (comment.agent) return false;
    if (comment.recordKey.startsWith('draft-')) return true;
    if (comment.createdByYou != null) return comment.createdByYou;
    if (viewer?.id && comment.createdBy) return comment.createdBy === viewer.id;
    return Boolean(me) && comment.author === me;
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

  // A thread on several items (an items comment) is on each of them (SPC-463).
  const threadsOn = useCallback((key: string | null | undefined) =>
    threads.filter(thread => isCommentOnAnchor(thread.root.anchorIds, key, anchors)), [threads, anchors]);
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
  // A pane that holds a part of the Space cannot count the first comments before a pin: the host's number wins.
  const hostNumbers = facts?.numbers ?? null;
  const numberOf = useCallback((thread: CommentThread) => hostNumbers?.[thread.root.recordKey]
    ?? pinNumbers.get(thread.root.recordKey) ?? 0, [pinNumbers, hostNumbers]);
  const anchor = useMemo(() => anchors.find(item => item.recordKey === anchorKey), [anchors, anchorKey]);

  // What the pane shows is handed over when a newer version of the view replaces this one (`handover`): the filters,
  // the selected thread and the new comment being placed never go back to their defaults under the reader.
  const viewToken = host?.viewToken ?? null;
  const handoverId = `comments\u0000${draftScope}`;
  const handed = useRef(inheritedCommentState<CommentPaneHandover>(viewToken, handoverId)).current;
  const [filter, setFilter] = useState<CommentAnchorFilter>(handed?.filter ?? 'anchor');
  const [statusFilter, setStatusFilterState] = useState<CommentStatusView>(handed?.statusFilter ?? 'open');
  const [waitingFilter, setWaitingFilterState] = useState(handed?.waitingFilter ?? false);
  const setStatusFilter = useCallback((value: CommentStatusFilter) => {
    setStatusFilterState(value === 'resolved' ? 'done' : value);
    // Open, Done and All are the other choices of the same menu: picking one leaves "Waiting for you".
    setWaitingFilterState(false);
  }, []);
  const [revealRequest, setRevealRequest] = useState(handed?.revealRequest ?? 0);
  const [threadKey, setThreadKey] = useState<string | null>(handed?.threadKey ?? null);
  // A new comment being written outlives the pane (another Space, a page over the view): its pin comes back with the
  // text and files its box kept (`commentDrafts`), and a draft with nothing in it does not.
  const newDraftKey = commentDraftKey(draftScope, 'new');
  const restoredPin = (key: string | null): CommentDraftPin | null => {
    const stored = readCommentDraft(key);
    return hasDraftContent(stored) && stored?.place ? stored.place as CommentDraftPin : null;
  };
  const [draftPin, setDraftPin] = useState<CommentDraftPin | null>(() => (handed ? handed.draftPin : restoredPin(newDraftKey)));
  useCommentHandover<CommentPaneHandover>(viewToken, handoverId,
    () => ({ filter, statusFilter, waitingFilter, revealRequest, threadKey, draftPin }),
    (state) => {
      setFilter(state.filter);
      setStatusFilterState(state.statusFilter);
      setWaitingFilterState(state.waitingFilter);
      setRevealRequest(state.revealRequest);
      setThreadKey(state.threadKey);
      setDraftPin(state.draftPin);
    });
  const pinKeyRef = useRef(newDraftKey);
  // A controller that never held a place writes none: a view prepared out of sight (the next version of the page)
  // must not forget the place of the comment the reader is writing in the view on screen.
  const pinHeld = useRef(false);
  useEffect(() => {
    if (pinKeyRef.current !== newDraftKey) {
      // Another page: its own new comment, if one was left there.
      pinKeyRef.current = newDraftKey;
      pinHeld.current = false;
      setDraftPin(restoredPin(newDraftKey));
      return;
    }
    if (!draftPin && !pinHeld.current) return;
    pinHeld.current = Boolean(draftPin);
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
  // The Filter shows Done threads (Done, All): the pane then reads them too, a page at a time (`loadMore`).
  const wantsDone = !waitingFilter && statusFilter !== 'open';
  // How many Done threads were asked for, and how many of them the host answered: a page is asked for only once
  // the one before it is answered, whoever asks (the Filter, the end of the list).
  const doneAsked = useRef(doneWanted);
  const doneAnswered = useRef(0);
  doneAnswered.current = facts?.done ?? 0;
  const askDone = useCallback(() => {
    if (doneAsked.current > doneAnswered.current) return;
    doneAsked.current += COMMENT_DONE_PAGE;
    setDoneWanted(doneAsked.current);
  }, []);
  useEffect(() => { if (wantsDone && !doneAsked.current) askDone(); }, [wantsDone, askDone]);
  // The Space's totals as the host counted them, where the pane holds a part of the Space and lists all of it.
  const hostCounts = effectiveFilter === 'all' && onlyKey === null ? facts?.counts ?? null : null;
  const counts = useMemo(() => (hostCounts ? { open: hostCounts.open, done: hostCounts.done, all: hostCounts.open + hostCounts.done } : {
    open: scoped.filter(thread => thread.root.status === 'Open').length,
    done: scoped.filter(thread => thread.root.status === 'Resolved').length,
    all: scoped.length,
  }), [scoped, hostCounts]);
  // "Waiting for you": the host's list of what waits (as its numbers count it), else what the pane sees for itself.
  const waitingIds = useWaitingCommentThreads();
  // A thread answered here a moment ago no longer waits, before the host's list says so (`reviewRun`).
  const answeredHere = useReviewRunAnswered();
  const waits = useCallback((thread: CommentThread) => thread.root.status === 'Open' && !reviewRunAnswered(thread.root.recordKey)
    && (waitingIds ? waitingIds.has(thread.root.recordKey)
      : [thread.root, ...thread.replies].some(comment => comment.needs !== 'none' && !comment.answer && comment.status !== 'Deleted')),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [waitingIds, answeredHere]);
  const waitsRef = useRef(waits);
  waitsRef.current = waits;
  const setWaitingFilter = useCallback((on: boolean) => {
    setWaitingFilterState(on);
    if (on) setStatusFilterState('open');
  }, []);
  const waitingCount = useMemo(() => scoped.filter(waits).length, [scoped, waits]);
  // Under "Waiting for you" a card answered while nothing moves by itself stays listed, showing its answer.
  const visibleThreads = useMemo(() => waitingFilter
    ? scoped.filter(thread => waits(thread) || (thread.root.status === 'Open' && reviewRunKept(thread.root.recordKey)))
    : statusFilter === 'all' ? scoped
      : scoped.filter(thread => thread.root.status === (statusFilter === 'done' ? 'Resolved' : 'Open')),
  [waitingFilter, waits, statusFilter, scoped]);
  const scopeCounts = useMemo(() => {
    const shown = (thread: CommentThread) => statusFilter === 'all'
      || thread.root.status === (statusFilter === 'done' ? 'Resolved' : 'Open');
    const all = hostCounts ? (statusFilter === 'all' ? hostCounts.open + hostCounts.done : statusFilter === 'done' ? hostCounts.done : hostCounts.open)
      : threads.filter(shown).length;
    return { anchor: threadsOn(anchorKey).filter(shown).length, all };
  }, [statusFilter, threadsOn, anchorKey, threads, hostCounts]);
  // Older Done threads are left to read: the pane asks for the next page when the reader brings its list's end into
  // view. Until the first page is answered the list says it is loading.
  const boundedDone = Boolean(facts) && wantsDone && onlyKey === null;
  const doneRead = facts?.done ?? 0;
  const hasMore = boundedDone && Boolean(facts?.moreDone) && doneRead > 0;
  const loadMore = askDone;
  const loadingMore = boundedDone && (store.doneAwaited || (doneRead === 0 && Boolean(facts?.moreDone)));

  const selectThread = useCallback((thread: CommentThread) => {
    setThreadKey(thread.root.recordKey);
    setDraftPin(null);
    setCommentMode(null);
    setStatusFilterState(current => current === 'all' ? current : thread.root.status === 'Resolved' ? 'done' : 'open');
    // A thread picked from the page that does not wait for the viewer shows: "Waiting for you" would hide it (a card
    // kept in view after its answer is still listed there).
    if (!waitsRef.current(thread) && !reviewRunKept(thread.root.recordKey)) setWaitingFilterState(false);
    latest.current.onSelectThread?.(thread);
  }, []);
  const revealThread = useCallback((thread: CommentThread) => {
    selectThread(thread);
    setRevealRequest(current => current + 1);
  }, [selectThread]);

  // A link to one comment (a push, a chat pill): open its thread once it is read, in the host panel (a reveal), and the
  // pane scrolls it into view. (`focusKey` is read above: the pane asks for that thread whatever its status.)
  const focused = useRef<string | null>(null);
  const doneUnread = Boolean(facts) && onlyKey === null && (facts?.done ?? 0) === 0;
  const readFailed = Boolean(store.error);
  useEffect(() => {
    // A link the host took away is forgotten, so a later link to the same comment opens it again.
    if (!focusKey) { focused.current = null; return; }
    if (focused.current === focusKey) return;
    const thread = threads.find(item => item.root.recordKey === focusKey || item.replies.some(reply => reply.recordKey === focusKey));
    if (!thread) return;
    // Its thread is Done and the pane has not read the Done threads yet (it holds a part of the Space): the Filter
    // goes to Done first, and the card is revealed once the ones listed around it are there, so it is scrolled to
    // where it stays. A read that failed reveals it at once, alone.
    if (thread.root.status === 'Resolved' && doneUnread && !readFailed) {
      setStatusFilterState(current => current === 'all' ? current : 'done');
      setWaitingFilterState(false);
      return;
    }
    focused.current = focusKey;
    if (anchors.length && !isCommentOnAnchor(thread.root.anchorIds, anchorKey, anchors)) setFilter('all');
    revealThread(thread);
  }, [focusKey, threads, anchors, anchorKey, revealThread, doneUnread, readFailed]);

  // Grouping on the Space home: the page a thread is on, numbered in the order pages first come.
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

  const fail = useCallback((error: unknown) => {
    console.warn('[comments] write failed', errorCode(error) || error);
    notify(words.saveError, { tone: 'danger' });
  }, [notify, words]);

  const setBusyKey = useCallback((key: string, on: boolean) => setBusy(current => {
    const next = new Set(current);
    if (on) next.add(key); else next.delete(key);
    return next;
  }), []);

  const patchesRef = useRef(patches);
  patchesRef.current = patches;

  /** Keeps a row a write returned until the list shows it. */
  const keep = useCallback((row: SpaceCommentRow | null | undefined) => {
    if (!row || typeof row.id !== 'string') return;
    setWritten(current => (current[row.id]?.revision ?? -1) > (row.revision ?? 0) ? current : { ...current, [row.id]: row });
  }, []);

  // Writes in flight, by comment id: a write (an Undo right after an archive) waits for the one before it.
  const inFlight = useRef(new Map<string, Promise<unknown>>());

  /**
   * Runs one write on a comment and shows `fields` at once. `quiet` leaves the failure toast to the caller (an Undo,
   * whose toast says it could not undo). True once saved.
   */
  const write = useCallback(async (target: CommentRecord, fields: Partial<CommentRecord>,
    send: (transport: SpaceCommentsTransport) => Promise<SpaceCommentRow>, quiet = false) => {
    const transport = hostRef.current;
    const key = target.recordKey;
    if (!transport || key.startsWith('draft-')) return false;
    const previous = patchesRef.current[key];
    setPatches(current => ({ ...current, [key]: { fields: { ...(current[key]?.fields ?? {}), ...fields }, revision: null } }));
    setBusyKey(key, true);
    const before = inFlight.current.get(key);
    let done: () => void = () => {};
    const mine = new Promise<void>(resolve => { done = resolve; });
    inFlight.current.set(key, mine);
    try {
      if (before) await before.catch(() => undefined);
      const row = await send(transport);
      keep(row);
      // Only the latest write on this comment drops its patch: a queued write (an Undo) owns the fields shown.
      if (inFlight.current.get(key) === mine) {
        setPatches(current => {
          if (!current[key]) return current;
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
      return true;
    } catch (error) {
      // A failed write puts back what was shown before it, unless a later write already shows its own fields.
      if (inFlight.current.get(key) === mine) {
        setPatches(current => {
          const next = { ...current };
          if (previous) next[key] = previous; else delete next[key];
          return next;
        });
      }
      if (quiet) console.warn('[comments] write failed', errorCode(error) || error); else fail(error);
      return false;
    } finally {
      if (inFlight.current.get(key) === mine) inFlight.current.delete(key);
      done();
      if (!inFlight.current.has(key)) setBusyKey(key, false);
    }
  }, [fail, setBusyKey, keep]);

  /** Shows a new comment at once and saves it: a thread's first comment, or a reply. The stored row, or false. */
  const create = useCallback(async (input: {
    body: string; reply?: { root: CommentRecord; answerTo: string | null }; place?: CommentDraftPin | null;
    files?: readonly CommentFile[];
  }): Promise<SpaceCommentRow | false> => {
    const transport = hostRef.current;
    if (!transport) return false;
    // Send stays off until the viewer is known; nothing is written under another name meanwhile.
    if (!canWrite) { console.warn('[comments] the viewer is not known yet: nothing was sent'); return false; }
    const files = transport.upload ? input.files ?? [] : [];
    const at = new Date().toISOString();
    const requestId = newCommentId();
    const tempKey = `draft-${requestId}`;
    const where = input.reply ? null : commentAnchorOfDraft(input.place);
    const root = input.reply?.root ?? null;
    const comment: CommentRecord = {
      id: tempKey, recordKey: tempKey, revision: 0, body: input.body,
      scopeIds: root ? [...root.scopeIds] : pageKey ? [pageKey] : [],
      anchorIds: root ? [...root.anchorIds] : [...(where?.anchor_keys ?? [])],
      thread: root ? root.recordKey : '', author: me,
      x: where?.x ?? null, y: where?.y ?? null, w: where?.w ?? null, h: where?.h ?? null,
      status: 'Open', needs: 'none', options: [], answer: '', answeredAt: null,
      change: root ? 'replied' : 'created', changedAt: at, example: false, createdAt: at,
      attachments: commentAttachmentList(files.map(file => ({ name: file.name, url: file.previewUrl || file.url }))),
      time: where?.time_start ?? null, answerTo: input.reply?.answerTo ?? null,
      createdByYou: true, createdBy: viewer?.id ?? null,
      mode: where?.mode ?? root?.mode ?? 'page',
      passage: where?.mode === 'text' && where.quote
        ? { quote: where.quote, prefix: where.prefix ?? '', suffix: where.suffix ?? '', field: where.field ?? null } : null,
      view,
    };
    setDrafts(current => [...current, { comment }]);
    try {
      let row: SpaceCommentRow;
      if (input.reply) {
        row = await transport.reply({ root_id: input.reply.root.recordKey, body: input.body,
          ...(input.reply.answerTo ? { answer_to: input.reply.answerTo } : {}),
          ...(files.length ? { attachments: sentFiles(files) } : {}), request_id: requestId });
      } else {
        const insert: SpaceCommentInsert = { ...where!, page_key: pageKey, view, body: input.body,
          ...(files.length ? { attachments: sentFiles(files) } : {}), request_id: requestId };
        row = await transport.insert(insert);
      }
      keep(row);
      return row;
    } catch (error) {
      fail(error);
      return false;
    } finally {
      setDrafts(current => current.filter(draft => draft.comment.recordKey !== tempKey));
    }
  }, [canWrite, pageKey, view, me, viewer?.id, keep, fail]);

  // Rights (SPC-128): your own comments; a whole thread or someone else's comment needs Space edit rights.
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

  /** Archives (Resolved) or brings back (Open) a thread. */
  const writeStatus = useCallback((root: CommentRecord, status: 'Open' | 'Resolved', quiet = false) => {
    const changedAt = new Date().toISOString();
    return write(root, { status, change: status === 'Resolved' ? 'resolved' : 'reopened', changedAt },
      transport => status === 'Resolved' ? transport.archive({ root_id: root.recordKey })
        : transport.unarchive({ root_id: root.recordKey }), quiet);
  }, [write]);

  /** An Undo: throws when it fails, so the toast says it could not undo. */
  const undoing = useCallback(async (run: () => Promise<boolean>) => {
    if (!await run()) throw new Error('The comment could not be put back');
  }, []);

  const remove = useCallback((comment: CommentRecord) => {
    if (!canDelete(comment)) return;
    const root = !comment.thread;
    if (root) setThreadKey(current => current === comment.recordKey ? null : current);
    // One delete: a first comment takes its thread with it (the server keeps its replies for the Bin).
    const saved = write(comment, { status: 'Deleted', change: 'deleted', changedAt: new Date().toISOString() },
      transport => transport.remove({ id: comment.recordKey }), true);
    let undone = false;
    const undo = async () => {
      undone = true;
      if (!await saved) return;
      await undoing(() => write(comment, { status: comment.status, change: comment.change, changedAt: comment.changedAt },
        transport => transport.restore({ id: comment.recordKey }), true));
    };
    // On a touch screen the Undo is harder to reach in time: it stays DELETE_UNDO_TOUCH_MS there, or until dismissed.
    const durationMs = touchScreen() ? DELETE_UNDO_TOUCH_MS : undefined;
    notify(root ? words.threadDeleted : words.commentDeletedToast, { undo, durationMs });
    const shown = toastSeq.current;
    void saved.then(ok => {
      // A newer toast (another delete's Undo) stays: this late outcome never replaces it.
      if (ok || undone || toastSeq.current !== shown) return;
      notify(words.saveError, { tone: 'danger' });
    });
  }, [canDelete, write, notify, words, undoing]);

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
      // The one reply names the ask in `answer_to`: the server records it as the ask's answer, sends it to the asking
      // agent's thread only (never the comment thread's first link, W1) and re-arms nobody's waiting inbox with it (W3).
      // The ask shows its answer at once.
      if (asking && answer != null) {
        setPatches(current => ({ ...current, [asking.recordKey]: {
          fields: { ...(current[asking.recordKey]?.fields ?? {}), answer, answeredAt: at }, revision: null } }));
      }
      const row = await create({ body: body.trim(), reply: { root, answerTo: asking && answer != null ? asking.recordKey : null }, files });
      if (asking && answer != null) {
        setPatches(current => {
          const patch = current[asking.recordKey];
          if (!patch) return current;
          const next = { ...current };
          if (row) next[asking.recordKey] = { ...patch, revision: (asking.revision ?? 0) + 1 }; else delete next[asking.recordKey];
          return next;
        });
        if (row) void refetchRef.current();
      }
      // The wake may now start the thread this reply goes to: read where it goes again until it names it (K30).
      if (row) rereadLinks(root.recordKey);
      return Boolean(row);
    },
    answer: (root, answer) => {
      const at = new Date().toISOString();
      return write(root, { answer, answeredAt: at, change: 'answered', changedAt: at },
        transport => transport.answer({ id: root.recordKey, answer }));
    },
    setStatus: (root, status) => { void writeStatus(root, status); },
    archive: root => {
      if (root.status !== 'Open' || root.recordKey.startsWith('draft-')) return;
      void writeStatus(root, 'Resolved');
      notify(words.archived, { undo: () => undoing(() => writeStatus(root, 'Open', true)) });
    },
    unarchive: root => {
      if (root.status !== 'Resolved') return;
      void writeStatus(root, 'Open');
      notify(words.unarchived, { undo: () => undoing(() => writeStatus(root, 'Resolved', true)) });
    },
    remove,
    askDelete: root => remove(root),
    edit: async (comment, body) => {
      const text = body.trim();
      if (!canEdit(comment) || (!text && !comment.attachments.length)) return false;
      if (text === comment.body) return true;
      return write(comment, { body: text, editedAt: new Date().toISOString() },
        transport => transport.edit({ id: comment.recordKey, body: text }));
    },
    copyLink: async (root, element = null) => {
      const link = root.recordKey.startsWith('draft-') ? null : commentLinkFor(hostRef.current, root.recordKey);
      const copied = link ? await writeCommentClipboard(link, element) : false;
      notify(copied ? words.linkCopied : words.linkCopyFailed, copied ? undefined : { tone: 'danger' });
      return copied;
    },
    notify: text => notify(text),
  }), [create, write, notify, writeStatus, words, undoing, remove, canEdit, rereadLinks]);

  const shownToaster = useMemo<ToastController>(() => ({ ...toaster, notify }), [toaster, notify]);

  const confirmDelete = useCallback(async (comment?: CommentRecord) => { if (comment) remove(comment); }, [remove]);

  /** Opens the new comment box. A comment with no anchor on a page that has anchors shows under All. */
  const openDraft = useCallback((pin: CommentDraftPin) => {
    setCommentMode(null);
    setDraftPin(pin);
    setThreadKey(null);
    // The list's filters change only when they would hide the new comment once sent. "This item" lists the threads of
    // the item shown: a comment on another item, or on the whole page (it has no item), would be hidden by it, so the
    // list widens to every item; a comment on the item shown, or on items that include it, keeps the filter as it is.
    // Done hides an open comment, so it goes back to Open; Open and All both show it.
    setFilter(current => {
      if (current === 'all' || !anchorsRef.current.length) return current;
      const keys = pin.items?.length ? pin.items.map(item => item.recordKey) : pin.anchorKey ? [pin.anchorKey] : [];
      return isCommentOnAnchor(keys, anchorKeyRef.current, anchorsRef.current) ? current : 'all';
    });
    setStatusFilterState(current => current === 'done' ? 'open' : current);
    // A new comment asks nothing of its writer: it would not show under "Waiting for you".
    setWaitingFilterState(false);
  }, []);

  const placePin = useCallback((key: string | null, x: number | null, y: number | null,
    w: number | null = null, h: number | null = null) => {
    openDraft({ anchorKey: key, x, y, w: x == null || y == null ? null : w, h: x == null || y == null ? null : h });
  }, [openDraft]);

  const placeText = useCallback((passage: CommentPassage, key: string | null = null) => {
    if (!passage?.quote?.trim()) return;
    openDraft({ anchorKey: key, x: null, y: null, w: null, h: null,
      text: { quote: passage.quote, prefix: passage.prefix ?? '', suffix: passage.suffix ?? '', field: passage.field ?? null } });
  }, [openDraft]);

  const startAnchor = useCallback((place: SpaceCommentAnchor) => {
    if (!place || !MODE_ORDER.includes(place.mode)) return false;
    if (place.mode === 'text' && !place.quote?.trim()) return false;
    openDraft(commentDraftOfAnchor(place, anchorsRef.current));
    return true;
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

  // The store keeps a box on any anchor.
  const zones = true;
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

  const sendAt = useCallback(async (place: CommentDraftPin, body: string, files: readonly CommentFile[] = []) => {
    if (!body.trim() && !files.length) return null;
    const row = await create({ body: body.trim(), place, files });
    if (!row) return null;
    // The item shown may have changed while the comment was written: the sent thread stays in the list (SPC-463).
    if (anchorsRef.current.length && !isCommentOnAnchor(row.anchor_keys ?? [], anchorKeyRef.current, anchorsRef.current)) {
      setFilter('all');
    }
    setThreadKey(row.id);
    // The new comment thread goes to the thread picked with the chip or @, else the best match (SPC-117).
    void linkNew(row.id);
    return row.id;
  }, [create, linkNew]);

  const sendNew = useCallback(async (body: string, files: readonly CommentFile[] = []) => {
    const pin = draftPin;
    if (!pin || (!body.trim() && !files.length)) return false;
    const id = await sendAt(pin, body, files);
    if (!id) return false;
    setDraftPin(null);
    setThreadKey(id);
    return true;
  }, [draftPin, sendAt]);

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
    // As before the comment store: text comments start from a selection (Comment in the selection bar), not a mode.
    const list: CommentMode[] = [];
    if (anchors.length) list.push('point', 'box');
    if (hasItems) list.push('items');
    if (hasTime) list.push('time');
    list.push('page');
    return list;
  }, [modesKey, anchors.length, hasItems, hasTime]);

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
  const layerId = useId();
  useEscapeLayer(`comments.${layerId}.mode`, () => { cancelMode(); return true; },
    { priority: ESCAPE_PRIORITY.selection + 2, enabled: commentMode != null });

  // Files: the host's upload for comments. Without it the pane takes text only.
  const canUpload = Boolean(host?.upload);
  const attach: CommentAttachMode = canUpload ? 'on' : 'off';
  const maxFileBytes = typeof host?.maxFileBytes === 'number' && host.maxFileBytes > 0 ? host.maxFileBytes : SPACE_FILE_MAX_BYTES;

  const uploadFile = useCallback(async (file: File, upload: {
    onProgress?(sent: number, total: number): void; signal?: AbortSignal;
  } = {}): Promise<CommentFile> => {
    const transport = hostRef.current;
    if (!transport?.upload) throw new SpaceFileError('Files cannot be attached here.', 'space_file_write_required');
    const result = await transport.upload({ file, name: file.name, requestId: newCommentId(),
      onProgress: upload.onProgress, signal: upload.signal });
    return { name: result.name, url: result.url ?? '', previewUrl: result.previewUrl ?? null, path: result.path,
      type: result.type, size: result.size };
  }, []);

  const refreshedAt = useRef(0);
  const refreshFiles = useCallback(() => {
    if (Date.now() - refreshedAt.current < 30000) return;
    refreshedAt.current = Date.now();
    void refetchRef.current();
  }, []);

  const copyChanges = useCallback(async (element: HTMLElement | null) => {
    if (!changeCount || copying) return false;
    setCopying(true);
    const at = new Date().toISOString();
    let all = inScope;
    let list = changes;
    if (hostChanges !== null && hostRef.current) {
      // The digest of a whole Space with no checkpoint reports every comment of it: read once, when it is asked for.
      try {
        const answer = await hostRef.current.list({ page: 'all' });
        all = applyCommentPatches((Array.isArray(answer?.comments) ? answer.comments : []).map(row => commentFromRow(row)), patchesRef.current);
        list = commentChangesSince(all, checkpoint, me);
      } catch (error) {
        fail(error);
        setCopying(false);
        return false;
      }
    }
    const count = list.length;
    const text = commentDigest({ scope: scope ? { ...scope, checkpoint } : null, comments: all, anchors, changes: list, nowIso: at,
      since: checkpoint }, { me, ...(latest.current.digest ?? {}) });
    const ok = await writeCommentClipboard(text, element);
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
  }, [changes, changeCount, hostChanges, copying, scope, checkpoint, inScope, anchors, me, notify, words, marker, fail]);

  return {
    comments: inScope, threads, visibleThreads, changes, checkpoint, isNew, threadsOn, numberOf,
    scope, anchors, anchorKey, anchor,
    filter: effectiveFilter, setFilter, statusFilter, setStatusFilter, counts, scopeCounts, waitingFilter, setWaitingFilter, waits, waitingCount,
    wholeSpace, groupOf,
    threadKey, setThreadKey, selectThread, revealThread, revealRequest,
    actions, viewer, canEdit, canDelete, canWrite, routing,
    modes, commentMode, startMode, cancelMode, startItems, placeText, startAnchor, toolBar, setToolBar,
    commenting, setCommenting, toggleCommenting, draftPin, draftScope, placePin, placePinFromEvent, cancelPin, sendNew, sendAt,
    deleting: null, cancelDelete: noop, confirmDelete,
    attach, maxFileBytes, uploadFile, refreshFiles,
    zones, dragZone, zoneHandlers,
    copyChanges, copying,
    busy, now, toaster: shownToaster, words, say, locale, me, signed, openThread, showOnPage,
    loading: store.loading, hasData: store.hasData, error: store.error, refetch,
    changeCount, hasMore, loadMore, loadingMore,
  };
}
