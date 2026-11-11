'use client';
import React, { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ContextResource } from '../runtime';
import { NotisSelectionBoundary, quoteResourceFor } from './NotisSelectionBoundary';
import { useAgentContext } from '../hooks/useAgentContext';
import { useNotisRuntime } from '../provider';
import { COMMENT_GLYPH, QUOTE_GLYPH, SELECTION_BAR_WORDS, SelectionActionBar, clearSelectionIn, getSelectionBarPosition } from './SelectionActionBar';
import { useToolkitLocale } from '../ui/engine/hooks';

export interface NotisCommentBoxProps {
  quote?: string;
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  onCancel(): void;
  pending?: boolean;
  error?: string;
  className?: string;
}

/** Compact, chrome-themed presentation. Apps retain ownership of comment state. */
export function NotisCommentBox({ quote, value, onChange, onSubmit, onCancel, pending, error, className = '' }: NotisCommentBoxProps) {
  return <div data-notis-comment-ui role="dialog" aria-label="Comment on selection"
    style={{ colorScheme: 'dark', background: 'hsl(var(--sidebar-background, 0 0% 7.5%))', color: 'hsl(var(--sidebar-foreground, 240 4.8% 95.9%))', borderColor: 'hsl(var(--sidebar-border, 0 0% 23.5%))' }}
    className={`flex min-w-0 flex-col gap-2 rounded-xl border p-2.5 text-sm shadow-lg ${className}`}>
    <div className="flex min-w-0 items-center gap-2">
      {quote && <blockquote title={quote} className="min-w-0 flex-1 truncate border-l-2 border-current/40 pl-2 opacity-70">{quote}</blockquote>}
      <button type="button" aria-label="Cancel comment" onClick={onCancel} disabled={pending} className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-lg opacity-70 hover:bg-white/10 hover:opacity-100 disabled:opacity-40 [@media(pointer:coarse)]:size-9">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </div>
    <textarea autoFocus rows={2} name="selection-comment" aria-label="Your comment" placeholder="Add a comment…" value={value} onChange={event => onChange(event.target.value)} disabled={pending}
      onKeyDown={event => { if (event.nativeEvent.isComposing || pending) return; if (event.key === 'Escape') { event.preventDefault(); onCancel(); } if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); if (value.trim()) onSubmit(); } }}
      className="w-full min-w-0 resize-none rounded bg-transparent px-0.5 py-1 text-base text-inherit outline-none placeholder:text-current placeholder:opacity-60 sm:text-sm" />
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs opacity-60">⌘ / Ctrl ↵ to add</span>
      <button type="button" disabled={pending || !value.trim()} onClick={onSubmit}
        style={{ background: 'hsl(var(--sidebar-foreground, 240 4.8% 95.9%))', color: 'hsl(var(--sidebar-background, 0 0% 7.5%))' }}
        className="min-h-8 shrink-0 rounded-lg px-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40 [@media(pointer:coarse)]:min-h-9">{pending ? 'Adding…' : 'Add to chat'}</button>
    </div>
  </div>;
}

export interface NotisCommentBoundaryProps {
  resource?: ContextResource | null;
  children: ReactNode;
  className?: string;
  commentClassName?: string;
  /** Replace the optional standard editor while retaining selection/context behavior. */
  renderComment?: (props: NotisCommentBoxProps) => ReactNode;
}

type SelectionRect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;

/** Place the tile after the final selected line, otherwise below (or above near the viewport bottom). */
export function getCommentActionPosition(rects: SelectionRect[], viewport: { width: number; height: number }, rightBoundary = viewport.width, trailing: SelectionRect[] = []) {
  const last = rects[rects.length - 1];
  const size = 32, gap = 8;
  const clampX = (x: number) => Math.max(gap, Math.min(viewport.width - size - gap, x));
  const clampY = (y: number) => Math.max(gap, Math.min(viewport.height - size - gap, y));
  const beside = { left: last.right + gap, top: clampY((last.top + last.bottom - size) / 2) };
  const overlapsText = trailing.some(rect => rect.left < beside.left + size && rect.right > beside.left && rect.top < beside.top + size && rect.bottom > beside.top);
  if (beside.left + size <= Math.min(viewport.width, rightBoundary) - gap && !overlapsText) return beside;
  return { left: clampX(last.right - size), top: clampY(last.bottom + gap + size <= viewport.height - gap ? last.bottom + gap : last.top - size - gap) };
}

/** Browser paragraph selection may include an adjacent block's empty starting boundary. */
export function getOwnedCommentRange(selected: Range, content: Element): Range | null {
  const owned = content.ownerDocument.createRange();
  owned.selectNodeContents(content);
  const range = selected.cloneRange();
  // Only clip whitespace outside the resource; actual neighboring content must
  // never be silently attached to this resource's comment.
  if (range.compareBoundaryPoints(Range.START_TO_START, owned) < 0) {
    const before = range.cloneRange();
    before.setEnd(owned.startContainer, owned.startOffset);
    if (before.toString().trim()) return null;
    range.setStart(owned.startContainer, owned.startOffset);
  }
  if (range.compareBoundaryPoints(Range.END_TO_END, owned) > 0) {
    const after = range.cloneRange();
    after.setStart(owned.endContainer, owned.endOffset);
    if (after.toString().trim()) return null;
    range.setEnd(owned.endContainer, owned.endOffset);
  }
  if (range.collapsed || !content.contains(range.startContainer) || !content.contains(range.endContainer)) return null;
  return range;
}

/** Selection-to-chat convenience. No annotation database, polling or background attachment. */
export function NotisCommentBoundary({ resource, children, className, commentClassName, renderComment }: NotisCommentBoundaryProps) {
  const context = useAgentContext();
  // A host without a chat (a public Site) offers Comment alone: Cite would have nowhere to go.
  const canCite = Boolean(useNotisRuntime()?.addContext);
  const root = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ id: string; text: string; resource?: ContextResource | null; range: Range; top: number; left: number } | null>(null);
  const locale = useToolkitLocale();
  const [barSize, setBarSize] = useState({ width: 176, height: 32 });
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const document = node.ownerDocument;
    const scope = node.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null };
    const clearInvalidSelection = () => {
      // Opening the editor focuses its input and collapses the browser range.
      // Keep the captured quote/editor; only the unopened action follows live selection.
      if (editingRef.current) return;
      const selected = scope.getSelection?.() || document.defaultView?.getSelection();
      const content = node.firstElementChild;
      if (!selected?.rangeCount || selected.isCollapsed || !selected.toString().trim()
        || !content || !getOwnedCommentRange(selected.getRangeAt(0), content)) { setSelection(null); return; }
      // A touch selection has no mouse up: show the bar once its handles stop moving (truth PRT-094).
      if (document.defaultView?.matchMedia?.('(pointer: coarse)').matches) {
        document.defaultView.clearTimeout(touchSettle.current);
        touchSettle.current = document.defaultView.setTimeout(() => captureRef.current(null), 450);
      }
    };
    document.addEventListener('selectionchange', clearInvalidSelection);
    if (scope !== (document as unknown as ShadowRoot)) scope.addEventListener('selectionchange', clearInvalidSelection);
    return () => {
      document.removeEventListener('selectionchange', clearInvalidSelection);
      if (scope !== (document as unknown as ShadowRoot)) scope.removeEventListener('selectionchange', clearInvalidSelection);
    };
  }, []);
  const open = () => { editingRef.current = true; setEditing(true); };
  const touchSettle = useRef<number | undefined>(undefined);
  const captureRef = useRef<(target: EventTarget | null) => void>(() => {});
  const capture = (target: EventTarget | null) => {
    // Clicking the action/editor must not unmount it before its click runs.
    if (editing || (target instanceof Element && target.closest('[data-notis-comment-ui],[data-notis-selection-ui]'))) return;
    const node = root.current;
    const scope = node?.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null };
    const selected = scope?.getSelection?.() || window.getSelection();
    if (!node || !selected?.rangeCount || selected.isCollapsed) { setSelection(null); return; }
    const content = node.firstElementChild;
    const range = content ? getOwnedCommentRange(selected.getRangeAt(0), content) : null;
    if (!range) { setSelection(null); return; }
    const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement;
    const end = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer as Element : range.endContainer.parentElement;
    if (!node.contains(range.startContainer) || !node.contains(range.endContainer)
      || start?.closest('input,textarea,button,[contenteditable],[data-notis-comment-ui]')
      || end?.closest('input,textarea,button,[contenteditable],[data-notis-comment-ui]')) { setSelection(null); return; }
    const rect = range.getBoundingClientRect();
    const lines = Array.from(range.getClientRects?.() || []).filter(line => line.width > 0 && line.height > 0);
    const boundary = node.firstElementChild?.getBoundingClientRect();
    const trailing: DOMRect[] = [];
    const endBlock = end?.closest('p,li,h1,h2,h3,h4,h5,h6,td,th,div');
    if (endBlock && node.contains(endBlock)) {
      const remainder = range.cloneRange();
      remainder.selectNodeContents(endBlock);
      remainder.setStart(range.endContainer, range.endOffset);
      trailing.push(...Array.from(remainder.getClientRects?.() || []).filter(line => line.width > 0 && line.height > 0));
    }
    // The bar (Cite, then Comment) sits where the old Comment tile did: after the last line, or below it.
    const position = getSelectionBarPosition(lines.length ? lines : [rect], { width: window.innerWidth, height: window.innerHeight }, barSize,
      { rightBoundary: boundary?.width ? boundary.right : window.innerWidth, trailing, coarse: window.matchMedia?.('(pointer: coarse)').matches });
    setSelection({ id: crypto.randomUUID(), text: selected.toString().trim(), resource: resource ? JSON.parse(JSON.stringify(resource)) : null, range: range.cloneRange(), ...position });
  };
  captureRef.current = capture;
  // Once the bar measured itself, place it again with its real width.
  useEffect(() => { if (!editingRef.current) captureRef.current(null); }, [barSize.width, barSize.height]);
  const close = () => { editingRef.current = false; setEditing(false); setSelection(null); setComment(''); setError(''); };
  const submit = async () => {
    if (!selection || !comment.trim() || pending) return;
    setPending(true); setError('');
    try {
      const added = await context.add({ id: selection.id, kind: 'comment', title: selection.resource?.label || 'Comment', icon: 'phosphor:chat-text', text: selection.text, comment, resource: selection.resource });
      if (!added) throw new Error('The comment could not be added to chat.');
      close();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not add this comment.'); }
    finally { setPending(false); }
  };
  const cite = async () => {
    if (!selection) return;
    const quoted = selection;
    clearSelectionIn(root.current);
    setSelection(null);
    // The quote copy would make: the innermost boundary's resource, else this boundary's.
    const named = quoteResourceFor(quoted.range) ?? quoted.resource ?? null;
    try { await context.add({ id: quoted.id, text: quoted.text, ...(named ? { resource: named } : {}) }); } catch { /* No chat in this host: copy still quotes. */ }
  };
  const editorProps: NotisCommentBoxProps = { quote: selection?.text, value: comment, onChange: setComment, onSubmit: () => void submit(), onCancel: close, pending, error, className: commentClassName };
  return <div ref={root} className="contents" data-notis-comment-boundary onMouseUp={event => capture(event.target)} onDoubleClick={event => capture(event.target)} onKeyUp={event => { if (!editing && (event.shiftKey || event.key === 'Shift' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a'))) capture(event.target); }}>
    <NotisSelectionBoundary resource={resource} className={className} style={className ? undefined : { display: 'contents' }}>{children}</NotisSelectionBoundary>
    {selection && !editing && <SelectionActionBar anchor={selection} onSize={setBarSize} actions={[
      ...(canCite ? [{ key: 'cite', label: SELECTION_BAR_WORDS.cite[locale], title: SELECTION_BAR_WORDS.citeHint[locale], icon: QUOTE_GLYPH, onSelect: () => void cite() }] : []),
      { key: 'comment', label: SELECTION_BAR_WORDS.comment[locale], icon: COMMENT_GLYPH, onSelect: open },
    ]} />}
    {selection && editing && <div data-notis-comment-ui className="fixed z-50 max-h-[calc(100dvh-1rem)]" style={{ overflow: 'auto', top: Math.min(selection.top, Math.max(8, window.innerHeight - 320)), left: `clamp(8px, ${selection.left}px, calc(100vw - min(20rem, calc(100vw - 1rem)) - 8px))`, width: 'min(20rem, calc(100vw - 1rem))' } as CSSProperties}>
      {renderComment ? renderComment(editorProps) : <NotisCommentBox {...editorProps} />}
    </div>}
  </div>;
}
