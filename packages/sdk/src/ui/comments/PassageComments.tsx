/**
 * Comments on passages of a record's text, rendered from a `usePassageComments` controller:
 *
 * - `CommentableText`: around a text input or textarea. Selecting words offers Comment; the field is tinted while it
 *   holds open threads, with a count that opens the first one; an opened thread selects its words.
 * - `CommentableRichText`: around rich text (the Markdown editor, or rendered Markdown). It highlights every thread's
 *   passage, follows the text as it is edited and laid out, offers Comment on a selection, and a click on a highlight
 *   opens its thread.
 * - `PassageCommentPane`: the standard comment pane for these threads: each card shows its field and quote (Text
 *   changed when the words are gone), the Open and Resolved filter, the new comment box, replies, Resolve and Delete.
 *   Put it in a `SidePane` beside the record.
 */

import React, {
  useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent,
} from 'react';
import { Dialog } from '../../components/Dialog';
import { pick, type Words } from '../../words';
import { ActionToast } from '../actions/ActionToast';
import { Badge, Button, EmptyState, Notice, SegmentedControl } from '../blocks';
import { ESCAPE_PRIORITY } from '../engine/core';
import { useEscapeLayer } from '../engine/hooks';
import { cx } from '../util';
import { CommentThreadCard, sendsOnEnter } from './CommentPane';
import type { CommentThread } from './commentModel';
import { locatePassage, passageAt, type PassageAnchor } from './passageModel';
import type { PassageCommentController } from './usePassageComments';

// ---------------------------------------------------------------------------
// The Comment button
// ---------------------------------------------------------------------------

function CommentButton({ comments, onPick }: { comments: PassageCommentController; onPick(): void }) {
  const { controller } = comments;
  return (
    <Button size="sm" variant="secondary" icon="chat-circle-text" aria-label={controller.say('commentOnSelection')}
      // The selection stays while the button is pressed.
      onMouseDown={event => event.preventDefault()} onClick={onPick}>
      {controller.say('comment')}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// A text input or textarea
// ---------------------------------------------------------------------------

type Editable = HTMLInputElement | HTMLTextAreaElement;

function editableIn(wrap: HTMLElement | null): Editable | null {
  return (wrap?.querySelector('input, textarea') as Editable | null) ?? null;
}

export interface CommentableTextProps {
  comments: PassageCommentController;
  /** The field's key, as declared in `fields`. */
  field: string;
  /** The field's value as edited on screen. */
  value: string;
  /** The field: anything holding one text input or textarea (`FieldText`, `FieldLongText`). */
  children: ReactNode;
  className?: string;
}

export function CommentableText({ comments, field, value, children, className }: CommentableTextProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<PassageAnchor | null>(null);
  const { controller } = comments;
  const mine = comments.threadsOn(field);
  const open = mine.filter(thread => thread.root.status === 'Open');
  const chosen = mine.some(thread => thread.root.recordKey === controller.threadKey);
  const flash = comments.flash && mine.some(thread => thread.root.recordKey === comments.flash?.key) ? comments.flash : null;

  const read = () => {
    const el = editableIn(wrap.current);
    const start = el?.selectionStart;
    const end = el?.selectionEnd;
    const passage = el && start != null && end != null && start !== end ? passageAt(value, start, end) : null;
    setSelected(passage ? { field, ...passage } : null);
  };

  // An opened thread selects its words in the field.
  useEffect(() => {
    if (!flash) return;
    const passage = comments.passageOf(flash.key);
    const el = editableIn(wrap.current);
    if (!el || !flash.scroll) return;
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    const hit = passage ? locatePassage(value, passage) : null;
    if (hit) { el.focus({ preventScroll: true }); el.setSelectionRange(hit.start, hit.end); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash?.n]);

  const state = flash ? 'flash' : chosen ? 'selected' : open.length ? 'open' : undefined;
  return (
    <div className={cx('nui-passage-text', className)}>
      <div className="nui-passage-text-row">
        <div ref={wrap} className="nui-passage-text-field" data-state={state}
          onSelect={read} onMouseUp={read} onKeyUp={read} onTouchEnd={read}>
          {children}
        </div>
        {open.length ? (
          <Button size="sm" variant="ghost" icon="chat-circle-text" aria-label={controller.say('openFieldComments')}
            onClick={() => comments.open(open[0]!, 'passage')}>
            {String(open.length)}
          </Button>
        ) : null}
      </div>
      {selected ? (
        <div><CommentButton comments={comments} onPick={() => { comments.startDraft(selected); setSelected(null); }} /></div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rich text: the Markdown editor, or rendered Markdown
// ---------------------------------------------------------------------------

type Box = { key: string; top: number; left: number; width: number; height: number };

/** The element holding the text: an editor's editable area (never its menus or toolbars), else the whole content. */
function textHolder(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('[contenteditable]') ?? root;
}

function textNodes(root: Node): { text: string; nodes: Array<{ node: Text; start: number }> } {
  const owner = root.ownerDocument ?? document;
  const walker = owner.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: Array<{ node: Text; start: number }> = [];
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({ node: node as Text, start: text.length });
    text += (node as Text).data;
  }
  return { text, nodes };
}

/** Boxes of the text between two offsets, one per line of each text node. */
function boxesOf(nodes: Array<{ node: Text; start: number }>, start: number, end: number, origin: DOMRect): Omit<Box, 'key'>[] {
  const out: Omit<Box, 'key'>[] = [];
  for (const { node, start: at } of nodes) {
    const from = Math.max(start, at);
    const to = Math.min(end, at + node.data.length);
    if (from >= to) continue;
    const range = node.ownerDocument.createRange();
    range.setStart(node, from - at);
    range.setEnd(node, to - at);
    for (const rect of Array.from(range.getClientRects?.() ?? [])) {
      if (rect.width < 1 || rect.height < 1) continue;
      out.push({ top: rect.top - origin.top, left: rect.left - origin.left, width: rect.width, height: rect.height });
    }
  }
  return out;
}

/** The selection of the document or shadow root the element is in. */
function selectionOf(el: HTMLElement): Selection | null {
  const root = el.getRootNode() as Document | (ShadowRoot & { getSelection?: () => Selection | null });
  const own = 'getSelection' in root && typeof root.getSelection === 'function' ? root.getSelection() : null;
  return own ?? el.ownerDocument.defaultView?.getSelection() ?? null;
}

export interface CommentableRichTextProps {
  comments: PassageCommentController;
  /** The field's key, as declared in `fields`. */
  field: string;
  /** The text: `MarkdownEditor`, `Markdown`, or any element holding it. */
  children: ReactNode;
  className?: string;
}

export function CommentableRichText({ comments, field, children, className }: CommentableRichTextProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const textRoot = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selected, setSelected] = useState<{ passage: PassageAnchor; top: number; left: number } | null>(null);
  const { controller, flash, reportFound } = comments;
  const marks = comments.threadsOn(field).flatMap(thread => {
    const passage = comments.passageOf(thread.root.recordKey);
    return passage ? [{ key: thread.root.recordKey, passage }] : [];
  });
  const marksKey = marks.map(mark => `${mark.key}:${mark.passage.quote}:${mark.passage.prefix}:${mark.passage.suffix}`).join('|');
  const marksRef = useRef(marks);
  marksRef.current = marks;

  const measure = useCallback(() => {
    const box = wrap.current;
    const root = textRoot.current;
    if (!box || !root) return;
    const origin = box.getBoundingClientRect();
    const { text, nodes } = textNodes(textHolder(root));
    const next: Box[] = [];
    const hits = new Set<string>();
    for (const mark of marksRef.current) {
      const hit = locatePassage(text, mark.passage);
      if (!hit) continue;
      hits.add(mark.key);
      for (const rect of boxesOf(nodes, hit.start, hit.end, origin)) next.push({ key: mark.key, ...rect });
    }
    setBoxes(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    // Before the text has opened there is nothing to judge: Text changed then follows the value.
    reportFound(field, text.trim() ? hits : null);
  }, [field, reportFound]);

  useLayoutEffect(() => { measure(); }, [measure, marksKey]);
  useEffect(() => () => reportFound(field, null), [field, reportFound]);
  // An editor opens, is typed in and lays out on its own: measure again after each change of its text or size.
  useEffect(() => {
    const root = textRoot.current;
    const view = root?.ownerDocument.defaultView;
    if (!root || !view) return undefined;
    // One measure per frame; a page without animation frames (a test document) measures on the next tick.
    const schedule = typeof view.requestAnimationFrame === 'function'
      ? (run: () => void) => view.requestAnimationFrame(run) : (run: () => void) => view.setTimeout(run, 0);
    const unschedule = typeof view.cancelAnimationFrame === 'function'
      ? (id: number) => view.cancelAnimationFrame(id) : (id: number) => view.clearTimeout(id);
    let frame = 0;
    const later = () => { unschedule(frame); frame = schedule(measure); };
    const mutations = typeof view.MutationObserver === 'undefined' ? null : new view.MutationObserver(later);
    mutations?.observe(root, { subtree: true, childList: true, characterData: true });
    const sizes = typeof view.ResizeObserver === 'undefined' ? null : new view.ResizeObserver(later);
    sizes?.observe(root);
    // A web font arriving moves the words without changing the text or its box: measure again then too.
    const fonts = (root.ownerDocument as Document & { fonts?: FontFaceSet }).fonts;
    let alive = true;
    void fonts?.ready?.then(() => { if (alive) later(); });
    fonts?.addEventListener?.('loadingdone', later);
    later();
    return () => {
      alive = false;
      unschedule(frame);
      mutations?.disconnect();
      sizes?.disconnect();
      fonts?.removeEventListener?.('loadingdone', later);
    };
  }, [measure]);

  // An opened thread scrolls its passage into view.
  useEffect(() => {
    if (!flash?.scroll) return;
    const first = Array.from(wrap.current?.querySelectorAll<HTMLElement>('[data-passage]') ?? [])
      .find(mark => mark.dataset.passage === flash.key);
    first?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash?.n, boxes.length > 0]);

  const readSelection = () => {
    const box = wrap.current;
    const root = textRoot.current;
    if (!box || !root) return;
    const holder = textHolder(root);
    const selection = selectionOf(root);
    const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || range.collapsed || !holder.contains(range.startContainer) || !holder.contains(range.endContainer)) {
      setSelected(null);
      return;
    }
    const before = holder.ownerDocument.createRange();
    before.selectNodeContents(holder);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const end = start + range.toString().length;
    const passage = passageAt(textNodes(holder).text, start, end);
    if (!passage) { setSelected(null); return; }
    const rects = Array.from(range.getClientRects?.() ?? []).filter(rect => rect.width > 0);
    const last = rects[rects.length - 1] ?? range.getBoundingClientRect?.() ?? null;
    const origin = box.getBoundingClientRect();
    setSelected({
      passage: { field, ...passage },
      top: last ? last.bottom - origin.top + 6 : 0,
      left: last ? Math.max(0, Math.min(last.right - origin.left - 40, origin.width - 120)) : 0,
    });
  };

  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const box = wrap.current;
    if (!box) return;
    const selection = selectionOf(box);
    if (selection && !selection.isCollapsed) return;
    const origin = box.getBoundingClientRect();
    const x = event.clientX - origin.left;
    const y = event.clientY - origin.top;
    const hit = boxes.find(b => x >= b.left - 1 && x <= b.left + b.width + 1 && y >= b.top - 1 && y <= b.top + b.height + 1);
    if (hit) comments.openKey(hit.key, 'passage');
  };

  return (
    <div ref={wrap} className={cx('nui-passage-rich', className)}
      onMouseUp={readSelection} onKeyUp={readSelection} onTouchEnd={readSelection} onClick={onClick}
      onInput={() => setSelected(null)}>
      <div ref={textRoot} className="nui-passage-rich-text">{children}</div>
      {/* Above the text (an editor paints its own background); clicks and selections go through to it. */}
      {boxes.map((box, index) => (
        <span
          key={`${box.key}-${index}`}
          data-passage={box.key}
          aria-hidden="true"
          className="nui-passage-mark"
          data-state={flash?.key === box.key ? 'flash' : controller.threadKey === box.key ? 'selected' : undefined}
          style={{ top: box.top, left: box.left - 1, width: box.width + 2, height: box.height }}
        />
      ))}
      {selected ? (
        <div className="nui-passage-pick" style={{ top: selected.top, left: selected.left }}>
          <CommentButton comments={comments} onPick={() => {
            comments.startDraft(selected.passage);
            setSelected(null);
            if (wrap.current) selectionOf(wrap.current)?.removeAllRanges();
          }} />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The pane
// ---------------------------------------------------------------------------

function PassageCommentBox({ comments }: { comments: PassageCommentController }) {
  const { controller, draft } = comments;
  const [body, setBody] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancel = useCallback(() => { comments.cancelDraft(); setBody(''); }, [comments]);
  const where = draft ? `${draft.field}:${draft.quote}` : null;
  useEffect(() => {
    if (!where) return;
    ref.current?.focus({ preventScroll: true });
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [where]);
  useEscapeLayer('comments.passage.new', () => { cancel(); return true; },
    { priority: ESCAPE_PRIORITY.selection + 1, enabled: draft != null });
  if (!draft) return null;
  const label = comments.field(draft.field)?.label;
  const send = async () => {
    if (!body.trim() || comments.sending) return;
    if (await comments.send(body)) setBody('');
  };
  return (
    <div className="nui-comment-new-box" role="group" aria-label={controller.say('newComment')}>
      {label ? <p className="nui-passage-field-name">{pick(label, controller.locale)}</p> : null}
      <p className="nui-passage-quote">{draft.quote}</p>
      <textarea
        ref={ref}
        className="nui-comment-input"
        value={body}
        rows={2}
        placeholder={controller.say('commentPlaceholder')}
        aria-label={controller.say('commentPlaceholder')}
        disabled={comments.sending}
        onChange={event => setBody(event.target.value)}
        onKeyDown={event => {
          if (sendsOnEnter(event)) { event.preventDefault(); void send(); }
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (body.trim()) event.currentTarget.blur(); else cancel();
          }
        }}
      />
      {comments.failed ? <p className="nui-passage-error" role="alert">{controller.say('saveError')}</p> : null}
      <div className="nui-comment-new-actions">
        <Button size="sm" variant="ghost" onClick={cancel}>{controller.words.cancel}</Button>
        <Button size="sm" variant="primary" disabled={!body.trim() || comments.sending} icon="paper-plane-right"
          onClick={() => void send()}>{controller.words.send}</Button>
      </div>
    </div>
  );
}

export interface PassageCommentPaneProps {
  comments: PassageCommentController;
  /** Closes the pane: shows a close button in its heading. */
  onClose?(): void;
  /** The heading. Default "Comments". */
  title?: string;
  /**
   * Names of the other groups (for example `{ FR: w('the French copy', 'la version française') }`) and how to show
   * one: the pane then says how many open threads each other group holds, as a link to it.
   */
  groups?: Readonly<Record<string, Words>>;
  onGroup?(group: string): void;
  className?: string;
}

export function PassageCommentPane({ comments, onClose, title, groups, onGroup, className }: PassageCommentPaneProps) {
  const { controller, draft } = comments;
  const heading = title ?? controller.say('comments');
  const threads = comments.threads();
  const open = threads.filter(thread => thread.root.status === 'Open');
  const resolved = threads.filter(thread => thread.root.status === 'Resolved');
  const status = controller.statusFilter;
  const shown = status === 'resolved' ? resolved : open;
  const draftGroup = draft ? comments.field(draft.field)?.group ?? null : null;
  const draftHere = draft && (comments.group == null || draftGroup == null || draftGroup === comments.group) ? draft : null;
  const others = groups && onGroup ? Object.entries(groups).filter(([group]) => group !== comments.group).map(([group, label]) => ({
    group, label, count: comments.threads(group).filter(thread => thread.root.status === 'Open'
      && comments.passageOf(thread.root.recordKey) != null).length,
  })).filter(item => item.count > 0) : [];

  const card = (thread: CommentThread) => {
    const passage = comments.passageOf(thread.root.recordKey);
    const label = passage ? comments.field(passage.field)?.label : undefined;
    const gone = comments.isChanged(thread.root.recordKey);
    return (
      <div key={thread.root.recordKey} className="nui-passage-thread" data-comment-thread={thread.root.recordKey}>
        {passage ? (
          <button type="button" className="nui-passage-anchor" data-changed={gone ? '' : undefined}
            onClick={() => comments.open(thread, 'quote')}>
            <span className="nui-passage-field-name">
              {label ? pick(label, controller.locale) : null}
              {gone ? <Badge tone="warning">{controller.say('textChanged')}</Badge> : null}
            </span>
            <span className="nui-passage-quote">{passage.quote}</span>
            {gone ? <span className="nui-passage-hint">{controller.say('textChangedHint')}</span> : null}
          </button>
        ) : null}
        <CommentThreadCard controller={controller} thread={thread} />
      </div>
    );
  };

  let body: ReactNode = null;
  if (controller.error && !controller.hasData) {
    body = <Notice tone="danger" onRetry={() => void controller.refetch()}>{controller.say('readError')}</Notice>;
  } else if (!shown.length && !draftHere && controller.hasData) {
    body = (
      <EmptyState className="nui-comment-empty" icon="chat-circle-text"
        title={status === 'resolved' ? controller.say('emptyResolved') : controller.say('emptyPassages')} />
    );
  }

  return (
    <aside className={cx('nui-comment-pane', className)} aria-label={heading}>
      <div className="nui-comment-pane-head">
        <h2 className="nui-comment-pane-title">{heading}</h2>
        {onClose ? (
          <Button variant="ghost" size="sm" className="nui-comment-icon-btn" icon="x" aria-label={controller.say('closeComments')}
            onClick={onClose} />
        ) : null}
      </div>
      <SegmentedControl
        label={controller.words.status}
        value={status}
        onChange={value => controller.setStatusFilter(value)}
        options={[
          { value: 'open', label: controller.words.open, count: open.length },
          { value: 'resolved', label: controller.words.resolvedFilter, count: resolved.length },
        ]}
      />
      {draftHere ? <PassageCommentBox comments={comments} />
        : shown.length ? <p className="nui-passage-hint">{controller.say('selectToComment')}</p> : null}
      {body}
      {shown.length ? <div className="nui-comment-list">{shown.map(card)}</div> : null}
      {others.map(item => (
        <button key={item.group} type="button" className="nui-passage-other" onClick={() => onGroup?.(item.group)}>
          {controller.say('inGroup', { n: item.count, group: pick(item.label, controller.locale) })}
        </button>
      ))}
      <Dialog open={controller.deleting != null} onClose={controller.cancelDelete} title={controller.say('deleteTitle')}
        description={controller.say('deleteBody')} role="alertdialog">
        <div className="nui-comment-dialog-actions">
          <Button variant="ghost" data-dialog-cancel="" onClick={controller.cancelDelete}>{controller.words.cancel}</Button>
          <Button variant="danger" data-dialog-confirm="" onClick={() => void controller.confirmDelete()}>
            {controller.words.delete}
          </Button>
        </div>
      </Dialog>
      <ActionToast toast={controller.toaster.toast} onUndo={() => void controller.toaster.undo()}
        onDismiss={controller.toaster.dismiss} />
    </aside>
  );
}
