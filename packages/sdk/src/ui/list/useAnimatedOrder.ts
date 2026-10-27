/**
 * `useAnimatedOrder`: the Manager's row motion (portal `useAnimatedThreadOrder`) for every ListReader layout. When the
 * rows change (a saved change re-sorts a row, a new row arrives, a row leaves the view), each row that stays slides
 * from where it was to where it is now (FLIP, 320ms, the Manager's ease-out), so a re-sort reads as a move and the gap
 * a leaving row leaves closes smoothly; a new row fades in. Tiles and boards move on both axes.
 *
 * It never animates the first rows, a change of layout, density, folded groups or width (`resetKey` and the measured
 * width), a row that only changed its id in place (a new row getting its real key), or with reduced motion. A second change mid-flight starts from where each row is on screen, so it never snaps.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { useIsoLayoutEffect } from '../util';
import { ROW_ID_ATTRIBUTE } from './useListKeys';

const MOVE_MS = 320;
const ENTER_MS = 200;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

type Point = { x: number; y: number };

function reducedMotion(view: Window | null): boolean {
  return !!view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Where each row sits in the container's content (scrolling does not move it). */
function measure(container: HTMLElement): Map<string, Point> {
  const box = container.getBoundingClientRect();
  const out = new Map<string, Point>();
  for (const row of container.querySelectorAll<HTMLElement>(`[${ROW_ID_ATTRIBUTE}]`)) {
    const id = row.getAttribute(ROW_ID_ATTRIBUTE);
    if (!id || out.has(id)) continue;
    const rect = row.getBoundingClientRect();
    out.set(id, { x: rect.left - box.left + container.scrollLeft, y: rect.top - box.top + container.scrollTop });
  }
  return out;
}

/**
 * Animates the rows inside `containerRef` whenever `signature` (the ids in order) changes. `resetKey` names what
 * re-lays the rows out without moving them (layout, density, folded groups): a change of it re-measures only, as
 * does new `content` (the items) in the same order, so the next move starts from where the rows really were.
 */
export function useAnimatedOrder(containerRef: RefObject<HTMLElement | null>, signature: string, resetKey: string,
  content: unknown): void {
  const positions = useRef<Map<string, Point> | null>(null);
  const previous = useRef<{ signature: string; resetKey: string; width: number; content: unknown }>(
    { signature, resetKey, width: -1, content });
  const running = useRef(new Map<HTMLElement, Animation>());

  useIsoLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) { positions.current = null; return; }
    const last = previous.current;
    const width = container.clientWidth;
    const changed = last.signature !== signature;
    previous.current = { signature, resetKey, width, content };
    if (!changed && positions.current && last.resetKey === resetKey && last.width === width && last.content === content) return;
    // New content in the same order (a saved change confirmed) lets a running move finish; the layout it ends on holds.
    if (!changed && positions.current && last.resetKey === resetKey && last.width === width && running.current.size) return;
    const before = positions.current;
    const view = container.ownerDocument.defaultView;
    // A running move counts from where its row is on screen now: its old place plus the offset it is drawn at.
    const drawn = new Map<string, Point>();
    if (before && running.current.size) {
      const box = container.getBoundingClientRect();
      for (const row of running.current.keys()) {
        const id = row.getAttribute(ROW_ID_ATTRIBUTE);
        if (!id || !row.isConnected) continue;
        const rect = row.getBoundingClientRect();
        drawn.set(id, { x: rect.left - box.left + container.scrollLeft, y: rect.top - box.top + container.scrollTop });
      }
    }
    for (const animation of running.current.values()) animation.cancel();
    running.current.clear();
    const after = measure(container);
    positions.current = after;
    const animate = changed && before !== null && last.resetKey === resetKey && last.width === width && !reducedMotion(view);
    // Rows arriving in an empty list (a first load, another tab) appear at once.
    if (!animate || !before?.size) return;
    // A row that took another's place exactly (a new row getting its real key) is the same row: it does not fade.
    const vacated = [...before].filter(([id]) => !after.has(id)).map(([, point]) => point);
    for (const row of container.querySelectorAll<HTMLElement>(`[${ROW_ID_ATTRIBUTE}]`)) {
      if (typeof row.animate !== 'function') return;
      const id = row.getAttribute(ROW_ID_ATTRIBUTE)!;
      const to = after.get(id);
      let from = before.get(id);
      const seen = drawn.get(id);
      if (from && seen && to) from = { x: from.x + seen.x - to.x, y: from.y + seen.y - to.y };
      let animation: Animation;
      if (!to) continue;
      if (!from) {
        if (vacated.some((point) => Math.abs(point.x - to.x) < 1 && Math.abs(point.y - to.y) < 1)) continue;
        animation = row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ENTER_MS, easing: 'ease-out' });
      } else {
        const dx = from.x - to.x, dy = from.y - to.y;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        animation = row.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: MOVE_MS, easing: EASE });
      }
      running.current.set(row, animation);
      animation.onfinish = () => { if (running.current.get(row) === animation) running.current.delete(row); };
    }
  });

  useEffect(() => {
    const view = containerRef.current?.ownerDocument.defaultView;
    const media = view?.matchMedia?.('(prefers-reduced-motion: reduce)');
    const cancel = () => {
      for (const animation of running.current.values()) animation.cancel();
      running.current.clear();
    };
    const onChange = () => { if (media?.matches) cancel(); };
    media?.addEventListener?.('change', onChange);
    return () => { media?.removeEventListener?.('change', onChange); cancel(); };
  }, [containerRef]);
}
