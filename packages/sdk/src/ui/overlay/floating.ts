/** Positioning and outside-press dismissal shared by Menu, Popover and Tooltip. */

import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import { place, type Align, type Side } from './position';
import { eventWithin, useIsoLayoutEffect, useLatest } from '../util';

export interface FloatingOptions { side?: Side; align?: Align; offset?: number }

/** Fixed-position style for `panel` next to `anchor` while open; follows scroll and resize. */
export function useFloatingStyle(open: boolean, anchor: RefObject<Element | null>, panel: RefObject<HTMLElement | null>,
  { side = 'bottom', align = 'start', offset = 4 }: FloatingOptions): { style: CSSProperties; side: Side } {
  const [state, setState] = useState<{ top: number; left: number; side: Side; measured: boolean }>(
    { top: 0, left: 0, side, measured: false });
  useIsoLayoutEffect(() => {
    if (!open) {
      setState((current) => current.measured ? { ...current, measured: false } : current);
      return;
    }
    const update = () => {
      const anchorEl = anchor.current;
      const panelEl = panel.current;
      if (!anchorEl || !panelEl) return;
      const rect = anchorEl.getBoundingClientRect();
      const viewport = { width: window.innerWidth || document.documentElement.clientWidth || 1024,
        height: window.innerHeight || document.documentElement.clientHeight || 768 };
      const size = { width: panelEl.offsetWidth, height: panelEl.offsetHeight };
      const next = place(rect, size, { side, align, offset, viewport });
      setState((current) => current.top === next.top && current.left === next.left && current.side === next.side
        && current.measured ? current : { ...next, measured: true });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (observer && panel.current) observer.observe(panel.current);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      observer?.disconnect();
    };
  }, [open, side, align, offset]);
  return {
    style: { top: state.top, left: state.left, visibility: state.measured ? undefined : 'hidden' },
    side: state.side,
  };
}

/** Calls `onDismiss` on a press outside every element in `inside` (shadow roots included). */
export function useOutsidePress(open: boolean, inside: () => Array<Element | null | undefined>, onDismiss: () => void): void {
  const latest = useLatest({ inside, onDismiss });
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const onPointerDown = (event: Event) => {
      if (eventWithin(event, latest.current.inside())) return;
      latest.current.onDismiss();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('mousedown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('mousedown', onPointerDown, true);
    };
  }, [open, latest]);
}
