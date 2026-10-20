/**
 * One toolkit stylesheet for the document and every Space shadow root (toolkit spec 1.4.7).
 *
 * The host registers the text of `@notis/sdk/toolkit.css` once (`registerToolkitStyles`), and `adoptToolkitStyles(root)`
 * appends the same CSSStyleSheet to `adoptedStyleSheets` of each root. Nothing is adopted before the host registers:
 * the SDK never looks for the sheet among the page's own stylesheets, because a host that bundles its CSS would hand
 * over its whole merged stylesheet instead of the toolkit.
 */

const STYLE_ATTRIBUTE = 'data-notis-toolkit-styles';

let registeredText: string | null = null;
let constructed: CSSStyleSheet | null = null;

function canConstruct(): boolean {
  try {
    return typeof CSSStyleSheet !== 'undefined' && typeof new CSSStyleSheet().replaceSync === 'function';
  } catch {
    return false;
  }
}

/** Registers the toolkit stylesheet: its CSS text, or an already built sheet. Later roots adopt this one. */
export function registerToolkitStyles(source: string | CSSStyleSheet): void {
  if (typeof source === 'string') {
    registeredText = source;
    constructed = null;
    if (canConstruct()) {
      constructed = new CSSStyleSheet();
      constructed.replaceSync(source);
    }
    return;
  }
  constructed = source;
  registeredText = sheetText(source);
}

function sheetText(sheet: CSSStyleSheet): string | null {
  try {
    return Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
  } catch {
    // A cross-origin sheet hides its rules.
    return null;
  }
}

/** The registered toolkit CSS text; null until the host registers it. */
export function getToolkitStyleText(): string | null {
  return registeredText;
}

/** The shared sheet; null without constructable stylesheets or until the host registers the CSS. */
export function getToolkitStyleSheet(): CSSStyleSheet | null {
  return constructed;
}

/**
 * Adds the registered toolkit sheet to a document or shadow root, once. Without constructable stylesheets the root
 * gets one `<style>` element instead. Returns false, and adds nothing, while the host has not registered the CSS.
 */
export function adoptToolkitStyles(root: Document | ShadowRoot): boolean {
  const sheet = getToolkitStyleSheet();
  if (sheet && 'adoptedStyleSheets' in root) {
    const current = root.adoptedStyleSheets;
    if (!current.includes(sheet)) root.adoptedStyleSheets = [...current, sheet];
    return true;
  }
  const text = getToolkitStyleText();
  if (!text) return false;
  const host = root instanceof Document ? root.head : root;
  if (host.querySelector(`style[${STYLE_ATTRIBUTE}]`)) return true;
  const ownerDocument = root instanceof Document ? root : root.ownerDocument;
  const style = ownerDocument.createElement('style');
  style.setAttribute(STYLE_ATTRIBUTE, '');
  style.textContent = text;
  host.appendChild(style);
  return true;
}

/** Test hook: forget the registered sheet. */
export function resetToolkitStylesForTests(): void {
  registeredText = null;
  constructed = null;
}
