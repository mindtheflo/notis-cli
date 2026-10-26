/**
 * ListReader (toolkit spec 2.3): a list beside a reader, with the Manager's keys, selection, actions and open modes.
 *
 * It composes `useListKeys`, `useSelection`, `useActions`, `useSelectionBar`, `useOpenMode` and `Panels`:
 * - J/K move the cursor (wrapping on a fresh press), Enter or a click opens the item in the current open mode.
 * - X, Shift+J/K, Mod+A, Mod/Shift-click and press and hold select; the selection bar shows the bulk actions.
 * - Esc closes the open item first, then clears the selection.
 * - After an action takes the cursor row off the list, the cursor (and an open item) moves to the next row, else the
 *   previous one. An E action (Complete, Archive) whose items stay in the list moves on to the row after them.
 * - Side: the reader sits beside the list (Panels; below the Panels minimum it slides over the list with Back).
 *   Center: a dialog over the list (max 880px), J/K still step through items. Full: the reader replaces the list.
 * - The open id lives in the URL (`openParam`, default `open`): the Space URL inside a Space, the page URL (history)
 *   on a Notis page, so reload and links restore it. An open id missing from the list shows "Item not found".
 * - `onOpenChange` may keep the open item (unsaved edits): the list then says why in its toast. An open item that
 *   leaves the list (a search, a refresh, a delete) stays in the reader while the page keeps it, so a page that
 *   deletes the open item drops its unsaved edits first and the list moves on.
 * - Toolbar: one 44px line (a status title, the tabs, "+" and the view menu), then an optional 44px info line. The
 *   search lives in the top bar (`search`), and the open item's label joins the top bar title (`crumbLabel`).
 * - Reader bar (48px): close or back, open as, previous, next, the item's label, its actions, More, then Open as full
 *   page (center) or a second close (one pane). Actions past the bar's room fold into More.
 * - Sizing: the list fills its parent (height 100%, flex 1); the page gives it a set height.
 * - Reorder (`reorder`, off by default): drag a row, or Alt and an arrow key, to move it one item at a time; the new
 *   order shows at once and goes back if `onReorder` rejects (`useReorder`). Off while a local search filters the list
 *   or `groupBy` groups it.
 */

import {
  useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type DragEvent as ReactDragEvent,
  type ReactNode, type Ref,
} from 'react';
import { useNotisRuntime } from '../../provider';
import { useTopBarSearch } from '../../hooks/useTopBarSearch';
import { useTopBarTitleLeaf } from '../../hooks/useTopBarTitleLeaf';
import { useMarqueeSelection } from '../../hooks/useMarqueeSelection';
import { MultiSelectDragOverlay } from '../../components/MultiSelectDragOverlay';
import { writeViewParams } from '../../hooks/useViewParams';
import {
  DEFAULT_KEYMAP, SHELL_WORDS, actionErrorReason, isWords, keyList, toWords, w, type ActionOption, type ActionRef,
  type KeySpec, type Words,
} from '../../words';
import { ESCAPE_PRIORITY } from '../engine/core';
import { containsComposed, isVisibleComposed, openModalLayers } from '../engine/dom';
import { useEscapeLayer, useShortcutOwner, useShortcuts } from '../engine/hooks';
import { ShortcutScope } from '../engine/KeyboardEngine';
import { stepCursor } from '../engine/step';
import type { ShortcutDef } from '../engine/types';
import { Icon } from '../icons';
import { Panels, usePanels } from '../layout/Panels';
import { Menu } from '../overlay/Menu';
import { Tooltip } from '../overlay/Tooltip';
import { cx, deepActiveElement, flag, useIsoLayoutEffect, useLabelValue, useLatest, useStableId, useT } from '../util';
import { ActionToast } from '../actions/ActionToast';
import {
  useActions, type ActionHandlers, type ActionOutcome, type ActionsController, type ResolvedAction,
} from '../actions/useActions';
import type { ToastOptions } from '../actions/useToast';
import { Button, EmptyState } from '../blocks/blocks';
import { TabRow, type TabRowProps } from '../blocks/Tabs';
import { Keycap } from '../keycap/Keycap';
import { OpenAsMenu } from '../open/OpenAsMenu';
import { normalizeAllowed, useOpenMode, useOpenModeKey } from '../open/useOpenMode';
import type { OpenMode } from '../open/openModeStore';
import { boardOrder, dropIndex, neighbourColumn, type BoardColumn, type ListBoard } from '../board/boardModel';
import { BOARD_WORDS } from '../board/boardWords';
import { RowMore } from './Row';
import { RowIdContext, RowStateContext, type RowState, type RowStateSource } from './rowState';
import { SelectionBar, useSelectionBar } from './SelectionBar';
import { ROW_ID_ATTRIBUTE, ROW_INTERACTIVE_SELECTOR, findRow, useListKeys } from './useListKeys';
import { REORDER_WORDS, chainReorderProps, useReorder, type ReorderChange } from './useReorder';
import { useSelection, type Selection } from './useSelection';

/** What the reader slot and the header get besides their item. */
export interface ReaderCtx<T = unknown> {
  /** Closes the item. Returns false when `onOpenChange` kept it open (the list then says why). */
  close(): boolean;
  /** Opens the next item (wraps from the last to the first when the list wraps). */
  next(): void;
  /** Opens the previous item (wraps from the first to the last when the list wraps). */
  prev(): void;
  hasNext: boolean;
  hasPrev: boolean;
  mode: OpenMode;
  setMode(mode: OpenMode): void;
  /**
   * The section the item was opened at (`apiRef.current.open(id, { section })`), else null. The reader scrolls the
   * element with `data-section="<section>"` into view once it renders.
   */
  section: string | null;
  /** Shows words in the list's toast, the one its actions use (`useToast`). */
  notify(words: Words | string, options?: ToastOptions): void;
  /** The list's actions that apply to the open item, in list order (a toggle pair shows the half that fits it). */
  actions: ResolvedAction<T>[];
  /** Ids of the list's actions running now: a reader bar button for one shows busy. */
  busy: ReadonlySet<string>;
  /**
   * Runs one of the list's actions on the open item, as its key does: busy while it runs, the list's toast after it
   * (Undo and Z when it returned an UndoFn), and an E action moves the reader on to the next item. An action with
   * options and no `option` opens its picker in the reader bar, at the bar button that has focus; the promise
   * then settles with the run of the option chosen, or cancelled when the picker closes. An id the list does not have,
   * or an action that does not apply to the item, settles cancelled.
   */
  run(action: ResolvedAction<T> | string, option?: ActionOption): Promise<ActionOutcome<T>>;
  /**
   * The open item's actions in a More menu, the menu its row has (null when none applies or it is pending). The reader
   * bar already draws it; this places the same menu in the reader body too.
   */
  actionsMenu: ReactNode;
}

/** One button of the reader bar (`readerActions`): an icon, and its label and key when `labelled` or keyed. */
export interface ReaderAction {
  id: string;
  label: Words | string;
  /** An icon name. */
  icon: string;
  /** Its key: shown on the button, and it runs the action while the item is open. */
  key?: KeySpec;
  /** Shows the label beside the icon. Default true when `key` is set; an unlabelled button shows it in a tooltip. */
  labelled?: boolean;
  /** Shows the button disabled: neither a click, its key nor the More menu runs it. Every action is disabled while the open item is pending (`isPending`). */
  disabled?: boolean;
  run(): void | Promise<void>;
}

/** The parts of one tile (`renderTile`): a mark, a title and subtitle, a body, then a figure and a trailing node. */
export interface TileParts {
  /** A 36px mark (logo, monogram) beside the title and subtitle. */
  mark?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  body?: ReactNode;
  /** A figure at the bottom start (a count, a price). */
  figure?: ReactNode;
  /** At the bottom end (a status, a date, an avatar). */
  trailing?: ReactNode;
}

/** One choice of the view menu's Sort or Group part, or one of its `actions`. */
export interface ViewMenuItem {
  id: string;
  label: Words | string;
  icon?: string;
  checked?: boolean;
  onSelect(): void;
}

/** The view menu (`viewMenu`): sort and group choices, a layout switch, view actions and a description, in one "..." button. */
export interface ViewMenuProps {
  sort?: readonly ViewMenuItem[];
  group?: readonly ViewMenuItem[];
  layout?: {
    value: string;
    options: ReadonlyArray<{ value: string; label: Words | string; icon?: string }>;
    onChange(value: string): void;
  };
  /** Commands on the whole view ("Refresh research"), after the choices; `checked` is ignored. */
  actions?: readonly ViewMenuItem[];
  /** A muted line at the end of the menu (what the view shows). */
  description?: Words | string;
}

/** The top bar search of a list (`search`). Without `onChange` the list keeps the query and filters with `match`. */
export interface ListSearchProps<T> {
  placeholder?: Words | string;
  value?: string;
  onChange?(value: string): void;
  onSubmit?(): void | Promise<void>;
  /** Whether an item matches the query (local query only). Default: its title or name holds the query. */
  match?(item: T, query: string): boolean;
}

/** The reader bar's part of the context. */
type ReaderBarCtx = Pick<ReaderCtx, 'close' | 'next' | 'prev' | 'hasNext' | 'hasPrev' | 'mode' | 'setMode' | 'section'>;

/** Imperative control of a ListReader (`apiRef`). */
export interface ListReaderApi {
  /**
   * Opens an item, optionally at a section of its reader (see `ReaderCtx.section`). Returns false when it did not
   * open: the item is disabled, or `onOpenChange` kept the open item (the list then says why).
   */
  open(id: string, options?: { section?: string }): boolean;
  /** Closes the open item. Returns false when `onOpenChange` kept it open (the list then says why). */
  close(): boolean;
  /** Moves the cursor without opening. */
  focus(id: string): void;
  /** Shows words in the list's toast, the one its actions use (`useToast`). */
  notify(words: Words | string, options?: ToastOptions): void;
}

/** What `onOpenChange` returns: false, words or a string keep the open item; anything else lets the change happen. */
export type OpenChangeVerdict = void | boolean | Words | string;

/** Why an open change happens: a click, a key or the API (`user`), a move the list makes itself (`auto`: autoOpen, the open item left the list, an E action moved on), or the URL (`url`: load, Back and Forward, a Space link). */
export type OpenChangeReason = 'user' | 'auto' | 'url';

/** One group heading of a ListReader (`groupBy`). */
export interface ListGroup {
  id: string;
  label: Words | string;
}

/** The props of `ListReader`. */
export interface ListReaderProps<T> {
  items: readonly T[];
  /** Default `item.id`. */
  getId?: (item: T) => string;
  /** One row, usually `<Row />`; the list draws the row element and its states around it. */
  row: (item: T, state: RowState) => ReactNode;
  /** The open item. Leave out for a list without a reader (Enter then only calls `onOpen`). */
  reader?: (item: T, ctx: ReaderCtx<T>) => ReactNode;
  /** Standard action ids or custom actions, in order. */
  actions?: readonly ActionRef<T>[];
  /** The Space's runs for the standard ids it lists (a standard id without one is hidden). */
  handlers?: ActionHandlers<T>;
  /** Modes offered, the first is the default. Default side, center and full. */
  openAs?: OpenMode | readonly OpenMode[];
  /** 48px (default) or 40px rows. */
  density?: 'comfortable' | 'compact';
  /**
   * 'table': `row` returns the cells; `columns` gives the header cells. 'board': one column per stage of `board`
   * (BoardView sets it), each drawing its tiles with `renderTile`.
   */
  layout?: 'list' | 'table' | 'tiles' | 'board';
  /** Board layout: the columns, each item's column and how tiles move. Ignored by the other layouts. */
  board?: ListBoard<T>;
  /** Tiles layout: draws each tile from its parts instead of `row`. */
  renderTile?: (item: T) => TileParts;
  /** Tiles layout: 'manager' tiles keep a 152px minimum height. */
  tileVariant?: 'default' | 'manager';
  /** 'two-tone' tints the list beside the reader at all times; 'plain' (default) only while an item is open. */
  look?: 'two-tone' | 'plain';
  /** Header cells of the table layout. */
  columns?: ReactNode;
  /** Consecutive items with the same group id share a heading. */
  groupBy?: (item: T) => ListGroup;
  /** Default true when an action is bulk. */
  selectable?: boolean;
  /**
   * Drag from empty space in the list to select the rows under the rectangle (the Manager's marquee), whenever the
   * list allows multiple selection. Pending and disabled rows are skipped. Default true; false turns it off.
   */
  dragSelect?: boolean;
  /** J on the last row goes to the first. Default true. */
  wrap?: boolean;
  /** Shown when `items` is empty. Default `<EmptyState />`. */
  empty?: ReactNode;
  /** At the toolbar start: what the list shows now (a status, "Inbox"), never the page or view name. */
  title?: { text: Words | string; count?: number };
  /** Pills in the toolbar line (TabRow); the title leads them unless `tabs.lead` is set. */
  tabs?: Omit<TabRowProps<string>, 'end'>;
  /** Icon buttons at the toolbar end, before "+" (a refresh). Keep them few; the rest go in `actions`. */
  toolbarActions?: ReactNode;
  /** A "+" at the toolbar end, its label in a tooltip; `key` also runs it. */
  create?: { label: Words | string; onCreate(): void; key?: KeySpec };
  /** A "..." at the toolbar end with the view's sort, group and layout choices. */
  viewMenu?: ViewMenuProps;
  /** One 44px line under the toolbar (a sync state, a notice). */
  infoLine?: ReactNode;
  /** The top bar search for this list. Leave out for a list with no search. */
  search?: ListSearchProps<T>;
  /**
   * Below the list, outside its scroll (page numbers, a count): one 48px line, at the end of the row. It belongs to
   * the list: beside an open reader it stays under the list, a reader over the list covers it, and it keeps clear of
   * the floating Notis button. The selection bar and the undo toast sit above it.
   */
  footer?: ReactNode;
  /** The open item's label in the reader bar (an id, "PRO-002"). */
  readerLabel?: (item: T) => ReactNode;
  /**
   * The open item's buttons in the reader bar, before its More menu. `ctx.run` runs one of the list's actions with
   * the list's toast. Buttons past the bar's room (more than three) fold into More.
   */
  readerActions?: (item: T, ctx: ReaderCtx<T>) => readonly ReaderAction[];
  /**
   * The open item's leaf in the top bar title ("Tickets / PRO-002"), in every open mode; null for none. Default the
   * item's `title`, else its `name`, when it is a string.
   */
  crumbLabel?: (item: T) => string | null;
  /**
   * Side mode beside the list: open the first item once the list loads (no history step), and with nothing open
   * show "Pick something from the list to read it." in the reader. Default false.
   */
  autoOpen?: boolean;
  /** The URL param holding the open id. Default 'open'. Declare it in the Space's `params` (type text). */
  openParam?: string;
  /**
   * Outside a Space: keep the open id in the page URL (`?open=`, history push on open and close). Default true.
   * Ignored when `open` is controlled.
   */
  openInUrl?: boolean;
  /** Controlled selection (ids); pair with `onSelectedChange`. */
  selected?: readonly string[];
  onSelectedChange?: (ids: string[]) => void;
  /**
   * After an action ran on the selection: 'clear' (default) empties it and keeps only the items that failed;
   * 'keep' leaves it as it was. A cancelled run never changes it.
   */
  afterAction?: 'clear' | 'keep';
  /**
   * Rows can be dragged (all, or the ones this returns true for). Dragging a selected row carries the whole
   * selection in list order. The drag data holds the ids as JSON under `LIST_DRAG_TYPE` and one per line as text.
   */
  draggable?: boolean | ((item: T) => boolean);
  onDragStart?: (items: T[], event: ReactDragEvent<HTMLElement>) => void;
  /**
   * Rows can be put in a new order (off when left out): drag one, or press Alt and an arrow key (all four in tiles),
   * Alt+Home or Alt+End. One item moves at a time. The new order shows at once; `onReorder` saves it, and when its
   * promise rejects the list goes back to `items` and says it could not save (an `ActionError` reason shows under it).
   * Off while a local search filters the list or `groupBy` groups it. Pending and disabled rows do not move.
   */
  reorder?: ListReorder<T>;
  /** The first page is loading: skeleton rows while `items` is empty, a thin bar above the list otherwise. */
  loading?: boolean;
  /** More items can be loaded: a Load more button at the end, loaded as it scrolls into view and by J on the last row. */
  hasMore?: boolean;
  onLoadMore?: () => void | Promise<void>;
  /** The next page is loading. */
  loadingMore?: boolean;
  /**
   * A change on this item is being saved: it shows busy, cannot be selected, dragged or acted on (it still opens).
   * A run may mark its own items pending: they leave the selection while it lasts, and once it ends `afterAction`
   * applies to the selection the run started on (the failed items come back even before the marks clear).
   */
  isPending?: (item: T) => boolean;
  /** This item cannot be opened, selected, dragged or acted on. */
  isDisabled?: (item: T) => boolean;
  /** Group headings fold their rows away. Default false. */
  collapsible?: boolean;
  /** Controlled folded group ids; pair with `onCollapsedChange`. */
  collapsed?: readonly string[];
  onCollapsedChange?: (ids: string[]) => void;
  /** A muted count after each group heading. Default true. */
  groupCounts?: boolean;
  /** Imperative control: open an item (at a section), close, move the cursor, show a toast. */
  apiRef?: Ref<ListReaderApi>;
  /**
   * Called with the item the reader shows, null when it closes: after a click, a key or the API, and when the URL
   * opens one (on load, Back and Forward, a Space link). Without a reader, Enter and a click call it with the item.
   */
  onOpen?: (item: T | null) => void;
  /**
   * The page an item opens, for the desktop's right-click Open in new tab, Open in browser and Copy link. Default: the
   * current URL with the open param set, when the open id lives in the URL. Return null for an item with no page.
   */
  itemHref?: (item: T) => string | null | undefined;
  /** Controlled open id; pair with `onOpenChange`. */
  open?: string | null;
  /**
   * Called with the id about to open (null to close): a click, a key, the API, Back and Forward, a Space link.
   * Return false to keep the current item open, for example while its reader has unsaved edits: the list, the
   * cursor and the URL stay as they are and the list's toast says "Save or cancel your changes first.". Return words
   * or a string to say something else. `reason` says why the change happens; a move the list makes on its own
   * (`auto`) is kept without a toast.
   */
  onOpenChange?: (id: string | null, reason: OpenChangeReason) => OpenChangeVerdict;
  /** Shortcut owner of this list. Default a child of the Space's owner, one per list. */
  scope?: string;
  /** The list's id inside the Space: keys the open mode and the reader width. Default 'list'. */
  listId?: string;
  /** Accessible name of the list. */
  label?: Words | string;
  className?: string;
}

/** How a ListReader's rows are put in a new order (see `reorder`). */
export interface ListReorder<T> {
  /** Save the move: the item, its index before and after, and every id in the new order. */
  onReorder: (change: ReorderChange<T>) => void | Promise<unknown>;
  /** Only these items move (all by default). */
  canReorder?: (item: T) => boolean;
}

/** Every word ListReader shows, in English and French. */
export const LIST_READER_WORDS = Object.freeze({
  list: w('Items', 'Éléments'),
  open: w('Open', 'Ouvrir'),
  openFull: w('Open as full page', 'Ouvrir en pleine page'),
  viewOptions: w('View options', 'Options de la vue'),
  sort: w('Sort', 'Trier'),
  group: w('Group', 'Grouper'),
  layout: w('Layout', 'Disposition'),
  pickOne: w('Pick something from the list to read it.', 'Choisis un élément de la liste pour le lire.'),
  pickKeys: w('{a} to move, {b} to open.', '{a} pour te déplacer, {b} pour ouvrir.'),
  rowActions: w('Actions', 'Actions'),
  loadMore: w('Load more', 'Charger plus'),
  loading: w('Loading…', 'Chargement…'),
  expandGroup: w('Show group', 'Afficher le groupe'),
  collapseGroup: w('Hide group', 'Masquer le groupe'),
  keptOpen: w('Save or cancel your changes first.', 'Enregistre ou annule tes modifications d’abord.'),
  notMoved: w('The page did not change. Try again.', 'La page n’a pas changé. Réessaie.'),
  notFound: w('Item not found', 'Élément introuvable'),
  notFoundBody: w('It may have been deleted, or a search or filter hides it.',
    'Il a peut-être été supprimé, ou une recherche ou un filtre le masque.'),
}) satisfies Readonly<Record<string, Words>>;

/** The words a refusal from `onOpenChange` shows, or null when it let the change happen. */
function refusalOf(verdict: OpenChangeVerdict): Words | null {
  if (verdict === false) return LIST_READER_WORDS.keptOpen;
  if (typeof verdict === 'string') return verdict.trim() ? toWords(verdict) : LIST_READER_WORDS.keptOpen;
  if (isWords(verdict)) return verdict.en.trim() || verdict.fr.trim() ? verdict : LIST_READER_WORDS.keptOpen;
  return null;
}

/** The drag data type of list rows: a JSON array of ids. */
export const LIST_DRAG_TYPE = 'application/x-notis-items';

/** How many skeleton rows the first load shows before the pane is measured. */
const SKELETON_ROWS = 8;

/** The string `title`, else `name`, of an item, else null. */
function textOf(item: unknown): string | null {
  const record = item as { title?: unknown; name?: unknown } | null;
  if (typeof record?.title === 'string' && record.title) return record.title;
  if (typeof record?.name === 'string' && record.name) return record.name;
  return null;
}

/** The default `crumbLabel`: the item's string title, else its name, else none. */
function defaultCrumbLabel<T>(item: T): string | null {
  return textOf(item);
}

/** The default `search.match`: the item's title or name holds the query, ignoring case. */
function defaultMatch<T>(item: T, query: string): boolean {
  return (textOf(item) ?? '').toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

/** The status actions, ranked after the E action in an item's menu. */
const STATUS_ACTION_IDS: ReadonlySet<string> = new Set(['progress', 'pause', 'resume']);

/**
 * An item's menu order (deck menu rank): the first E action, then the status actions, the others in list order,
 * and the danger ones last.
 */
export function rankActions<A extends { id: string; key?: KeySpec; tone?: string }>(actions: readonly A[]): A[] {
  const eIndex = actions.findIndex((action) => keyList(action.key).some((key) => key.toLowerCase() === 'e'));
  const rank = (action: A, index: number) => {
    if (index === eIndex) return 0;
    if (action.tone === 'danger') return 3;
    if (STATUS_ACTION_IDS.has(action.id)) return 1;
    return 2;
  };
  return actions
    .map((action, index) => ({ action, index, rank: rank(action, index) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.action);
}

/** How many `readerActions` the reader bar shows; the rest fold into More. */
const READER_ACTIONS_MAX = 3;

function defaultGetId<T>(item: T): string {
  const id = (item as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : String(id);
}

/** The id that takes `gone`'s place: the next one still in `now`, else the previous one. */
export function successorOf(previous: readonly string[], now: readonly string[], gone: string): string | null {
  const present = new Set(now);
  const index = previous.indexOf(gone);
  if (index === -1) return null;
  for (let i = index + 1; i < previous.length; i += 1) if (present.has(previous[i]!)) return previous[i]!;
  for (let i = index - 1; i >= 0; i -= 1) if (present.has(previous[i]!)) return previous[i]!;
  return null;
}

/** A run that did not happen (no such action, a picker closed unchosen). */
/** Same board columns: same ids, labels and tones in the same order. */
function sameColumns(a: readonly BoardColumn[], b: readonly BoardColumn[]): boolean {
  const label = (value: BoardColumn['label']) => (typeof value === 'string' ? value : `${value.en}\u0001${value.fr}`);
  return a === b || (a.length === b.length && a.every((column, index) => column.id === b[index]!.id
    && column.tone === b[index]!.tone && label(column.label) === label(b[index]!.label)));
}

function cancelledOutcome<T>(): ActionOutcome<T> {
  return { status: 'cancelled', done: [], failed: [] };
}

/** The focused element seen from `root` (inside shadow roots) and its page body. */
function focusOf(root: HTMLElement | null): { active: Element | null; body: HTMLElement | null } {
  if (!root) return { active: null, body: null };
  // A host field outside this ShadowRoot leaves its activeElement null. Keep
  // that real focus instead of treating it as a dropped row and moving it.
  return { active: deepActiveElement(root.getRootNode() as Document | ShadowRoot)
    ?? deepActiveElement(root.ownerDocument), body: root.ownerDocument.body };
}

/** The current URL with `param` set to `id`: the page an item opens when the open id lives in the URL. */
function urlWithParam(param: string, id: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(param, id);
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/** The portal reads this on right-click to offer the desktop's link menu for a row that is not an anchor. */
const ITEM_HREF_ATTRIBUTE = 'data-notis-href';

function readUrlParam(param: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URL(window.location.href).searchParams.get(param) || null;
  } catch {
    return null;
  }
}

function writeUrlParam(param: string, id: string | null, push: boolean): void {
  if (typeof window === 'undefined' || !window.history) return;
  try {
    const url = new URL(window.location.href);
    if (id === null) url.searchParams.delete(param);
    else url.searchParams.set(param, id);
    if (url.href === window.location.href) return;
    // Keep the router's own state object (Next.js stores its tree there).
    if (push) window.history.pushState(window.history.state, '', url.href);
    else window.history.replaceState(window.history.state, '', url.href);
  } catch {
    // A sandboxed frame may refuse history writes: the open id then lives in local state only.
  }
}

/**
 * The open id: the Space URL inside a Space, the page URL outside one (unless `useUrl` is false, then local state);
 * controlled when `open` is given. `onChange` may keep the current id (see `refusalOf`): the setter then returns
 * false and `refuse` shows why, unless the change is `quiet`. A URL change (Back, Forward, a Space link) asks
 * `onChange` too; a refusal puts the URL back. A Space URL write the host refuses puts the list back on the URL's item.
 */
function useOpenId(param: string, controlled: string | null | undefined,
  onChange: ((id: string | null, reason: OpenChangeReason) => OpenChangeVerdict) | undefined, useUrl: boolean,
  refuse: (words: Words) => void) {
  const runtime = useNotisRuntime();
  const raw = runtime?.context?.params ?? null;
  const inSpace = runtime?.resource?.kind === 'space' && typeof runtime.navigate === 'function';
  const pageUrl = !inSpace && useUrl && controlled === undefined;
  const urlValue = inSpace ? (raw?.[param] || null) : null;
  const [local, setLocal] = useState<string | null>(() => (pageUrl ? readUrlParam(param) : urlValue));
  const latest = useLatest({ runtime, inSpace, onChange, controlled, pageUrl, local, refuse, urlValue });
  // The Space URL values this list wrote and has not seen come back yet: its own writes are not asked about again.
  const written = useRef<Array<{ id: string | null }>>([]);

  /** Whether the page lets `id` open (null: close). A refusal says why, unless the list moved on its own (`auto`). */
  const allows = useCallback((id: string | null, reason: OpenChangeReason): boolean => {
    const words = refusalOf(latest.current.onChange?.(id, reason));
    if (words === null) return true;
    if (reason !== 'auto') latest.current.refuse(words);
    return false;
  }, [latest]);

  // A move the user made (`follow`) that the host refuses sends the list back to the item the URL still holds, and says
  // so; a move the list made on its own, and a write putting the URL back after a refusal, keep the list where it is.
  const writeSpace = useCallback((id: string | null, replace: boolean, follow = false) => {
    const entry = { id };
    written.current.push(entry);
    void writeViewParams(latest.current.runtime, { [param]: id }, { replace }).catch(() => {
      written.current = written.current.filter((pending) => pending !== entry);
      if (!follow || written.current.length) return;
      const { urlValue: kept, local: current, refuse: say } = latest.current;
      if (kept === current) return;
      setLocal(kept);
      say(LIST_READER_WORDS.notMoved);
    });
  }, [latest, param]);

  useEffect(() => {
    if (!inSpace) return;
    const { controlled: isControlled, local: current } = latest.current;
    if (isControlled !== undefined) {
      setLocal(urlValue);
      return;
    }
    const echo = written.current.findIndex((entry) => entry.id === urlValue);
    if (echo !== -1) {
      // This list's own write came back (two quick writes may come back as the last one only).
      written.current.splice(0, echo + 1);
      if (!written.current.length) setLocal(urlValue);
      return;
    }
    if (urlValue === current) return;
    written.current = [];
    // Back, Forward or a link changed the Space URL: when the page keeps its open item, the URL goes back to it.
    if (!allows(urlValue, 'url')) {
      writeSpace(current, true);
      return;
    }
    setLocal(urlValue);
  }, [allows, inSpace, latest, urlValue, writeSpace]);

  useEffect(() => {
    if (!pageUrl || typeof window === 'undefined') return undefined;
    const sync = () => {
      const next = readUrlParam(param);
      const { local: current } = latest.current;
      if (next === current) return;
      // Back or Forward: when the page keeps its open item (unsaved edits), the URL goes back to that item.
      if (!allows(next, 'url')) {
        writeUrlParam(param, current, false);
        return;
      }
      setLocal(next);
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [allows, latest, pageUrl, param]);

  const set = useCallback((id: string | null, quiet = false, noStep = false): boolean => {
    const { inSpace: space, controlled: isControlled, pageUrl: page, local: current } = latest.current;
    if (!allows(id, quiet ? 'auto' : 'user')) return false;
    if (isControlled !== undefined) return true;
    setLocal(id);
    // Opening and closing are history steps (Back closes the item); moving between items, and an open the list makes
    // on its own (`noStep`), replace.
    const replace = noStep || (id !== null && current !== null);
    if (page) writeUrlParam(param, id, !replace);
    // In a Space the open id is one of its own view params: the same Space and record stay open.
    else if (space) writeSpace(id, replace, !quiet);
    return true;
  }, [allows, latest, param, writeSpace]);

  return [controlled !== undefined ? controlled : local, set] as const;
}

/** The selection with blocked (pending, disabled) ids kept out. */
function guardSelection(selection: Selection, blocked: (id: string) => boolean, selectable: readonly string[]): Selection {
  return {
    ...selection,
    toggle: (id) => { if (!blocked(id)) selection.toggle(id); },
    extendTo: (id) => { if (!blocked(id)) selection.extendTo(id); },
    extendStep: (id) => { if (!blocked(id)) selection.extendStep(id); },
    set: (ids) => selection.set(ids.filter((id) => !blocked(id))),
    selectAll: () => selection.set(selectable),
  };
}

/** A list beside a reader, with the Manager's keys, selection, actions and open modes (see the file header). */
export interface ListSkeletonProps {
  /** Draw a group head first, for a list that groups its rows. */
  grouped?: boolean;
  /** A fixed number of rows. Default: as many as fill the visible pane. */
  rows?: number;
}

/**
 * The list while its first page loads, drawn like the rows it stands for: a group head when the list
 * groups, then a lead mark and a title over a meta line, as many rows as fill the pane. Pages use it for
 * their own route fallbacks so the page does not shift when the real list arrives.
 */
export function ListSkeleton({ grouped = false, rows }: ListSkeletonProps) {
  const t = useT();
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [fill, setFill] = useState(SKELETON_ROWS);
  useIsoLayoutEffect(() => {
    const pane = paneRef.current;
    if (rows !== undefined || !pane || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const row = pane.querySelector<HTMLElement>('.nui-row-skel');
      const rowHeight = row?.offsetHeight ?? 0;
      if (rowHeight <= 0 || pane.clientHeight <= 0) return;
      const head = pane.querySelector<HTMLElement>('.nui-group-head')?.offsetHeight ?? 0;
      setFill(Math.max(1, Math.ceil((pane.clientHeight - head) / rowHeight)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [rows]);
  return (
    <div ref={paneRef} className="nui-lr-scroll" role="status" aria-busy="true" aria-label={t(LIST_READER_WORDS.loading)}>
      {grouped && (
        <div className="nui-group-head" aria-hidden="true"><span className="nui-skel nui-skel-head" /></div>
      )}
      {Array.from({ length: rows ?? fill }, (_, index) => (
        <div key={index} className="nui-row nui-row-skel" aria-hidden="true">
          <span className="nui-skel nui-skel-dot" />
          <span className="nui-row-main">
            <span className="nui-skel nui-skel-line" style={{ width: `${44 - ((index * 13) % 22)}%` }} />
            <span className="nui-skel nui-skel-meta" style={{ width: `${22 + ((index * 7) % 12)}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function ListReader<T>(props: ListReaderProps<T>) {
  const parent = useShortcutOwner();
  const autoId = useStableId('list');
  const owner = props.scope ?? `${parent}/${props.listId ?? autoId}`;
  return (
    <ShortcutScope owner={owner} available>
      <ListReaderInner {...props} />
    </ShortcutScope>
  );
}

function ListReaderInner<T>({
  getId = defaultGetId, row, reader, actions = [], handlers, openAs, density = 'comfortable', layout = 'list',
  columns, groupBy, selectable, dragSelect = true, wrap = true, empty, title, tabs, toolbarActions, create, viewMenu, infoLine, search, footer,
  readerLabel, readerActions, crumbLabel = defaultCrumbLabel, autoOpen: autoOpenProp = false, renderTile, tileVariant, look = 'plain',
  openParam = 'open', onOpen, itemHref, open: controlledOpen, onOpenChange, listId = 'list', label, className, openInUrl = true,
  selected: controlledSelected, onSelectedChange, afterAction = 'clear', draggable, onDragStart, loading = false,
  hasMore = false, onLoadMore, loadingMore = false, isPending, isDisabled, collapsible = false,
  collapsed: controlledCollapsed, onCollapsedChange, groupCounts = true, apiRef, items: naturalItems, reorder, board,
}: ListReaderProps<T>) {
  const t = useT();
  const labelled = useLabelValue();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const readerRef = useRef<HTMLDivElement | null>(null);

  // ---- search: the top bar query; a local one (no `search.onChange`) filters the items here ----
  const [localQuery, setLocalQuery] = useState('');
  const localSearch = !!search && !search.onChange;
  const query = localSearch ? localQuery.trim() : '';
  const match = search?.match ?? defaultMatch;

  // ---- reorder: the optimistic order comes first, so a search and the keys see the order the list shows ----
  const notifyRef = useRef<ActionsController<T>['notify'] | null>(null);
  const reorderer = useReorder<T>({
    items: naturalItems,
    getId,
    enabled: !!reorder && !query && !groupBy && layout !== 'board',
    orientation: layout === 'tiles' ? 'both' : 'vertical',
    canReorder: reorder?.canReorder,
    onReorder: (change) => reorder?.onReorder(change),
    onError: (error) => notifyRef.current?.(REORDER_WORDS.failed, { tone: 'danger', reason: actionErrorReason(error) }),
  });
  const allItems = reorderer.items;
  const filtered = useMemo(() => (query ? allItems.filter((item) => match(item, query)) : allItems),
    [allItems, match, query]);

  // ---- board: the items column by column, so J/K, Shift+J/K and Mod+A walk them as the board shows them ----
  const boardOn = layout === 'board' && !!board;
  // A board opens nothing on its own (BRD5: with nothing open it runs full width).
  const autoOpen = autoOpenProp && !boardOn;
  const boardItems = useRef<T[]>([]);
  const boardColumns = useRef<readonly BoardColumn[]>([]);
  let items: readonly T[] = filtered;
  if (boardOn) {
    const ordered = boardOrder(filtered, board!.columns, board!.getColumn);
    const previous = boardItems.current;
    // A page that moves items in place (same items, same order) keeps the same array, so the memos below hold.
    if (ordered.length !== previous.length || ordered.some((item, index) => item !== previous[index])) {
      boardItems.current = ordered;
    }
    items = boardItems.current;
  }
  const columnKey = boardOn ? items.map((item) => board!.getColumn(item)).join('\u0001') : '';
  /** Each item's column, in `items` order: a new array only when one changes. */
  const itemColumns = useMemo(() => columnKey.split('\u0001'), [columnKey]);
  // A page that writes its columns inline keeps the same array while no id, label or tone changes.
  if (boardOn && !sameColumns(board!.columns, boardColumns.current)) boardColumns.current = board!.columns;
  const boardCols = boardColumns.current;

  const ids = useMemo(() => items.map(getId), [items, getId]);
  const byId = useMemo(() => {
    const map = new Map<string, T>();
    items.forEach((item, index) => map.set(ids[index]!, item));
    return map;
  }, [items, ids]);
  const blockedIds = useMemo(() => {
    const out = new Set<string>();
    if (!isPending && !isDisabled) return out;
    items.forEach((item, index) => {
      if (isPending?.(item) || isDisabled?.(item)) out.add(ids[index]!);
    });
    return out;
  }, [ids, isDisabled, isPending, items]);
  const disabledIds = useMemo(() => {
    const out = new Set<string>();
    if (!isDisabled) return out;
    items.forEach((item, index) => { if (isDisabled(item)) out.add(ids[index]!); });
    return out;
  }, [ids, isDisabled, items]);
  const isBlocked = useCallback((id: string) => blockedIds.has(id), [blockedIds]);
  /** Items the actions may touch: pending and disabled ones are left out. */
  const getItem = useCallback((id: string) => (blockedIds.has(id) ? undefined : byId.get(id)), [blockedIds, byId]);

  // ---- groups ----
  const groups = useMemo(() => {
    const out: Array<{ group: ListGroup | null; entries: Array<{ item: T; id: string }> }> = [];
    items.forEach((item, index) => {
      const group = groupBy ? groupBy(item) : null;
      const last = out[out.length - 1];
      if (last && (last.group?.id ?? null) === (group?.id ?? null)) last.entries.push({ item, id: ids[index]! });
      else out.push({ group, entries: [{ item, id: ids[index]! }] });
    });
    return out;
  }, [groupBy, ids, items]);
  const [collapsedLocal, setCollapsedLocal] = useState<readonly string[]>([]);
  const collapsedList = controlledCollapsed ?? collapsedLocal;
  const collapsedSet = useMemo(() => new Set(collapsible && !boardOn ? collapsedList : []),
    [boardOn, collapsible, collapsedList]);
  const toggleGroup = useCallback((id: string) => {
    const next = collapsedList.includes(id) ? collapsedList.filter((entry) => entry !== id) : [...collapsedList, id];
    if (controlledCollapsed === undefined) setCollapsedLocal(next);
    onCollapsedChange?.(next);
  }, [collapsedList, controlledCollapsed, onCollapsedChange]);
  /** The ids J/K walk: rows of folded groups are out. */
  const navIds = useMemo(() => {
    if (!collapsedSet.size) return ids;
    return groups.flatMap(({ group, entries }) => (group && collapsedSet.has(group.id) ? [] : entries.map((e) => e.id)));
  }, [collapsedSet, groups, ids]);
  const selectableIds = useMemo(() => (blockedIds.size ? ids.filter((id) => !blockedIds.has(id)) : ids),
    [blockedIds, ids]);

  /** The board's columns with their tiles (empty columns too); `laneIds` is what the arrows walk. */
  const lanes = useMemo(() => {
    if (!boardOn) return [];
    const map = new Map<string, Array<{ item: T; id: string }>>(boardCols.map((column) => [column.id, []]));
    items.forEach((item, index) => map.get(itemColumns[index]!)?.push({ item, id: ids[index]! }));
    return boardCols.map((column) => ({ column, entries: map.get(column.id)! }));
  }, [boardOn, boardCols, itemColumns, ids, items]);
  const laneIds = useMemo(() => lanes.map((lane) => lane.entries.map((entry) => entry.id)), [lanes]);

  // ---- board moves: the 'move' action (M, the selection bar, More) gets the columns as its choices ----
  /** The drop index a drag hands to the next move run (read and cleared by the run). */
  const pendingIndex = useRef<number | undefined>(undefined);
  /** The tile the cursor follows to its new column until the page shows it there. */
  const landing = useRef<{ id: string; column: string; focus: boolean } | null>(null);
  const moveRun = useRef<(targets: T[], choice?: ActionOption) => unknown>(() => undefined);
  const boardMove = boardOn && !!board!.onMove;
  const boardRef = useLatest(board);
  const listActions = useMemo<readonly ActionRef<T>[]>(() => {
    if (!boardMove) return actions;
    const def = {
      id: 'move',
      bulk: true,
      options: () => boardRef.current!.columns.map((column) => ({ value: column.id, label: column.label })),
      value: (targets: T[]) => {
        const first = targets[0] ? boardRef.current!.getColumn(targets[0]) : null;
        return first !== null && targets.every((item) => boardRef.current!.getColumn(item) === first) ? first : null;
      },
      run: (targets: T[], choice?: ActionOption) => moveRun.current(targets, choice),
    };
    const at = actions.findIndex((ref) => (typeof ref === 'string' ? ref : ref.id) === 'move');
    if (at === -1) return [def as ActionRef<T>, ...actions];
    const listed = actions[at]!;
    const merged = (typeof listed === 'string' ? def : { ...listed, ...def }) as ActionRef<T>;
    return actions.map((ref, index) => (index === at ? merged : ref));
  }, [actions, boardMove, boardRef, moveRun]);

  // ---- open id, cursor, mode ----
  const actionsController = useActions(listActions, handlers);
  const [openId, setOpenId] = useOpenId(openParam, controlledOpen, onOpenChange, openInUrl, actionsController.notify);
  const runtime = useNotisRuntime();
  // The item the reader last showed: an open item that leaves the list while the page keeps it open (unsaved edits)
  // stays in the reader until it closes.
  const lastShown = useRef<{ id: string; item: T } | null>(null);
  const listed = openId !== null && byId.has(openId);
  if (openId === null || (!listed && lastShown.current?.id !== openId)) lastShown.current = null;
  else if (listed) lastShown.current = { id: openId, item: byId.get(openId) as T };
  const known = openId !== null && lastShown.current?.id === openId;
  const openItem = reader && known ? lastShown.current!.item : null;
  // An open id the list does not hold (a stale link, a deleted item): the reader says so instead of staying blank.
  // Not while the first page loads, nor while more pages may still hold it.
  const missing = !!reader && openId !== null && !known && !loading && !hasMore && items.length > 0;
  const readerOpen = openItem !== null || missing;
  const [cursor, setCursor] = useState<string | null>(openId);
  const allowed = normalizeAllowed(openAs);
  const storeKey = useOpenModeKey(undefined, listId);
  const [mode, setMode] = useOpenMode({ allowed, listId });
  const latest = useLatest({ ids, navIds, byId, onOpen, openId, cursor, reader, disabledIds, hasMore, onLoadMore,
    loadingMore });

  useEffect(() => { if (openId !== null) setCursor(openId); }, [openId]);

  // onOpen follows the item the reader shows, however it opened (a click, a key, the API, the URL on load, Back).
  // While an open id waits for its item (the first page loads), nothing is said yet.
  const announced = useRef<string | null>(null);
  const shownId = openItem !== null ? openId : null;
  useEffect(() => {
    if (!reader || (openId !== null && openItem === null && !missing)) return;
    if (announced.current === shownId) return;
    announced.current = shownId;
    const { onOpen: notify, byId: map } = latest.current;
    notify?.(shownId === null ? null : map.get(shownId) ?? lastShown.current?.item ?? null);
  }, [latest, missing, openId, openItem, reader, shownId]);

  /**
   * Opens `id` (null closes). Returns false when it did not: the item is disabled, or the page kept its open item
   * (`onOpenChange`), which the toast then says unless `quiet` (a move the list makes on its own). `noStep` replaces
   * the URL instead of adding a history step.
   */
  const open = useCallback((id: string | null, options: { quiet?: boolean; noStep?: boolean } = {}): boolean => {
    const { byId: map, onOpen: notify, disabledIds: disabled } = latest.current;
    if (id !== null) setCursor(id);
    if (id !== null && disabled.has(id)) return false;
    if (!latest.current.reader) {
      if (id !== null) notify?.(map.get(id) ?? null);
      return true;
    }
    const kept = latest.current.openId;
    if (id === kept) return true;
    // The page kept its open item (onOpenChange refused): the cursor goes back to it, if the list still holds it.
    if (!setOpenId(id, !!options.quiet, !!options.noStep)) {
      if (kept !== null && latest.current.ids.includes(kept)) setCursor(kept);
      return false;
    }
    return true;
  }, [latest, setOpenId]);
  const close = useCallback(() => open(null), [open]);

  // The open item's leaf in the top bar title, in every open mode.
  useTopBarTitleLeaf(openItem !== null ? crumbLabel(openItem) : null, close);

  // ---- focus follows the cursor when an action moves it on (E, a removed row) ----
  // Noted before the move: focus in the list (or dropped to the page) goes to the new cursor row; focus in the
  // reader stays there, and the reader pane takes it back if the item change dropped it.
  const follow = useRef<{ id: string; where: 'list' | 'reader' } | null>(null);
  const noteFollow = useCallback((id: string | null) => {
    const { active, body } = focusOf(rootRef.current);
    if (id === null) follow.current = null;
    else if (active && active !== body && containsComposed(readerRef.current, active)) follow.current = { id, where: 'reader' };
    else if (!active || active === body || containsComposed(listRef.current, active)) follow.current = { id, where: 'list' };
    else follow.current = null;
  }, []);
  useEffect(() => {
    const target = follow.current;
    if (!target) return;
    follow.current = null;
    if (target.id !== cursor) return;
    const { active, body } = focusOf(rootRef.current);
    const dropped = !active || active === body;
    if (target.where === 'reader') {
      if (dropped) readerRef.current?.focus({ preventScroll: true });
      return;
    }
    // Focus went somewhere else meanwhile (a dialog, a field): leave it there.
    if (!dropped && !containsComposed(listRef.current, active)) return;
    const rowEl = findRow(scrollRef.current, target.id);
    if (!rowEl) return;
    rowEl.focus({ preventScroll: true });
    rowEl.scrollIntoView?.({ block: 'nearest' });
  }, [cursor]);

  // A section to show in the reader: set by apiRef.open(id, { section }), cleared once another item opens (or none),
  // so stepping back to the item later starts at its top.
  const [section, setSection] = useState<{ id: string; name: string; seq: number } | null>(null);
  const sectionSeq = useRef(0);
  const sectionOpenId = useRef(openId);
  useEffect(() => {
    if (sectionOpenId.current === openId) return;
    sectionOpenId.current = openId;
    if (section && section.id !== openId) setSection(null);
  }, [openId, section]);
  const notify = actionsController.notify;
  notifyRef.current = notify;
  useImperativeHandle(apiRef, () => ({
    open: (id, options) => {
      // A refused open leaves the open item at the section it shows.
      const opened = open(id);
      if (opened) setSection(options?.section ? { id, name: options.section, seq: ++sectionSeq.current } : null);
      return opened;
    },
    close: () => open(null),
    focus: (id) => { if (latest.current.ids.includes(id)) setCursor(id); },
    notify,
  }), [latest, notify, open]);
  const activeSection = section && section.id === openId ? section : null;

  // ---- selection and actions ----
  const rawSelection = useSelection({
    ids: selectableIds, cursor, selected: controlledSelected, onChange: onSelectedChange,
  });
  const selection = useMemo(() => (blockedIds.size ? guardSelection(rawSelection, isBlocked, selectableIds) : rawSelection),
    [blockedIds.size, isBlocked, rawSelection, selectableIds]);
  const selectionRef = useLatest(selection);
  // Each run notes the selection it starts on: a page that marks the run's items pending takes them out of the
  // selection while it lasts, so the end of the run reads this note instead (keyed by action, one run at a time).
  const runStarts = useRef(new Map<string, { onSelection: boolean; selected: string[] }>());
  const controller: ActionsController<T> = {
    ...actionsController,
    run: (action, items, choice) => {
      const id = typeof action === 'string' ? action : action.id;
      if (!actionsController.isBusy(id)) {
        const sel = selectionRef.current;
        runStarts.current.set(id, {
          onSelection: sel.count > 0 && items.some((item) => sel.isSelected(getId(item))),
          selected: [...sel.selected],
        });
      }
      return actionsController.run(action, items, choice);
    },
  };
  const canSelect = selectable ?? controller.actions.some((action) => action.bulk);
  const listSelection = canSelect ? selection : null;

  /**
   * After a run: on the selection, clear it and keep the failed items ('clear'), or leave it ('keep'). An E action
   * whose items stay in the list moves the cursor (and an open item) to the row after them (deck setStatus).
   */
  const onRan = useCallback((action: ResolvedAction<T>, items: T[], outcome: ActionOutcome<T>) => {
    const start = runStarts.current.get(action.id);
    runStarts.current.delete(action.id);
    if (outcome.status === 'cancelled' || outcome.status === 'busy') return;
    const sel = selectionRef.current;
    const { ids: present, disabledIds: disabled } = latest.current;
    const failedIds = outcome.failed.map((item) => getId(item));
    const ranOnSelection = !!start?.onSelection || (sel.count > 0 && items.some((item) => sel.isSelected(getId(item))));
    const moveOn = keyList(action.key).some((key) => key.toLowerCase() === 'e');
    // A board move leaves the selection selected, so the next move takes it on (as Shift+Left/Right does).
    const keep = afterAction === 'keep' || (boardMove && action.id === 'move');
    // Items still marked pending come back too: the page clears its marks as the run ends, maybe after this.
    const restore = (next: Iterable<string>) => {
      const wanted = new Set(next);
      const kept = present.filter((id) => wanted.has(id) && !disabled.has(id));
      if (kept.length !== sel.count || kept.some((id) => !sel.isSelected(id))) rawSelection.set(kept);
    };
    if (ranOnSelection || moveOn) {
      if (!keep || moveOn) {
        if (failedIds.length) restore(failedIds);
        else sel.clear();
      } else {
        restore([...(start?.selected ?? []), ...sel.selected, ...failedIds]);
      }
    }
    if (!moveOn || outcome.status !== 'done') return;
    const { ids: list, cursor: current, openId: opened } = latest.current;
    const doneIds = outcome.done.map((item) => getId(item));
    const last = Math.max(-1, ...doneIds.map((id) => list.indexOf(id)));
    const next = list.slice(last + 1).find((id) => !doneIds.includes(id)) ?? null;
    if (!next || !doneIds.includes((current ?? opened) as string)) return;
    noteFollow(next);
    setCursor(next);
    if (opened !== null && doneIds.includes(opened)) open(next, { quiet: true });
  }, [afterAction, boardMove, getId, latest, noteFollow, open, rawSelection, selectionRef]);

  // ---- pickers (Move to, Assign): a menu of the action's options at the button, row or reader bar ----
  const [picker, setPicker] = useState<{ action: ResolvedAction<T>; items: T[]; anchor: HTMLElement | null } | null>(null);
  // The run `ReaderCtx.run` waits on while its picker is open: settled with the option's run, or cancelled.
  const pickerSettle = useRef<((outcome: ActionOutcome<T>) => void) | null>(null);
  const settlePicker = useCallback((outcome: ActionOutcome<T> | null) => {
    const settle = pickerSettle.current;
    pickerSettle.current = null;
    if (settle) settle(outcome ?? cancelledOutcome<T>());
  }, []);
  const pickerAnchor = useCallback((action: ResolvedAction<T>): HTMLElement | null => {
    const root = rootRef.current;
    if (!root) return null;
    const escapeId = action.id.replace(/["\\]/g, '\\$&');
    const button = root.querySelector<HTMLElement>(`.nui-selbar [data-action="${escapeId}"]`);
    if (button) return button;
    const { cursor: current, openId: opened } = latest.current;
    const readerOpenNow = opened !== null && !!readerRef.current;
    if (readerOpenNow) return readerRef.current!.querySelector<HTMLElement>('[data-part="actions"]') ?? readerRef.current;
    const rowId = current ?? opened;
    const rowEl = rowId !== null ? findRow(scrollRef.current, rowId) : null;
    return rowEl?.querySelector<HTMLElement>('.nui-row-more') ?? rowEl ?? scrollRef.current ?? root;
  }, [latest]);
  const openPicker = useCallback((action: ResolvedAction<T>, targets: T[], anchor: HTMLElement | null,
    settle?: (outcome: ActionOutcome<T>) => void) => {
    // A picker still open closes unchosen.
    settlePicker(null);
    pickerSettle.current = settle ?? null;
    setPicker({ action, items: targets, anchor: anchor ?? pickerAnchor(action) });
  }, [pickerAnchor, settlePicker]);
  const choose = useCallback((action: ResolvedAction<T>, targets: T[], option: ActionOption) => {
    setPicker(null);
    return controller.run(action, targets, option).then((outcome) => {
      if (outcome.status !== 'busy') onRan(action, targets, outcome);
      return outcome;
    });
  }, [controller, onRan]);

  // Selection keys rest while the list is hidden (full page) or behind the center dialog.
  const listVisible = useCallback(() => {
    const element = listRef.current;
    if (!element || !element.isConnected || element.hasAttribute('inert')) return false;
    return typeof window === 'undefined' || window.getComputedStyle(element).display !== 'none';
  }, []);

  // With rows selected beside the reader, a shared key (E, S) acts on the selection, as the selection bar shows.
  const selectionKeys = useCallback(() => selectionRef.current.count > 0 && listVisible(), [listVisible, selectionRef]);
  const bar = useSelectionBar<T>({
    controller,
    selection,
    getItem,
    // With nothing selected the keys act on the cursor (else the open) row, unless it is pending or disabled.
    fallback: () => {
      const { openId: opened, cursor: current } = latest.current;
      const id = current ?? opened;
      const item = id !== null ? getItem(id) : undefined;
      return item !== undefined ? [item] : [];
    },
    when: listVisible,
    onRan,
    onPick: openPicker,
  });

  // ---- removals: the cursor and an open item move on (next, else previous) ----
  const previousIds = useRef<readonly string[]>(ids);
  useIsoLayoutEffect(() => {
    const previous = previousIds.current;
    previousIds.current = ids;
    if (previous === ids) return;
    const present = new Set(ids);
    const { cursor: current, openId: opened } = latest.current;
    if (current !== null && !present.has(current) && previous.includes(current)) {
      const next = successorOf(previous, ids, current);
      noteFollow(next);
      setCursor(next);
    }
    if (opened !== null && !present.has(opened) && previous.includes(opened)) {
      open(successorOf(previous, ids, opened), { quiet: true });
    }
  }, [ids]);

  // ---- keys ----
  const centerOpen = readerOpen && mode === 'center';
  const fullOpen = readerOpen && mode === 'full';
  // Side mode: in one pane Panels lays the open item over the list (inert). The probe in the list reports the layout.
  const [paneLayout, setPaneLayout] = useState<PaneLayout>(NO_PANE);
  /** The open item hides the list: full page, the center dialog, or one pane. The toast then sits above the reader. */
  const listCovered = fullOpen || centerOpen || (mode === 'side' && readerOpen && paneLayout.covers);
  const besideList = !!reader && mode === 'side' && paneLayout.split;

  // autoOpen: beside the list, the first item opens once the list has loaded (once per list, without a history step).
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpen || autoOpened.current || !besideList) return;
    if (openId !== null) { autoOpened.current = true; return; }
    if (loading || !navIds.length) return;
    autoOpened.current = true;
    open(navIds[0]!, { quiet: true, noStep: true });
  }, [autoOpen, besideList, loading, navIds, open, openId]);
  const loadMore = useCallback(() => {
    const { hasMore: more, onLoadMore: load, loadingMore: busy } = latest.current;
    if (!more || !load || busy) return;
    void Promise.resolve(load()).catch(() => {});
  }, [latest]);
  const wraps = wrap && !hasMore;
  const { getRowProps } = useListKeys({
    ids: navIds, cursor, setCursor, onOpen: open, wrap: wraps, containerRef: scrollRef, selection: listSelection,
    openId: readerOpen ? openId : null, enabled: !centerOpen && !fullOpen,
    onReachEnd: hasMore && onLoadMore ? loadMore : undefined, grid: layout === 'tiles',
    board: boardOn ? laneIds : undefined,
  });

  // ---- drag to select: a marquee from empty space selects the rows under it (Manager `enableDragSelect`) ----
  const marquee = useMarqueeSelection({
    enabled: canSelect && dragSelect && !centerOpen && !fullOpen,
    itemAttribute: ROW_ID_ATTRIBUTE,
    interactiveSelector: ROW_INTERACTIVE_SELECTOR,
    // A full list leaves no empty space below its rows: a drag may start on a row's leading strip too.
    startSelector: '.nui-row-lead',
    isSelectable: (id) => !blockedIds.has(id) && byId.has(id),
    onSelect: (next) => selectionRef.current.set(next),
    onClear: () => { if (selectionRef.current.count > 0) selectionRef.current.clear(); },
  });

  // The reader's J/K, Prev and Next wrap like the list (fresh press only); with more to load, the end loads it.
  const step = useCallback((delta: number, repeat = false) => {
    const { navIds: list, openId: opened, cursor: current } = latest.current;
    const from = opened ?? current;
    const next = stepCursor(list, from, delta, { wrap: wraps, repeat });
    if (next === null) return false;
    if (next === from) {
      if (delta > 0 && latest.current.hasMore && list[list.length - 1] === from) { loadMore(); return true; }
      return false;
    }
    open(next);
    return true;
  }, [latest, loadMore, open, wraps]);

  // Center peek is modal: only modal keys run, so J/K step through items from here (not while a menu is open).
  const centerDefs = useMemo<ShortcutDef[]>(() => {
    if (!centerOpen) return [];
    const onlyThisDialog = () => {
      const dialog = readerRef.current;
      if (!dialog) return false;
      return openModalLayers(dialog.ownerDocument).every((layer) => layer === dialog);
    };
    const k = DEFAULT_KEYMAP;
    return [
      { id: `${k['list.next'].id}.center`, keys: [...k['list.next'].keys], scope: 'modal', label: k['list.next'].label,
        repeat: true, when: onlyThisDialog, run: (event: KeyboardEvent) => step(1, event.repeat) },
      { id: `${k['list.prev'].id}.center`, keys: [...k['list.prev'].keys], scope: 'modal', label: k['list.prev'].label,
        repeat: true, when: onlyThisDialog, run: (event: KeyboardEvent) => step(-1, event.repeat) },
    ];
  }, [centerOpen, step]);
  useShortcuts(centerDefs);

  // Where the reader covers the list (full page, or one pane below the Panels minimum) the list's keys rest with it:
  // J/K step through items from the reader instead, like the reader bar's Prev and Next.
  const coverDefs = useMemo<ShortcutDef[]>(() => {
    if (!readerOpen || centerOpen) return [];
    const covering = () => {
      const pane = readerRef.current;
      if (!pane || !isVisibleComposed(pane)) return false;
      return fullOpen || !isVisibleComposed(listRef.current);
    };
    const k = DEFAULT_KEYMAP;
    return [
      { id: `${k['list.next'].id}.reader`, keys: [...k['list.next'].keys], scope: 'detail', label: k['list.next'].label,
        repeat: true, when: covering, run: (event: KeyboardEvent) => step(1, event.repeat) },
      { id: `${k['list.prev'].id}.reader`, keys: [...k['list.prev'].keys], scope: 'detail', label: k['list.prev'].label,
        repeat: true, when: covering, run: (event: KeyboardEvent) => step(-1, event.repeat) },
    ];
  }, [centerOpen, fullOpen, readerOpen, step]);
  useShortcuts(coverDefs);

  // ---- board moves: the move run, Shift+Left/Right, drag and drop, and the cursor that follows a moved tile ----
  const laneIdsRef = useLatest(laneIds);
  const controllerRef = useLatest(controller);
  moveRun.current = (targets, choice) => {
    const index = pendingIndex.current;
    pendingIndex.current = undefined;
    const current = boardRef.current;
    if (!choice || !current?.onMove || !targets.length) return { cancelled: true };
    const to = choice.value;
    const targetIds = targets.map(getId);
    const at = current.columns.findIndex((column) => column.id === to);
    if (at === -1) return { cancelled: true };
    if (index === undefined) {
      if (targets.every((item) => current.getColumn(item) === to)) return { cancelled: true };
    } else {
      // A drop that leaves the column as it was changes nothing.
      const lane = laneIdsRef.current[at] ?? [];
      const rest = lane.filter((id) => !targetIds.includes(id));
      const next = [...rest.slice(0, index), ...targetIds, ...rest.slice(index)];
      if (next.length === lane.length && next.every((id, position) => id === lane[position])) return { cancelled: true };
    }
    const { cursor: currentCursor } = latest.current;
    const lead = currentCursor !== null && targetIds.includes(currentCursor) ? currentCursor : targetIds[0]!;
    const { active, body } = focusOf(rootRef.current);
    landing.current = {
      id: lead, column: to, focus: !active || active === body || containsComposed(listRef.current, active),
    };
    setCursor(lead);
    const words = toWords(current.columns[at]!.label);
    const moved: Words = {
      en: BOARD_WORDS.moved.en.replace('{column}', words.en), fr: BOARD_WORDS.moved.fr.replace('{column}', words.fr),
    };
    const settle = (result: unknown) => {
      if (typeof result === 'function') return { undo: result as () => void, toast: moved };
      if (result && typeof result === 'object') {
        const detail = result as { cancelled?: boolean; failed?: readonly unknown[]; undo?: unknown; toast?: unknown };
        if (detail.cancelled || detail.failed?.length) landing.current = null;
        if (typeof detail.undo === 'function' && !('toast' in detail)) return { ...detail, toast: moved };
      }
      return result;
    };
    let result: unknown;
    try {
      result = current.onMove(targetIds, to, index);
    } catch (error) {
      landing.current = null;
      throw error;
    }
    if (!result || typeof (result as Promise<unknown>).then !== 'function') return settle(result);
    return (result as Promise<unknown>).then(settle, (error) => {
      landing.current = null;
      throw error;
    });
  };

  /** Moves the selection, else the cursor tile, one column left or right (Shift+Left/Right). */
  const moveBy = useCallback((delta: -1 | 1): boolean => {
    const current = boardRef.current;
    if (!current?.onMove) return false;
    const sel = selectionRef.current;
    const { ids: list, cursor: currentCursor, openId: opened } = latest.current;
    let targets: T[] = [];
    if (sel.count > 0) {
      targets = list.filter((id) => sel.isSelected(id)).map((id) => getItem(id)).filter((item): item is T => item !== undefined);
    }
    if (!targets.length) {
      const id = currentCursor ?? opened;
      const item = id !== null ? getItem(id) : undefined;
      if (item !== undefined) targets = [item];
    }
    if (!targets.length) return false;
    const lead = targets.find((item) => getId(item) === currentCursor) ?? targets[0]!;
    const to = neighbourColumn(current.columns, current.getColumn(lead), delta);
    if (to === null) return true;
    const column = current.columns.find((entry) => entry.id === to)!;
    // The selection stays as it was, so Shift+Right again moves it on.
    void controllerRef.current.run('move', targets, { value: to, label: column.label })
      .finally(() => { runStarts.current.delete('move'); });
    return true;
  }, [boardRef, controllerRef, getId, getItem, latest, selectionRef]);
  const boardDefs = useMemo<ShortcutDef[]>(() => {
    if (!boardMove || centerOpen || fullOpen) return [];
    const live = () => {
      const scroll = scrollRef.current;
      return listVisible() && !!scroll && isVisibleComposed(scroll) && !scroll.closest('[inert]');
    };
    return [
      { id: 'list.board.moveLeft', keys: ['shift+arrowleft'], scope: 'collection', label: BOARD_WORDS.moveLeft,
        repeat: true, when: live, run: () => moveBy(-1) },
      { id: 'list.board.moveRight', keys: ['shift+arrowright'], scope: 'collection', label: BOARD_WORDS.moveRight,
        repeat: true, when: live, run: () => moveBy(1) },
    ];
  }, [boardMove, centerOpen, fullOpen, listVisible, moveBy]);
  useShortcuts(boardDefs);

  // The moved tile keeps the cursor: once the page shows it in its new column, focus (if it was in the list) and the
  // scroll follow it there.
  useIsoLayoutEffect(() => {
    const target = landing.current;
    if (!target || !boardOn) return;
    const item = byId.get(target.id);
    if (!item) { landing.current = null; return; }
    if (board!.getColumn(item) !== target.column) return;
    landing.current = null;
    setCursor(target.id);
    const rowEl = findRow(scrollRef.current, target.id);
    if (!rowEl) return;
    const { active, body } = focusOf(rootRef.current);
    if (target.focus && (!active || active === body || containsComposed(listRef.current, active))) {
      rowEl.focus({ preventScroll: true });
    }
    rowEl.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [items, columnKey]);

  // Drag and drop between columns: the line shows where the tiles land.
  const [drop, setDrop] = useState<{ column: string; before: string | null; index: number } | null>(null);
  const dragIds = useRef<string[]>([]);
  const dropAt = useCallback((columnId: string, event: ReactDragEvent<HTMLElement>) => {
    const lane = laneIdsRef.current[boardRef.current?.columns.findIndex((column) => column.id === columnId) ?? -1] ?? [];
    const container = event.currentTarget;
    const tiles = lane.filter((id) => !dragIds.current.includes(id)).flatMap((id) => {
      const el = findRow(container, id);
      if (!el) return [];
      const rect = el.getBoundingClientRect();
      return [{ id, top: rect.top, height: rect.height }];
    });
    return { column: columnId, ...dropIndex(tiles, event.clientY) };
  }, [boardRef, laneIdsRef]);
  const isListDrag = (event: ReactDragEvent<HTMLElement>) => Array.from(event.dataTransfer?.types ?? []).includes(LIST_DRAG_TYPE);
  const onColumnDragOver = (columnId: string) => (event: ReactDragEvent<HTMLElement>) => {
    if (!boardMove || !isListDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const next = dropAt(columnId, event);
    setDrop((previous) => (previous && previous.column === next.column && previous.before === next.before
      && previous.index === next.index ? previous : next));
  };
  const onColumnDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    const related = event.relatedTarget as Node | null;
    if (related && event.currentTarget.contains(related)) return;
    setDrop(null);
  };
  const onColumnDrop = (columnId: string) => (event: ReactDragEvent<HTMLElement>) => {
    if (!boardMove || !isListDrag(event)) return;
    event.preventDefault();
    const place = dropAt(columnId, event);
    setDrop(null);
    let dropped: string[] = [];
    try {
      const parsed: unknown = JSON.parse(event.dataTransfer.getData(LIST_DRAG_TYPE) || '[]');
      if (Array.isArray(parsed)) dropped = parsed.filter((id): id is string => typeof id === 'string');
    } catch { /* another list's data: fall back to this list's own drag */ }
    if (!dropped.length) dropped = dragIds.current;
    dragIds.current = [];
    const targets = dropped.map((id) => getItem(id)).filter((item): item is T => item !== undefined);
    const column = boardRef.current?.columns.find((entry) => entry.id === columnId);
    const action = controllerRef.current.actions.find((entry) => entry.id === 'move');
    if (!targets.length || !column || !action) return;
    pendingIndex.current = place.index;
    void choose(action, targets, { value: columnId, label: column.label });
    // A busy move never read it.
    pendingIndex.current = undefined;
  };
  const onTileDragEnd = () => {
    dragIds.current = [];
    setDrop(null);
  };

  const visible = () => {
    const root = rootRef.current;
    return !!root && root.isConnected && (typeof window === 'undefined' || window.getComputedStyle(root).display !== 'none');
  };
  useEscapeLayer(`${listId}.detail`, () => {
    if (!latest.current.openId || !visible()) return false;
    close();
    return true;
  }, { priority: ESCAPE_PRIORITY.detail, enabled: readerOpen });
  useEscapeLayer(`${listId}.selection`, () => {
    if (latest.current.openId && readerOpen) return false;
    if (selection.count === 0 || !visible()) return false;
    selection.clear();
    return true;
  }, { priority: ESCAPE_PRIORITY.selection, enabled: selection.count > 0 });

  // ---- center: focus the dialog, keep the list inert, give focus back to the cursor row ----
  const wasCenter = useRef(false);
  useIsoLayoutEffect(() => {
    const list = listRef.current;
    if (list) {
      if (centerOpen) list.setAttribute('inert', '');
      else list.removeAttribute('inert');
    }
    if (centerOpen && !wasCenter.current) readerRef.current?.focus({ preventScroll: true });
    if (!centerOpen && wasCenter.current) {
      const id = latest.current.cursor;
      if (id !== null) findRow(scrollRef.current, id)?.focus({ preventScroll: true });
    }
    wasCenter.current = centerOpen;
  }, [centerOpen]);

  // ---- rows ----
  /**
   * An item's actions in a More menu: on its row (`more`), and in the reader bar (`ReaderCtx.actionsMenu`). A row's
   * menu starts with Open (Enter). Then the E action, the status actions, the others in list order, and the danger
   * ones after a line (deck menu rank). In the reader bar the action keys work while the menu is closed (menu
   * accelerators), so they act on the open item where the list's own keys rest (full page, one pane, the center
   * dialog); a row's menu leaves its keys to the list. `extra` adds reader buttons that did not fit the bar.
   */
  const itemMenu = useCallback((item: T, where: 'row' | 'reader', extra: readonly ReaderAction[] = [],
    listActions = true): ReactNode => {
    const list = listActions ? rankActions(controller.available([item])) : [];
    const canOpen = where === 'row' && Boolean(latest.current.reader || latest.current.onOpen);
    if (!list.length && !extra.length && !canOpen) return null;
    const id = getId(item);
    const firstDanger = list.findIndex((action) => action.tone === 'danger');
    return (
      <Menu align="end" label={LIST_READER_WORDS.rowActions} accelerators={where === 'reader'}
        trigger={(
          <button type="button" className={where === 'row' ? 'nui-row-more' : 'nui-om-btn'} aria-label={t(SHELL_WORDS.more)}
            data-part={where === 'reader' ? 'more' : undefined}>
            <Icon name="dots-three" />
          </button>
        )}>
        {canOpen && (
          <Menu.Item icon="arrow-square-out" keys="enter" onSelect={() => { open(id); }}>
            {t(LIST_READER_WORDS.open)}
          </Menu.Item>
        )}
        {extra.map((action) => (
          <Menu.Item key={`reader:${action.id}`} icon={action.icon} keys={action.key} disabled={action.disabled}
            onSelect={() => { if (!action.disabled) void Promise.resolve(action.run()).catch(() => {}); }}>
            {t(action.label)}
          </Menu.Item>
        ))}
        {list.map((action, index) => {
          const line = index === firstDanger && index > 0 ? <Menu.Separator key={`sep:${action.id}`} /> : null;
          const options = action.options?.([item]);
          if (options) {
            const value = action.value?.([item]);
            return [line, (
              <Menu.Sub key={action.id} icon={action.icon as ReactNode} disabled={controller.busy.has(action.id)}
                menuLabel={action.label}
                label={action.key ? (
                  <span className="nui-lr-sub-label">
                    <span>{t(action.label)}</span>
                    <span className="nui-menu-keys"><Keycap keys={keyList(action.key)} /></span>
                  </span>
                ) : t(action.label)}>
                {options.map((option) => (
                  <Menu.Item key={option.value} icon={option.icon as ReactNode}
                    checked={action.value ? value === option.value : undefined}
                    onSelect={() => { void choose(action, [item], option); }}>
                    {t(option.label)}
                  </Menu.Item>
                ))}
              </Menu.Sub>
            )];
          }
          return [line, (
            <Menu.Item key={action.id} icon={action.icon as ReactNode} tone={action.tone}
              disabled={controller.busy.has(action.id)}
              keys={action.key ? keyList(action.key) : undefined}
              onSelect={() => {
                void controller.run(action, [item]).then((outcome) => {
                  if (outcome.status !== 'busy') onRan(action, [item], outcome);
                });
              }}>
              {t(action.label)}
            </Menu.Item>
          )];
        })}
      </Menu>
    );
  }, [choose, controller, getId, latest, onRan, open, t]);
  // A pending or disabled row, or one with nothing to offer, keeps an empty More slot, so its trail lines up.
  const rowMore = useCallback((id: string) => {
    const item = getItem(id);
    const slot = <span className="nui-row-more" data-slot="" aria-hidden="true" />;
    return item === undefined ? slot : itemMenu(item, 'row') ?? slot;
  }, [getItem, itemMenu]);

  const anySelected = selection.count > 0;
  const stateOf = useCallback((id: string): RowState => ({
    cursor: cursor === id,
    open: readerOpen && openId === id,
    selected: canSelect && selection.isSelected(id),
    anySelected: canSelect && anySelected,
    index: ids.indexOf(id),
  }), [anySelected, canSelect, cursor, ids, openId, readerOpen, selection]);

  const source = useMemo<RowStateSource>(() => ({
    stateOf,
    toggle: canSelect ? selection.toggle : null,
    more: controller.actions.length ? rowMore : null,
  }), [canSelect, controller.actions.length, rowMore, selection.toggle, stateOf]);

  // A board that moves tiles drags them unless `draggable` says otherwise.
  const dragOn = draggable ?? boardMove;
  const canDrag = (item: T, id: string) => !!dragOn && !blockedIds.has(id)
    && (typeof dragOn === 'function' ? dragOn(item) : true);
  const dragStart = (id: string, event: ReactDragEvent<HTMLElement>) => {
    const sel = selectionRef.current;
    const carried = canSelect && sel.isSelected(id)
      ? ids.filter((entry) => sel.isSelected(entry) && !blockedIds.has(entry)) : [id];
    dragIds.current = carried;
    const dragged = carried.map((entry) => byId.get(entry)).filter((entry): entry is T => entry !== undefined);
    const data = event.dataTransfer;
    if (data) {
      try {
        data.setData(LIST_DRAG_TYPE, JSON.stringify(carried));
        data.setData('text/plain', carried.join('\n'));
        data.effectAllowed = 'copyMove';
      } catch {
        // Some hosts lock the data store; the callback still gets the items.
      }
    }
    onDragStart?.(dragged, event);
  };

  // Only a list whose open id lives in a URL has a page per item unless the caller names it.
  const urlOpens = controlledOpen === undefined && (openInUrl || runtime?.resource?.kind === 'space')
    && Boolean(reader || onOpen);
  const hrefOf = (item: T, id: string) => (itemHref ? itemHref(item) : urlOpens ? urlWithParam(openParam, id) : null);

  const renderRow = (item: T, id: string) => {
    const props = getRowProps(id);
    const pending = !!isPending?.(item);
    const disabled = disabledIds.has(id);
    const href = disabled ? null : hrefOf(item, id);
    const own = {
      ...props,
      ...(href ? { [ITEM_HREF_ATTRIBUTE]: href } : {}),
      ...(pending ? { 'data-pending': '', 'aria-busy': true } : {}),
      ...(disabled ? { 'data-disabled': '', 'aria-disabled': true } : {}),
      ...(canDrag(item, id) ? {
        draggable: true, onDragStart: (event: ReactDragEvent<HTMLElement>) => dragStart(id, event),
        ...(boardOn ? { onDragEnd: onTileDragEnd } : {}),
      } : {}),
      ...(boardOn && drop?.before === id ? { 'data-drop-before': '' } : {}),
    };
    // A blocked row is still a place to drop; it does not move itself.
    const movable = !blockedIds.has(id) && (!reorder?.canReorder || reorder.canReorder(item));
    const rowProps = reorder ? chainReorderProps(own, reorderer.getItemProps(id, { movable })) : own;
    const drawn = (layout === 'tiles' || boardOn) && renderTile ? <TileContent parts={renderTile(item)} />
      : row(item, stateOf(id));
    const content = <RowIdContext.Provider value={id}>{drawn}</RowIdContext.Provider>;
    if (layout === 'table') return <tr key={id} className="nui-row" {...rowProps}>{content}</tr>;
    if (layout === 'tiles' || boardOn) {
      return (
        <div key={id} className="nui-tile" data-variant={tileVariant === 'manager' ? 'manager' : undefined}
          {...rowProps}>
          {content}
        </div>
      );
    }
    return <div key={id} className="nui-row" {...rowProps}>{content}</div>;
  };

  const groupHead = (group: ListGroup, count: number) => {
    const folded = collapsedSet.has(group.id);
    const inner = (
      <>
        {collapsible && <Icon name={folded ? 'caret-right' : 'caret-down'} className="nui-group-caret" />}
        <span className="nui-group-label">{t(group.label)}</span>
        {groupCounts && <span className="nui-group-count">{count}</span>}
      </>
    );
    if (!collapsible) return inner;
    return (
      <button type="button" className="nui-group-toggle" aria-expanded={!folded}
        aria-label={labelled(t(folded ? LIST_READER_WORDS.expandGroup : LIST_READER_WORDS.collapseGroup), t(group.label))}
        onClick={() => toggleGroup(group.id)}>
        {inner}
      </button>
    );
  };

  let body: ReactNode;
  if (boardOn) {
    // BRD3: one column per stage, each scrolling on its own; a tone puts a dot before the label, never an edge.
    body = lanes.map(({ column, entries }) => {
      const tone = column.tone && column.tone !== 'default' ? column.tone : undefined;
      const dropHere = drop?.column === column.id;
      return (
        <section key={column.id} className="nui-board-col" role="group" aria-label={t(column.label)}
          data-column={column.id} data-drop={flag(dropHere)}>
          <div className="nui-group-head nui-board-head" role="presentation">
            {tone && <span className="nui-board-dot" data-tone={tone} aria-hidden="true" />}
            <span className="nui-group-label">{t(column.label)}</span>
            {groupCounts && <span className="nui-group-count">{entries.length}</span>}
          </div>
          <div className="nui-board-body" role="presentation" data-drop={dropHere && drop!.before === null ? 'end' : undefined}
            onDragOver={onColumnDragOver(column.id)} onDragLeave={onColumnDragLeave} onDrop={onColumnDrop(column.id)}>
            {entries.length
              ? entries.map(({ item, id }) => renderRow(item, id))
              : <div className="nui-board-empty">{t(board!.emptyColumn ?? BOARD_WORDS.emptyColumn)}</div>}
          </div>
        </section>
      );
    });
  } else if (layout === 'table') {
    body = (
      <table className="nui-table" role="presentation">
        {columns && <thead role="presentation"><tr role="presentation">{columns}</tr></thead>}
        <tbody role="presentation">
          {groups.flatMap(({ group, entries }) => [
            ...(group ? [<tr key={`g:${group.id}`} role="presentation"><td className="nui-group-head" colSpan={999}>{groupHead(group, entries.length)}</td></tr>] : []),
            ...(group && collapsedSet.has(group.id) ? [] : entries.map(({ item, id }) => renderRow(item, id))),
          ])}
        </tbody>
      </table>
    );
  } else {
    body = groups.map(({ group, entries }, index) => {
      const folded = !!group && collapsedSet.has(group.id);
      const rows = folded ? null : entries.map(({ item, id }) => renderRow(item, id));
      return (
        <div key={group ? `g:${group.id}` : `n:${index}`} role="presentation" data-collapsed={flag(folded)}>
          {group && <div className="nui-group-head" role="presentation">{groupHead(group, entries.length)}</div>}
          {rows && (layout === 'tiles' ? <div className="nui-tiles" role="presentation">{rows}</div> : rows)}
        </div>
      );
    });
  }

  // ---- load more: a button at the end, pressed for you as it scrolls into view ----
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!hasMore || !onLoadMore || !sentinel || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { root: scrollRef.current, rootMargin: '0px 0px 240px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, loadMore, items.length]);

  const barShown = bar.visible;
  // Under the list while it shows; above the reader while the open item covers the list (else it would be hidden).
  const toastNode = (
    <ActionToast toast={controller.toast} onUndo={() => { void controller.undo(); }} onDismiss={controller.dismiss} />
  );
  const showSkeleton = loading && items.length === 0;

  // ---- toolbar: one line (title or tabs, then "+" and the view menu) ----
  const titleNode = title ? (
    <h2 className="nui-lr-title">
      <span className="nui-lr-title-text">{t(title.text)}</span>
      {/* A title that names a count keeps its slot while the count loads, so the tabs and pills beside it do not move. */}
      {title.count !== undefined ? <span className="nui-lr-title-count">{title.count}</span>
        : 'count' in title ? <span className="nui-lr-title-count" data-reserved="" aria-hidden="true" /> : null}
    </h2>
  ) : null;
  const tools = toolbarActions || create || viewMenu ? (
    <span className="nui-lr-tools">
      {toolbarActions}
      {create && <CreateButton create={create} />}
      {viewMenu && <ViewMenu menu={viewMenu} />}
    </span>
  ) : null;
  let toolbarNode: ReactNode = null;
  if (tabs) toolbarNode = <TabRow {...tabs} lead={tabs.lead ?? titleNode} end={tools} />;
  else if (titleNode || tools) {
    toolbarNode = (
      <div className="nui-lr-toolbar">
        {titleNode}
        <span className="nui-lr-toolbar-spacer" />
        {tools}
      </div>
    );
  }

  const listNode = (
    <div ref={listRef} className="nui-lr-list" data-footer={footer ? '' : undefined}>
      {toolbarNode}
      {infoLine !== undefined && infoLine !== null && <div className="nui-lr-info">{infoLine}</div>}
      {showSkeleton ? (
        <ListSkeleton grouped={Boolean(groupBy)} />
      ) : items.length === 0 && !boardOn ? (
        <div className="nui-lr-empty">{empty ?? <EmptyState />}</div>
      ) : (
        <div ref={scrollRef} className={cx('nui-lr-scroll', boardOn && 'nui-board')} role="listbox" aria-label={t(label ?? LIST_READER_WORDS.list)}
          aria-multiselectable={canSelect || undefined} aria-busy={loading || loadingMore || undefined}
          data-notis-engine-list="" data-marquee={flag(marquee.rect !== null)}
          onMouseDown={marquee.onMouseDown} onClickCapture={marquee.onClickCapture}>
          <RowStateContext.Provider value={source}>{body}</RowStateContext.Provider>
          {hasMore && (
            <div className="nui-lr-more" role="presentation">
              <div ref={sentinelRef} className="nui-lr-sentinel" aria-hidden="true" />
              <Button variant="ghost" size="sm" disabled={loadingMore || !onLoadMore} onClick={loadMore}
                aria-busy={loadingMore || undefined}>
                {t(loadingMore ? LIST_READER_WORDS.loading : LIST_READER_WORDS.loadMore)}
              </Button>
            </div>
          )}
        </div>
      )}
      {marquee.rect && <MultiSelectDragOverlay rect={marquee.rect} className="nui-marquee" />}
      {footer ? <div className="nui-lr-footer">{footer}</div> : null}
      {barShown && <SelectionBar {...bar.barProps} />}
      {mode === 'side' && <PaneProbe onChange={setPaneLayout} />}
      {!listCovered && toastNode}
    </div>
  );

  const openIndex = openId !== null ? navIds.indexOf(openId) : -1;
  /** `ReaderCtx.run` for the item the reader shows (see there). */
  const runOn = (item: T) => (ref: ResolvedAction<T> | string, option?: ActionOption): Promise<ActionOutcome<T>> => {
    const action = typeof ref === 'string' ? controller.actions.find((candidate) => candidate.id === ref) : ref;
    if (!action) return Promise.resolve(cancelledOutcome<T>());
    if (action.options && option === undefined) {
      if (controller.isBusy(action.id)) return Promise.resolve({ status: 'busy', done: [], failed: [] });
      if (action.appliesTo && !action.appliesTo(item)) return Promise.resolve(cancelledOutcome<T>());
      return new Promise((settle) => {
        // At the reader bar button that has focus (it takes focus back on close), else at the bar's actions.
        const pane = readerRef.current;
        const slot = pane?.querySelector<HTMLElement>('[data-part="actions"]') ?? null;
        const { active } = focusOf(rootRef.current);
        const anchor = slot && active && active !== slot && containsComposed(slot, active) ? active as HTMLElement : slot;
        openPicker(action, [item], anchor ?? pane, settle);
      });
    }
    return controller.run(action, [item], option).then((outcome) => {
      if (outcome.status !== 'busy') onRan(action, [item], outcome);
      return outcome;
    });
  };
  const ctx: ReaderCtx<T> = {
    close,
    next: () => { step(1); },
    prev: () => { step(-1); },
    hasNext: openIndex > -1 && (openIndex < navIds.length - 1 || hasMore || (wraps && navIds.length > 1)),
    hasPrev: openIndex > -1 && (openIndex > 0 || (wraps && navIds.length > 1)),
    mode,
    setMode,
    section: activeSection?.name ?? null,
    notify,
    actions: openItem !== null ? controller.available([openItem]) : [],
    busy: controller.busy,
    run: openItem !== null ? runOn(openItem) : () => Promise.resolve(cancelledOutcome<T>()),
    actionsMenu: openItem !== null && !isBlocked(openId!) ? itemMenu(openItem, 'reader') : null,
  };

  let readerNode: ReactNode = null;
  if (reader && openItem !== null) {
    // The bar shows the first few buttons; the rest join the More menu, so the bar never runs past its width.
    // A pending open item takes no action: its buttons show disabled until the save ends.
    const blockedOpen = isBlocked(openId!);
    const barActions = (readerActions?.(openItem, ctx) ?? [])
      .map((action) => (blockedOpen && !action.disabled ? { ...action, disabled: true } : action));
    readerNode = (
      <ReaderPane paneRef={readerRef} ctx={ctx} allowed={allowed} itemId={openId} sectionSeq={activeSection?.seq ?? 0}
        label={readerLabel?.(openItem)} actions={barActions.slice(0, READER_ACTIONS_MAX)} keysYield={selectionKeys}
        keysHidden={anySelected && !listCovered}
        more={itemMenu(openItem, 'reader', barActions.slice(READER_ACTIONS_MAX), !isBlocked(openId!))}
        center={centerOpen} full={fullOpen}>
        {reader(openItem, ctx)}
      </ReaderPane>
    );
  } else if (missing) {
    readerNode = (
      <ReaderPane paneRef={readerRef} ctx={ctx} allowed={allowed} itemId={openId} sectionSeq={0} center={centerOpen}
        full={fullOpen}>
        <EmptyState title={LIST_READER_WORDS.notFound} body={LIST_READER_WORDS.notFoundBody} />
      </ReaderPane>
    );
  } else if (autoOpen && besideList && items.length > 0) {
    // autoOpen beside the list with nothing open (it was closed): the reader says how to pick one.
    readerNode = <PickOne />;
  }

  const pickerOptions = picker?.action.options?.(picker.items) ?? [];
  const pickerValue = picker?.action.value?.(picker.items);
  const pickerNode = picker ? (
    <Menu anchor={picker.anchor} open align="start" side="bottom" label={picker.action.label}
      onOpenChange={(next) => {
        if (next) return;
        setPicker(null);
        settlePicker(null);
      }}>
      {pickerOptions.map((option) => (
        <Menu.Item key={option.value} icon={option.icon as ReactNode}
          checked={picker.action.value ? pickerValue === option.value : undefined}
          onSelect={() => {
            // Taken before the menu closes, so the run it waits on gets the option's outcome.
            const settle = pickerSettle.current;
            pickerSettle.current = null;
            void choose(picker.action, picker.items, option).then((outcome) => settle?.(outcome));
          }}>
          {t(option.label)}
          {option.hint !== undefined && <span className="nui-menu-hint">{t(option.hint)}</span>}
        </Menu.Item>
      ))}
    </Menu>
  ) : null;

  return (
    <div ref={rootRef} className={cx('nui-lr', className)} data-mode={mode} data-density={density} data-look={look}
      data-reader-open={flag(readerOpen)} data-bar={flag(barShown)} data-has-selection={flag(canSelect && anySelected)}
      data-loading={flag(loading && items.length > 0)}>
      {search && <ListSearch search={search} query={localQuery} setQuery={setLocalQuery} />}
      <div className="nui-lr-body">
        {mode === 'side' ? (
          <Panels list={listNode} reader={readerNode} resizable
            storageKey={storeKey ? `lr:${storeKey}` : undefined} />
        ) : (
          <>
            {listNode}
            {centerOpen && <div className="nui-lr-scrim" onClick={close} aria-hidden="true" />}
            {centerOpen && <div className="nui-lr-center">{readerNode}</div>}
            {fullOpen && readerNode}
          </>
        )}
      </div>
      {listCovered && toastNode}
      {pickerNode}
      {reorder && reorderer.announcer}
    </div>
  );
}

/** What the list's probe reports from inside Panels. */
interface PaneLayout {
  /** The open item covers the list (one pane). */
  covers: boolean;
  /** The list and the reader sit side by side. */
  split: boolean;
}

const NO_PANE: PaneLayout = Object.freeze({ covers: false, split: false });

/** Inside Panels: whether the panes sit side by side (once the mode is settled, so autoOpen waits for the measure), and whether the open item covers the list (one pane). */
function PaneProbe({ onChange }: { onChange(layout: PaneLayout): void }) {
  const panels = usePanels();
  const covers = panels.mode === 'stacked' && panels.readerOpen;
  const split = panels.mode === 'split' && panels.settled;
  useIsoLayoutEffect(() => {
    onChange(covers === NO_PANE.covers && split === NO_PANE.split ? NO_PANE : { covers, split });
  }, [covers, split, onChange]);
  return null;
}

// ---- tiles ----

/** One tile drawn from its parts (`renderTile`): the mark beside the head, body, bottom line, and the row's More menu. */
function TileContent({ parts }: { parts: TileParts }) {
  const bottom = parts.figure !== undefined || parts.trailing !== undefined;
  return (
    <>
      <span className="nui-tile-top">
        {parts.mark !== undefined && <span className="nui-tile-mark">{parts.mark}</span>}
        <span className="nui-tile-head">
          <span className="nui-tile-title">{parts.title}</span>
          {parts.subtitle !== undefined && <span className="nui-tile-subtitle">{parts.subtitle}</span>}
        </span>
      </span>
      {parts.body !== undefined && <span className="nui-tile-body">{parts.body}</span>}
      {bottom && (
        <span className="nui-tile-bottom">
          {parts.figure !== undefined && <span className="nui-tile-figure">{parts.figure}</span>}
          <span className="nui-tile-spacer" />
          {parts.trailing}
        </span>
      )}
      <RowMore />
    </>
  );
}

// ---- toolbar parts ----

/** The toolbar's "+": a 32px ghost button, its label in a tooltip; its key (if any) creates from the list. */
function CreateButton({ create }: { create: NonNullable<ListReaderProps<unknown>['create']> }) {
  const t = useT();
  const latest = useLatest(create);
  const defs = useMemo<ShortcutDef[]>(() => (create.key ? [{
    id: 'list.create', keys: keyList(create.key), scope: 'collection', label: toWords(latest.current.label),
    run: () => { latest.current.onCreate(); },
  }] : []), [create.key, latest]); // eslint-disable-line react-hooks/exhaustive-deps
  useShortcuts(defs);
  return (
    <Tooltip label={create.label} keys={create.key}>
      <button type="button" className="nui-om-btn" data-part="create" aria-label={t(create.label)}
        onClick={() => create.onCreate()}>
        <Icon name="plus" />
      </button>
    </Tooltip>
  );
}

/** The toolbar's "...": the view's Sort, Group and Layout choices, then its description. */
function ViewMenu({ menu }: { menu: ViewMenuProps }) {
  const t = useT();
  const choices = (items: readonly ViewMenuItem[]) => items.map((item) => (
    <Menu.Item key={item.id} icon={item.icon} checked={item.checked} onSelect={() => item.onSelect()}>
      {t(item.label)}
    </Menu.Item>
  ));
  return (
    <Menu align="end" label={LIST_READER_WORDS.viewOptions} accelerators={false}
      trigger={(
        <button type="button" className="nui-om-btn" data-part="view-menu" aria-label={t(LIST_READER_WORDS.viewOptions)}>
          <Icon name="dots-three" />
        </button>
      )}>
      {menu.sort?.length ? (
        <Menu.Sub label={t(LIST_READER_WORDS.sort)} menuLabel={LIST_READER_WORDS.sort}>
          {choices(menu.sort)}
        </Menu.Sub>
      ) : null}
      {menu.group?.length ? (
        <Menu.Sub label={t(LIST_READER_WORDS.group)} menuLabel={LIST_READER_WORDS.group}>
          {choices(menu.group)}
        </Menu.Sub>
      ) : null}
      {menu.layout ? (
        <Menu.Sub label={t(LIST_READER_WORDS.layout)} menuLabel={LIST_READER_WORDS.layout}>
          {menu.layout.options.map((option) => (
            <Menu.Item key={option.value} icon={option.icon} checked={menu.layout!.value === option.value}
              onSelect={() => menu.layout!.onChange(option.value)}>
              {t(option.label)}
            </Menu.Item>
          ))}
        </Menu.Sub>
      ) : null}
      {menu.actions?.length ? (
        <>
          {menu.sort?.length || menu.group?.length || menu.layout ? <Menu.Separator /> : null}
          {menu.actions.map((item) => (
            <Menu.Item key={item.id} icon={item.icon} onSelect={() => item.onSelect()}>{t(item.label)}</Menu.Item>
          ))}
        </>
      ) : null}
      {menu.description !== undefined && <p className="nui-lr-view-note">{t(menu.description)}</p>}
    </Menu>
  );
}

/** Binds the list to the top bar search; mounted only when the list has `search` (the hook always registers). */
function ListSearch<T>({ search, query, setQuery }: {
  search: ListSearchProps<T>; query: string; setQuery(value: string): void;
}) {
  const t = useT();
  useTopBarSearch({
    value: search.onChange ? search.value ?? '' : query,
    onChange: search.onChange ?? setQuery,
    placeholder: search.placeholder !== undefined ? t(search.placeholder) : undefined,
    onSubmit: search.onSubmit,
  });
  return null;
}

// ---- reader pane ----

/** The reader beside the list when `autoOpen` has nothing open: how to pick an item. */
function PickOne() {
  const t = useT();
  const [before, rest = ''] = t(LIST_READER_WORDS.pickKeys).split('{a}');
  const [middle, after = ''] = rest.split('{b}');
  return (
    <div className="nui-lr-pick">
      <p>{t(LIST_READER_WORDS.pickOne)}</p>
      <p className="nui-lr-pick-keys">
        {before}<Keycap keys="j" /><Keycap keys="k" />{middle}<Keycap keys="enter" />{after}
      </p>
    </div>
  );
}

interface ReaderPaneProps {
  paneRef: React.RefObject<HTMLDivElement | null>;
  ctx: ReaderBarCtx;
  /** The open item: the reader body starts at its top for each item. */
  itemId: string | null;
  /** Bumps each time an item opens at a section. */
  sectionSeq: number;
  allowed: OpenMode[];
  /** The bar's label (`readerLabel`). */
  label?: ReactNode;
  /** The buttons the bar shows (at most `READER_ACTIONS_MAX`); their keys run them while the item is open. */
  actions?: readonly ReaderAction[];
  /** The bar's More menu. */
  more?: ReactNode;
  /** True while rows are selected beside the reader: the selection bar's keys answer instead of the action keys. */
  keysYield?: () => boolean;
  /** Rows are selected beside the reader: the buttons hide their keys, which the selection bar answers instead. */
  keysHidden?: boolean;
  center: boolean;
  full: boolean;
  children?: ReactNode;
}

const NO_READER_ACTIONS: readonly ReaderAction[] = Object.freeze([]);

function ReaderPane({ paneRef, ctx, allowed, itemId, sectionSeq, label, actions = NO_READER_ACTIONS, more, keysYield,
  keysHidden = false, center, full, children }: ReaderPaneProps) {
  const t = useT();
  const panels = usePanels();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Busy while its run lasts (a picker it opened included): it stays enabled, so focus stays on it, and a second press
  // does nothing.
  const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set());
  const runningNow = useRef<Set<string>>(new Set());
  // One scrolling body serves every item: each item starts at its top.
  useIsoLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [itemId]);
  // Opened at a section: bring it into view once the reader drew it (next frame for content that renders late).
  useEffect(() => {
    const name = ctx.section;
    const body = bodyRef.current;
    if (!name || !body) return undefined;
    const escaped = name.replace(/["\\]/g, '\\$&');
    const reveal = () => {
      const target = body.querySelector<HTMLElement>(`[data-section="${escaped}"]`);
      target?.scrollIntoView?.({ block: 'start' });
      return !!target;
    };
    if (reveal() || typeof requestAnimationFrame === 'undefined') return undefined;
    const frame = requestAnimationFrame(() => { reveal(); });
    return () => cancelAnimationFrame(frame);
  }, [itemId, sectionSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  const runAction = useCallback((action: ReaderAction) => {
    if (action.disabled || runningNow.current.has(action.id)) return;
    runningNow.current.add(action.id);
    setRunning((now) => new Set(now).add(action.id));
    void Promise.resolve().then(() => action.run()).catch(() => {}).finally(() => {
      runningNow.current.delete(action.id);
      setRunning((now) => {
        const next = new Set(now);
        next.delete(action.id);
        return next;
      });
    });
  }, []);
  const latestActions = useLatest(actions);
  const latestYield = useLatest(keysYield);
  const keySig = actions.map((action) => `${action.id}:${keyList(action.key).join(',')}`).join('|');
  // The shown buttons' keys; folded ones run from the More menu's own keys, so each key works once.
  const actionDefs = useMemo<ShortcutDef[]>(() => latestActions.current.filter((action) => action.key).map((action) => ({
    id: `list.reader.${action.id}`, keys: keyList(action.key), scope: center ? 'modal' : 'detail',
    label: toWords(action.label),
    when: () => !!paneRef.current && isVisibleComposed(paneRef.current) && !latestYield.current?.()
      && !latestActions.current.find((entry) => entry.id === action.id)?.disabled,
    run: () => {
      const current = latestActions.current.find((entry) => entry.id === action.id);
      if (current) runAction(current);
    },
  })), [keySig, center, runAction]); // eslint-disable-line react-hooks/exhaustive-deps
  useShortcuts(actionDefs);

  // Back where the reader covers the list (stacked side, full page); Close where the list stays in view.
  const slide = !center && !full && panels.mode === 'stacked';
  const back = full || slide;
  const k = DEFAULT_KEYMAP;
  const closeButton = (
    <Tooltip label={SHELL_WORDS.close} keys={['escape']}>
      <button type="button" className="nui-om-btn" data-part="close" aria-label={t(SHELL_WORDS.close)}
        onClick={ctx.close}>
        <Icon name="x" />
      </button>
    </Tooltip>
  );
  return (
    <div ref={paneRef} className="nui-lr-reader" tabIndex={-1} data-notis-escape-owned=""
      {...(center ? { role: 'dialog', 'aria-modal': true, 'aria-label': t(SHELL_WORDS.centerPeek) } : {})}>
      <div className="nui-lr-bar">
        {back ? (
          // Icon only where the reader slides over the list (a narrow pane); the full page keeps the word until 560.
          <Tooltip label={SHELL_WORDS.back} keys={['escape']}>
            <button type="button" className="nui-lr-back" data-part="back" data-compact={slide ? '' : undefined}
              aria-label={t(SHELL_WORDS.back)} onClick={ctx.close}>
              <Icon name="arrow-left" />
              <span className="nui-lr-back-label">{t(SHELL_WORDS.back)}</span>
            </button>
          </Tooltip>
        ) : closeButton}
        <OpenAsMenu allowed={allowed} mode={ctx.mode} onChange={ctx.setMode} />
        {/* At an edge Prev and Next stay focusable (aria-disabled), so a press there keeps the focus on the bar. */}
        <Tooltip label={SHELL_WORDS.previous} keys={[...k['list.prev'].keys].slice(0, 1)}>
          <button type="button" className="nui-om-btn" data-part="prev" aria-label={t(SHELL_WORDS.previous)}
            aria-disabled={!ctx.hasPrev || undefined} onClick={() => { if (ctx.hasPrev) ctx.prev(); }}>
            <Icon name="caret-up" />
          </button>
        </Tooltip>
        <Tooltip label={SHELL_WORDS.next} keys={[...k['list.next'].keys].slice(0, 1)}>
          <button type="button" className="nui-om-btn" data-part="next" aria-label={t(SHELL_WORDS.next)}
            aria-disabled={!ctx.hasNext || undefined} onClick={() => { if (ctx.hasNext) ctx.next(); }}>
            <Icon name="caret-down" />
          </button>
        </Tooltip>
        <span className="nui-lr-label" data-part="label">{label}</span>
        <span className="nui-lr-actions" data-part="actions">
          {actions.map((action) => {
            const busy = running.has(action.id);
            const labelled = action.labelled ?? !!action.key;
            if (labelled) {
              // The tooltip carries the name once a narrow reader (under 560px) hides the label beside the icon.
              return (
                <Tooltip key={action.id} label={action.label} keys={keysHidden ? undefined : action.key}>
                  <button type="button" className="nui-lr-act" data-action={action.id}
                    aria-label={t(action.label)} aria-busy={busy || undefined} aria-disabled={action.disabled || undefined}
                    onClick={() => runAction(action)}>
                    <Icon name={action.icon} />
                    <span className="nui-lr-act-label">{t(action.label)}</span>
                    {action.key !== undefined && !keysHidden && <Keycap keys={keyList(action.key)} />}
                  </button>
                </Tooltip>
              );
            }
            return (
              <Tooltip key={action.id} label={action.label} keys={keysHidden ? undefined : action.key}>
                <button type="button" className="nui-om-btn" data-action={action.id} aria-label={t(action.label)}
                  aria-busy={busy || undefined} aria-disabled={action.disabled || undefined} onClick={() => runAction(action)}>
                  <Icon name={action.icon} />
                </button>
              </Tooltip>
            );
          })}
        </span>
        {more}
        {center && allowed.includes('full') && (
          <Tooltip label={LIST_READER_WORDS.openFull}>
            <button type="button" className="nui-om-btn" data-part="expand" aria-label={t(LIST_READER_WORDS.openFull)}
              onClick={() => ctx.setMode('full')}>
              <Icon name="arrows-out" />
            </button>
          </Tooltip>
        )}
        {slide && closeButton}
      </div>
      <div ref={bodyRef} className="nui-lr-reader-body">
        <div className="nui-lr-reader-inner">{children}</div>
      </div>
    </div>
  );
}
