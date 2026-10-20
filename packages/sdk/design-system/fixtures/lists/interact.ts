/**
 * Interaction steps for the list specimens. Rows, bars and toasts sit in the state root; menus and tooltips portal
 * into a layer root in the frame's shadow root, so lookups for them search the root's shadow root.
 */
import { nextFrame } from '../../specimen';

/** The frame's state root pads 24px on every side: content of a state `height` px tall is `height - FRAME_PAD`. */
export const FRAME_PAD = 48;

/** The content height inside a state of `height` px. */
export function inner(height: number): number {
  return height - FRAME_PAD;
}

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

/** A pointer click (detail 1), as a mouse press sends it. */
export async function pointerClick(el: HTMLElement): Promise<void> {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, detail: 1 }));
  await settle();
}

/** Waits for `selector` under the state root, then clicks it like a mouse. */
export async function clickIn(root: HTMLElement, selector: string): Promise<void> {
  await pointerClick(await waitFor<HTMLElement>(root, selector));
}

/** Waits for an open menu in the layer root. */
export async function waitForMenu(root: HTMLElement): Promise<HTMLElement> {
  return waitFor<HTMLElement>(layerScope(root), '[role="menu"]');
}

/** Hovers an element so its tooltip opens (pointer enter and move, as a mouse sends them). */
export async function hover(el: HTMLElement): Promise<void> {
  for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove']) {
    const Ctor = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, { bubbles: !type.endsWith('enter'), composed: true, cancelable: true, pointerType: 'mouse' } as PointerEventInit));
  }
  await settle();
}
