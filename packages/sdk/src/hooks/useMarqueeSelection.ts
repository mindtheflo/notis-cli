'use client';

/**
 * `useMarqueeSelection`: drag from empty space to select (the rubber band), shared by the Manager
 * (`useCollectionInteractions`) and the toolkit list (`ListReader`), so both run the same code.
 *
 * - A press starts a marquee only on empty space inside the container: not on an item, not on a control
 *   (button, link, field). A press on a control does nothing here; a press on an item is left to the item.
 * - The marquee shows once the pointer moved past `threshold` px; the text selection is cleared then.
 * - While dragging, every selectable item the rectangle intersects is selected, live (`onSelect`, in DOM order;
 *   the last one is the anchor).
 * - Releasing after a drag swallows the click that follows; a plain click on empty space clears (`onClear`).
 * - Mouse events only: a touch drag scrolls and never draws a marquee.
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

export interface SelectionMarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Clicks on these belong to the control (Manager `INTERACTIVE_SELECTOR`). */
export const MARQUEE_INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, [role="button"], [contenteditable]:not([contenteditable="false"])';

export interface UseMarqueeSelectionOptions {
  /** The marquee is on: the collection allows multiple selection and the surface did not opt out. */
  enabled: boolean;
  /** The attribute every item element carries, holding its id. */
  itemAttribute: string;
  /** Items that may join the selection (pending and disabled ones may not). */
  isSelectable: (id: string) => boolean;
  /** The items under the rectangle, in DOM order, on every move of a drag. Replaces the selection. */
  onSelect: (ids: string[]) => void;
  /** A plain click (no drag) on empty space. */
  onClear: () => void;
  /** Distance in px before a press becomes a drag. Default 5. */
  threshold?: number;
  interactiveSelector?: string;
  /** A part of an item a drag may also start from (a row's leading strip), so a list with no empty space left still
   *  has a place to start one. A plain click there still reaches the item. Default: empty space only. */
  startSelector?: string;
}

export interface MarqueeSelection {
  /** The marquee in viewport coordinates while dragging, else null (draw it with `SelectionMarquee`). */
  rect: SelectionMarqueeRect | null;
  /** Put on the container. */
  onMouseDown: (event: ReactMouseEvent) => void;
  /** Put on the container: swallows the click that ends a drag (or any gesture that armed it). */
  onClickCapture: (event: ReactMouseEvent) => void;
  /** Swallow the next click inside the container (Mod-press toggles use it too). */
  armSuppressNextClick: () => void;
}

function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** The ids of the selectable items under `rect` inside `container`, in DOM order. */
export function itemsInMarquee(
  container: ParentNode | null,
  rect: { left: number; top: number; right: number; bottom: number },
  itemAttribute: string,
  isSelectable: (id: string) => boolean,
): string[] {
  const nodes = container?.querySelectorAll<HTMLElement>(`[${itemAttribute}]`);
  if (!nodes) return [];
  const ids: string[] = [];
  nodes.forEach((node) => {
    if (!rectsIntersect(rect, node.getBoundingClientRect())) return;
    const id = node.getAttribute(itemAttribute);
    if (id && isSelectable(id)) ids.push(id);
  });
  return ids;
}

export function useMarqueeSelection(options: UseMarqueeSelectionOptions): MarqueeSelection {
  const {
    enabled, itemAttribute, threshold = 5, interactiveSelector = MARQUEE_INTERACTIVE_SELECTOR, startSelector,
  } = options;
  const latest = useRef(options);
  latest.current = options;
  const [rect, setRect] = useState<SelectionMarqueeRect | null>(null);

  const containerRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(false);
  const activeRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });
  const currentRef = useRef({ x: 0, y: 0 });
  const clickShouldClearRef = useRef(false);
  const suppressNextClickRef = useRef(false);

  const armSuppressNextClick = useCallback(() => {
    suppressNextClickRef.current = true;
    setTimeout(() => { suppressNextClickRef.current = false; }, 0);
  }, []);

  const onMouseDown = useCallback((event: ReactMouseEvent) => {
    if (!enabled || event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    const itemTarget = target.closest(`[${itemAttribute}]`);
    const interactiveTarget = target.closest(interactiveSelector);
    if (interactiveTarget && interactiveTarget !== itemTarget) {
      clickShouldClearRef.current = false;
      return;
    }
    clickShouldClearRef.current = !itemTarget;
    if (itemTarget) {
      const startTarget = startSelector ? target.closest(startSelector) : null;
      if (!startTarget || !itemTarget.contains(startTarget)) return;
      // Neither the item's own drag nor a text selection starts from the strip.
      event.preventDefault();
    }
    containerRef.current = event.currentTarget as HTMLElement;
    pendingRef.current = true;
    startRef.current = { x: event.clientX, y: event.clientY };
    currentRef.current = { x: event.clientX, y: event.clientY };
  }, [enabled, interactiveSelector, itemAttribute, startSelector]);

  const onClickCapture = useCallback((event: ReactMouseEvent) => {
    if (!suppressNextClickRef.current) return;
    suppressNextClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  useEffect(() => {
    if (!enabled) {
      pendingRef.current = false;
      if (activeRef.current) {
        activeRef.current = false;
        setRect(null);
      }
      return undefined;
    }
    if (typeof document === 'undefined') return undefined;
    const doc = document;
    const handleMouseMove = (event: MouseEvent) => {
      if (pendingRef.current) {
        const dx = event.clientX - startRef.current.x;
        const dy = event.clientY - startRef.current.y;
        if (Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
          pendingRef.current = false;
          activeRef.current = true;
          window.getSelection()?.removeAllRanges();
        } else return;
      }
      if (!activeRef.current) return;
      event.preventDefault();
      currentRef.current = { x: event.clientX, y: event.clientY };
      const next: SelectionMarqueeRect = {
        left: Math.min(startRef.current.x, currentRef.current.x),
        top: Math.min(startRef.current.y, currentRef.current.y),
        width: Math.abs(currentRef.current.x - startRef.current.x),
        height: Math.abs(currentRef.current.y - startRef.current.y),
      };
      setRect(next);
      const { itemAttribute: attribute, isSelectable, onSelect } = latest.current;
      onSelect(itemsInMarquee(containerRef.current, {
        left: next.left, top: next.top, right: next.left + next.width, bottom: next.top + next.height,
      }, attribute, isSelectable));
    };
    const handleMouseUp = () => {
      const wasPending = pendingRef.current;
      const wasActive = activeRef.current;
      pendingRef.current = false;
      activeRef.current = false;
      if (wasActive) {
        setRect(null);
        clickShouldClearRef.current = false;
        armSuppressNextClick();
      } else if (wasPending && clickShouldClearRef.current) {
        clickShouldClearRef.current = false;
        latest.current.onClear();
      }
    };
    doc.addEventListener('mousemove', handleMouseMove);
    doc.addEventListener('mouseup', handleMouseUp);
    return () => {
      doc.removeEventListener('mousemove', handleMouseMove);
      doc.removeEventListener('mouseup', handleMouseUp);
    };
  }, [armSuppressNextClick, enabled, threshold]);

  return { rect, onMouseDown, onClickCapture, armSuppressNextClick };
}
