/** Helpers shared by CalendarView and TimelineView: width, cursor focus and keymap shortcuts. Not exported. */

import * as React from 'react';
import { DEFAULT_KEYMAP } from '../../words';
import type { Words } from '../../words/types';
import type { ShortcutDef } from '../engine/types';
import { deepActiveElement } from '../util';

export function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

/** Width of an element, followed with a ResizeObserver (1200 before the first measure). */
export function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = React.useState(1200);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => { if (el.clientWidth) setWidth(el.clientWidth); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * Cursor focus shared by the calendar and the timeline: after the cursor moves by key, focus follows it unless focus
 * sits outside the view (a side reader keeps it).
 */
export function useCursorFocus(rootRef: React.RefObject<HTMLElement | null>, cursor: string | null) {
  const pending = React.useRef<string | null>(null);
  const focusNow = React.useCallback((id: string) => {
    const root = rootRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-nav-id="${cssEscape(id)}"]`);
    if (!root || !el) return;
    const active = deepActiveElement(root.getRootNode() as Document | ShadowRoot);
    const free = !active || active === root.ownerDocument.body || root.contains(active);
    if (free) el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [rootRef]);
  React.useEffect(() => {
    const id = pending.current;
    if (id === null || id !== cursor) return;
    pending.current = null;
    focusNow(id);
  }, [cursor, focusNow]);
  return React.useCallback((id: string | null, current: string | null) => {
    if (id === null) return;
    pending.current = id;
    if (id === current) focusNow(id);
  }, [focusNow]);
}

/** Focus is on the page itself or inside `root`, so the left and right arrows belong to the view. */
export function focusFreeFor(root: HTMLElement | null): boolean {
  if (!root) return false;
  const active = deepActiveElement(root.getRootNode() as Document | ShadowRoot);
  return !active || active === root.ownerDocument.body || root.contains(active);
}

/**
 * Focus sits inside `root` itself (not on the page). The page's Tabs own [ and ]: a calendar or a timeline steps its
 * period with them only while focus is inside it.
 */
export function focusInside(root: HTMLElement | null): boolean {
  if (!root) return false;
  const active = deepActiveElement(root.getRootNode() as Document | ShadowRoot);
  return !!active && active !== root.ownerDocument.body && root.contains(active);
}

/**
 * Call before a key step that can take the focused item away (the period moved): when focus was inside the view, it
 * stays there (on the view itself), so the next [ or ] still steps it. Runs after the cursor focus.
 */
export function useKeepFocusInside(rootRef: React.RefObject<HTMLElement | null>): () => void {
  const armed = React.useRef(false);
  React.useEffect(() => {
    if (!armed.current) return;
    armed.current = false;
    const root = rootRef.current;
    if (root && !focusInside(root)) root.focus({ preventScroll: true });
  });
  return React.useCallback(() => {
    if (!focusInside(rootRef.current)) return;
    armed.current = true;
    // A step that changed nothing renders nothing: forget it, so a later render never pulls focus back.
    setTimeout(() => { armed.current = false; }, 0);
  }, [rootRef]);
}

export function keymapDef(id: keyof typeof DEFAULT_KEYMAP, label: Words, when: () => boolean,
  run: ShortcutDef['run']): ShortcutDef {
  const entry = DEFAULT_KEYMAP[id];
  return { id: entry.id, keys: [...entry.keys], scope: entry.scope, label, when, run, ...(entry.repeat ? { repeat: true } : {}) };
}
