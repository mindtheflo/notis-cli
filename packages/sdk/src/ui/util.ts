/** Small shared helpers of the toolkit pieces (not exported from `@notis/sdk/ui`). */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { labelValue, pick, type Words } from '../words/types';
import { useToolkitLocale } from './engine/hooks';

/** Joins class names, skipping empty ones. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}

/** `(words) => string` in the toolkit locale. Plain strings pass through (Space code may pass its own words). */
export function useT(): (words: Words | string) => string {
  const locale = useToolkitLocale();
  return useCallback((words: Words | string) => pick(words, locale), [locale]);
}

/** `(label, value) => "Label: value"` in the toolkit locale (French: a narrow no-break space before the colon). */
export function useLabelValue(): (label: string, value: string) => string {
  const locale = useToolkitLocale();
  return useCallback((label: string, value: string) => labelValue(label, value, locale), [locale]);
}

/** A data attribute that is present (empty string) or absent, never "false". */
export function flag(on: boolean | undefined): '' | undefined {
  return on ? '' : undefined;
}

export const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** The latest value, readable from callbacks registered once. */
export function useLatest<V>(value: V): { readonly current: V } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

let idCounter = 0;
/** A stable id for aria wiring (React 18 has useId, but the SDK supports any React the host ships). */
export function useStableId(prefix: string): string {
  const ref = useRef<string | null>(null);
  if (ref.current === null) {
    idCounter += 1;
    ref.current = `${prefix}-${idCounter}`;
  }
  return ref.current;
}

/** True when the event path (shadow roots included) passes through one of the elements. */
export function eventWithin(event: Event, elements: Array<Element | null | undefined>): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const element of elements) {
    if (!element) continue;
    if (path.includes(element)) return true;
    if (event.target instanceof Node && element.contains(event.target)) return true;
  }
  return false;
}

/** The element that has focus, looking through open shadow roots. */
export function deepActiveElement(root: Document | ShadowRoot = document): Element | null {
  let active = root.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/**
 * Scrolls the nearest sideways-scrolling ancestor so `el` is fully in view (a tab strip or toolbar on a phone).
 * Unlike scrollIntoView it never scrolls the page up or down.
 */
export function revealInline(el: HTMLElement | null | undefined): void {
  if (!el || typeof window === 'undefined') return;
  for (let box = el.parentElement; box; box = box.parentElement) {
    if (box.scrollWidth <= box.clientWidth) continue;
    const overflow = window.getComputedStyle(box).overflowX;
    if (overflow !== 'auto' && overflow !== 'scroll') continue;
    const boxRect = box.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (rect.left < boxRect.left) box.scrollLeft -= boxRect.left - rect.left;
    else if (rect.right > boxRect.right) box.scrollLeft += rect.right - boxRect.right;
    return;
  }
}
