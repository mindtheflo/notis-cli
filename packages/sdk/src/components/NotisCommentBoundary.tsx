'use client';
import React, { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ContextResource } from '../runtime';
import { NotisSelectionBoundary, quoteResourceFor } from './NotisSelectionBoundary';
import { useAgentContext } from '../hooks/useAgentContext';
import { useNotisRuntime } from '../provider';
import { COMMENT_GLYPH, SELECTION_BAR_WORDS, SelectionActionBar, citeSelectionAction, useSelectionAnchor } from './SelectionActionBar';
import { newSelectionId } from './selectionId';
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
  const locale = useToolkitLocale();
  const [barSize, setBarSize] = useState({ width: 176, height: 32 });
  // The quote being commented on, frozen when the editor opens: typing moves the browser selection into the editor.
  const [editing, setEditing] = useState<{ id: string; text: string; resource: ContextResource | null; top: number; left: number } | null>(null);
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  // The same bar placement as every quoting surface; a selection spilling over the boundary only by whitespace is
  // clipped to it, and one that takes a neighbour's words is refused.
  const { anchor, dismiss } = useSelectionAnchor(root, {
    enabled: !editing,
    barSize,
    clip: (range, node) => node.firstElementChild ? getOwnedCommentRange(range, node.firstElementChild) : null,
    // A comment boundary never quotes a selection that starts or ends on a button, as before the shared bar.
    exclude: 'button',
  });
  const ownResource = () => resource ? JSON.parse(JSON.stringify(resource)) as ContextResource : null;
  const open = () => {
    if (!anchor) return;
    setEditing({ id: newSelectionId(), text: anchor.text, resource: ownResource(), top: anchor.top, left: anchor.left });
  };
  const close = () => { setEditing(null); dismiss(); setComment(''); setError(''); };
  const submit = async () => {
    if (!editing || !comment.trim() || pending) return;
    setPending(true); setError('');
    try {
      const added = await context.add({ id: editing.id, kind: 'comment', title: editing.resource?.label || 'Comment', icon: 'phosphor:chat-text', text: editing.text, comment, resource: editing.resource });
      if (!added) throw new Error('The comment could not be added to chat.');
      close();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not add this comment.'); }
    finally { setPending(false); }
  };
  const cite = async (range: Range, text: string) => {
    // The quote copy would make: the innermost boundary's resource, else this boundary's.
    const named = quoteResourceFor(range) ?? ownResource();
    try { await context.add({ id: newSelectionId(), text, ...(named ? { resource: named } : {}) }); } catch { /* No chat in this host: copy still quotes. */ }
  };
  const editorProps: NotisCommentBoxProps = { quote: editing?.text, value: comment, onChange: setComment, onSubmit: () => void submit(), onCancel: close, pending, error, className: commentClassName };
  return <div ref={root} className="contents" data-notis-comment-boundary>
    <NotisSelectionBoundary resource={resource} className={className} style={className ? undefined : { display: 'contents' }}>{children}</NotisSelectionBoundary>
    {anchor && !editing && <SelectionActionBar anchor={anchor} onSize={setBarSize} actions={[
      ...(canCite ? [citeSelectionAction(locale, anchor, root, dismiss, (range, text) => void cite(range, text))] : []),
      { key: 'comment', label: SELECTION_BAR_WORDS.comment[locale], icon: COMMENT_GLYPH, onSelect: open },
    ]} />}
    {editing && <div data-notis-comment-ui className="fixed z-50 max-h-[calc(100dvh-1rem)]" style={{ overflow: 'auto', top: Math.min(editing.top, Math.max(8, window.innerHeight - 320)), left: `clamp(8px, ${editing.left}px, calc(100vw - min(20rem, calc(100vw - 1rem)) - 8px))`, width: 'min(20rem, calc(100vw - 1rem))' } as CSSProperties}>
      {renderComment ? renderComment(editorProps) : <NotisCommentBox {...editorProps} />}
    </div>}
  </div>;
}
