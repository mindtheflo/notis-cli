/**
 * Interaction steps for the documents specimens: open a dialog from its trigger, type into the Markdown editor
 * fallback, press Cmd+S, click a button. Everything renders inside the state root (a native dialog sits in the
 * top layer but stays in the tree), so lookups search the root.
 */
import { nextFrame } from '../../specimen';

/** Lets effects, layout and the top layer settle. */
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

/** A pointer click on the element `selector` finds under `root`. */
export async function clickOn(root: ParentNode, selector: string): Promise<HTMLElement> {
  const el = await waitFor<HTMLElement>(root, selector);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, detail: 1 }));
  await settle();
  return el;
}

/** Clicks the trigger `selector`, then waits for the open native dialog. */
export async function openDialog(root: HTMLElement, selector = '[data-ds-open-dialog]'): Promise<HTMLDialogElement> {
  await clickOn(root, selector);
  const dialog = await waitFor<HTMLDialogElement>(root, 'dialog[open]');
  await settle(4);
  return dialog;
}

/** Types `text` at the end of a textarea or input as a person would: React sees one input event. */
export async function typeInto(el: HTMLTextAreaElement | HTMLInputElement, text: string): Promise<void> {
  el.focus({ preventScroll: true });
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const next = `${el.value}${text}`;
  if (setter) setter.call(el, next); else el.value = next;
  el.setSelectionRange(next.length, next.length);
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await settle();
}

/** Cmd+S on `el` (the Markdown editor saves on it). */
export async function pressSave(el: HTMLElement): Promise<void> {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', metaKey: true, bubbles: true, composed: true, cancelable: true }));
  await settle(4);
}
