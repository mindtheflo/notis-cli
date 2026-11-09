import type { CSSProperties, ClipboardEvent, ReactNode } from 'react';
import React, { useCallback } from 'react';
import { useNotisRuntime } from '../provider';
import type { ContextResource, ContextSelection, NotisRuntime } from '../runtime';

export const NOTIS_CONTEXT_CLIPBOARD_TYPE = 'application/x-notis-context+json';

export interface NotisSelectionBoundaryProps {
  resource?: ContextResource | null;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

function selectionId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `selection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** The selection's markup for other paste targets: hidden parts dropped, links made absolute. */
function selectionHtml(selection: Selection): string {
  if (typeof document === 'undefined') return '';
  const container = document.createElement('div');
  for (let index = 0; index < selection.rangeCount; index += 1) container.appendChild(selection.getRangeAt(index).cloneContents());
  container.querySelectorAll('[hidden],script,style,template').forEach(node => node.remove());
  container.querySelectorAll('[href],[src]').forEach(node => {
    for (const name of ['href', 'src']) {
      const value = node.getAttribute(name);
      if (value === null) continue;
      try { node.setAttribute(name, new URL(value, document.baseURI).href); } catch { node.removeAttribute(name); }
    }
  });
  return container.innerHTML;
}

/**
 * Adds the copied passage as a Notis quote to a copy event that started inside
 * `event.currentTarget`, and returns that quote (null when nothing inside was
 * copied). Text in a rich editor (a Space's MarkdownEditor, Skill and automation
 * instructions) is quoted too: the editor already wrote its own formats, so they
 * stay as written and the quote reads the editor's plain text. Form fields keep
 * plain copy.
 */
export function addCopiedSelectionToClipboard(
  event: ClipboardEvent<HTMLElement>,
  context: Omit<ContextSelection, 'id' | 'text'> = {},
): ContextSelection | null {
  const boundary = event.currentTarget;
  const target = event.target as Element | null;
  if (!event.clipboardData || target?.closest?.('input,textarea')) return null;
  // An inner boundary already quoted this copy: its resource wins over an outer default.
  if (event.clipboardData.getData(NOTIS_CONTEXT_CLIPBOARD_TYPE)) return null;
  const scope = boundary.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null };
  const selection = scope?.getSelection?.() || window.getSelection();
  if (!selection || !boundary.contains(selection.anchorNode) || !boundary.contains(selection.focusNode)) return null;
  const editorWrote = event.nativeEvent?.defaultPrevented ?? event.defaultPrevented;
  const wrotePlain = editorWrote ? event.clipboardData.getData('text/plain') : '';
  // A handler that cancelled the copy and wrote nothing at all blocked it: quote nothing.
  if (editorWrote && !wrotePlain && !event.clipboardData.getData('text/html')) return null;
  const text = wrotePlain || selection.toString();
  if (!text.trim()) return null;

  const payload: ContextSelection = { ...context, id: selectionId(), text };
  if (!editorWrote) {
    // Keep the copied formatting (links, bold, tables) for every other paste target.
    const html = selectionHtml(selection);
    event.clipboardData.setData('text/plain', text);
    if (html) event.clipboardData.setData('text/html', html);
    event.preventDefault();
  }
  event.clipboardData.setData(NOTIS_CONTEXT_CLIPBOARD_TYPE, JSON.stringify(payload));
  return payload;
}

/**
 * The Space-wide default every view gets from its host: text copied anywhere in
 * the view quotes as the Space itself (its name on the pill, the view as source).
 * A NotisSelectionBoundary inside the view quotes first and names its own resource.
 */
export function copySpaceSelection(event: ClipboardEvent<HTMLElement>, runtime: QuoteRuntime | null): void {
  const source = runtime?.contextSource;
  captureCopiedSelection(event, runtime, source ? { source, title: source.appName } : {});
}

type QuoteRuntime = Pick<NotisRuntime, 'contextSource' | 'captureContextSelection'>;

/** Quotes a copy for the host chat; a public Site's runtime has no chat, so its copy stays the browser's own. */
function captureCopiedSelection(event: ClipboardEvent<HTMLElement>, runtime: QuoteRuntime | null, context: Omit<ContextSelection, 'id' | 'text'>): void {
  if (!runtime?.captureContextSelection) return;
  const payload = addCopiedSelectionToClipboard(event, context);
  if (payload) runtime.captureContextSelection(payload);
}

/**
 * Adds structured provenance to ordinary copied text. Pasting still works in
 * every app because `text/plain` is preserved; Notis chat additionally reads
 * the custom MIME payload and renders a separate quote pill.
 */
export function NotisSelectionBoundary({
  resource,
  children,
  className,
  style,
}: NotisSelectionBoundaryProps) {
  const runtime = useNotisRuntime();
  const onCopy = useCallback((event: ClipboardEvent<HTMLDivElement>) => captureCopiedSelection(event, runtime, {
    ...(runtime?.contextSource ? { source: runtime.contextSource } : {}),
    ...(resource ? { resource: { ...resource, snapshot: undefined } } : {}),
  }), [resource, runtime]);

  return <div className={className} style={style} onCopy={onCopy}>{children}</div>;
}
