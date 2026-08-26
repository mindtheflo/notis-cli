'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  collectionActionDefaults,
  type CollectionAction,
  type CollectionActionContext,
  type ResolvedCollectionAction,
} from '../interactions/actions';
import {
  activateShortcutCollection,
  createShortcutCollectionOwner,
  useShortcuts,
  type ShortcutDefinition,
  type ShortcutScope,
} from '../interactions/shortcuts';

export const COLLECTION_ITEM_ATTRIBUTE = 'data-notis-collection-item-id';
const LEGACY_ROW_ATTRIBUTE = 'data-notis-row-id';
const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, [role="button"], [contenteditable]:not([contenteditable="false"])';

export interface SelectionMarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type CollectionInteractionReason =
  | 'activate'
  | 'clear'
  | 'drag'
  | 'items-changed'
  | 'navigate'
  | 'range'
  | 'select-all'
  | 'toggle';

export interface CollectionSelectionChange<T> {
  reason: CollectionInteractionReason;
  selectedIds: ReadonlySet<string>;
  selectedItems: T[];
  anchorId: string | null;
}

export type CollectionNavigationDirection = 'next' | 'previous' | 'up' | 'down' | 'left' | 'right';

export interface CollectionNavigationContext<T> {
  direction: CollectionNavigationDirection;
  currentId: string | null;
  items: T[];
  orderedIds: string[];
}

export interface CollectionKeyboardShortcuts {
  clear: string | false;
  selectAll: string | false;
  toggle: string | false;
  extendNext: string | false;
  extendPrevious: string | false;
  next: string | string[] | false;
  previous: string | string[] | false;
  up: string | false;
  down: string | false;
  left: string | false;
  right: string | false;
  activate: string | false;
}

export interface UseCollectionInteractionsOptions<T> {
  items: T[];
  getId: (item: T) => string;
  selectionMode?: 'multiple' | 'single' | 'none';
  selectedIds?: ReadonlySet<string>;
  defaultSelectedIds?: Iterable<string>;
  onSelectionChange?: (change: CollectionSelectionChange<T>) => void;
  activeId?: string | null;
  defaultActiveId?: string | null;
  onActiveIdChange?: (id: string | null, reason: CollectionInteractionReason) => void;
  anchorId?: string | null;
  defaultAnchorId?: string | null;
  onAnchorIdChange?: (id: string | null, reason: CollectionInteractionReason) => void;
  onActivate?: (item: T, id: string) => void;
  isItemDisabled?: (item: T) => boolean;
  enabled?: boolean;
  bindKeyboardShortcuts?: boolean;
  enableDragSelect?: boolean;
  /** Plain item clicks activate the item and clear checkbox selection by default. */
  clearSelectionOnPlainClick?: boolean;
  dragThreshold?: number;
  shortcuts?: Partial<CollectionKeyboardShortcuts>;
  shortcutScope?: ShortcutScope;
  shortcutPriority?: number;
  resolveNextId?: (context: CollectionNavigationContext<T>) => string | null;
  onActiveItemChange?: (id: string | null) => void;
  actions?: CollectionAction<T>[];
}

export interface CollectionInteractionController<T> {
  selectedIds: ReadonlySet<string>;
  selectedCount: number;
  activeId: string | null;
  anchorId: string | null;
  /** Compatibility aliases used by the original multi-select API. */
  headId: string | null;
  lastClickedId: string | null;
  dragRect: SelectionMarqueeRect | null;
  actions: ResolvedCollectionAction[];

  isSelected: (id: string) => boolean;
  getSelectedItems: () => T[];
  setActive: (id: string | null, reason?: CollectionInteractionReason) => void;
  activate: (id: string) => void;
  toggle: (id: string) => void;
  select: (ids: string[]) => void;
  clear: () => void;
  selectAll: () => void;
  selectRange: (anchorId: string, targetId: string) => void;

  onCheckboxClick: (id: string) => (event: ReactMouseEvent) => void;
  onRowMouseDown: (id: string) => (event: ReactMouseEvent) => void;
  getRowProps: (id: string) => Record<string, string>;
  getItemProps: (id: string) => {
    [COLLECTION_ITEM_ATTRIBUTE]: string;
    [LEGACY_ROW_ATTRIBUTE]: string;
    tabIndex: number;
    'aria-selected': boolean;
    'aria-disabled': boolean;
    'data-notis-active': 'true' | 'false';
    onFocus: () => void;
    onMouseDown: (event: ReactMouseEvent) => void;
    onClick: (event: ReactMouseEvent) => void;
    onKeyDown: (event: ReactKeyboardEvent) => void;
  };
  getCheckboxProps: (id: string) => {
    isSelected: boolean;
    disabled: boolean;
    onClick: (event: ReactMouseEvent) => void;
  };
  getContainerProps: () => {
    ref: (node: HTMLElement | null) => void;
    onMouseDown: (event: ReactMouseEvent) => void;
    onFocusCapture: () => void;
    onClickCapture: (event: ReactMouseEvent) => void;
    style: { userSelect: 'none' };
  };
}

const DEFAULT_SHORTCUTS: CollectionKeyboardShortcuts = {
  clear: 'Escape',
  selectAll: 'Mod+A',
  toggle: 'X',
  extendNext: 'Shift+ArrowDown',
  extendPrevious: 'Shift+ArrowUp',
  next: 'J',
  previous: 'K',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: false,
  right: false,
  activate: 'Enter',
};

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function useCollectionInteractions<T>(
  options: UseCollectionInteractionsOptions<T>,
): CollectionInteractionController<T> {
  const {
    items,
    getId,
    selectionMode = 'multiple',
    selectedIds: controlledSelectedIds,
    defaultSelectedIds,
    onSelectionChange,
    activeId: controlledActiveId,
    defaultActiveId = null,
    onActiveIdChange,
    anchorId: controlledAnchorId,
    defaultAnchorId,
    onAnchorIdChange,
    onActivate,
    isItemDisabled,
    enabled = true,
    bindKeyboardShortcuts = true,
    enableDragSelect = selectionMode === 'multiple',
    clearSelectionOnPlainClick = true,
    dragThreshold = 5,
    shortcuts: shortcutOverrides,
    shortcutScope = 'collection',
    shortcutPriority = 0,
    resolveNextId,
    onActiveItemChange,
    actions: actionDefinitions = [],
  } = options;

  const [uncontrolledSelectedIds, setUncontrolledSelectedIds] = useState<Set<string>>(
    () => new Set(defaultSelectedIds ?? []),
  );
  const selectedIds = controlledSelectedIds ?? uncontrolledSelectedIds;
  const [uncontrolledActiveId, setUncontrolledActiveId] = useState<string | null>(defaultActiveId);
  const activeId = controlledActiveId === undefined ? uncontrolledActiveId : controlledActiveId;
  const [uncontrolledAnchorId, setUncontrolledAnchorId] = useState<string | null>(
    defaultAnchorId === undefined ? defaultActiveId : defaultAnchorId,
  );
  const anchorId = controlledAnchorId === undefined ? uncontrolledAnchorId : controlledAnchorId;
  const [dragRect, setDragRect] = useState<SelectionMarqueeRect | null>(null);

  const itemsRef = useRef(items);
  const getIdRef = useRef(getId);
  const selectedIdsRef = useRef(selectedIds);
  const activeIdRef = useRef(activeId);
  const anchorIdRef = useRef(anchorId);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onActiveIdChangeRef = useRef(onActiveIdChange);
  const onAnchorIdChangeRef = useRef(onAnchorIdChange);
  const onActiveItemChangeRef = useRef(onActiveItemChange);
  const onActivateRef = useRef(onActivate);
  const resolveNextIdRef = useRef(resolveNextId);
  const containerRef = useRef<HTMLElement | null>(null);
  const shortcutCollectionOwnerRef = useRef<string | null>(null);
  if (!shortcutCollectionOwnerRef.current) {
    shortcutCollectionOwnerRef.current = createShortcutCollectionOwner();
  }

  itemsRef.current = items;
  getIdRef.current = getId;
  selectedIdsRef.current = selectedIds;
  activeIdRef.current = activeId;
  anchorIdRef.current = anchorId;
  onSelectionChangeRef.current = onSelectionChange;
  onActiveIdChangeRef.current = onActiveIdChange;
  onAnchorIdChangeRef.current = onAnchorIdChange;
  onActiveItemChangeRef.current = onActiveItemChange;
  onActivateRef.current = onActivate;
  resolveNextIdRef.current = resolveNextId;

  const itemById = useMemo(() => new Map(items.map((item) => [getId(item), item])), [getId, items]);
  const selectableIds = useMemo(
    () => items.filter((item) => !isItemDisabled?.(item)).map((item) => getId(item)),
    [getId, isItemDisabled, items],
  );
  const selectableIdsRef = useRef(selectableIds);
  selectableIdsRef.current = selectableIds;

  const getItemsForIds = useCallback((ids: ReadonlySet<string>) => {
    return itemsRef.current.filter((item) => ids.has(getIdRef.current(item)));
  }, []);

  const commitSelection = useCallback((next: Set<string>, reason: CollectionInteractionReason) => {
    const allowed = new Set(selectableIdsRef.current);
    const normalized = selectionMode === 'none'
      ? new Set<string>()
      : new Set(Array.from(next).filter((id) => allowed.has(id)));
    if (selectionMode === 'single' && normalized.size > 1) {
      const first = normalized.values().next().value as string | undefined;
      normalized.clear();
      if (first) normalized.add(first);
    }
    if (setsEqual(normalized, selectedIdsRef.current)) return;
    selectedIdsRef.current = normalized;
    if (controlledSelectedIds === undefined) setUncontrolledSelectedIds(normalized);
    onSelectionChangeRef.current?.({
      reason,
      selectedIds: normalized,
      selectedItems: getItemsForIds(normalized),
      anchorId: anchorIdRef.current,
    });
  }, [controlledSelectedIds, getItemsForIds, selectionMode]);

  const setActive = useCallback((id: string | null, reason: CollectionInteractionReason = 'activate') => {
    const next = id && selectableIdsRef.current.includes(id) ? id : null;
    if (activeIdRef.current === next) return;
    activeIdRef.current = next;
    if (controlledActiveId === undefined) setUncontrolledActiveId(next);
    onActiveIdChangeRef.current?.(next, reason);
    onActiveItemChangeRef.current?.(next);
  }, [controlledActiveId]);

  const setAnchor = useCallback((id: string | null, reason: CollectionInteractionReason) => {
    if (anchorIdRef.current === id) return;
    anchorIdRef.current = id;
    if (controlledAnchorId === undefined) setUncontrolledAnchorId(id);
    onAnchorIdChangeRef.current?.(id, reason);
  }, [controlledAnchorId]);

  const activate = useCallback((id: string) => {
    const item = itemsRef.current.find((candidate) => getIdRef.current(candidate) === id);
    if (!item || !selectableIdsRef.current.includes(id)) return;
    setActive(id, 'activate');
    setAnchor(id, 'activate');
    onActivateRef.current?.(item, id);
  }, [setActive, setAnchor]);

  const toggle = useCallback((id: string) => {
    if (selectionMode === 'none' || !selectableIdsRef.current.includes(id)) return;
    const next = new Set(selectedIdsRef.current);
    if (next.has(id)) next.delete(id);
    else {
      if (selectionMode === 'single') next.clear();
      next.add(id);
    }
    setAnchor(id, 'toggle');
    commitSelection(next, 'toggle');
  }, [commitSelection, selectionMode, setAnchor]);

  const select = useCallback((ids: string[]) => {
    const next = new Set(ids);
    const last = ids[ids.length - 1] ?? null;
    setAnchor(last, 'toggle');
    commitSelection(next, 'toggle');
  }, [commitSelection, setAnchor]);

  const clear = useCallback(() => {
    setAnchor(null, 'clear');
    commitSelection(new Set(), 'clear');
  }, [commitSelection, setAnchor]);

  const selectAll = useCallback(() => {
    if (selectionMode === 'none') return;
    const ids = selectionMode === 'single' ? selectableIdsRef.current.slice(0, 1) : selectableIdsRef.current;
    const last = ids[ids.length - 1] ?? null;
    setAnchor(last, 'select-all');
    commitSelection(new Set(ids), 'select-all');
  }, [commitSelection, selectionMode, setAnchor]);

  const replaceRange = useCallback((fromId: string, toId: string, reason: CollectionInteractionReason) => {
    const ids = selectableIdsRef.current;
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from === -1 || to === -1) {
      commitSelection(new Set([toId]), reason);
      return;
    }
    commitSelection(new Set(ids.slice(Math.min(from, to), Math.max(from, to) + 1)), reason);
  }, [commitSelection]);

  const selectRange = useCallback((fromId: string, toId: string) => {
    const ids = selectableIdsRef.current;
    if (selectionMode === 'none' || !ids.includes(toId)) return;
    const resolvedFromId = ids.includes(fromId)
      ? fromId
      : activeIdRef.current && ids.includes(activeIdRef.current)
        ? activeIdRef.current
        : toId;
    setAnchor(toId, 'range');
    if (selectionMode === 'single') {
      commitSelection(new Set([toId]), 'range');
      return;
    }
    const from = ids.indexOf(resolvedFromId);
    const to = ids.indexOf(toId);
    if (from === -1 || to === -1) {
      commitSelection(new Set([toId]), 'range');
    } else {
      const next = new Set(selectedIdsRef.current);
      for (const id of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(id);
      commitSelection(next, 'range');
    }
  }, [commitSelection, selectionMode, setAnchor]);

  useEffect(() => {
    const allowed = new Set(selectableIds);
    const pruned = new Set(Array.from(selectedIdsRef.current).filter((id) => allowed.has(id)));
    if (!setsEqual(pruned, selectedIdsRef.current)) commitSelection(pruned, 'items-changed');
    if (activeIdRef.current && !allowed.has(activeIdRef.current)) setActive(null, 'items-changed');
    if (anchorIdRef.current && !allowed.has(anchorIdRef.current)) {
      setAnchor(null, 'items-changed');
    }
  }, [commitSelection, selectableIds, setActive, setAnchor]);

  const moveActive = useCallback((direction: CollectionNavigationDirection, extend = false) => {
    const ids = selectableIdsRef.current;
    if (ids.length === 0) return;
    const current = activeIdRef.current;
    let next = resolveNextIdRef.current?.({
      direction,
      currentId: current,
      items: itemsRef.current,
      orderedIds: ids,
    }) ?? null;
    if (!next) {
      const currentIndex = current ? ids.indexOf(current) : -1;
      const forward = direction === 'next' || direction === 'down' || direction === 'right';
      const nextIndex = currentIndex === -1
        ? forward ? 0 : ids.length - 1
        : Math.min(ids.length - 1, Math.max(0, currentIndex + (forward ? 1 : -1)));
      next = ids[nextIndex] ?? null;
    }
    if (!next || next === current) return;
    const stableAnchor = anchorIdRef.current ?? current ?? next;
    if (extend) {
      if (!anchorIdRef.current) {
        setAnchor(stableAnchor, 'range');
      }
      replaceRange(stableAnchor, next, 'range');
    } else {
      setAnchor(next, 'navigate');
    }
    setActive(next, extend ? 'range' : 'navigate');
    const nextId = next;
    requestAnimationFrame(() => {
      const nodes = containerRef.current?.querySelectorAll<HTMLElement>(`[${COLLECTION_ITEM_ATTRIBUTE}]`);
      const node = nodes ? Array.from(nodes).find(
        (candidate) => candidate.getAttribute(COLLECTION_ITEM_ATTRIBUTE) === nextId,
      ) : null;
      node?.focus({ preventScroll: true });
    });
  }, [replaceRange, setActive, setAnchor]);

  const keyboard = useMemo<CollectionKeyboardShortcuts>(
    () => ({ ...DEFAULT_SHORTCUTS, ...(shortcutOverrides || {}) }),
    [shortcutOverrides],
  );
  const keyDefinitions = useMemo<ShortcutDefinition[]>(() => {
    const definitions: ShortcutDefinition[] = [];
    const add = (
      id: string,
      label: string,
      keys: string | string[] | false,
      onTrigger: () => void,
    ) => {
      if (!keys) return;
      definitions.push({ id, label, keys, onTrigger });
    };
    add('collection.clear', 'Clear selection', keyboard.clear, clear);
    add('collection.select-all', 'Select all visible items', selectionMode === 'none' ? false : keyboard.selectAll, selectAll);
    add('collection.toggle', 'Toggle active item', selectionMode === 'none' ? false : keyboard.toggle, () => {
      const id = activeIdRef.current ?? anchorIdRef.current;
      if (id) toggle(id);
    });
    add('collection.extend-next', 'Extend selection down', selectionMode !== 'multiple' ? false : keyboard.extendNext, () => moveActive('down', true));
    add('collection.extend-previous', 'Extend selection up', selectionMode !== 'multiple' ? false : keyboard.extendPrevious, () => moveActive('up', true));
    add('collection.next', 'Next item', keyboard.next, () => moveActive('next'));
    add('collection.previous', 'Previous item', keyboard.previous, () => moveActive('previous'));
    add('collection.up', 'Move up', keyboard.up, () => moveActive('up'));
    add('collection.down', 'Move down', keyboard.down, () => moveActive('down'));
    add('collection.left', 'Move left', keyboard.left, () => moveActive('left'));
    add('collection.right', 'Move right', keyboard.right, () => moveActive('right'));
    add('collection.activate', 'Open active item', keyboard.activate, () => {
      const id = activeIdRef.current ?? selectableIdsRef.current[0];
      if (id) activate(id);
    });
    return definitions;
  }, [activate, clear, keyboard, moveActive, selectAll, selectionMode, toggle]);
  useShortcuts(keyDefinitions, {
    enabled: enabled && bindKeyboardShortcuts,
    scope: shortcutScope,
    priority: shortcutPriority,
    collectionOwnerId: shortcutCollectionOwnerRef.current,
  });

  const activateCollectionShortcuts = useCallback(() => {
    activateShortcutCollection(shortcutCollectionOwnerRef.current!);
  }, []);

  const dragPendingRef = useRef(false);
  const dragActiveRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragCurrentRef = useRef({ x: 0, y: 0 });
  const clickShouldClearRef = useRef(false);
  const suppressNextClickRef = useRef(false);

  const armSuppressNextClick = useCallback(() => {
    suppressNextClickRef.current = true;
    setTimeout(() => { suppressNextClickRef.current = false; }, 0);
  }, []);

  const computeDragRect = useCallback((): SelectionMarqueeRect => ({
    left: Math.min(dragStartRef.current.x, dragCurrentRef.current.x),
    top: Math.min(dragStartRef.current.y, dragCurrentRef.current.y),
    width: Math.abs(dragCurrentRef.current.x - dragStartRef.current.x),
    height: Math.abs(dragCurrentRef.current.y - dragStartRef.current.y),
  }), []);

  const computeIntersectingIds = useCallback((rect: {
    left: number; top: number; right: number; bottom: number;
  }) => {
    const nodes = containerRef.current?.querySelectorAll<HTMLElement>(`[${COLLECTION_ITEM_ATTRIBUTE}]`);
    if (!nodes) return [];
    const ids: string[] = [];
    nodes.forEach((node) => {
      if (!rectsIntersect(rect, node.getBoundingClientRect())) return;
      const id = node.getAttribute(COLLECTION_ITEM_ATTRIBUTE);
      if (id && selectableIdsRef.current.includes(id)) ids.push(id);
    });
    return ids;
  }, []);

  const handleContainerMouseDown = useCallback((event: ReactMouseEvent) => {
    if (!enabled || event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const itemTarget = target.closest(`[${COLLECTION_ITEM_ATTRIBUTE}]`);
    const interactiveTarget = target.closest(INTERACTIVE_SELECTOR);
    if (interactiveTarget && interactiveTarget !== itemTarget) {
      clickShouldClearRef.current = false;
      return;
    }
    clickShouldClearRef.current = !itemTarget;
    if (itemTarget) return;
    if (!enableDragSelect || selectionMode !== 'multiple') return;
    dragPendingRef.current = true;
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    dragCurrentRef.current = { x: event.clientX, y: event.clientY };
  }, [enableDragSelect, enabled, selectionMode]);

  const handleContainerClickCapture = useCallback((event: ReactMouseEvent) => {
    if (!suppressNextClickRef.current) return;
    suppressNextClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  useEffect(() => {
    if (!enabled || !enableDragSelect || selectionMode !== 'multiple') return;
    const handleMouseMove = (event: MouseEvent) => {
      if (dragPendingRef.current) {
        const dx = event.clientX - dragStartRef.current.x;
        const dy = event.clientY - dragStartRef.current.y;
        if (Math.abs(dx) > dragThreshold || Math.abs(dy) > dragThreshold) {
          dragPendingRef.current = false;
          dragActiveRef.current = true;
          window.getSelection()?.removeAllRanges();
        } else return;
      }
      if (!dragActiveRef.current) return;
      event.preventDefault();
      dragCurrentRef.current = { x: event.clientX, y: event.clientY };
      const rect = computeDragRect();
      setDragRect(rect);
      const ids = computeIntersectingIds({
        left: rect.left,
        top: rect.top,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
      });
      commitSelection(new Set(ids), 'drag');
      const last = ids[ids.length - 1] ?? null;
      setAnchor(last, 'drag');
    };
    const handleMouseUp = () => {
      const wasPending = dragPendingRef.current;
      const wasActive = dragActiveRef.current;
      dragPendingRef.current = false;
      dragActiveRef.current = false;
      if (wasActive) {
        setDragRect(null);
        clickShouldClearRef.current = false;
        armSuppressNextClick();
      } else if (wasPending && clickShouldClearRef.current) {
        clickShouldClearRef.current = false;
        clear();
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [armSuppressNextClick, clear, commitSelection, computeDragRect, computeIntersectingIds, dragThreshold, enableDragSelect, enabled, selectionMode, setAnchor]);

  const onRowMouseDown = useCallback((id: string) => (event: ReactMouseEvent) => {
    if (!enabled || event.button !== 0 || event.shiftKey || !(event.metaKey || event.ctrlKey)) return;
    const target = event.target as HTMLElement | null;
    const interactiveTarget = target?.closest(INTERACTIVE_SELECTOR);
    if (interactiveTarget && interactiveTarget !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    toggle(id);
    armSuppressNextClick();
  }, [armSuppressNextClick, enabled, toggle]);

  const onCheckboxClick = useCallback((id: string) => (event: ReactMouseEvent) => {
    event.stopPropagation();
    if (event.shiftKey && selectionMode === 'multiple') {
      const rangeAnchor = anchorIdRef.current ?? activeIdRef.current ?? id;
      selectRange(rangeAnchor, id);
    } else toggle(id);
  }, [selectRange, selectionMode, toggle]);

  const getRowProps = useCallback((id: string) => ({
    [COLLECTION_ITEM_ATTRIBUTE]: id,
    [LEGACY_ROW_ATTRIBUTE]: id,
  }), []);

  const getItemProps = useCallback((id: string) => ({
    [COLLECTION_ITEM_ATTRIBUTE]: id,
    [LEGACY_ROW_ATTRIBUTE]: id,
    tabIndex: activeIdRef.current === id || (!activeIdRef.current && selectableIdsRef.current[0] === id) ? 0 : -1,
    'aria-selected': selectedIdsRef.current.has(id),
    'aria-disabled': !selectableIdsRef.current.includes(id),
    'data-notis-active': (activeIdRef.current === id ? 'true' : 'false') as 'true' | 'false',
    onFocus: () => {
      activateCollectionShortcuts();
      setActive(id, 'activate');
    },
    onMouseDown: onRowMouseDown(id),
    onClick: (event: ReactMouseEvent) => {
      if (event.defaultPrevented) return;
      if (!selectableIdsRef.current.includes(id)) return;
      const target = event.target as HTMLElement | null;
      const interactiveTarget = target?.closest(INTERACTIVE_SELECTOR);
      if (interactiveTarget && interactiveTarget !== event.currentTarget) return;
      if (event.shiftKey && selectionMode === 'multiple') {
        event.preventDefault();
        const rangeAnchor = anchorIdRef.current ?? activeIdRef.current ?? id;
        selectRange(rangeAnchor, id);
        return;
      }
      if (event.metaKey || event.ctrlKey) return;
      if (clearSelectionOnPlainClick) clear();
      activate(id);
    },
    onKeyDown: (event: ReactKeyboardEvent) => {
      if (event.key !== ' ' || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      if (selectionMode === 'none') activate(id);
      else toggle(id);
    },
  }), [activate, activateCollectionShortcuts, clear, clearSelectionOnPlainClick, onRowMouseDown, selectRange, selectionMode, setActive, toggle]);

  const getCheckboxProps = useCallback((id: string) => ({
    isSelected: selectedIdsRef.current.has(id),
    disabled: !selectableIdsRef.current.includes(id),
    onClick: onCheckboxClick(id),
  }), [onCheckboxClick]);

  const getSelectedItems = useCallback(() => getItemsForIds(selectedIdsRef.current), [getItemsForIds]);
  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const actionContext = useMemo<CollectionActionContext<T>>(() => ({
    selectedIds: Array.from(selectedIds),
    selectedItems: getItemsForIds(selectedIds),
    clearSelection: clear,
  }), [clear, getItemsForIds, selectedIds]);
  const resolvedActions = useMemo<ResolvedCollectionAction[]>(() => actionDefinitions.map((action) => {
    const defaults = collectionActionDefaults(action.intent);
    const disabled = typeof action.disabled === 'function' ? action.disabled(actionContext) : action.disabled;
    const shortcut = action.shortcut === false ? undefined : action.shortcut ?? defaults.shortcut;
    return {
      id: action.id,
      label: action.label ?? defaults.label ?? action.id,
      icon: action.icon,
      shortcut,
      destructive: action.destructive ?? action.intent === 'delete',
      disabled,
      pending: action.pending,
      onRun: () => action.onRun(actionContext),
    };
  }), [actionContext, actionDefinitions]);

  const getContainerProps = useCallback(() => ({
    ref: (node: HTMLElement | null) => { containerRef.current = node; },
    onMouseDown: (event: ReactMouseEvent) => {
      activateCollectionShortcuts();
      handleContainerMouseDown(event);
    },
    onFocusCapture: activateCollectionShortcuts,
    onClickCapture: handleContainerClickCapture,
    style: { userSelect: 'none' as const },
  }), [activateCollectionShortcuts, handleContainerClickCapture, handleContainerMouseDown]);

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    activeId,
    anchorId,
    headId: activeId,
    lastClickedId: anchorId,
    dragRect,
    actions: resolvedActions,
    isSelected,
    getSelectedItems,
    setActive,
    activate,
    toggle,
    select,
    clear,
    selectAll,
    selectRange,
    onCheckboxClick,
    onRowMouseDown,
    getRowProps,
    getItemProps,
    getCheckboxProps,
    getContainerProps,
  };
}
