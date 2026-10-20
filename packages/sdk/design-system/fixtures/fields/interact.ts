/**
 * Interaction steps for the field specimens. Triggers sit in the state root; menus and popovers portal into the frame's
 * layer root, outside the state root, so lookups for them go through the root's shadow root (or document).
 */
import { nextFrame } from '../../specimen';

/** Where portaled layers land: the state root's shadow root, else its document. */
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

/** Waits up to `frames` animation frames until `ready` holds. */
export async function until(ready: () => boolean, frames = 180): Promise<void> {
  for (let i = 0; i < frames && !ready(); i += 1) await nextFrame();
}

/** A pointer click (detail 1), as a mouse press sends it. */
export async function pointerClick(el: HTMLElement): Promise<void> {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, detail: 1 }));
  await settle();
}

/** Clicks the `index`th field trigger of the state and waits for the overlay `expect` (a menu or a popover). */
export async function openField(root: HTMLElement, expect: string, index = 0): Promise<HTMLElement> {
  await waitFor(root, 'button.nui-field-trigger');
  const trigger = root.querySelectorAll<HTMLElement>('button.nui-field-trigger')[index];
  if (!trigger) throw new Error(`No field trigger at ${index}`);
  await pointerClick(trigger);
  return waitFor<HTMLElement>(layerScope(root), expect);
}

/** Types `text` into an input as a person would (React reads the native value setter). */
export async function typeInto(input: HTMLInputElement, text: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await settle();
}

/** Presses Enter in `el`. */
export async function pressEnter(el: HTMLElement): Promise<void> {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, composed: true, cancelable: true }));
  await settle();
}

/** Keyboard focus with a visible focus ring, where the browser supports asking for one. */
export function keyboardFocus(el: HTMLElement): void {
  el.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
}
