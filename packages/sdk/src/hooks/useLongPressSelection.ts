'use client';

import { useCallback, useEffect, useRef } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;
const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'textarea',
  'select',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="tab"]',
].join(', ');

/** Adds a touch-only long-press entry point without rendering idle checkboxes. */
export function useLongPressSelection(onSelect: (id: string) => void) {
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    startRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return useCallback((id: string) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch' || event.button !== 0) return;
      const target = event.target;
      if (
        target instanceof HTMLElement
        && target !== event.currentTarget
        && target.closest(INTERACTIVE_SELECTOR)
      ) return;
      cancel();
      startRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        startRef.current = null;
        suppressClickRef.current = true;
        onSelectRef.current(id);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const start = startRef.current;
      if (!start) return;
      if (
        Math.abs(event.clientX - start.x) > MOVE_TOLERANCE_PX
        || Math.abs(event.clientY - start.y) > MOVE_TOLERANCE_PX
      ) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
      if (!suppressClickRef.current) return false;
      suppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    },
  }), [cancel]);
}
