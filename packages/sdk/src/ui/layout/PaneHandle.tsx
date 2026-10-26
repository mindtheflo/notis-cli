/**
 * The drag edge on a side pane's left edge, shared by `Panels` (the open item) and `SidePane`:
 * drag, arrow keys (24px), double click resets. A drag writes the width straight onto the
 * owner's element through `onLive` and commits it with `onWidth` on release.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { PANELS_KEYBOARD_STEP_PX } from './panelMath';

type Drag = { pointerId: number; startX: number; startWidth: number; container: number | null; width: number | null };

export function measureWidth(element: HTMLElement | null): number | null {
  const width = element?.getBoundingClientRect().width ?? 0;
  return width > 0 ? width : null;
}

export interface PaneHandleProps {
  className: string;
  label: string;
  hint: string;
  width: number;
  min: number;
  max: number | undefined;
  /** The width a drag reaches in a row `container` px wide (null when unknown). */
  clamp: (px: number, container: number | null) => number;
  /** The row the pane sits in, measured when a drag starts. */
  rootRef: { current: HTMLElement | null };
  /** A width while dragging, before it is committed. */
  onLive: (px: number) => void;
  onWidth: (px: number) => void;
  onReset: () => void;
}

export function PaneHandle({ className, label, hint, width, min, max, clamp, rootRef, onLive, onWidth, onReset }: PaneHandleProps) {
  const dragRef = useRef<Drag | null>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const end = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragWidth(null);
    // A click without movement keeps the width as it was.
    if (drag.width !== null) onWidth(drag.width);
  }, [onWidth]);

  useEffect(() => end, [end]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, container: measureWidth(rootRef.current), width: null };
    setDragWidth(width);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    // The handle sits on the pane's left edge: moving left widens the pane.
    const next = clamp(drag.startWidth + drag.startX - event.clientX, drag.container);
    if (next === drag.width) return;
    drag.width = next;
    onLive(next);
    setDragWidth(next);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const direction = event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    event.stopPropagation();
    onWidth(width + direction * PANELS_KEYBOARD_STEP_PX);
  };

  return (
    <div
      className={className}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(dragWidth ?? width)}
      title={hint}
      tabIndex={0}
      data-resizing={dragWidth === null ? undefined : ''}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
