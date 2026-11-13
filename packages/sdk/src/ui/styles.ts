/**
 * One toolkit stylesheet for the document and every Space shadow root (toolkit spec 1.4.7).
 *
 * The host registers the text of `@notis/sdk/toolkit.css` once (`registerToolkitStyles`), and `adoptToolkitStyles(root)`
 * appends the same CSSStyleSheet to `adoptedStyleSheets` of each root. Nothing is adopted before the host registers:
 * the SDK never looks for the sheet among the page's own stylesheets, because a host that bundles its CSS would hand
 * over its whole merged stylesheet instead of the toolkit.
 */

const STYLE_ATTRIBUTE = 'data-notis-toolkit-styles';

/**
 * The cascade layer the toolkit sits in inside a Space shadow root. It comes after Tailwind 4's preflight (`base`) and
 * before its `utilities`, so a Space's utilities and its own CSS override a toolkit piece (`hidden sm:flex`, `px-6`)
 * the way they override any element, while preflight never reaches it. The SDK shell (`styles.css`) sits just before.
 */
export const TOOLKIT_CASCADE_LAYER = 'components.notis-toolkit';
/**
 * How the toolkit joins a root's cascade. `layered` (the default): in TOOLKIT_CASCADE_LAYER. `unlayered`: as plain
 * rules, for a Space built with Tailwind 3, whose preflight is unlayered and would otherwise reset toolkit buttons.
 */
export type ToolkitCascade = 'layered' | 'unlayered';

let registeredText: string | null = null;
const sheets: Record<ToolkitCascade, CSSStyleSheet | null> = { layered: null, unlayered: null };

function canConstruct(): boolean {
  try {
    return typeof CSSStyleSheet !== 'undefined' && typeof new CSSStyleSheet().replaceSync === 'function';
  } catch {
    return false;
  }
}

/**
 * The toolkit text inside its layer. The order statements come first so the layers keep their places whichever
 * stylesheet of the root declares them first (Tailwind 4's full order, then the SDK shell before the toolkit).
 */
function layeredText(text: string): string {
  return `@layer properties, theme, base, components, utilities;\n@layer components.notis-sdk, ${TOOLKIT_CASCADE_LAYER};\n`
    + `@layer ${TOOLKIT_CASCADE_LAYER} {\n${text}\n}\n`;
}

function cascadeText(cascade: ToolkitCascade): string | null {
  if (registeredText === null) return null;
  return cascade === 'layered' ? layeredText(registeredText) : registeredText;
}

/**
 * The cascade a Space's own compiled CSS needs: `unlayered` for Tailwind 3 output (its banner, or `--tw-` rules with
 * no Tailwind 4 `base` or `utilities` layer block; the SDK stylesheet's order statement and its own sublayer do not
 * count), else `layered`.
 */
export function toolkitCascadeFor(css: string | null | undefined): ToolkitCascade {
  if (!css) return 'layered';
  if (/tailwindcss v3\./i.test(css)) return 'unlayered';
  return css.includes('--tw-') && !/@layer\s+(?:base|utilities)\s*\{/.test(css) ? 'unlayered' : 'layered';
}

/** Registers the toolkit stylesheet: its CSS text, or an already built sheet. Later roots adopt this one. */
export function registerToolkitStyles(source: string | CSSStyleSheet): void {
  sheets.layered = null;
  sheets.unlayered = null;
  registeredText = typeof source === 'string' ? source : sheetText(source);
  if (typeof source !== 'string' && registeredText === null) sheets.unlayered = source;
}

function sheetText(sheet: CSSStyleSheet): string | null {
  try {
    return Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
  } catch {
    // A cross-origin sheet hides its rules.
    return null;
  }
}

/** The registered toolkit CSS text, as registered (no layer); null until the host registers it. */
export function getToolkitStyleText(): string | null {
  return registeredText;
}

/** The shared sheet for a cascade; null without constructable stylesheets or until the host registers the CSS. */
export function getToolkitStyleSheet(cascade: ToolkitCascade = 'layered'): CSSStyleSheet | null {
  if (sheets[cascade]) return sheets[cascade];
  const text = cascadeText(cascade);
  if (text === null || !canConstruct()) return null;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  sheets[cascade] = sheet;
  return sheet;
}

export interface AdoptToolkitOptions {
  /** Default `layered`; pass `toolkitCascadeFor(spaceCss)` when the Space's CSS is known. */
  cascade?: ToolkitCascade;
}

/**
 * Adds the registered toolkit sheet to a document or shadow root, once. Without constructable stylesheets the root
 * gets one `<style>` element instead. Adopting again with the other cascade swaps the sheet in place. Returns false,
 * and adds nothing, while the host has not registered the CSS.
 */
export function adoptToolkitStyles(root: Document | ShadowRoot, options: AdoptToolkitOptions = {}): boolean {
  const cascade = options.cascade ?? 'layered';
  const other: ToolkitCascade = cascade === 'layered' ? 'unlayered' : 'layered';
  // A cross-origin sheet registered as a sheet has no text to layer: it is adopted as it is.
  const sheet = getToolkitStyleSheet(cascade) ?? (registeredText === null ? sheets.unlayered : null);
  if (sheet && 'adoptedStyleSheets' in root) {
    const current = root.adoptedStyleSheets;
    if (current.includes(sheet)) return true;
    const stale = sheets[other];
    const index = stale ? current.indexOf(stale) : -1;
    root.adoptedStyleSheets = index >= 0 ? current.map((value, at) => (at === index ? sheet : value)) : [...current, sheet];
    return true;
  }
  const text = cascadeText(cascade);
  if (!text) return false;
  const host = root instanceof Document ? root.head : root;
  const existing = host.querySelector<HTMLStyleElement>(`style[${STYLE_ATTRIBUTE}]`);
  if (existing) {
    if (existing.getAttribute(STYLE_ATTRIBUTE) !== cascade) {
      existing.setAttribute(STYLE_ATTRIBUTE, cascade);
      existing.textContent = text;
    }
    return true;
  }
  const ownerDocument = root instanceof Document ? root : root.ownerDocument;
  const style = ownerDocument.createElement('style');
  style.setAttribute(STYLE_ATTRIBUTE, cascade);
  style.textContent = text;
  host.appendChild(style);
  return true;
}

/** Test hook: forget the registered sheet. */
export function resetToolkitStylesForTests(): void {
  registeredText = null;
  sheets.layered = null;
  sheets.unlayered = null;
}
