'use client';
/**
 * Text comments on every Space page (SPC-118 text mode): Comment on selected words (the shared selection bar, next to
 * Cite) and the highlights of the page's open text comments. Both need the host comment store
 * (`runtime.spaceComments`, on while `unified_comments` is); without it the page shows Cite alone and no highlights.
 *
 * A text comment keeps its words with up to 40 characters before and after them. The highlights find those words
 * again in the page as it is now (white space ignored, the surrounding words telling apart several matches); words
 * that are gone are reported to the host (`passagesChanged`) and the thread card reads Passage changed. A thread is
 * never closed for it. A click on a highlight opens its thread in the host Comments panel (`revealComment`).
 *
 * Words inside a Space's own commentable text (`CommentableText`, `CommentableRichText`) keep their own Comment button
 * and their own highlights: the page bar offers Cite alone there, and comments on a named field are not drawn here.
 */

import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import type { NotisRuntime } from '../runtime';
import type { SpaceCommentAnchor, SpaceCommentRow, SpaceCommentsTransport } from '../space';
import { PASSAGE_COMMENT_EVENT, locatePassage, passageAt } from '../ui/comments/passageModel';
import { setChangedPassages } from '../ui/comments/textHighlights';

/** Text a passage is never read from: styles, scripts and the selection bar. */
const SKIP_TEXT = 'style, script, noscript, template, [data-notis-selection-ui], [data-notis-comment-skip]';
/** A Space's own commentable text: it has its own Comment button and highlights. */
export const OWN_PASSAGE_TEXT = '.nui-passage-text-field, .nui-passage-rich-text';
/** A Space's own commentable rich text: the page's selection bar offers Comment on it (SPC-487). */
const OWN_RICH_TEXT = '.nui-passage-rich-text';

export interface PageText { text: string; nodes: Array<{ node: Text; start: number }> }

/** The text of a page, in reading order, with where each text node starts in it. */
export function pageTextOf(root: Node): PageText {
  const owner = root.ownerDocument ?? (root as Document);
  const walker = owner.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: PageText['nodes'] = [];
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = (node as Text).parentElement;
    if (parent?.closest(SKIP_TEXT)) continue;
    nodes.push({ node: node as Text, start: text.length });
    text += (node as Text).data;
  }
  return { text, nodes };
}

/** Where a range boundary falls in the page text. */
function offsetOf(page: PageText, container: Node, offset: number): number {
  if (container.nodeType === 3) {
    const hit = page.nodes.find(item => item.node === container);
    if (hit) return hit.start + Math.min(offset, hit.node.data.length);
  }
  const owner = container.ownerDocument ?? (container as Document);
  const point = owner.createRange();
  try {
    point.setStart(container, offset);
    point.collapse(true);
  } catch {
    return page.text.length;
  }
  // The first text node at or after the boundary starts there; none: the end of the text.
  for (const item of page.nodes) {
    try {
      if (point.comparePoint(item.node, 0) >= 0) return item.start;
    } catch { /* another tree */ }
  }
  return page.text.length;
}

/**
 * A text comment's place for the selected `range` of `root`: the selected words (white space collapsed, at most 1000
 * characters) with up to 40 characters before and after them. Null when only white space is selected.
 */
export function textCommentAnchor(root: Node, range: Range): SpaceCommentAnchor | null {
  const page = pageTextOf(root);
  const start = offsetOf(page, range.startContainer, range.startOffset);
  const end = offsetOf(page, range.endContainer, range.endOffset);
  if (end <= start) return null;
  const passage = passageAt(page.text, start, end);
  return passage ? { mode: 'text', quote: passage.quote, prefix: passage.prefix, suffix: passage.suffix } : null;
}

/** The page's open text comments drawn here: first comments in text mode on no named field, of this view. */
export function openTextComments(rows: readonly SpaceCommentRow[], view: string | null): SpaceCommentRow[] {
  return rows.filter(row => row && !row.thread_root_id && row.mode === 'text' && row.status === 'open' && !row.field
    && Boolean(row.quote?.trim()) && (!row.view || !view || row.view === view));
}

function lastNode(page: PageText, test: (item: PageText['nodes'][number]) => boolean): PageText['nodes'][number] | undefined {
  for (let index = page.nodes.length - 1; index >= 0; index -= 1) if (test(page.nodes[index]!)) return page.nodes[index];
  return undefined;
}

/** The ranges of each comment's words in the page, and the comments whose words are gone. */
export function locateTextComments(root: Node, rows: readonly SpaceCommentRow[]): { found: Map<string, Range>; missing: string[] } {
  const page = pageTextOf(root);
  const found = new Map<string, Range>();
  const missing: string[] = [];
  const owner = root.ownerDocument ?? (root as Document);
  for (const row of rows) {
    const hit = locatePassage(page.text, { quote: row.quote ?? '', prefix: row.prefix ?? '', suffix: row.suffix ?? '' });
    if (!hit) { missing.push(row.id); continue; }
    const from = lastNode(page, item => item.start <= hit.start);
    const to = lastNode(page, item => item.start < hit.end);
    if (!from || !to) { missing.push(row.id); continue; }
    const range = owner.createRange();
    try {
      range.setStart(from.node, Math.min(hit.start - from.start, from.node.data.length));
      range.setEnd(to.node, Math.min(hit.end - to.start, to.node.data.length));
      found.set(row.id, range);
    } catch {
      missing.push(row.id);
    }
  }
  return { found, missing };
}

/** The CSS Custom Highlight registry, where the browser has one. */
type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): boolean };
function highlightApi(view: Window | null | undefined): { registry: HighlightRegistry; Highlight: new (...ranges: Range[]) => unknown } | null {
  const css = (view as unknown as { CSS?: { highlights?: HighlightRegistry } } | null)?.CSS;
  const Highlight = (view as unknown as { Highlight?: new (...ranges: Range[]) => unknown } | null)?.Highlight;
  return css?.highlights && Highlight ? { registry: css.highlights, Highlight } : null;
}

/**
 * The open text comments of the page the host shows, read through the comment store and listed again whenever the
 * host says they may have changed.
 */
function usePageTextComments(transport: SpaceCommentsTransport | undefined): SpaceCommentRow[] {
  const page = transport?.page?.recordKey ?? null;
  const view = transport?.page?.view ?? null;
  const [rows, setRows] = useState<SpaceCommentRow[]>([]);
  const transportRef = useRef(transport);
  transportRef.current = transport;
  const hasTransport = Boolean(transport);
  useEffect(() => {
    const store = transportRef.current;
    if (!store) { setRows([]); return undefined; }
    let live = true;
    let seq = 0;
    const read = () => {
      const mine = ++seq;
      store.list({ page }).then(answer => {
        if (live && mine === seq) setRows(Array.isArray(answer?.comments) ? answer.comments : []);
      }, () => undefined);
    };
    read();
    let stop: (() => void) | undefined;
    try { stop = store.subscribe({ page }, read); } catch { /* no live feed */ }
    return () => { live = false; stop?.(); };
  }, [hasTransport, page]);
  return useMemo(() => openTextComments(rows, view), [rows, view]);
}

/**
 * Draws the page's open text comments as highlights in `root`, reports the ones whose words are gone, and opens a
 * thread when its highlight is clicked. Renders only its highlight style.
 */
export function SpaceTextComments({ root, runtime }: { root: RefObject<HTMLElement | null>; runtime: NotisRuntime }) {
  const transport = runtime.spaceComments;
  const rows = usePageTextComments(transport);
  const name = `notis-comment-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const located = useRef<Map<string, Range>>(new Map());
  const transportRef = useRef(transport);
  transportRef.current = transport;
  const page = transport?.page?.recordKey ?? null;

  useEffect(() => {
    const element = root.current;
    if (!element || !transport) return undefined;
    const view = element.ownerDocument.defaultView;
    const api = highlightApi(view);
    let frame = 0;
    let reported = '';
    const draw = () => {
      frame = 0;
      const { found, missing } = locateTextComments(element, rows);
      located.current = found;
      if (api) {
        if (found.size) api.registry.set(name, new api.Highlight(...found.values()));
        else api.registry.delete(name);
      }
      setChangedPassages(missing);
      const key = [...missing].sort().join('|');
      if (key !== reported) {
        reported = key;
        try { transportRef.current?.passagesChanged?.({ page, ids: missing }); } catch { /* the host may not listen */ }
      }
    };
    draw();
    // The page changes under the comments (an edit, a page of results): find the words again once per frame.
    const Observer = view?.MutationObserver;
    const observer = Observer ? new Observer(() => {
      if (!frame) frame = view?.requestAnimationFrame?.(draw) ?? 0;
      if (!frame) draw();
    }) : null;
    observer?.observe(element, { childList: true, subtree: true, characterData: true });
    return () => {
      observer?.disconnect();
      if (frame) view?.cancelAnimationFrame?.(frame);
      api?.registry.delete(name);
      located.current = new Map();
    };
  }, [root, transport, rows, name, page]);

  // A click on highlighted words (not the end of a selection) opens their thread in the host Comments panel.
  useEffect(() => {
    const element = root.current;
    if (!element || !transport?.revealComment) return undefined;
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.defaultPrevented) return;
      const selection = element.ownerDocument.getSelection?.();
      if (selection && !selection.isCollapsed) return;
      for (const [id, range] of located.current) {
        const hit = Array.from(range.getClientRects?.() ?? []).some(rect => event.clientX >= rect.left
          && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
        if (hit) { transportRef.current?.revealComment?.(id); return; }
      }
    };
    element.addEventListener('click', onClick);
    return () => element.removeEventListener('click', onClick);
  }, [root, transport]);

  if (!transport || !rows.length) return null;
  // Theme tokens only: the page's primary color, see-through.
  return <style data-notis-comment-highlights>{`::highlight(${name}) { background-color: hsl(var(--primary) / .18); }`}</style>;
}

/** The Space's own commentable text a selection lies in, if any. */
function ownTextOf(range: Range): Element | null {
  const container = range.commonAncestorContainer;
  const element = container.nodeType === 1 ? container as Element : container.parentElement;
  return element?.closest(OWN_PASSAGE_TEXT) ?? null;
}

/**
 * Whether the bar's Comment may start a comment on this selection: page text, and a Space's own commentable rich text
 * (the bar hands it the selection, SPC-487), never a text field (its own Comment button stays).
 */
export function canCommentOnPage(range: Range): boolean {
  const own = ownTextOf(range);
  return !own || own.matches(OWN_RICH_TEXT);
}

/**
 * The bar's Comment on a selection: inside a Space's own commentable rich text that text starts its own new comment
 * on the words; elsewhere the host's new text comment opens on them. False when nothing took it.
 */
export function commentOnSelection(runtime: NotisRuntime, root: Node | null, range: Range): boolean {
  const own = ownTextOf(range);
  if (own) {
    if (!own.matches(OWN_RICH_TEXT)) return false;
    const view = own.ownerDocument?.defaultView;
    const Custom = view?.CustomEvent ?? CustomEvent;
    // Cancelled by the text once it opened the comment.
    return !own.dispatchEvent(new Custom(PASSAGE_COMMENT_EVENT, { detail: { range }, cancelable: true }));
  }
  return startTextComment(runtime, root, range);
}

/** Hands a selection to the host's new text comment. False when there is nothing to comment on or no host for it. */
export function startTextComment(runtime: NotisRuntime, root: Node | null, range: Range): boolean {
  const transport = runtime.spaceComments;
  if (!transport?.startComment || !root) return false;
  const anchor = textCommentAnchor(root, range);
  if (!anchor) return false;
  transport.startComment({
    ...anchor,
    page_key: transport.page?.recordKey ?? null,
    view: transport.page?.view ?? null,
  });
  return true;
}
