/**
 * Shows an element inside the pane's own scroller (C7), measured against the scroller and never the page: a deep link's
 * card, a pin's thread, a new comment's box. The host panel may still be opening (it grows from no height, slides in,
 * or its list is still reading), so the reveal runs again while the layout settles: on each resize of the scroller or
 * the element and on each frame, until nothing moved for a few frames or a short time passed. After that it still
 * follows the element's size for a while (a picture in the card loads and the card grows): each change shows it whole
 * again, from its top when it is taller than the list. It stops at once when the person scrolls, touches or types in
 * the scroller. The page around the panel never moves.
 */

import { useEffect, type RefObject } from 'react';

/** Room kept between the element and the scroller's edge, in pixels. */
const MARGIN = 8;
/** Frames in a row with nothing moved before the reveal stops. */
const STABLE_FRAMES = 3;
/** The longest a reveal keeps following the layout frame by frame, in milliseconds. */
const SETTLE_MS = 1500;
/** How long a reveal keeps following the element's size after the frames settled (pictures loading), in milliseconds. */
const WATCH_MS = 8000;
/** What the person does in the scroller that ends a reveal (on the scroller itself, never the window or document). */
const USER_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/**
 * Scrolls `box` the least that shows `element` whole, or from its top when it is taller than the box. Positions are
 * read relative to the scroller's content and in layout pixels (a panel still scaling in draws everything smaller on
 * screen: rects are divided by that scale), so the same layout always gives the same scrollTop. True when it scrolled.
 */
export function alignInScroller(box: HTMLElement, element: HTMLElement, margin = MARGIN): boolean {
  const view = box.clientHeight;
  if (view <= 0) return false;
  const outer = box.getBoundingClientRect();
  const at = element.getBoundingClientRect();
  const layoutHeight = box.offsetHeight;
  const scale = layoutHeight > 0 && outer.height > 0 ? outer.height / layoutHeight : 1;
  const current = box.scrollTop;
  const top = (at.top - outer.top) / scale - (box.clientTop || 0) + current;
  const height = at.height / scale;
  const bottom = top + height;
  let target = current;
  if (height + 2 * margin > view || top - margin < current) target = top - margin;
  else if (bottom + margin > current + view) target = bottom + margin - view;
  const most = box.scrollHeight > view ? box.scrollHeight - view : Math.max(target, 0);
  target = Math.round(Math.max(0, Math.min(target, most)));
  if (Math.abs(target - current) < 1) return false;
  box.scrollTop = target;
  return true;
}

type Frame = (callback: () => void) => () => void;

function frameOf(): Frame {
  const raf = typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame.bind(globalThis) : null;
  if (raf) {
    return callback => {
      const id = raf(() => callback());
      return () => globalThis.cancelAnimationFrame?.(id);
    };
  }
  return callback => {
    const id = setTimeout(callback, 16);
    return () => clearTimeout(id);
  };
}

/**
 * Reveals what `find` returns inside `box` now and again while the layout settles (see above). Returns a stop function;
 * a newer reveal in the same scroller should stop the older one first.
 */
export function revealInScroller(box: HTMLElement, find: () => HTMLElement | null): () => void {
  const view = box.ownerDocument.defaultView;
  const frame = frameOf();
  const started = Date.now();
  let stopped = false;
  let cancelFrame: (() => void) | null = null;
  let watching: ReturnType<typeof setTimeout> | null = null;
  let settledAt = 0;
  let stable = 0;
  let last = '';
  const observed = new Set<Element>();
  const sizes = view && typeof view.ResizeObserver !== 'undefined' ? new view.ResizeObserver(() => align()) : null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelFrame?.();
    if (watching != null) clearTimeout(watching);
    sizes?.disconnect();
    box.removeEventListener('load', onLoad, true);
    box.removeEventListener('scroll', onScroll);
    for (const type of USER_EVENTS) box.removeEventListener(type, stop);
  };
  // A picture in the list loading (load does not bubble: caught on the way down, on the scroller only).
  function onLoad() { align(); }

  function align(): boolean {
    if (stopped) return false;
    const element = find();
    if (!element || !element.isConnected) return false;
    if (sizes && !observed.has(element)) { observed.add(element); sizes.observe(element); }
    const moved = alignInScroller(box, element);
    settledAt = box.scrollTop;
    return moved;
  }

  const tick = () => {
    cancelFrame = null;
    if (stopped) return;
    const moved = align();
    const element = find();
    const at = element?.getBoundingClientRect();
    const outer = box.getBoundingClientRect();
    const shape = `${box.clientHeight}|${box.scrollTop}|${outer.top}|${at ? `${at.top}|${at.height}` : '-'}`;
    stable = !moved && shape === last ? stable + 1 : 0;
    last = shape;
    if (stable >= STABLE_FRAMES || Date.now() - started > SETTLE_MS) { watch(); return; }
    cancelFrame = frame(tick);
  };

  // The layout settled: no more frames, but the element's size is still followed (its resize observer and the loads
  // of its pictures) until the watch ends or the person takes over.
  const watch = () => {
    if (stopped) return;
    watching = setTimeout(stop, Math.max(0, WATCH_MS - (Date.now() - started)));
    settledAt = box.scrollTop;
    box.addEventListener('scroll', onScroll, { passive: true });
  };
  // While watching, any scroll this reveal did not make (another reveal, a scroll bar) ends it.
  function onScroll() { if (Math.abs(box.scrollTop - settledAt) > 1) stop(); }

  // The person takes over: their scroll, touch or key in the list ends the reveal.
  for (const type of USER_EVENTS) box.addEventListener(type, stop, { passive: true });
  box.addEventListener('load', onLoad, true);
  if (sizes) sizes.observe(box);
  align();
  cancelFrame = frame(tick);
  return stop;
}

/**
 * Reveals the element `ref` holds each time `key` names a new opening (a new comment box opening while the list is
 * scrolled down): inside its pane scroller with `revealInScroller`, or with the browser's nearest scroll when it sits in
 * no pane. Nothing while `key` is null.
 */
export function useRevealOnOpen(ref: RefObject<HTMLElement | null>, key: string | null): void {
  useEffect(() => {
    const element = ref.current;
    if (!key || !element) return undefined;
    const box = element.closest<HTMLElement>('[data-comment-scroll]');
    if (!box) { element.scrollIntoView?.({ block: 'nearest' }); return undefined; }
    return revealInScroller(box, () => ref.current);
  }, [key, ref]);
}
