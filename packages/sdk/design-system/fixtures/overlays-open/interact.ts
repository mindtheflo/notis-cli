/**
 * Interaction steps for the overlay specimens. Triggers sit in the state root; menus, popovers and tips portal into a
 * layer root in the frame's shadow root (or a pinned root), so lookups for them search the root's shadow root.
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

/** Waits `ms` of real time (the frame fixes the clock, not timers). */
export function pause(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
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

/** A pointer click (detail 1), as a mouse press sends it: a menu opens with its panel focused. */
export async function pointerClick(el: HTMLElement): Promise<void> {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, detail: 1 }));
  await settle();
}

/** Keyboard focus with a visible focus ring, where the browser supports asking for one. */
export function keyboardFocus(el: HTMLElement): void {
  el.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
}

/** A keyboard open: focus the trigger, then ArrowDown (a menu then focuses its first item). */
export async function keyboardOpen(el: HTMLElement): Promise<void> {
  keyboardFocus(el);
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, composed: true, cancelable: true }));
  await settle(4);
}

/** The mouse moving onto `el` (React's pointer enter comes from pointerover). */
export function hover(el: HTMLElement): void {
  const init = { bubbles: true, composed: true, pointerType: 'mouse', isPrimary: true };
  el.dispatchEvent(new PointerEvent('pointerover', init));
  el.dispatchEvent(new PointerEvent('pointermove', init));
}

/** Clicks the trigger found by `selector` in the state root and waits for the overlay `expect` in the layer scope. */
export async function openFrom(root: HTMLElement, selector: string, expect: string): Promise<HTMLElement> {
  const trigger = await waitFor<HTMLElement>(root, selector);
  await pointerClick(trigger);
  return waitFor<HTMLElement>(layerScope(root), expect);
}
