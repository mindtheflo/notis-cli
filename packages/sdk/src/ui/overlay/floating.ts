/** Positioning and outside-press dismissal shared by Menu, Popover and Tooltip. */

import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import { place, type Align, type Side } from './position';
import { eventWithin, useIsoLayoutEffect, useLatest } from '../util';

export interface FloatingOptions { side?: Side; align?: Align; offset?: number }

/** The computed value of `name`, '' when the browser does not know the property. */
function styleOf(style: CSSStyleDeclaration, name: string): string {
  const value = (style as unknown as Record<string, unknown>)[name];
  if (typeof value === 'string' && value) return value;
  return typeof style.getPropertyValue === 'function' ? style.getPropertyValue(name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)) : '';
}

/**
 * True when this style makes the element the containing block of its fixed-position descendants: a transform, the
 * individual `translate` / `rotate` / `scale` properties (what Tailwind v4's `translate-x-0` or `scale-100` writes, as
 * the phone chat panel does), a perspective, a filter, or paint or layout containment. A container type is left out:
 * browsers no longer make a query container hold fixed descendants, and a Space's `@container` must keep its menus where
 * they were.
 */
function holdsFixed(style: CSSStyleDeclaration): boolean {
  const set = (name: string) => { const value = styleOf(style, name).trim(); return Boolean(value) && value !== 'none'; };
  const has = (value: string, words: readonly string[]) => Boolean(value && words.some(word => value.includes(word)));
  return set('transform') || set('translate') || set('rotate') || set('scale') || set('perspective')
    || set('filter') || set('backdropFilter')
    || has(styleOf(style, 'contain'), ['paint', 'layout', 'strict', 'content'])
    || styleOf(style, 'contentVisibility') === 'auto'
    || has(styleOf(style, 'willChange'), ['transform', 'translate', 'rotate', 'scale', 'perspective', 'filter']);
}

/**
 * Where (0, 0) of `position: fixed` is for `panel`, in viewport coordinates: the screen's corner, or the padding box of
 * an ancestor (shadow hosts included) whose transform (or translate, rotate, scale), filter or containment holds fixed
 * descendants, as a host panel sliding in does. A menu placed from its button's screen position is moved back by it.
 */
export function fixedOrigin(panel: Element): { x: number; y: number } {
  const view = panel.ownerDocument.defaultView;
  if (!view) return { x: 0, y: 0 };
  let node: Node | null = panel.parentNode;
  while (node) {
    if (node instanceof view.Element) {
      if (holdsFixed(view.getComputedStyle(node))) {
        const rect = node.getBoundingClientRect();
        const box = node as HTMLElement;
        return { x: rect.left + (box.clientLeft || 0) - (box.scrollLeft || 0), y: rect.top + (box.clientTop || 0) - (box.scrollTop || 0) };
      }
      node = node.parentNode;
    } else if (typeof view.ShadowRoot !== 'undefined' && node instanceof view.ShadowRoot) node = node.host;
    else break;
  }
  return { x: 0, y: 0 };
}

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
      const placed = place(rect, size, { side, align, offset, viewport });
      const origin = fixedOrigin(panelEl);
      const next = { ...placed, top: placed.top - origin.y, left: placed.left - origin.x };
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
