'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

const ROW_ATTR = 'data-notis-row-id';
const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, [role="button"]';

export interface DragRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface UseMultiSelectOptions<T> {
  items: T[];
  getId: (item: T) => string;
  /** When false, suppresses the global Esc / Cmd+A / X / Shift+Arrow listeners. Default true. */
  bindKeyboardShortcuts?: boolean;
  /** When false, disables the rubber-band drag-select rectangle. Default true. */
  enableDragSelect?: boolean;
  /** Distance (px) the cursor must move past mousedown before a drag begins. Default 5. */
  dragThreshold?: number;
  /** Initial head id (the row that Shift+Arrow extends from). */
  initialHeadId?: string | null;
  /** Fires when the head moves via Shift+Arrow so the consumer can scroll the row into view. */
  onHeadChange?: (id: string | null) => void;
}

export interface MultiSelectController<T> {
  selectedIds: ReadonlySet<string>;
  selectedCount: number;
  lastClickedId: string | null;
  headId: string | null;
  /** Viewport-fixed drag rectangle, or null when no drag is active. */
  dragRect: DragRect | null;

  isSelected: (id: string) => boolean;
  getSelectedItems: () => T[];

  toggle: (id: string) => void;
  select: (ids: string[]) => void;
  clear: () => void;
  selectAll: () => void;
  selectRange: (anchorId: string, targetId: string) => void;
  setHead: (id: string | null) => void;

  /** Click handler for a row's hover checkbox. Toggles, with shift-click range from lastClickedId. */
  onCheckboxClick: (id: string) => (event: ReactMouseEvent) => void;
  /** mousedown on a row body — handles Cmd/Ctrl+click toggle without opening detail. */
  onRowMouseDown: (id: string) => (event: ReactMouseEvent) => void;

  /** Spread on each selectable row so drag-select can find them. */
  getRowProps: (id: string) => { [ROW_ATTR]: string };
  /**
   * Spread on each selectable row/card — bundles `getRowProps` (the drag-select
   * attribute) with the Cmd/Ctrl+click `onMouseDown` handler in one spread.
   */
  getItemProps: (id: string) => {
    [ROW_ATTR]: string;
    onMouseDown: (event: ReactMouseEvent) => void;
  };
  /** Spread onto `<MultiSelectCheckbox {...getCheckboxProps(id)} />`. */
  getCheckboxProps: (id: string) => {
    isSelected: boolean;
    onClick: (event: ReactMouseEvent) => void;
  };
  /** Spread on the list container — owns the drag-select mousedown/move/up + click-empty-to-clear. */
  getContainerProps: () => {
    ref: (node: HTMLElement | null) => void;
    onMouseDown: (event: ReactMouseEvent) => void;
    onClickCapture: (event: ReactMouseEvent) => void;
    style: { userSelect: 'none' };
  };
}

function isEditableEvent(event: Event): boolean {
  // Notis apps mount inside a Shadow DOM, so a document-level listener sees
  // `event.target` retargeted to the shadow host rather than the real focused
  // element. `composedPath()[0]` pierces the shadow boundary to the actual
  // target, so typing in an app input doesn't trigger selection shortcuts.
  const target = event.composedPath?.()[0] ?? event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function useMultiSelect<T>(opts: UseMultiSelectOptions<T>): MultiSelectController<T> {
  const {
    items,
    getId,
    bindKeyboardShortcuts = true,
    enableDragSelect = true,
    dragThreshold = 5,
    initialHeadId = null,
    onHeadChange,
  } = opts;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [headId, setHeadIdState] = useState<string | null>(initialHeadId);
  const [dragRect, setDragRect] = useState<DragRect | null>(null);

  // Latest-state refs so document listeners and stable callbacks read fresh
  // values without retriggering the effect.
  const itemsRef = useRef(items);
  const getIdRef = useRef(getId);
  const selectedIdsRef = useRef(selectedIds);
  const lastClickedIdRef = useRef(lastClickedId);
  const headIdRef = useRef(headId);
  const onHeadChangeRef = useRef(onHeadChange);
  const containerRef = useRef<HTMLElement | null>(null);

  itemsRef.current = items;
  getIdRef.current = getId;
  selectedIdsRef.current = selectedIds;
  lastClickedIdRef.current = lastClickedId;
  headIdRef.current = headId;
  onHeadChangeRef.current = onHeadChange;

  const orderedIds = useMemo(() => items.map((item) => getId(item)), [items, getId]);
  const orderedIdsRef = useRef(orderedIds);
  orderedIdsRef.current = orderedIds;

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const getSelectedItems = useCallback(() => {
    const set = selectedIdsRef.current;
    return itemsRef.current.filter((item) => set.has(getIdRef.current(item)));
  }, []);

  const setHead = useCallback((id: string | null) => {
    setHeadIdState((prev) => {
      if (prev === id) return prev;
      onHeadChangeRef.current?.(id);
      return id;
    });
  }, []);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastClickedId(id);
  }, []);

  const select = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
    setLastClickedId(ids.length > 0 ? ids[ids.length - 1] ?? null : null);
  }, []);

  const clear = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const selectAll = useCallback(() => {
    const all = orderedIdsRef.current;
    setSelectedIds(new Set(all));
    setLastClickedId(all.length > 0 ? all[all.length - 1] ?? null : null);
  }, []);

  const selectRange = useCallback((anchorId: string, targetId: string) => {
    const all = orderedIdsRef.current;
    const anchorIdx = all.indexOf(anchorId);
    const targetIdx = all.indexOf(targetId);
    if (anchorIdx === -1 || targetIdx === -1) {
      setSelectedIds(new Set([targetId]));
      setLastClickedId(targetId);
      return;
    }
    const start = Math.min(anchorIdx, targetIdx);
    const end = Math.max(anchorIdx, targetIdx);
    const range = all.slice(start, end + 1);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of range) next.add(id);
      return next;
    });
    setLastClickedId(targetId);
  }, []);

  const onCheckboxClick = useCallback(
    (id: string) =>
      (event: ReactMouseEvent) => {
        event.stopPropagation();
        if (event.shiftKey && lastClickedIdRef.current && lastClickedIdRef.current !== id) {
          selectRange(lastClickedIdRef.current, id);
          return;
        }
        toggle(id);
      },
    [selectRange, toggle],
  );

  const onRowMouseDown = useCallback(
    (id: string) =>
      (event: ReactMouseEvent) => {
        if (event.button !== 0) return;
        if (!(event.metaKey || event.ctrlKey)) return;
        const target = event.target as HTMLElement | null;
        if (target && target.closest(INTERACTIVE_SELECTOR)) return;
        event.preventDefault();
        event.stopPropagation();
        toggle(id);
        // The trailing click on the row should NOT open it.
        armSuppressNextClick();
      },
    [toggle],
  );

  const getRowProps = useCallback(
    (id: string) => ({
      [ROW_ATTR]: id,
    }),
    [],
  );

  const getItemProps = useCallback(
    (id: string) => ({
      [ROW_ATTR]: id,
      onMouseDown: onRowMouseDown(id),
    }),
    [onRowMouseDown],
  );

  const getCheckboxProps = useCallback(
    (id: string) => ({
      isSelected: selectedIdsRef.current.has(id),
      onClick: onCheckboxClick(id),
    }),
    [onCheckboxClick],
  );

  // ---------------------------------------------------------------------------
  // Drag-select
  // ---------------------------------------------------------------------------

  const dragPendingRef = useRef(false);
  const dragActiveRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragCurrentRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Tracks whether the most recent mousedown originated outside any row, which
  // means a bare click should clear the selection.
  const clickShouldClearRef = useRef(false);
  // Set true after a gesture that should NOT trigger the row's onClick: an
  // active drag-select, or a cmd/ctrl-click toggle. The container's
  // onClickCapture consumes the next click before it reaches the row.
  const suppressNextClickRef = useRef(false);

  const armSuppressNextClick = () => {
    suppressNextClickRef.current = true;
    setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
  };

  const computeDragRect = useCallback((): DragRect => {
    const start = dragStartRef.current;
    const current = dragCurrentRef.current;
    return {
      left: Math.min(start.x, current.x),
      top: Math.min(start.y, current.y),
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y),
    };
  }, []);

  const computeIntersectingIds = useCallback(
    (rect: { left: number; top: number; right: number; bottom: number }): string[] => {
      const container = containerRef.current;
      if (!container) return [];
      const nodes = container.querySelectorAll<HTMLElement>(`[${ROW_ATTR}]`);
      const ids: string[] = [];
      nodes.forEach((node) => {
        const rowRect = node.getBoundingClientRect();
        if (rectsIntersect(rect, rowRect)) {
          const id = node.getAttribute(ROW_ATTR);
          if (id) ids.push(id);
        }
      });
      return ids;
    },
    [],
  );

  const setContainerRef = useCallback(
    (node: HTMLElement | null) => {
      containerRef.current = node;
    },
    [],
  );

  const handleContainerMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      // Cmd/Ctrl-click on a row is handled by `onRowMouseDown` (which calls
      // stopPropagation), so we never reach here for that case. Skip if the
      // mousedown lands on an interactive element so its native focus/text
      // behavior is preserved.
      if (target.closest(INTERACTIVE_SELECTOR)) {
        clickShouldClearRef.current = false;
        return;
      }
      const isOnRow = Boolean(target.closest(`[${ROW_ATTR}]`));
      // A click on empty space (not on a row) should clear the selection.
      clickShouldClearRef.current = !isOnRow;
      if (!enableDragSelect) return;
      // Arm a possible drag from anywhere in the container — including row
      // bodies. If the user moves past the threshold we activate a rubber-band
      // selection AND suppress the trailing click on the row.
      dragPendingRef.current = true;
      dragStartRef.current = { x: event.clientX, y: event.clientY };
      dragCurrentRef.current = { x: event.clientX, y: event.clientY };
    },
    [enableDragSelect],
  );

  // Capture-phase click handler intercepts the trailing click after a drag so
  // the row's bubble-phase onClick (which would open the row) never fires.
  const handleContainerClickCapture = useCallback(
    (event: ReactMouseEvent) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        event.stopPropagation();
        event.preventDefault();
      }
    },
    [],
  );

  // Attach document mousemove/mouseup while a drag is pending or active.
  useEffect(() => {
    if (!enableDragSelect) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (dragPendingRef.current) {
        const dx = event.clientX - dragStartRef.current.x;
        const dy = event.clientY - dragStartRef.current.y;
        if (Math.abs(dx) > dragThreshold || Math.abs(dy) > dragThreshold) {
          dragPendingRef.current = false;
          dragActiveRef.current = true;
          window.getSelection()?.removeAllRanges();
          dragCurrentRef.current = { x: event.clientX, y: event.clientY };
          setDragRect(computeDragRect());
        }
        return;
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
      setSelectedIds(new Set(ids));
      setLastClickedId(ids.length > 0 ? ids[ids.length - 1] ?? null : null);
    };

    const handleMouseUp = () => {
      const wasPending = dragPendingRef.current;
      const wasActive = dragActiveRef.current;
      dragPendingRef.current = false;
      dragActiveRef.current = false;
      if (wasActive) {
        setDragRect(null);
        clickShouldClearRef.current = false;
        // The trailing click on the row should not open it.
        armSuppressNextClick();
        return;
      }
      if (wasPending && clickShouldClearRef.current) {
        // Bare click on empty space — clear the selection.
        clickShouldClearRef.current = false;
        if (selectedIdsRef.current.size > 0) {
          setSelectedIds(new Set());
        }
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [computeDragRect, computeIntersectingIds, dragThreshold, enableDragSelect]);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!bindKeyboardShortcuts) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableEvent(event)) return;

      // Esc — clear selection
      if (event.key === 'Escape') {
        if (selectedIdsRef.current.size > 0) {
          event.preventDefault();
          setSelectedIds(new Set());
        }
        return;
      }

      // Cmd/Ctrl + A — select all
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === 'a') {
          if (orderedIdsRef.current.length === 0) return;
          event.preventDefault();
          const all = orderedIdsRef.current;
          setSelectedIds(new Set(all));
          setLastClickedId(all[all.length - 1] ?? null);
          return;
        }
      }

      // X — toggle the focused/head row
      if (
        event.key === 'x' &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        const targetId = headIdRef.current ?? lastClickedIdRef.current;
        if (!targetId) return;
        event.preventDefault();
        toggle(targetId);
        return;
      }

      // Shift + ArrowUp / ArrowDown — extend range from anchor
      if (
        (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        const all = orderedIdsRef.current;
        if (all.length === 0) return;
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const currentHead = headIdRef.current;
        const currentIdx = currentHead ? all.indexOf(currentHead) : -1;
        const newIdx =
          currentIdx === -1
            ? direction === 1
              ? 0
              : all.length - 1
            : Math.min(all.length - 1, Math.max(0, currentIdx + direction));
        if (newIdx === currentIdx) return;
        const newHead = all[newIdx];
        if (!newHead) return;
        const anchorId = lastClickedIdRef.current ?? currentHead ?? newHead;
        const anchorIdx = all.indexOf(anchorId);
        if (anchorIdx === -1) {
          setSelectedIds(new Set([newHead]));
        } else {
          const start = Math.min(anchorIdx, newIdx);
          const end = Math.max(anchorIdx, newIdx);
          setSelectedIds(new Set(all.slice(start, end + 1)));
        }
        if (lastClickedIdRef.current === null) {
          setLastClickedId(anchorId);
        }
        setHead(newHead);
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [bindKeyboardShortcuts, setHead, toggle]);

  const getContainerProps = useCallback(
    () => ({
      ref: setContainerRef,
      onMouseDown: handleContainerMouseDown,
      onClickCapture: handleContainerClickCapture,
      style: { userSelect: 'none' as const },
    }),
    [handleContainerClickCapture, handleContainerMouseDown, setContainerRef],
  );

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    lastClickedId,
    headId,
    dragRect,
    isSelected,
    getSelectedItems,
    toggle,
    select,
    clear,
    selectAll,
    selectRange,
    setHead,
    onCheckboxClick,
    onRowMouseDown,
    getRowProps,
    getItemProps,
    getCheckboxProps,
    getContainerProps,
  };
}
