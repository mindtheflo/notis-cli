/**
 * useReorder: drag to reorder, plus Alt and an arrow key, for any ordered list (rows, tiles, a slide rail).
 *
 * - Off unless the list asks for it: rows only get reorder props from `getItemProps`, and `enabled: false` returns none.
 * - Pointer: a row drags with the browser's own drag (so touch scrolling stays the browser's), the row under the
 *   pointer shows where it lands (`data-drop="before" | "after"`) and the dragged row shows `data-dragging`.
 * - Keyboard: Alt and an arrow key move the focused item one place (Up and Down for a vertical list, Left and Right
 *   for a horizontal one, all four for a grid); Alt+Home and Alt+End move it to the start or the end. Focus stays on it.
 * - Every move is said in the polite live region (`announcer`): "Moved to position 3 of 8.".
 * - Optimistic: the new order shows at once. `onReorder` may return a promise; when it rejects, the order goes back
 *   to the list the page passes and `onError` runs (without one, the live region says it could not save). Once a move
 *   settles, the page's own order wins as soon as it changes.
 */

import { createElement, useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { w, type Words } from '../../words';
import { flag, useIsoLayoutEffect, useLatest, useStableId, useT } from '../util';

/** The drag data type a reorder drag carries (the moved id). */
export const REORDER_DRAG_TYPE = 'application/x-notis-reorder';

/** Every word a reorderable list says, in English and French. */
export const REORDER_WORDS = Object.freeze({
  hint: w('Drag to reorder. Alt and an arrow key also move it.',
    'Glisse pour réordonner. Alt et une flèche le déplacent aussi.'),
  moved: w('Moved to position {n} of {total}.', 'Déplacé en position {n} sur {total}.'),
  failed: w('Could not save the new order. Try again.', 'Impossible d’enregistrer le nouvel ordre. Réessaie.'),
}) satisfies Readonly<Record<string, Words>>;

/** One move, as `onReorder` gets it. Indexes count the whole list, before (`from`) and after (`to`) the move. */
export interface ReorderChange<T> {
  item: T;
  id: string;
  from: number;
  to: number;
  /** Every id in the new order. */
  ids: string[];
}

export type ReorderOrientation = 'vertical' | 'horizontal' | 'both';

export interface UseReorderOptions<T> {
  items: readonly T[];
  getId: (item: T) => string;
  /** Save the move. Return a promise to keep the new order until it settles; a rejection puts the old order back. */
  onReorder: (change: ReorderChange<T>) => void | Promise<unknown>;
  /** Only these items move (all by default). Any item is still a place to drop. */
  canReorder?: (item: T) => boolean;
  /** Which arrow keys move an item. Default 'vertical'. */
  orientation?: ReorderOrientation;
  /** Default true. False gives no reorder props, so the list renders as it would without the hook. */
  enabled?: boolean;
  /** Called after a rejected move put the old order back. Without it the live region says it could not save. */
  onError?: (error: unknown) => void;
}

/** The props one item spreads (with its own handlers chained, see `chainReorderProps`). */
export interface ReorderItemProps {
  draggable?: true;
  'aria-describedby'?: string;
  /** Marks a reorderable item (the toolkit fades `[data-reorder][data-dragging]`). */
  'data-reorder'?: '';
  'data-drop'?: 'before' | 'after';
  'data-dragging'?: '';
  ref?: (element: HTMLElement | null) => void;
  onDragStart?: (event: ReactDragEvent<HTMLElement>) => void;
  onDragOver?: (event: ReactDragEvent<HTMLElement>) => void;
  onDragLeave?: (event: ReactDragEvent<HTMLElement>) => void;
  onDrop?: (event: ReactDragEvent<HTMLElement>) => void;
  onDragEnd?: (event: ReactDragEvent<HTMLElement>) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export interface Reorder<T> {
  /** The items in the order to show (the optimistic one while a move saves). */
  items: T[];
  ids: string[];
  /** Props for one item. `movable` overrides `canReorder` for it (false: a drop place only). */
  getItemProps(id: string, options?: { movable?: boolean }): ReorderItemProps;
  /** The hint and the live region; render it once, anywhere inside the page. */
  announcer: ReactNode;
  /** Moves an item to an index of the whole list, as a drop or a key would. */
  move(id: string, to: number): void;
  /** A move is saving. */
  pending: boolean;
}

interface Override { ids: string[]; base: string; seq: number; settled: boolean }

const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** The ids of `order` that still exist, then any new ones in the page's order. */
function mergeOrder(order: readonly string[], natural: readonly string[]): string[] {
  const present = new Set(natural);
  const out = order.filter((id) => present.has(id));
  const kept = new Set(out);
  for (const id of natural) if (!kept.has(id)) out.push(id);
  return out;
}

/** The new index of an item dropped before or after another. */
export function dropIndex(from: number, over: number, side: 'before' | 'after'): number {
  const place = side === 'before' ? over : over + 1;
  return place > from ? place - 1 : place;
}

const KEY_STEPS: Record<ReorderOrientation, Record<string, number>> = {
  vertical: { ArrowUp: -1, ArrowDown: 1 },
  horizontal: { ArrowLeft: -1, ArrowRight: 1 },
  both: { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1 },
};

export function useReorder<T>(options: UseReorderOptions<T>): Reorder<T> {
  const { items: natural, getId, enabled = true, orientation = 'vertical' } = options;
  const t = useT();
  const latest = useLatest(options);
  const hintId = useStableId('nui-reorder-hint');

  const naturalIds = useMemo(() => natural.map(getId), [natural, getId]);
  const naturalKey = naturalIds.join('\u0000');
  const [override, setOverride] = useState<Override | null>(null);

  // The page caught up (same order) or, once the move settled, changed its order: the page's order wins.
  useEffect(() => {
    if (!override) return;
    if (sameOrder(mergeOrder(override.ids, naturalIds), naturalIds)) setOverride(null);
    else if (override.settled && naturalKey !== override.base) setOverride(null);
  }, [naturalIds, naturalKey, override]);

  const ids = useMemo(() => (override ? mergeOrder(override.ids, naturalIds) : naturalIds), [naturalIds, override]);
  const items = useMemo(() => {
    if (!override) return natural.slice();
    const byId = new Map<string, T>();
    natural.forEach((item, index) => byId.set(naturalIds[index]!, item));
    return ids.map((id) => byId.get(id)!).filter((item) => item !== undefined);
  }, [ids, natural, naturalIds, override]);
  const current = useLatest({ ids, items, naturalKey });

  // ---- the live region: a trailing no-break space flips so the same words are said again ----
  const [message, setMessage] = useState('');
  const flip = useRef(false);
  const say = useCallback((text: string) => {
    flip.current = !flip.current;
    setMessage(flip.current ? text : `${text} `);
  }, []);

  const seq = useRef(0);
  const [pendingCount, setPendingCount] = useState(0);
  const move = useCallback((id: string, target: number) => {
    const { ids: order, items: shown, naturalKey: base } = current.current;
    const from = order.indexOf(id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(order.length - 1, Math.round(target)));
    if (to === from) return;
    const next = order.slice();
    next.splice(from, 1);
    next.splice(to, 0, id);
    const item = shown[from]!;
    const mine = ++seq.current;
    setOverride({ ids: next, base, seq: mine, settled: false });
    say(t(REORDER_WORDS.moved).replace('{n}', String(to + 1)).replace('{total}', String(next.length)));

    const settle = () => setOverride((prev) => (prev && prev.seq === mine ? { ...prev, settled: true } : prev));
    const fail = (error: unknown) => {
      setOverride(null);
      const onError = latest.current.onError;
      if (onError) onError(error);
      else say(t(REORDER_WORDS.failed));
    };
    let result: void | Promise<unknown>;
    try {
      result = latest.current.onReorder({ item, id, from, to, ids: next });
    } catch (error) {
      fail(error);
      return;
    }
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      setPendingCount((count) => count + 1);
      (result as Promise<unknown>).then(settle, fail).finally(() => setPendingCount((count) => count - 1));
    } else {
      settle();
    }
  }, [current, latest, say, t]);

  // ---- pointer drag ----
  const dragging = useRef<string | null>(null);
  const [dragState, setDragState] = useState<{ id: string; over: string | null; side: 'before' | 'after' } | null>(null);
  const endDrag = useCallback(() => {
    dragging.current = null;
    setDragState(null);
  }, []);
  /** Where a drop over this item would put the dragged one, or null when it would not move. */
  const target = (overId: string, event: ReactDragEvent<HTMLElement>) => {
    const from = current.current.ids.indexOf(dragging.current ?? '');
    const over = current.current.ids.indexOf(overId);
    if (from < 0 || over < 0) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const horizontal = latest.current.orientation === 'horizontal' || latest.current.orientation === 'both';
    const before = horizontal && rect.width > 0 ? event.clientX < rect.left + rect.width / 2
      : rect.height > 0 ? event.clientY < rect.top + rect.height / 2 : over < from;
    const side: 'before' | 'after' = before ? 'before' : 'after';
    const to = dropIndex(from, over, side);
    return to === from ? null : { side, to };
  };

  // ---- keyboard: focus follows the moved item ----
  const nodes = useRef(new Map<string, HTMLElement>());
  const refs = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const refFor = (id: string) => {
    let ref = refs.current.get(id);
    if (!ref) {
      ref = (element) => { if (element) nodes.current.set(id, element); else nodes.current.delete(id); };
      refs.current.set(id, ref);
    }
    return ref;
  };
  const refocus = useRef<string | null>(null);
  useIsoLayoutEffect(() => {
    const id = refocus.current;
    if (id === null) return;
    refocus.current = null;
    const node = nodes.current.get(id);
    if (node && node.ownerDocument.activeElement !== node) node.focus();
  });

  const movableItem = (id: string) => {
    const index = current.current.ids.indexOf(id);
    const item = current.current.items[index];
    const can = latest.current.canReorder;
    return item !== undefined && (!can || can(item));
  };

  const getItemProps = (id: string, itemOptions?: { movable?: boolean }): ReorderItemProps => {
    if (!enabled) return {};
    const movable = itemOptions?.movable ?? movableItem(id);
    const drop = dragState && dragState.over === id ? dragState.side : undefined;
    const props: ReorderItemProps = {
      ref: refFor(id),
      'data-reorder': '',
      'data-drop': drop,
      onDragOver: (event) => {
        if (dragging.current === null) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        const found = target(id, event);
        const over = found ? id : null;
        const side = found?.side ?? 'before';
        setDragState((prev) => (prev && prev.over === over && prev.side === side ? prev
          : { id: dragging.current!, over, side }));
      },
      onDragLeave: (event) => {
        if (dragging.current === null) return;
        const next = event.relatedTarget as Node | null;
        if (next && event.currentTarget.contains(next)) return;
        setDragState((prev) => (prev && prev.over === id ? { ...prev, over: null } : prev));
      },
      onDrop: (event) => {
        if (dragging.current === null) return;
        event.preventDefault();
        const moved = dragging.current;
        const found = target(id, event);
        endDrag();
        if (found) move(moved, found.to);
      },
    };
    if (!movable) return props;
    return {
      ...props,
      draggable: true,
      'aria-describedby': hintId,
      'data-dragging': flag(dragState?.id === id),
      onDragStart: (event) => {
        if (event.target !== event.currentTarget) return;
        dragging.current = id;
        setDragState({ id, over: null, side: 'before' });
        const data = event.dataTransfer;
        if (data) {
          try {
            data.setData(REORDER_DRAG_TYPE, id);
            if (data.effectAllowed === 'none' || data.effectAllowed === 'uninitialized') data.effectAllowed = 'move';
          } catch {
            // Some hosts lock the data store; the drag still works inside the page.
          }
        }
      },
      onDragEnd: endDrag,
      onKeyDown: (event) => {
        if (event.target !== event.currentTarget || event.defaultPrevented) return;
        if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
        const order = current.current.ids;
        const from = order.indexOf(id);
        if (from < 0) return;
        let to: number | null = null;
        if (event.key === 'Home') to = 0;
        else if (event.key === 'End') to = order.length - 1;
        else {
          const step = KEY_STEPS[latest.current.orientation ?? 'vertical'][event.key];
          if (step !== undefined) to = from + step;
        }
        if (to === null) return;
        event.preventDefault();
        event.stopPropagation();
        if (to < 0 || to >= order.length || to === from) return;
        refocus.current = id;
        move(id, to);
      },
    };
  };

  const announcer = createElement('span', { className: 'nui-reorder-live' },
    createElement('span', { id: hintId, className: 'nui-sr-only' }, enabled ? t(REORDER_WORDS.hint) : ''),
    createElement('span', { className: 'nui-sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': true },
      message));

  return { items, ids, getItemProps, announcer, move, pending: pendingCount > 0 };
}

type Handler<E> = ((event: E) => void) | undefined;

/**
 * Spreads reorder props over an item's own: both handlers run (the item's first), and both refs get the element.
 * `own` holds the item's handlers for the same events (onDragStart, onKeyDown and so on).
 */
export function chainReorderProps<P extends object>(own: P, reorder: ReorderItemProps): P & ReorderItemProps {
  const out = { ...own, ...reorder } as Record<string, unknown>;
  const mine = own as Record<string, unknown>;
  for (const key of ['onDragStart', 'onDragOver', 'onDragLeave', 'onDrop', 'onDragEnd', 'onKeyDown'] as const) {
    const a = mine[key] as Handler<unknown>;
    const b = reorder[key] as Handler<unknown>;
    if (a && b) out[key] = (event: unknown) => { a(event); b(event); };
  }
  const ownRef = mine.ref as ((element: HTMLElement | null) => void) | undefined;
  if (ownRef && reorder.ref) {
    const theirs = reorder.ref;
    out.ref = (element: HTMLElement | null) => { ownRef(element); theirs(element); };
  }
  return out as P & ReorderItemProps;
}
