/**
 * Interaction steps for the date specimens. Popovers portal into the frame's layer root, outside the state root,
 * so lookups go through the root's shadow root (or document) rather than the state root alone.
 */
import { nextFrame } from '../../specimen';

/** Where portaled layers land: the state root's shadow root, else its document. */
export function layerScope(root: HTMLElement): ParentNode {
  const node = root.getRootNode();
  return node instanceof ShadowRoot || node instanceof Document ? node : root.ownerDocument;
}

/** Waits up to `frames` animation frames for `selector` under `scope`. */
export async function waitFor<E extends Element = HTMLElement>(scope: ParentNode, selector: string, frames = 90): Promise<E> {
  for (let i = 0; i < frames; i += 1) {
    const el = scope.querySelector<E>(selector);
    if (el) return el;
    await nextFrame();
  }
  throw new Error(`Not found after ${frames} frames: ${selector}`);
}

/** Clicks the first match of `selector` under `scope` once it is there, then lets React settle. */
export async function clickWhenReady(scope: ParentNode, selector: string): Promise<void> {
  const el = await waitFor<HTMLElement>(scope, selector);
  el.click();
  await nextFrame();
  await nextFrame();
}

/** Lets effects, layout and portals settle. */
export async function settle(frames = 3): Promise<void> {
  for (let i = 0; i < frames; i += 1) await nextFrame();
}
