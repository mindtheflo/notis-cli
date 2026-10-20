/**
 * Interaction steps for the selection, comment and shortcut specimens. The state root sits in the frame's shadow
 * root, so lookups and text selections go through that root (or the document when there is none).
 */
import { nextFrame } from '../../specimen';

/** Where the state root and its fixed layers live: the shadow root, else the document. */
export function layerScope(root: HTMLElement): ParentNode {
  const node = root.getRootNode();
  return node instanceof ShadowRoot || node instanceof Document ? node : root.ownerDocument;
}

/** Lets effects, layout and portals settle. */
export async function settle(frames = 3): Promise<void> {
  for (let i = 0; i < frames; i += 1) await nextFrame();
}

/** Waits up to `frames` animation frames for `selector` under `scope`. */
export async function waitFor<E extends Element = HTMLElement>(scope: ParentNode, selector: string, frames = 120): Promise<E> {
  for (let i = 0; i < frames; i += 1) {
    const el = scope.querySelector<E>(selector);
    if (el) return el;
    await nextFrame();
  }
  throw new Error(`Not found after ${frames} frames: ${selector}`);
}

/** The first text node under `el` that holds `needle`, with the offset where it starts. */
function findText(el: Element, needle: string): { node: Text; offset: number } {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const offset = (node.textContent ?? '').indexOf(needle);
    if (offset >= 0) return { node: node as Text, offset };
  }
  throw new Error(`Text not found: ${needle.slice(0, 40)}`);
}

/** Selects the first occurrence of `needle` inside `el`, as a reader dragging over it would. */
export function selectText(el: Element, needle: string): Selection {
  const { node, offset } = findText(el, needle);
  const scope = el.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null };
  const selection = scope.getSelection?.() ?? el.ownerDocument.getSelection();
  if (!selection) throw new Error('No selection object in this frame.');
  selection.removeAllRanges();
  selection.setBaseAndExtent(node, offset, node, offset + needle.length);
  return selection;
}

/** The mouse button coming up over `el`, which ends a text selection. */
export function mouseUp(el: Element): void {
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true, cancelable: true, detail: 1 }));
}

/** Types `value` into a React-controlled textarea or input. */
export function typeInto(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

/** A plain key press on `el` (keydown then keyup), bubbling out of the shadow root like a real one. */
export function pressKey(el: Element, key: string, init: KeyboardEventInit = {}): void {
  const options = { key, bubbles: true, composed: true, cancelable: true, ...init };
  el.dispatchEvent(new KeyboardEvent('keydown', options));
  el.dispatchEvent(new KeyboardEvent('keyup', options));
}

/** A copy of the current selection from `el`, with a clipboard the page can write to and read back. */
export function copyFrom(el: Element): DataTransfer {
  const clipboardData = new DataTransfer();
  el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, composed: true, cancelable: true, clipboardData }));
  return clipboardData;
}

/** Keyboard focus with a visible focus ring, where the browser supports asking for one. */
export function keyboardFocus(el: HTMLElement): void {
  el.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
}

/** The left button going down at a viewport point over `el`. */
export function mouseDownAt(el: Element, clientX: number, clientY: number): void {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true, cancelable: true, button: 0, buttons: 1, clientX, clientY }));
}

/** The pointer moving to a viewport point with the left button held, as the frame's document sees it. */
export function mouseMoveTo(doc: Document, clientX: number, clientY: number): void {
  doc.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX, clientY }));
}
