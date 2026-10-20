/**
 * `useListKeys` (toolkit spec 2.4): J/K, Enter, X, Shift+J/K and Mod+A on a list, plus the row pointer rules,
 * registered with the keyboard engine (no own keydown listener).
 *
 * Behaviour follows the Portal Manager list (`useCollectionInteractions`):
 * - J/K wrap on a fresh press and stop at the edge while held (`stepCursor`, `repeat: true`).
 * - With an item open, J/K open the item under the new cursor.
 * - Only visible rows count (hidden, inert or display none rows are skipped).
 * - The row under the cursor is focused without scrolling, then scrolled to the nearest edge (scroll padding keeps
 *   it clear of the selection bar). Focus stays put only inside another toolkit pane or layer, such as the open
 *   item's reader (`focusStaysOnMove`); from a filter or a tab it goes to the row, so Enter opens the row.
 * - Mod+press toggles on pointer down and swallows the click; Shift+click selects a range; a plain click clears
 *   the selection and opens; Space on the row toggles; press and hold on touch toggles (500 ms, 10 px).
 * - Clicks on a control inside the row (button, link, field) are left to the control.
 *
 * Put `data-notis-engine-list` on the list container (role listbox): the engine then keeps its keys working while
 * a row has focus.
 */

import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import type {
  FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { DEFAULT_KEYMAP, type Scope, type Words } from '../../words';
import { closestComposed, containsComposed, isVisibleComposed } from '../engine/dom';
import { useShortcuts, useToolkitPlatform } from '../engine/hooks';
import { stepCursor } from '../engine/step';
import type { ShortcutDef } from '../engine/types';
import { deepActiveElement, flag, useLatest } from '../util';
import type { Selection } from './useSelection';

/** Clicks on these inside a row belong to them (Manager `INTERACTIVE_SELECTOR`). */
export const ROW_INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, [role="button"], [contenteditable]:not([contenteditable="false"])';

export const ROW_ID_ATTRIBUTE = 'data-nui-item';

/** Press and hold on touch (Manager `useLongPressSelection`). */
const LONG_PRESS_MS = 500;
const LONG_PRESS_TOLERANCE_PX = 10;

export interface UseListKeysOptions {
  ids: readonly string[];
  cursor: string | null;
  setCursor(id: string): void;
  onOpen(id: string): void;
  /** J on the last row goes to the first (fresh press only). Default true. */
  wrap?: boolean;
  /** Default 'collection'. */
  scope?: Scope;
  /** The list element (scroll container or the listbox). Keys are live while it is visible. */
  containerRef: RefObject<HTMLElement | null>;
  /** Multi-select: X, Shift+J/K, Mod+A, Mod/Shift-click, Space and press and hold. */
  selection?: Selection | null;
  /** The open item: J/K then open the next item too. */
  openId?: string | null;
  /** Keys off (a background view). Default true. */
  enabled?: boolean;
  /** Owner override for the defs (default the nearest ShortcutScope). */
  owner?: string;
  /** J on the last row without wrapping (the list has more to load): ListReader loads the next page. */
  onReachEnd?: () => void;
  /**
   * A tile grid: the arrow keys move left, right and by one row up and down (no wrap) while a tile has focus.
   * J/K still step one tile.
   */
  grid?: boolean;
}

export interface RowDomProps {
  role: 'option';
  'aria-selected': boolean;
  tabIndex: number;
  'data-nui-item': string;
  'data-cursor'?: '';
  'data-open'?: '';
  'data-selected'?: '';
  onMouseDown(event: ReactMouseEvent<HTMLElement>): void;
  onClick(event: ReactMouseEvent<HTMLElement>): void;
  onClickCapture(event: ReactMouseEvent<HTMLElement>): void;
  onKeyDown(event: ReactKeyboardEvent<HTMLElement>): void;
  onFocus(event: ReactFocusEvent<HTMLElement>): void;
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(event: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(event: ReactPointerEvent<HTMLElement>): void;
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

/** The row element of `id` inside `container`. */
export function findRow(container: HTMLElement | null, id: string): HTMLElement | null {
  return container?.querySelector<HTMLElement>(`[${ROW_ID_ATTRIBUTE}="${cssEscape(id)}"]`) ?? null;
}

const GRID_WORDS = Object.freeze({
  left: { en: 'Tile to the left', fr: 'Tuile à gauche' },
  right: { en: 'Tile to the right', fr: 'Tuile à droite' },
  up: { en: 'Tile above', fr: 'Tuile au-dessus' },
  down: { en: 'Tile below', fr: 'Tuile en dessous' },
}) satisfies Readonly<Record<string, Words>>;

/** Tiles in the first row of a grid (same top edge as the first tile); 1 when it cannot tell. */
export function gridColumns(container: HTMLElement | null, ids: readonly string[]): number {
  const rows = ids.map((id) => findRow(container, id)).filter((row): row is HTMLElement => !!row);
  if (rows.length < 2) return 1;
  const top = Math.round(rows[0]!.getBoundingClientRect().top);
  let count = 0;
  for (const row of rows) {
    if (Math.round(row.getBoundingClientRect().top) !== top) break;
    count += 1;
  }
  // Everything on one line (or no layout, as in tests without one): treat it as a single row.
  return Math.max(1, count);
}

/**
 * When a key moves the cursor, focus stays where it is only inside another toolkit pane or layer that does not hold
 * the list (they mark `data-notis-escape-owned`): the open item's reader, a Popover, a Menu. Anywhere else (a filter,
 * a tab, the selection bar, a heading button, the page body) it goes to the cursor row, so Enter then opens that row
 * instead of pressing the control the key came from (follow-up E1).
 */
function focusStaysOnMove(active: Element | null, container: HTMLElement | null): boolean {
  if (!active || active === active.ownerDocument.body) return false;
  if (containsComposed(container, active)) return false;
  const holder = closestComposed(active, '[data-notis-escape-owned]');
  return holder !== null && !containsComposed(holder, container);
}

function isInteractiveTarget(event: { target: EventTarget | null; currentTarget: EventTarget | null }): boolean {
  const target = event.target as Element | null;
  if (!target || target === event.currentTarget || typeof target.closest !== 'function') return false;
  const hit = target.closest(ROW_INTERACTIVE_SELECTOR);
  return !!hit && hit !== event.currentTarget && (event.currentTarget as Element | null)?.contains(hit) === true;
}

export function useListKeys(options: UseListKeysOptions): { getRowProps(id: string): RowDomProps; visibleIds(): string[] } {
  const { ids, cursor, containerRef, selection = null, openId = null, wrap = true, scope = 'collection',
    enabled = true, owner } = options;
  const platform = useToolkitPlatform();
  const latest = useLatest(options);
  const pendingFocus = useRef<string | null>(null);
  const suppressClick = useRef(false);
  const longPressed = useRef(false);
  const press = useRef<{ id: string; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const cancelPress = useCallback(() => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  }, []);
  useEffect(() => cancelPress, [cancelPress]);

  /** Rows that are on screen; rows the list did not render yet (virtualized) still count. */
  const visibleIds = useCallback((): string[] => {
    const container = containerRef.current;
    return latest.current.ids.filter((id) => {
      const row = findRow(container, id);
      return !row || isVisibleComposed(row);
    });
  }, [containerRef, latest]);

  const focusRow = useCallback((id: string) => {
    const container = containerRef.current;
    const row = findRow(container, id);
    if (!row) return;
    const active = deepActiveElement(row.getRootNode() as Document | ShadowRoot);
    if (!focusStaysOnMove(active, container)) row.focus({ preventScroll: true });
    row.scrollIntoView?.({ block: 'nearest' });
  }, [containerRef]);

  // Focus after the cursor change rendered (the row now carries data-cursor and tabIndex 0).
  useEffect(() => {
    const id = pendingFocus.current;
    if (id === null || id !== cursor) return;
    pendingFocus.current = null;
    focusRow(id);
  }, [cursor, focusRow]);

  const moveTo = useCallback((next: string | null, open: boolean) => {
    if (next === null) return false;
    const { setCursor, onOpen } = latest.current;
    pendingFocus.current = next;
    setCursor(next);
    if (next === latest.current.cursor) focusRow(next);
    if (open) onOpen(next);
    return true;
  }, [focusRow, latest]);

  const live = () => enabled && latest.current.enabled !== false && isVisibleComposed(containerRef.current)
    && latest.current.ids.length > 0;

  const defs = useMemo<ShortcutDef[]>(() => {
    const k = DEFAULT_KEYMAP;
    const step = (delta: number) => (event: KeyboardEvent) => {
      const { cursor: current, wrap: wrapping = true, openId: open = null, selection: sel = null } = latest.current;
      const visible = visibleIds();
      const next = stepCursor(visible, current, delta, { wrap: wrapping, repeat: event.repeat });
      if (next === null) return false;
      if (next === current && delta > 0 && latest.current.onReachEnd && visible[visible.length - 1] === current) {
        latest.current.onReachEnd();
        return true;
      }
      sel?.navigate(next);
      return moveTo(next, open !== null && next !== open);
    };
    const extend = (delta: number) => (event: KeyboardEvent) => {
      const { cursor: current, selection: sel } = latest.current;
      if (!sel) return false;
      const next = stepCursor(visibleIds(), current, delta, { wrap: false, repeat: event.repeat });
      if (next === null) return false;
      sel.extendStep(next);
      return moveTo(next, false);
    };
    const base = (entry: { id: string; keys: readonly string[]; label: { en: string; fr: string } }): Pick<ShortcutDef,
      'id' | 'keys' | 'scope' | 'label' | 'when' | 'owner'> => ({
      id: entry.id, keys: [...entry.keys], scope, label: entry.label, when: live, ...(owner ? { owner } : {}),
    });
    // In a grid the arrows belong to the grid moves below; J/K keep stepping one tile.
    const gridOn = !!latest.current.grid;
    const noArrows = (def: ReturnType<typeof base>) => (gridOn
      ? { ...def, keys: [def.keys].flat().filter((spec: string) => !/^arrow(up|down)$/i.test(spec)) } : def);
    const list: ShortcutDef[] = [
      { ...noArrows(base(k['list.next'])), repeat: true, run: step(1) },
      { ...noArrows(base(k['list.prev'])), repeat: true, run: step(-1) },
      {
        ...base(k['list.open']),
        run: () => {
          const { cursor: current, onOpen } = latest.current;
          if (current === null || !latest.current.ids.includes(current)) return false;
          onOpen(current);
          return true;
        },
      },
    ];
    if (selection) {
      list.push(
        { ...base(k['list.extendDown']), repeat: true, run: extend(1) },
        { ...base(k['list.extendUp']), repeat: true, run: extend(-1) },
        {
          ...base(k['list.toggleSelect']),
          run: () => {
            const { cursor: current, selection: sel } = latest.current;
            if (!sel || current === null) return false;
            sel.toggle(current);
            return true;
          },
        },
        {
          ...base(k['list.selectAll']),
          run: () => {
            const sel = latest.current.selection;
            if (!sel) return false;
            sel.selectAll();
            return true;
          },
        },
      );
    }
    if (gridOn) {
      const gridStep = (dir: 'left' | 'right' | 'up' | 'down') => () => {
        const { cursor: current, openId: open = null, selection: sel = null } = latest.current;
        const visible = visibleIds();
        const index = current === null ? -1 : visible.indexOf(current);
        if (index === -1) return moveTo(visible[0] ?? null, false);
        const columns = gridColumns(containerRef.current, visible);
        const delta = dir === 'left' ? -1 : dir === 'right' ? 1 : dir === 'up' ? -columns : columns;
        const target = index + delta;
        // No wrap in a grid: the edge holds (the key is still taken, so the page does not scroll).
        if (target < 0 || target >= visible.length) return true;
        const next = visible[target]!;
        sel?.navigate(next);
        return moveTo(next, open !== null && next !== open);
      };
      for (const dir of ['left', 'right', 'up', 'down'] as const) {
        list.push({
          id: `list.grid.${dir}`, keys: [`arrow${dir}`], scope, label: GRID_WORDS[dir], when: live, repeat: true,
          ...(owner ? { owner } : {}), run: gridStep(dir),
        });
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, owner, !!selection, enabled, !!options.grid]);

  useShortcuts(enabled ? defs : [], [enabled]);

  const isMod = (event: { metaKey: boolean; ctrlKey: boolean }) => (platform === 'mac' ? event.metaKey : event.ctrlKey);

  const roving = (cursor !== null && ids.includes(cursor) ? cursor : null)
    ?? (openId !== null && ids.includes(openId) ? openId : null) ?? ids[0] ?? null;

  const getRowProps = (id: string): RowDomProps => {
    const selected = selection?.isSelected(id) ?? false;
    return {
      role: 'option',
      'aria-selected': selected,
      tabIndex: id === roving ? 0 : -1,
      [ROW_ID_ATTRIBUTE]: id,
      'data-cursor': flag(id === cursor),
      'data-open': flag(id === openId),
      'data-selected': flag(selected),
      onMouseDown: (event) => {
        if (event.button !== 0 || !isMod(event) || isInteractiveTarget(event)) return;
        const sel = latest.current.selection;
        if (!sel) return;
        event.preventDefault();
        suppressClick.current = true;
        sel.toggle(id);
        latest.current.setCursor(id);
        event.currentTarget.focus({ preventScroll: true });
      },
      onClickCapture: (event) => {
        if (!longPressed.current) return;
        // The click that ends a press and hold must not open the row (onClick then resets suppressClick).
        longPressed.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
      onClick: (event) => {
        if (suppressClick.current) { suppressClick.current = false; return; }
        if (event.defaultPrevented || isInteractiveTarget(event)) return;
        const { selection: sel, setCursor, onOpen } = latest.current;
        if (event.shiftKey && sel) {
          event.preventDefault();
          sel.extendTo(id);
          setCursor(id);
          return;
        }
        if (isMod(event)) return;
        if (sel) { sel.clear(); sel.activate(id); }
        setCursor(id);
        onOpen(id);
      },
      onKeyDown: (event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== ' ') return;
        const sel = latest.current.selection;
        if (!sel) return;
        event.preventDefault();
        sel.toggle(id);
        latest.current.setCursor(id);
      },
      onFocus: (event) => {
        if (event.target !== event.currentTarget) return;
        if (latest.current.cursor !== id) latest.current.setCursor(id);
      },
      onPointerDown: (event) => {
        if (!latest.current.selection || event.pointerType !== 'touch' || event.button !== 0
          || isInteractiveTarget(event)) return;
        cancelPress();
        press.current = {
          id, x: event.clientX, y: event.clientY,
          timer: setTimeout(() => {
            press.current = null;
            const { selection: sel, setCursor } = latest.current;
            if (!sel) return;
            suppressClick.current = true;
            longPressed.current = true;
            sel.toggle(id);
            setCursor(id);
          }, LONG_PRESS_MS),
        };
      },
      onPointerMove: (event) => {
        const start = press.current;
        if (start && (Math.abs(event.clientX - start.x) > LONG_PRESS_TOLERANCE_PX
          || Math.abs(event.clientY - start.y) > LONG_PRESS_TOLERANCE_PX)) cancelPress();
      },
      onPointerUp: () => cancelPress(),
      onPointerCancel: () => cancelPress(),
    };
  };

  return { getRowProps, visibleIds };
}
