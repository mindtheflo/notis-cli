'use client';
import React, { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ContextResource } from '../runtime';
import { NotisSelectionBoundary } from './NotisSelectionBoundary';
import { useAgentContext } from '../hooks/useAgentContext';

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
      <button type="button" aria-label="Cancel comment" onClick={onCancel} disabled={pending} className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-lg opacity-70 hover:bg-white/10 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current disabled:opacity-40 [@media(pointer:coarse)]:size-9">
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
        className="min-h-8 shrink-0 rounded-lg px-2.5 text-sm font-medium hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current disabled:opacity-40 [@media(pointer:coarse)]:min-h-9">{pending ? 'Adding…' : 'Add to chat'}</button>
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
  const root = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ id: string; text: string; resource?: ContextResource | null; top: number; left: number } | null>(null);
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
        || !content || !getOwnedCommentRange(selected.getRangeAt(0), content)) setSelection(null);
    };
    document.addEventListener('selectionchange', clearInvalidSelection);
    if (scope !== (document as unknown as ShadowRoot)) scope.addEventListener('selectionchange', clearInvalidSelection);
    return () => {
      document.removeEventListener('selectionchange', clearInvalidSelection);
      if (scope !== (document as unknown as ShadowRoot)) scope.removeEventListener('selectionchange', clearInvalidSelection);
    };
  }, []);
  const open = () => { editingRef.current = true; setEditing(true); };
  const capture = (target: EventTarget | null) => {
    // Clicking the action/editor must not unmount it before its click runs.
    if (editing || (target instanceof Element && target.closest('[data-notis-comment-ui]'))) return;
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
    const position = getCommentActionPosition(lines.length ? lines : [rect], { width: window.innerWidth, height: window.innerHeight }, boundary?.width ? boundary.right : window.innerWidth, trailing);
    setSelection({ id: crypto.randomUUID(), text: selected.toString().trim(), resource: resource ? JSON.parse(JSON.stringify(resource)) : null, ...position });
  };
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
  const editorProps: NotisCommentBoxProps = { quote: selection?.text, value: comment, onChange: setComment, onSubmit: () => void submit(), onCancel: close, pending, error, className: commentClassName };
  return <div ref={root} className="contents" onMouseUp={event => capture(event.target)} onDoubleClick={event => capture(event.target)} onKeyUp={event => { if (!editing && (event.shiftKey || event.key === 'Shift' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a'))) capture(event.target); }}>
    <NotisSelectionBoundary resource={resource} className={className} style={className ? undefined : { display: 'contents' }}>{children}</NotisSelectionBoundary>
    {selection && <div data-notis-comment-ui className="fixed z-50 max-h-[calc(100dvh-1rem)]" style={{ overflow: editing ? 'auto' : 'visible', top: editing ? Math.min(selection.top, Math.max(8, window.innerHeight - 320)) : selection.top, left: `clamp(8px, ${selection.left}px, calc(100vw - ${editing ? 'min(20rem, calc(100vw - 1rem))' : '2rem'} - 8px))`, width: editing ? 'min(20rem, calc(100vw - 1rem))' : undefined } as CSSProperties}>
      {editing ? (renderComment ? renderComment(editorProps) : <NotisCommentBox {...editorProps} />) : <button type="button" aria-label="Comment" title="Comment" onMouseDown={event => event.preventDefault()} onClick={open}
        style={{ background: 'hsl(var(--sidebar-background, 0 0% 7.5%))', color: 'hsl(var(--sidebar-foreground, 240 4.8% 95.9%))' }}
        className="relative flex size-8 items-center justify-center rounded-lg ring-1 ring-white/15 hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 256 256" fill="currentColor"><path d="M216,48H40A16,16,0,0,0,24,64V224a15.85,15.85,0,0,0,9.24,14.5A16.13,16.13,0,0,0,40,240a15.89,15.89,0,0,0,10.25-3.78l.09-.07L83,208H216a16,16,0,0,0,16-16V64A16,16,0,0,0,216,48ZM40,224h0ZM216,192H80a8,8,0,0,0-5.23,1.95L40,224V64H216ZM88,112a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H96A8,8,0,0,1,88,112Zm0,32a8,8,0,0,1,8-8h64a8,8,0,1,1,0,16H96A8,8,0,0,1,88,144Z" /></svg>
        <span aria-hidden="true" className="absolute left-1/2 top-1/2 hidden size-12 -translate-x-1/2 -translate-y-1/2 [@media(pointer:coarse)]:block" />
      </button>}
    </div>}
  </div>;
}
