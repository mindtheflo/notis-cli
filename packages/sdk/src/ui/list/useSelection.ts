/**
 * `useSelection` (toolkit spec 2.4): the multi-select state of one list.
 *
 * The reducer mirrors the Portal Manager (`useCollectionInteractions`): an anchor where a range starts, and a base
 * (the selection outside the range being extended) so Shift+J then Shift+K shrinks the range instead of keeping
 * every row it ever passed. Pure and exported for tests.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

export interface SelectionState {
  selected: ReadonlySet<string>;
  /** Where the next range starts. */
  anchor: string | null;
  /** The selection kept outside the range being extended; null when no range is in progress. */
  base: ReadonlySet<string> | null;
}

export type SelectionAction =
  | { type: 'toggle'; id: string }
  | { type: 'set'; ids: readonly string[] }
  | { type: 'clear' }
  | { type: 'selectAll'; ids: readonly string[] }
  /** A plain click: the clicked row becomes the anchor. */
  | { type: 'activate'; id: string }
  /** The cursor moved without Shift: the next extension starts fresh from it. */
  | { type: 'navigate'; id: string }
  /** Shift+J/K from `cursor` to `next`. */
  | { type: 'extendStep'; ids: readonly string[]; cursor: string | null; next: string }
  /** Shift+click on `id`. */
  | { type: 'range'; ids: readonly string[]; cursor: string | null; id: string }
  /** The list changed: drop ids that left it. */
  | { type: 'prune'; ids: readonly string[] };

export const EMPTY_SELECTION: SelectionState = Object.freeze({ selected: new Set<string>(), anchor: null, base: null });

/** The ids from `a` to `b` inclusive, in list order; just `b` when either is not in the list. */
export function rangeBetween(ids: readonly string[], a: string, b: string): string[] {
  const from = ids.indexOf(a);
  const to = ids.indexOf(b);
  if (from === -1 || to === -1) return [b];
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return ids.slice(lo, hi + 1);
}

function without(set: ReadonlySet<string>, drop: Iterable<string>): Set<string> {
  const next = new Set(set);
  for (const id of drop) next.delete(id);
  return next;
}

function union(a: ReadonlySet<string>, b: Iterable<string>): Set<string> {
  const next = new Set(a);
  for (const id of b) next.add(id);
  return next;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'toggle': {
      const selected = new Set(state.selected);
      if (selected.has(action.id)) selected.delete(action.id);
      else selected.add(action.id);
      return { selected, anchor: action.id, base: null };
    }
    case 'set':
      return { selected: new Set(action.ids), anchor: action.ids[action.ids.length - 1] ?? null, base: null };
    case 'clear':
      if (!state.selected.size && state.anchor === null && state.base === null) return state;
      return { selected: new Set(), anchor: null, base: null };
    case 'selectAll':
      return { selected: new Set(action.ids), anchor: action.ids[action.ids.length - 1] ?? null, base: null };
    case 'activate':
      return { ...state, anchor: action.id, base: null };
    case 'navigate':
      return { ...state, anchor: action.id, base: new Set() };
    case 'extendStep': {
      const stableAnchor = state.anchor ?? action.cursor ?? action.next;
      const base = state.base ?? without(state.selected, [stableAnchor]);
      const selected = union(base, rangeBetween(action.ids, stableAnchor, action.next));
      return { selected, anchor: stableAnchor, base };
    }
    case 'range': {
      const rangeAnchor = state.anchor ?? action.cursor ?? action.id;
      const range = rangeBetween(action.ids, rangeAnchor, action.id);
      const base = state.base ?? without(state.selected, range);
      return { selected: union(base, range), anchor: rangeAnchor, base };
    }
    case 'prune': {
      const keep = new Set(action.ids);
      const selected = new Set([...state.selected].filter((id) => keep.has(id)));
      const base = state.base ? new Set([...state.base].filter((id) => keep.has(id))) : null;
      const anchor = state.anchor !== null && keep.has(state.anchor) ? state.anchor : null;
      if (sameSet(selected, state.selected) && anchor === state.anchor
        && (base === null ? state.base === null : state.base !== null && sameSet(base, state.base))) return state;
      return { selected, anchor, base };
    }
    default:
      return state;
  }
}

export interface UseSelectionOptions {
  ids: readonly string[];
  cursor: string | null;
  /**
   * Controlled selection: the ids selected now. With it the hook keeps only the anchor and the range base and
   * reports every change through `onChange`; leave it out for the hook to own the selection.
   */
  selected?: readonly string[] | ReadonlySet<string>;
  /** Every change of the selection, in list order where the list knows the ids. */
  onChange?: (ids: string[]) => void;
}

export interface Selection {
  selected: ReadonlySet<string>;
  isSelected(id: string): boolean;
  toggle(id: string): void;
  /** Shift+click: select from the anchor (else the cursor) to `id`. */
  extendTo(id: string): void;
  selectAll(): void;
  clear(): void;
  count: number;
  /** Replace the selection. */
  set(ids: readonly string[]): void;
  /** Shift+J/K: grow or shrink the range from the anchor to `next`. */
  extendStep(next: string): void;
  /** A cursor move without Shift (J/K): the next range starts from `id`. */
  navigate(id: string): void;
  /** A plain click on `id`: it becomes the anchor. */
  activate(id: string): void;
  anchor: string | null;
}

export function useSelection({ ids, cursor, selected: controlledSelected, onChange }: UseSelectionOptions): Selection {
  const controlled = controlledSelected !== undefined;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const store = useRef<SelectionState>(EMPTY_SELECTION);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const idsKey = ids.join('\u0000');

  // Controlled: the prop is the truth. A change the owner did not take is dropped at the next render.
  if (controlled) {
    const given = controlledSelected instanceof Set ? controlledSelected as ReadonlySet<string>
      : new Set(controlledSelected as readonly string[]);
    if (!sameSet(given, store.current.selected)) store.current = { ...store.current, selected: given, base: null };
  }

  // Dispatches compose within one tick (the store is a ref), so toggle then extend in one handler both count.
  const dispatch = useCallback((action: SelectionAction) => {
    const before = store.current;
    const next = selectionReducer(before, action);
    if (next === before) return;
    store.current = next;
    if (onChangeRef.current && !sameSet(next.selected, before.selected)) {
      const order = idsRef.current;
      const inList = order.filter((id) => next.selected.has(id));
      const rest = [...next.selected].filter((id) => !inList.includes(id));
      onChangeRef.current([...inList, ...rest]);
    }
    rerender();
  }, []);

  // Ids that leave the list leave the selection.
  useEffect(() => { dispatch({ type: 'prune', ids }); }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), [dispatch]);
  const clear = useCallback(() => dispatch({ type: 'clear' }), [dispatch]);
  const set = useCallback((next: readonly string[]) => dispatch({ type: 'set', ids: next }), [dispatch]);
  const navigate = useCallback((id: string) => dispatch({ type: 'navigate', id }), [dispatch]);
  const activate = useCallback((id: string) => dispatch({ type: 'activate', id }), [dispatch]);
  const selectAll = useCallback(() => dispatch({ type: 'selectAll', ids: idsRef.current }), [dispatch]);
  const extendTo = useCallback((id: string) => dispatch({ type: 'range', ids: idsRef.current, cursor, id }),
    [dispatch, cursor]);
  const extendStep = useCallback((next: string) => dispatch({ type: 'extendStep', ids: idsRef.current, cursor, next }),
    [dispatch, cursor]);

  const { selected, anchor } = store.current;
  return useMemo(() => ({
    selected,
    isSelected: (id: string) => selected.has(id),
    toggle, extendTo, selectAll, clear, set, extendStep, navigate, activate,
    count: selected.size,
    anchor,
  }), [selected, anchor, toggle, extendTo, selectAll, clear, set, extendStep, navigate, activate]);
}
