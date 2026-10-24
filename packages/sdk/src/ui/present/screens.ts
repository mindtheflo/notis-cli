/**
 * Pure helpers of the second-screen presenter: is a second screen there, which one shows the audience, where its
 * window opens, which key does what and how the page's styles reach the audience window.
 */

import type { NotisHtmlFramePresentAction } from '../../runtime';

export type PresentAction = NotisHtmlFramePresentAction;

/** The window name of the audience window. Electron recognises it and fills the other display. */
export const AUDIENCE_WINDOW_NAME = 'notis-presenter-audience';

/** The part of a ScreenDetailed (Window Management API) the presenter reads. */
export type ScreenArea = {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  isInternal?: boolean;
  isPrimary?: boolean;
  label?: string;
};

/** True when the desktop spans more than one screen. Chrome and Electron tell without asking; others say no. */
export function hasSecondScreen(win: Window | undefined): boolean {
  const screen = win?.screen as (Screen & { isExtended?: boolean }) | undefined;
  return screen?.isExtended === true;
}

function sameArea(a: ScreenArea, b: ScreenArea): boolean {
  return a.availLeft === b.availLeft && a.availTop === b.availTop && a.availWidth === b.availWidth && a.availHeight === b.availHeight;
}

/** The screen for the audience: never the current one, an external screen first, then the largest. */
export function pickAudienceScreen(screens: readonly ScreenArea[], current: ScreenArea | null | undefined): ScreenArea | null {
  const others = screens.filter((screen) => !(current && (screen === current || sameArea(screen, current))));
  if (others.length === 0) return null;
  return [...others].sort((a, b) => {
    const external = Number(a.isInternal === true) - Number(b.isInternal === true);
    return external !== 0 ? external : b.availWidth * b.availHeight - a.availWidth * a.availHeight;
  })[0];
}

/** `window.open` features placing the audience window over the whole of a screen, or a plain window without one. */
export function audienceFeatures(screen: ScreenArea | null): string {
  if (!screen) return 'popup,width=960,height=540';
  const { availLeft: left, availTop: top, availWidth: width, availHeight: height } = screen;
  return `popup,left=${Math.round(left)},top=${Math.round(top)},width=${Math.round(width)},height=${Math.round(height)}`;
}

/** The same keys as a presented HtmlFrame (portal htmlFramePresentation RELAY). */
const KEY_ACTIONS: Readonly<Record<string, PresentAction>> = Object.freeze({
  ArrowRight: 'next', ArrowDown: 'next', PageDown: 'next', ' ': 'next', Enter: 'next',
  ArrowLeft: 'previous', ArrowUp: 'previous', PageUp: 'previous',
  Home: 'first', End: 'last', Escape: 'stop',
});

const FIELD = 'input,textarea,select,[contenteditable=""],[contenteditable="true"]';
const ACTIVE = 'a[href],button,label,summary,details,video,audio,[role=button],[role=link],[role=tab],[onclick],[tabindex]';

function inside(target: EventTarget | null, selector: string): boolean {
  const element = target as Element | null;
  return Boolean(element && typeof element.closest === 'function' && element.closest(selector));
}

/** The action of a key press in the audience window, or null when the key is not one or belongs to a field. */
export function keyAction(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'defaultPrevented' | 'target'>): PresentAction | null {
  const action = KEY_ACTIONS[event.key];
  if (!action || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return null;
  if (inside(event.target, FIELD)) return null;
  if ((event.key === ' ' || event.key === 'Enter') && inside(event.target, ACTIVE)) return null;
  return action;
}

/** True when a click lands on something of its own (a field, a button, a link) rather than on the slide. */
export function clickHasOwnTarget(target: EventTarget | null): boolean {
  return inside(target, FIELD) || inside(target, ACTIVE);
}

/** Fullscreen, or a borderless full-size desktop window. A large browser popup can still have a URL bar. */
export function fillsScreen(win: Window): boolean {
  if (win.document.fullscreenElement) return true;
  const { width, height } = win.screen;
  return width > 0 && height > 0 && win.innerWidth >= width - 1 && win.innerHeight >= height - 1
    && win.outerWidth > 0 && win.outerHeight > 0
    && Math.abs(win.outerWidth - win.innerWidth) <= 1 && Math.abs(win.outerHeight - win.innerHeight) <= 1;
}

/** Inline sheets lose their original URL base. Keep asset and import addresses relative to that sheet. */
function resolveSheetUrls(css: string, base: string): string {
  const decode = (value: string) => value.replace(/\\([\da-f]{1,6}\s?|\r\n|[\n\r\f]|[^\n\r\f])/gi, (_, escape: string) => {
    if (/^[\da-f]/i.test(escape)) {
      const point = parseInt(escape.trim(), 16);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '\ufffd';
    }
    return /^[\n\r\f]/.test(escape) ? '' : escape;
  });
  // Consume comments and ordinary strings too: a content string containing "url(...)" is not an asset.
  return css.replace(/\/\*[\s\S]*?\*\/|url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|((?:\\.|[^)\\])*))\s*\)|@import\s+(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi,
    (token, double, single, bare, importDouble, importSingle) => {
      const value = double ?? single ?? bare?.trim() ?? importDouble ?? importSingle;
      if (value === undefined) return token;
      const decoded = decode(value);
      if (decoded.startsWith('#')) return token;
      try {
        const url = JSON.stringify(new URL(decoded, base).href);
        return importDouble !== undefined || importSingle !== undefined ? `@import ${url}` : `url(${url})`;
      } catch { return token; }
    });
}

function sheetText(sheet: CSSStyleSheet | null): string | null {
  if (!sheet) return null;
  try {
    const text = Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
    return sheet.href ? resolveSheetUrls(text, sheet.href) : text;
  } catch {
    return null;
  }
}

function copyNodes(target: Document, source: ParentNode): void {
  for (const node of Array.from(source.querySelectorAll('link[rel~="stylesheet"],style'))) {
    const sheetNode = node as HTMLLinkElement | HTMLStyleElement;
    if (sheetNode.disabled || sheetNode.sheet?.disabled) continue;
    const text = sheetText(sheetNode.sheet);
    let copy: HTMLLinkElement | HTMLStyleElement;
    if (node.localName === 'link' && text === null) {
      const link = target.createElement('link');
      link.rel = 'stylesheet';
      // The resolved address: a relative one would resolve against the audience window.
      link.href = (node as HTMLLinkElement).href;
      copy = link;
    } else {
      // Reuse the loaded rules. A Space's signed stylesheet URL may have expired since it opened.
      // CSSOM rules also include insertRule updates that are absent from a style node's textContent.
      const style = target.createElement('style');
      style.textContent = text ?? node.textContent;
      copy = style;
    }
    const media = node.getAttribute('media');
    if (media) copy.media = media;
    target.head.append(copy);
  }
}

function copyAdopted(target: Document, sheets: readonly CSSStyleSheet[] | undefined): void {
  for (const sheet of sheets ?? []) {
    if (sheet.disabled) continue;
    const text = sheetText(sheet);
    if (!text) continue;
    const style = target.createElement('style');
    style.textContent = text;
    target.head.append(style);
  }
}

/**
 * Copy the page's styles into the audience window: the document's loaded rules (links only when unreadable), then
 * those of the Space's shadow root (its bundle and the toolkit). Constructed sheets cannot move between documents, so
 * they are copied as text. The `<html>` class and style (light or dark) come along.
 */
export function copyStylesInto(target: Document, source: Document, shadowRoot?: ShadowRoot | null): void {
  copyNodes(target, source);
  copyAdopted(target, (source as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets);
  if (shadowRoot) {
    copyNodes(target, shadowRoot);
    copyAdopted(target, (shadowRoot as ShadowRoot & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets);
  }
  const from = source.documentElement;
  const to = target.documentElement;
  if (from.className) to.className = from.className;
  const style = from.getAttribute('style');
  if (style) to.setAttribute('style', style);
  else to.removeAttribute('style');
}
