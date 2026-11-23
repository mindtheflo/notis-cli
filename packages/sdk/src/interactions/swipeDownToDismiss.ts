/**
 * Swipe down in a text box to put the keyboard away, as phone chat apps do. A swipe that starts inside an area marked
 * `data-swipe-dismiss` (a chat composer, a comment's reply box) while its field has the keyboard first scrolls the
 * field's own text, as the browser does. Once the text is at its top, the rest of the swipe stops scrolling anything
 * behind it, and past {@link SWIPE_DISMISS_DISTANCE} the field loses focus, so the keyboard closes. A swipe up, a
 * sideways swipe, a second finger or a field without the keyboard leave everything to the browser.
 *
 * One listener per document, whoever asks for it (the Portal, a comment pane), through {@link useSwipeDownToDismiss}
 * or {@link installSwipeDownToDismiss}. Areas inside a shadow root (the comment panes) are found through the event's
 * composed path, and the focused field through each shadow root's own active element.
 */

import { useEffect } from 'react';

/** Marks an area where a swipe down puts the keyboard away. */
export const SWIPE_DISMISS_ATTRIBUTE = 'data-swipe-dismiss';
/** How far the finger travels down, once the text is at its top, before the keyboard closes, in pixels. */
export const SWIPE_DISMISS_DISTANCE = 32;
/** Travel before a swipe counts as vertical or sideways, in pixels. */
const SLOP = 6;

type Gesture = {
  id: number;
  field: HTMLElement;
  startX: number;
  startY: number;
  lastY: number;
  /** Where the finger was when the text reached its top during a downward move; null while the text still scrolls. */
  topY: number | null;
  vertical: boolean | null;
};

/** The element that has the focus, looking inside open shadow roots. */
export function deepActiveElement(doc: Document): Element | null {
  let active: Element | null = doc.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

function isTextField(element: Element | null): element is HTMLElement {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLInputElement) {
    return !element.readOnly && !element.disabled && !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color', 'image'].includes(element.type);
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

/** The marked area on the touch's composed path, so areas inside a shadow root count too. */
function areaOf(event: TouchEvent): HTMLElement | null {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement && node.hasAttribute(SWIPE_DISMISS_ATTRIBUTE)) return node;
  }
  return null;
}

/** The field the text scrolls in: the focused element, or its nearest scrolling editable ancestor (a contentEditable). */
function scrollerOf(field: HTMLElement): HTMLElement {
  let node: HTMLElement | null = field;
  while (node) {
    if (node.scrollHeight > node.clientHeight + 1) return node;
    if (node.parentElement && !node.parentElement.isContentEditable) break;
    node = node.parentElement;
  }
  return field;
}

const installs = new WeakMap<Document, { count: number; remove: () => void }>();

function listen(doc: Document): () => void {
  let gesture: Gesture | null = null;

  const start = (event: TouchEvent) => {
    gesture = null;
    if (event.touches.length !== 1) return;
    const area = areaOf(event);
    if (!area) return;
    const active = deepActiveElement(doc);
    if (!isTextField(active)) return;
    // The focused field must be in this area (or be the area): touching another composer leaves this one alone.
    let inside = false;
    for (let node: Node | null = active; node; node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null)) {
      if (node === area) { inside = true; break; }
    }
    if (!inside) return;
    const touch = event.touches[0];
    const field = scrollerOf(active);
    gesture = {
      id: touch.identifier, field, startX: touch.clientX, startY: touch.clientY, lastY: touch.clientY,
      topY: field.scrollTop <= 0 ? touch.clientY : null, vertical: null,
    };
  };

  const move = (event: TouchEvent) => {
    const current = gesture;
    if (!current) return;
    if (event.touches.length !== 1) { gesture = null; return; }
    const touch = Array.from(event.touches).find((t) => t.identifier === current.id);
    if (!touch) return;
    if (current.vertical === null) {
      const dx = Math.abs(touch.clientX - current.startX);
      const dy = Math.abs(touch.clientY - current.startY);
      if (dx < SLOP && dy < SLOP) return;
      current.vertical = dy > dx;
      if (!current.vertical) { gesture = null; return; }
    }
    const goingUp = touch.clientY < current.lastY;
    current.lastY = touch.clientY;
    // Moving up, or text still above the top: the browser scrolls the field, and the count starts again.
    if (goingUp || current.field.scrollTop > 0) { current.topY = null; return; }
    if (current.topY === null) current.topY = touch.clientY;
    // The text is at its top: nothing behind the field scrolls for the rest of this swipe.
    if (event.cancelable) event.preventDefault();
    if (touch.clientY - current.topY >= SWIPE_DISMISS_DISTANCE) {
      gesture = null;
      current.field.blur();
      const active = deepActiveElement(doc);
      if (active instanceof HTMLElement && active !== current.field && isTextField(active)) active.blur();
    }
  };

  const end = () => { gesture = null; };

  doc.addEventListener('touchstart', start, { passive: true, capture: true });
  doc.addEventListener('touchmove', move, { passive: false, capture: true });
  doc.addEventListener('touchend', end, { capture: true });
  doc.addEventListener('touchcancel', end, { capture: true });
  return () => {
    doc.removeEventListener('touchstart', start, { capture: true });
    doc.removeEventListener('touchmove', move, { capture: true });
    doc.removeEventListener('touchend', end, { capture: true });
    doc.removeEventListener('touchcancel', end, { capture: true });
  };
}

/** Turns the swipe on for a document; each call returns its own undo, and the listener stays while any caller needs it. */
export function installSwipeDownToDismiss(doc: Document = document): () => void {
  const existing = installs.get(doc);
  if (existing) existing.count += 1;
  else installs.set(doc, { count: 1, remove: listen(doc) });
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const install = installs.get(doc);
    if (!install) return;
    install.count -= 1;
    if (install.count <= 0) { install.remove(); installs.delete(doc); }
  };
}

/** Turns the swipe on for this document while the component is mounted. */
export function useSwipeDownToDismiss(enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    return installSwipeDownToDismiss(document);
  }, [enabled]);
}
