/**
 * DOM rules of the keyboard engine: typing targets, modal isolation and floating layers, across open shadow roots
 * (Spaces render in a Shadow DOM inside the Portal).
 */

/** Inputs that take no text: keys pass through them. */
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'reset', 'submit']);

function isElement(value: unknown): value is Element {
  return !!value && typeof (value as Element).matches === 'function';
}

/** The real target, inside shadow roots. */
export function eventTarget(event: Event): Element | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  const first = path.find(isElement);
  if (first) return first;
  return isElement(event.target) ? event.target : null;
}

/** `closest` that crosses shadow boundaries. */
export function closestComposed(element: Element | null, selector: string): Element | null {
  let current: Element | null = element;
  while (current) {
    const found = current.closest(selector);
    if (found) return found;
    const root = current.getRootNode();
    current = 'host' in root ? (root as ShadowRoot).host : null;
  }
  return null;
}

/** `contains` across shadow boundaries: `element` is `container` or sits inside it, maybe in a nested shadow root. */
export function containsComposed(container: Element | null, element: Element | null): boolean {
  let current: Element | null = element;
  while (current && container) {
    if (container.contains(current)) return true;
    const root = current.getRootNode();
    current = 'host' in root ? (root as ShadowRoot).host : null;
  }
  return false;
}

/** A text field owns its keys (and its Escape). */
export function isTextEntry(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has(((element as HTMLInputElement).type || 'text').toLowerCase());
  if ((element as HTMLElement).isContentEditable) return true;
  return closestComposed(element,
    '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], [role="combobox"], [role="searchbox"]') !== null;
}

/**
 * A text field owns its Escape, except inside a toolkit floating layer (Popover, Menu mark `data-notis-floating`):
 * there Escape closes the layer, unless the field has its own open list (`aria-expanded="true"`).
 */
export function fieldOwnsEscape(element: Element | null): boolean {
  if (!element || !isTextEntry(element)) return false;
  if (!closestComposed(element, '[data-notis-floating]')) return true;
  return element.getAttribute('aria-expanded') === 'true';
}

/** Inside an open menu or listbox: its own keys move through it. */
export function isInsideOpenMenu(element: Element | null): boolean {
  if (!element) return false;
  const menu = closestComposed(element, '[role="menu"], [role="listbox"], [role="menubar"]');
  // A listbox the engine itself drives (ListReader, useListKeys) keeps J/K/E alive while a row has focus.
  if (!menu || menu.hasAttribute('data-notis-engine-list')) return false;
  const state = menu.getAttribute('data-state');
  return state !== 'closed';
}

/** Typing rule (toolkit spec 2.1). Buttons and links do not block. */
export function blocksShortcuts(element: Element | null, options: { inFields: boolean; modal: boolean }): boolean {
  if (options.inFields) return false;
  if (isTextEntry(element)) return true;
  if (!options.modal && isInsideOpenMenu(element)) return true;
  return false;
}

/** Enter and Space on a control press the control, not a shortcut. */
export function isActivatable(element: Element | null): boolean {
  return closestComposed(element,
    'button, a[href], [role="button"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], summary, input[type="checkbox"], input[type="radio"]') !== null;
}

/** Arrows inside these move the control itself. */
export function ownsArrows(element: Element | null): boolean {
  return closestComposed(element,
    'input[type="range"], [role="slider"], [role="tablist"], [role="radiogroup"], [role="spinbutton"], [role="separator"][tabindex], [role="tree"], [role="grid"]') !== null;
}

/** Elements opt out of every engine key with `data-notis-keys="off"`. */
export function keysOff(element: Element | null): boolean {
  return closestComposed(element, '[data-notis-keys="off"]') !== null;
}

/** Visible without layout: no hidden, inert, aria-hidden, display none or visibility hidden up the composed tree. */
export function isVisibleComposed(element: Element | null): boolean {
  if (!element?.isConnected) return false;
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute('hidden') || current.hasAttribute('inert') || current.getAttribute('aria-hidden') === 'true') return false;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    const root: Node = current.getRootNode();
    current = current.parentElement ?? ('host' in root ? (root as ShadowRoot).host : null);
  }
  return true;
}

/** The document and every open shadow root inside it, recursively. */
export function collectRoots(doc: Document): Array<Document | ShadowRoot> {
  const roots: Array<Document | ShadowRoot> = [doc];
  const visit = (root: Document | ShadowRoot) => {
    const walker = doc.createTreeWalker(root, 1 /* NodeFilter.SHOW_ELEMENT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const shadow = (node as Element).shadowRoot;
      if (shadow) { roots.push(shadow); visit(shadow); }
    }
  };
  visit(doc);
  return roots;
}

function queryAllComposed(doc: Document, selector: string, event?: Event): Element[] {
  const found = new Set<Element>();
  for (const root of collectRoots(doc)) for (const el of root.querySelectorAll(selector)) found.add(el);
  if (event && typeof event.composedPath === 'function') {
    for (const target of event.composedPath()) if (isElement(target) && target.matches(selector)) found.add(target);
  }
  return [...found];
}

/** Open dialogs and menus that isolate keys to the modal scope. `data-notis-nonmodal` opts a popover out. */
const MODAL_LAYER = [
  '[role="dialog"][aria-modal="true"]',
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"]:not([data-state="closed"])',
  'dialog.notis-dialog[open]',
  'dialog[open][aria-modal="true"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
].join(', ');

export function openModalLayers(doc: Document, event?: Event): Element[] {
  return queryAllComposed(doc, MODAL_LAYER, event)
    .filter((el) => !el.closest('[data-notis-nonmodal]') && isVisibleComposed(el));
}

export function hasOpenModal(doc: Document, event?: Event): boolean {
  return openModalLayers(doc, event).length > 0;
}

/** The open modal layer `element` sits in (a dialog, menu or listbox), across shadow roots; null on the page. */
export function modalLayerOf(element: Element | null): Element | null {
  let current: Element | null = element;
  while (current) {
    const layer = closestComposed(current, MODAL_LAYER);
    if (!layer) return null;
    if (!layer.closest('[data-notis-nonmodal]')) return layer;
    // A non-modal popover leaves keys alone: look above it.
    const root = layer.getRootNode();
    current = layer.parentElement ?? ('host' in root ? (root as ShadowRoot).host : null);
  }
  return null;
}

/** Floating layers that handle Escape themselves (Radix, native dialogs). Toolkit layers mark `data-notis-escape-owned`. */
const FLOATING_LAYER = 'dialog[open], [role="dialog"]:not([data-state="closed"]), '
  + '[role="alertdialog"]:not([data-state="closed"]), [role="menu"]:not([data-state="closed"])';

export function foreignFloatingLayers(doc: Document, event?: Event): Element[] {
  return queryAllComposed(doc, FLOATING_LAYER, event)
    .filter((el) => !el.closest('[data-notis-escape-owned]') && isVisibleComposed(el));
}
