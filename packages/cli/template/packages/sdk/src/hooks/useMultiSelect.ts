'use client';

import { useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import {
  useCollectionInteractions,
  type CollectionInteractionController,
  type SelectionMarqueeRect,
} from './useCollectionInteractions';

const ROW_ATTR = 'data-notis-row-id';

export type DragRect = SelectionMarqueeRect;

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
  dragRect: DragRect | null;
  isSelected: (id: string) => boolean;
  getSelectedItems: () => T[];
  toggle: (id: string) => void;
  select: (ids: string[]) => void;
  clear: () => void;
  selectAll: () => void;
  selectRange: (anchorId: string, targetId: string) => void;
  setHead: (id: string | null) => void;
  onCheckboxClick: (id: string) => (event: ReactMouseEvent) => void;
  onRowMouseDown: (id: string) => (event: ReactMouseEvent) => void;
  getRowProps: (id: string) => { [ROW_ATTR]: string };
  getItemProps: (id: string) => {
    [ROW_ATTR]: string;
    onMouseDown: (event: ReactMouseEvent) => void;
  };
  getCheckboxProps: (id: string) => {
    isSelected: boolean;
    onClick: (event: ReactMouseEvent) => void;
  };
  getContainerProps: CollectionInteractionController<T>['getContainerProps'];
}

/**
 * @deprecated Use `useCollectionInteractions` for controlled selection,
 * active-item navigation, scoped shortcuts, and semantic actions. This bridge
 * is retained for the 0.2 minor and scheduled for removal in 0.3.
 */
export function useMultiSelect<T>(options: UseMultiSelectOptions<T>): MultiSelectController<T> {
  const controller = useCollectionInteractions({
    ...options,
    defaultActiveId: options.initialHeadId,
    onActiveItemChange: options.onHeadChange,
    shortcuts: {
      next: false,
      previous: false,
      activate: false,
    },
  });

  const getRowProps = useCallback((id: string) => ({ [ROW_ATTR]: id }), []);
  const getItemProps = useCallback((id: string) => ({
    [ROW_ATTR]: id,
    onMouseDown: controller.onRowMouseDown(id),
  }), [controller.onRowMouseDown]);

  return {
    selectedIds: controller.selectedIds,
    selectedCount: controller.selectedCount,
    lastClickedId: controller.lastClickedId,
    headId: controller.headId,
    dragRect: controller.dragRect,
    isSelected: controller.isSelected,
    getSelectedItems: controller.getSelectedItems,
    toggle: controller.toggle,
    select: controller.select,
    clear: controller.clear,
    selectAll: controller.selectAll,
    selectRange: controller.selectRange,
    setHead: controller.setActive,
    onCheckboxClick: controller.onCheckboxClick,
    onRowMouseDown: controller.onRowMouseDown,
    getRowProps,
    getItemProps,
    getCheckboxProps: controller.getCheckboxProps,
    getContainerProps: controller.getContainerProps,
  };
}
