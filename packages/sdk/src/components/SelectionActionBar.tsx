'use client';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useToolkitLocale } from '../ui/engine/hooks';
import type { Words } from '../words/types';

/**
 * The floating bar on selected text (truths PRT-087, PRT-090, PRT-094): one dark labelled pill at the end of the
 * selection, with Cite and, where a surface takes comments, Comment. Chat, every Space view, Skills and automations
 * draw the same bar; each surface decides what Cite quotes and where the quote goes.
 */

/** Cmd+Shift+C (Ctrl+Shift+C off a Mac) cites the selection: the host dispatches this on the document, and the bar on screen answers. */
export const CITE_SELECTION_EVENT = 'notis:cite-selection';

export const SELECTION_BAR_WORDS = Object.freeze({
  cite: Object.freeze({ en: 'Cite', fr: 'Citer' }),
  citeHint: Object.freeze({ en: 'Cite in chat', fr: 'Citer dans le chat' }),
  comment: Object.freeze({ en: 'Comment', fr: 'Commenter' }),
}) satisfies Readonly<Record<string, Words>>;

export interface SelectionBarAction {
  key: string;
  label: string;
  title?: string;
  icon: ReactNode;
  onSelect(): void;
}

export interface SelectionAnchor {
  top: number;
  left: number;
  /** The selected text, trimmed. */
  text: string;
  /** A copy of the selected range, still valid after the browser collapses the live selection. */
  range: Range;
}

type Rect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
const GAP = 8;
const TOUCH_GAP = 14;

/**
 * Where the bar goes: after the last selected line when it fits there and no text follows on that line, otherwise
 * just below where the selection ends (above it near the bottom of the viewport). On a touch screen it always goes
 * below, so the system's own Copy menu keeps the space above the selection.
 */
export function getSelectionBarPosition(
  rects: Rect[],
  viewport: { width: number; height: number },
  bar: { width: number; height: number },
  options: { rightBoundary?: number; trailing?: Rect[]; coarse?: boolean } = {},
): { top: number; left: number } {
  const last = rects[rects.length - 1];
  const { width, height } = bar;
  const rightBoundary = options.rightBoundary ?? viewport.width;
  const clampX = (x: number) => Math.max(GAP, Math.min(viewport.width - width - GAP, x));
  const clampY = (y: number) => Math.max(GAP, Math.min(viewport.height - height - GAP, y));
  if (!options.coarse) {
    const beside = { left: last.right + GAP, top: clampY((last.top + last.bottom - height) / 2) };
    const overlapsText = (options.trailing ?? []).some(rect => rect.left < beside.left + width && rect.right > beside.left
      && rect.top < beside.top + height && rect.bottom > beside.top);
    if (beside.left + width <= Math.min(viewport.width, rightBoundary) - GAP && !overlapsText) return beside;
  }
  const gap = options.coarse ? TOUCH_GAP : GAP;
  const below = last.bottom + gap;
  const left = clampX(options.coarse ? (last.left + last.right - width) / 2 : last.right - width);
  return { left, top: clampY(below + height <= viewport.height - GAP ? below : last.top - height - gap) };
}

function isCoarsePointer(view: Window | null): boolean {
  return Boolean(view?.matchMedia?.('(pointer: coarse)').matches);
}

// Where a selection may not start or end: fields, editable text and the bar itself.
const EDITABLE = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[data-notis-selection-ui]';

/** The live selection's ends, to tell when it moved away from what the bar shows. */
type Ends = { startContainer: Node; startOffset: number; endContainer: Node; endOffset: number };
function endsOf(range: Range): Ends {
  return { startContainer: range.startContainer, startOffset: range.startOffset, endContainer: range.endContainer, endOffset: range.endOffset };
}
function sameEnds(a: Ends, b: Ends): boolean {
  return a.startContainer === b.startContainer && a.startOffset === b.startOffset
    && a.endContainer === b.endContainer && a.endOffset === b.endOffset;
}

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
}

function selectionIn(node: Node): Selection | null {
  const scope = node.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null };
  return scope.getSelection?.() || node.ownerDocument?.defaultView?.getSelection() || null;
}

/**
 * The surface's box. A `display: contents` element draws none: its content's own box stands in when it draws one
 * (a boundary given a className), else the nearest ancestor that does.
 */
function boundsOf(node: HTMLElement): DOMRect {
  let element: Element = node;
  let box = element.getBoundingClientRect();
  for (let depth = 0; !box.width && element.firstElementChild && depth < 8; depth += 1) {
    const child = element.firstElementChild.getBoundingClientRect();
    if (child.width) return child;
    element = element.firstElementChild;
  }
  element = node;
  while (!box.width && element.parentElement) {
    element = element.parentElement;
    box = element.getBoundingClientRect();
  }
  return box;
}

export interface UseSelectionAnchorOptions {
  /** Off while the surface has nowhere to send a quote (a public Site, a chat that cannot send). */
  enabled?: boolean;
  /** Refuse a selection the surface does not quote (inside a nested surface with its own bar). */
  accept?(range: Range, root: HTMLElement): boolean;
  /** Clip the selection to the surface instead of refusing one that spills over its edge. */
  clip?(range: Range, root: HTMLElement): Range | null;
  /** The bar's size, measured once it shows; used to keep it inside the viewport. */
  barSize?: { width: number; height: number };
  /** More places a selection may not start or end in, on top of inputs and editable text (a CSS selector). */
  exclude?: string;
}

/**
 * Follows the text selected inside `root` and returns where the bar shows, or null. A mouse or keyboard selection
 * shows the bar when it ends (mouse up, Shift+arrow up); a touch selection once it has stopped moving.
 */
export function useSelectionAnchor(root: RefObject<HTMLElement | null>, options: UseSelectionAnchorOptions = {}) {
  const { enabled = true } = options;
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(null);
  const anchorRef = useRef<SelectionAnchor | null>(null);
  anchorRef.current = anchor;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const settle = useRef<number | undefined>(undefined);
  const pending = useRef<number | undefined>(undefined);
  // The live selection the shown bar was read from: a different one hides the bar until it is read again.
  const shownEnds = useRef<Ends | null>(null);

  const read = useCallback((): SelectionAnchor | null => {
    const node = root.current;
    if (!node) return null;
    const view = node.ownerDocument.defaultView;
    const selection = selectionIn(node);
    if (!selection?.rangeCount || selection.isCollapsed || !selection.toString().trim()) return null;
    const live = selection.getRangeAt(0);
    let range: Range | null = live.cloneRange();
    const clipped = !node.contains(range.startContainer) || !node.contains(range.endContainer);
    if (clipped) {
      // A selection in another tree (the page around a Space's shadow root) cannot be compared with this one.
      try { range = optionsRef.current.clip?.(range, node) ?? null; } catch { range = null; }
      if (!range) return null;
    }
    const start = elementOf(range.startContainer);
    const end = elementOf(range.endContainer);
    const excluded = optionsRef.current.exclude ? `${EDITABLE},${optionsRef.current.exclude}` : EDITABLE;
    if (start?.closest(excluded) || end?.closest(excluded)) return null;
    if (optionsRef.current.accept && !optionsRef.current.accept(range, node)) return null;
    // The range's own text: it is what the chat finds again when a quote link highlights the words.
    const text = range.toString().trim();
    if (!text) return null;
    const lines = Array.from(range.getClientRects?.() || []).filter(line => line.width > 0 && line.height > 0);
    const rect = range.getBoundingClientRect();
    const trailing: DOMRect[] = [];
    const endBlock = end?.closest('p,li,h1,h2,h3,h4,h5,h6,td,th,pre,blockquote,div');
    if (endBlock && node.contains(endBlock)) {
      const remainder = range.cloneRange();
      remainder.selectNodeContents(endBlock);
      remainder.setStart(range.endContainer, range.endOffset);
      if (remainder.toString().trim()) trailing.push(...Array.from(remainder.getClientRects?.() || []).filter(line => line.width > 0 && line.height > 0));
    }
    const bounds = boundsOf(node);
    const position = getSelectionBarPosition(lines.length ? lines : [rect],
      { width: view?.innerWidth ?? 1024, height: view?.innerHeight ?? 768 },
      optionsRef.current.barSize ?? { width: 80, height: 32 },
      { rightBoundary: bounds.width ? bounds.right : undefined, trailing, coarse: isCoarsePointer(view) });
    shownEnds.current = endsOf(live);
    return { ...position, text, range };
  }, [root]);

  const dismiss = useCallback(() => setAnchor(null), []);

  // The bar measured itself: place it again with its real width, so its edge lines up with the selection.
  const barWidth = options.barSize?.width;
  const barHeight = options.barSize?.height;
  useEffect(() => {
    // Read here, not inside the state updater: React may run an updater lazily or twice.
    if (!anchorRef.current) return;
    const next = read();
    setAnchor(current => current ? next : current);
  }, [barWidth, barHeight, read]);

  useEffect(() => {
    const node = root.current;
    if (!enabled || !node) { setAnchor(null); return; }
    const document = node.ownerDocument;
    const view = document.defaultView;
    const scope = node.getRootNode() as ShadowRoot | Document;
    // Cheap checks only while the selection moves: no layout until it is read again.
    const liveSelection = () => {
      const selection = selectionIn(node);
      const inside = (point: Node | null | undefined) => Boolean(point && node.contains(point));
      if (!selection?.rangeCount || selection.isCollapsed || !(inside(selection.anchorNode) || inside(selection.focusNode))) return null;
      return selection;
    };
    const capture = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[data-notis-selection-ui]')) return;
      // Let the browser finish the selection (a double click selects the word after mouseup).
      view?.clearTimeout(pending.current);
      pending.current = view?.setTimeout(() => setAnchor(read()), 0);
    };
    // Keys go to the focused element (often the page body), so a keyboard selection is followed on the document.
    const onKeyUp = (event: KeyboardEvent) => {
      if (!(event.shiftKey || event.key === 'Shift' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a'))) return;
      // Only a selection touching this surface (or a bar it shows) is worth reading: typing capitals elsewhere is not.
      if (!liveSelection() && !anchorRef.current) return;
      capture(event);
    };
    const onSelectionChange = () => {
      if (!isCoarsePointer(view)) {
        // A mouse or keyboard selection shows the bar when it ends (mouse up, key up). While it moves, the bar hides
        // as soon as the selection is gone or is no longer the one the bar was read from (a clipped one included).
        const current = selectionIn(node);
        const moved = !current?.rangeCount || current.isCollapsed || !shownEnds.current
          || !sameEnds(endsOf(current.getRangeAt(0)), shownEnds.current);
        if (moved) setAnchor(shown => shown ? null : shown);
        return;
      }
      const selection = liveSelection();
      // A touch selection has no mouse up: show the bar once its handles stop moving.
      view?.clearTimeout(settle.current);
      setAnchor(current => current ? null : current);
      if (!selection) return;
      settle.current = view?.setTimeout(() => setAnchor(read()), 450);
    };
    const onScroll = () => {
      if (!anchorRef.current) return;
      const next = read();
      setAnchor(current => current ? next : current);
    };
    node.addEventListener('mouseup', capture);
    node.addEventListener('dblclick', capture);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('selectionchange', onSelectionChange);
    if (scope !== document) scope.addEventListener('selectionchange', onSelectionChange);
    view?.addEventListener('scroll', onScroll, true);
    view?.addEventListener('resize', onScroll);
    return () => {
      view?.clearTimeout(settle.current);
      view?.clearTimeout(pending.current);
      node.removeEventListener('mouseup', capture);
      node.removeEventListener('dblclick', capture);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('selectionchange', onSelectionChange);
      if (scope !== document) scope.removeEventListener('selectionchange', onSelectionChange);
      view?.removeEventListener('scroll', onScroll, true);
      view?.removeEventListener('resize', onScroll);
    };
  }, [enabled, read, root]);

  return { anchor, dismiss, refresh: () => setAnchor(read()) };
}

/** Clears the page's selection once its text was cited, so the bar does not linger over it. */
export function clearSelectionIn(node: Node | null | undefined): void {
  if (node) selectionIn(node)?.removeAllRanges();
}

/**
 * The Cite action of a selection bar: the same words and glyph everywhere; it clears the selection and hides the bar
 * before handing over the cited text.
 */
export function citeSelectionAction(locale: keyof typeof SELECTION_BAR_WORDS.cite, anchor: SelectionAnchor,
  root: RefObject<HTMLElement | null>, dismiss: () => void, onCite: (range: Range, text: string) => void): SelectionBarAction {
  return {
    key: 'cite', label: SELECTION_BAR_WORDS.cite[locale], title: SELECTION_BAR_WORDS.citeHint[locale], icon: QUOTE_GLYPH,
    onSelect: () => {
      const { range, text } = anchor;
      clearSelectionIn(root.current);
      dismiss();
      onCite(range, text);
    },
  };
}

export interface CiteSelectionBarProps {
  /** The surface whose selected text Cite quotes. */
  root: RefObject<HTMLElement | null>;
  /** Receives the cited text once the bar has cleared the selection. */
  onCite(range: Range, text: string): void;
  enabled?: boolean;
  accept?: UseSelectionAnchorOptions['accept'];
  /**
   * Draws the bar somewhere other than beside the surface. The Portal's own pages hand the bar to a React portal on
   * the page body, out of a container that clips or transforms it. A Space view never gives one: a Notis app stays
   * inside its app surface, so its bar is drawn there, fixed to the viewport.
   */
  portal?(bar: ReactNode): ReactNode;
}

/**
 * The Cite-only bar every quoting surface shows (chat, Space views, Skills and automations; truth PRT-087): it follows
 * the selection in `root`, measures itself, and hands the cited text to `onCite`.
 */
export function CiteSelectionBar({ root, onCite, enabled = true, accept, portal }: CiteSelectionBarProps) {
  const locale = useToolkitLocale();
  const [barSize, setBarSize] = useState({ width: 72, height: 32 });
  const { anchor, dismiss } = useSelectionAnchor(root, { enabled, accept, barSize });
  if (!anchor) return null;
  const bar = <SelectionActionBar anchor={anchor} onSize={setBarSize} actions={[citeSelectionAction(locale, anchor, root, dismiss, onCite)]} />;
  return portal ? portal(bar) : bar;
}

export const QUOTE_GLYPH = <svg aria-hidden="true" width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M100,56H40A16,16,0,0,0,24,72v64a16,16,0,0,0,16,16h60v8a32,32,0,0,1-32,32,8,8,0,0,0,0,16,48.05,48.05,0,0,0,48-48V72A16,16,0,0,0,100,56Zm0,80H40V72h60ZM216,56H156a16,16,0,0,0-16,16v64a16,16,0,0,0,16,16h60v8a32,32,0,0,1-32,32,8,8,0,0,0,0,16,48.05,48.05,0,0,0,48-48V72A16,16,0,0,0,216,56Zm0,80H156V72h60Z" /></svg>;
export const COMMENT_GLYPH = <svg aria-hidden="true" width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M216,48H40A16,16,0,0,0,24,64V224a15.85,15.85,0,0,0,9.24,14.5A16.13,16.13,0,0,0,40,240a15.89,15.89,0,0,0,10.25-3.78l.09-.07L83,208H216a16,16,0,0,0,16-16V64A16,16,0,0,0,216,48ZM40,224h0ZM216,192H80a8,8,0,0,0-5.23,1.95L40,224V64H216ZM88,112a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H96A8,8,0,0,1,88,112Zm0,32a8,8,0,0,1,8-8h64a8,8,0,1,1,0,16H96A8,8,0,0,1,88,144Z" /></svg>;

const BAR_STYLE: React.CSSProperties = {
  position: 'fixed', zIndex: 60, display: 'inline-flex', alignItems: 'center', gap: 2, padding: 3, borderRadius: 999,
  background: 'hsl(var(--sidebar-background, 0 0% 7.5%))', color: 'hsl(var(--sidebar-foreground, 240 4.8% 95.9%))',
  boxShadow: '0 0 0 1px rgb(255 255 255 / 0.15), 0 6px 18px rgb(0 0 0 / 0.28)', colorScheme: 'dark',
  fontFamily: 'inherit', fontSize: 13, lineHeight: '18px', fontWeight: 500, whiteSpace: 'nowrap',
};

/**
 * The dark labelled pill itself. It never takes focus or moves the selection (mouse down is cancelled), and it
 * answers the Cite key while it shows: the first action is Cite.
 */
export function SelectionActionBar({ anchor, actions, onSize }: {
  anchor: Pick<SelectionAnchor, 'top' | 'left'>;
  actions: SelectionBarAction[];
  onSize?(size: { width: number; height: number }): void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const first = useRef(actions[0]);
  first.current = actions[0];
  const [left, setLeft] = useState(anchor.left);
  // A finger needs a bigger target than the 26 px a pointer gets.
  const coarse = typeof window !== 'undefined' && isCoarsePointer(window);
  useLayoutEffect(() => {
    const node = bar.current;
    const view = node?.ownerDocument.defaultView;
    if (!node || !view) { setLeft(anchor.left); return; }
    const width = node.offsetWidth;
    onSize?.({ width, height: node.offsetHeight });
    setLeft(Math.max(GAP, Math.min(view.innerWidth - width - GAP, anchor.left)));
  }, [anchor.left, anchor.top, onSize, actions.length]);
  useEffect(() => {
    const document = bar.current?.ownerDocument;
    if (!document) return;
    const onCite = (event: Event) => {
      if ((event as CustomEvent<{ handled?: boolean }>).detail?.handled) return;
      const detail = (event as CustomEvent<{ handled?: boolean }>).detail;
      if (detail) detail.handled = true;
      first.current?.onSelect();
    };
    document.addEventListener(CITE_SELECTION_EVENT, onCite);
    return () => document.removeEventListener(CITE_SELECTION_EVENT, onCite);
  }, []);
  return <div ref={bar} data-notis-selection-ui role="toolbar" style={{ ...BAR_STYLE, top: anchor.top, left }}
    onMouseDown={event => event.preventDefault()} onPointerDown={event => event.stopPropagation()}>
    {actions.map((action, index) => <React.Fragment key={action.key}>
      {index > 0 && <span aria-hidden="true" style={{ width: 1, height: 16, background: 'rgb(255 255 255 / 0.14)', margin: '0 1px' }} />}
      <button type="button" title={action.title ?? action.label} onClick={action.onSelect} data-selection-action={action.key}
        className="notis-selection-action"
        style={{ all: 'unset', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', gap: 6, height: coarse ? 36 : 26,
          padding: coarse ? '0 14px 0 12px' : '0 11px 0 9px', borderRadius: 999, cursor: 'pointer', background: index === 0 ? 'rgb(255 255 255 / 0.08)' : undefined }}>
        {action.icon}<span>{action.label}</span>
      </button>
    </React.Fragment>)}
  </div>;
}

/** Fires the Cite key: the bar on screen cites its selection. Returns whether one did. */
export function dispatchCiteSelection(document: Document): boolean {
  const detail = { handled: false };
  document.dispatchEvent(new CustomEvent(CITE_SELECTION_EVENT, { detail }));
  return detail.handled;
}
