/**
 * Comments on passages of a record's text, rendered from a `usePassageComments` controller:
 *
 * - `CommentableText`: around a text input or textarea. Selecting words offers Comment; the field is tinted while it
 *   holds open threads, with a count that opens the first one; an opened thread selects its words.
 * - `CommentableRichText`: around rich text (the Markdown editor, or rendered Markdown). It highlights every thread's
 *   passage, follows the text as it is edited and laid out, offers Comment on a selection, and a click on a highlight
 *   opens its thread.
 * - `PassageCommentPane`: the standard comment pane for these threads: each card shows its field and quote (Passage
 *   changed, with the old quote, when the words are gone; the thread stays open), the filter menu (Open, Done, All),
 *   the New comment button (on words, on the whole page), the new comment box with its To chip, replies, Archive,
 *   Edit and Delete with Undo. Threads come newest first; `order="reading"` lists them in reading order instead. It
 *   draws in the host Comments panel beside the chat, never inside the Space (`hostComments`).
 */

import React, {
  useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent,
} from 'react';
import { pick, type Words } from '../../words';
import { ActionToast } from '../actions/ActionToast';
import { Badge, Button, EmptyState, Notice } from '../blocks';
import { ESCAPE_PRIORITY } from '../engine/core';
import { useEscapeLayer } from '../engine/hooks';
import { cx } from '../util';
import { CommentThreadCard, NewCommentBox, sendsOnEnter } from './CommentPane';
import { commentDraftKey, useCommentDraftText } from './commentDrafts';
import { CommentAttachButton, CommentDropVeil, CommentFileChips, useCommentFiles } from './commentFiles';
import { useRevealOnOpen } from './scrollReveal';
import type { CommentOrder, CommentThread } from './commentModel';
import {
  CommentFilterMenu, CommentListLoading, CommentModeHint, CommentPaneKeys, CommentThreadList, CommentToChip, NewCommentMenu, useAtThreadPicker,
  usePaneFocusKeeper, useThreadScroller, type CommentListOptions,
} from './paneParts';
import { locatePassage, passageAt, type PassageAnchor } from './passageModel';
import { createPortal } from 'react-dom';
import { markRetiredPane, useHostCommentSource, useHostComments } from './hostComments';
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

export function CommentableText(props: CommentableTextProps) {
  return useHostComments() ? <ShownCommentableText {...props} />
    : <div className={cx('nui-commentable', props.className)}>{props.children}</div>;
}

function ShownCommentableText({ comments, field, value, children, className }: CommentableTextProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<PassageAnchor | null>(null);
  const { controller } = comments;
  const mine = comments.threadsOn(field);
  const open = mine.filter(thread => thread.root.status === 'Open');
  // The words being commented on keep their highlight while the new comment is open (QB2-F11).
  const chosen = mine.some(thread => thread.root.recordKey === controller.threadKey) || comments.draft?.field === field;
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
/** Room the Comment button needs above a selection (its height and a gap). */
const PICK_ROOM_PX = 40;
/** The Comment button's size, and the gap it keeps from the words. */
const PICK_W = 120;
const PICK_H = 32;
const PICK_GAP = 8;
/** The key of the boxes drawn for the comment being written (never a thread's record key). */
const DRAFT_MARK = '\u0000draft';

/** How far right the button can go: the screen's edge, or the edge of the first box around the text that clips. */
function rightLimit(el: HTMLElement): number {
  const view = el.ownerDocument.defaultView;
  let limit = view?.innerWidth ?? Number.POSITIVE_INFINITY;
  let node: Node | null = el.parentNode;
  while (node && view) {
    if (node instanceof view.HTMLElement) {
      const style = view.getComputedStyle(node);
      if (style.overflowX !== 'visible' || style.overflow === 'hidden') {
        limit = Math.min(limit, node.getBoundingClientRect().right);
        break;
      }
      node = node.parentNode;
    } else if (node instanceof view.ShadowRoot) node = node.host;
    else break;
  }
  return limit;
}

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

/**
 * True when a word follows the selection on its last line, where the Comment button would sit after it: the next
 * character that is not white space starts on that line, before the button's far edge.
 */
function wordsAfter(nodes: Array<{ node: Text; start: number }>, text: string, end: number, last: DOMRect, origin: DOMRect): boolean {
  const skip = text.slice(end).search(/\S/);
  if (skip < 0) return false;
  const at = end + skip;
  const [next] = boxesOf(nodes, at, at + 1, origin);
  if (!next) return false;
  const top = next.top + origin.top;
  const left = next.left + origin.left;
  const sameLine = top < last.bottom - 1 && top + next.height > last.top + 1;
  return sameLine && left < last.right + PICK_GAP + PICK_W + PICK_GAP;
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

export function CommentableRichText(props: CommentableRichTextProps) {
  return useHostComments() ? <ShownCommentableRichText {...props} />
    : <div className={cx('nui-commentable', props.className)}>{props.children}</div>;
}

function ShownCommentableRichText({ comments, field, children, className }: CommentableRichTextProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const textRoot = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selected, setSelected] = useState<{ passage: PassageAnchor; top: number; left: number; place: 'margin' | 'end' | 'above' | 'below' } | null>(null);
  const { controller, flash, reportFound } = comments;
  const threadsHere = comments.threadsOn(field);
  const marks = threadsHere.flatMap(thread => {
    const passage = comments.passageOf(thread.root.recordKey);
    return passage ? [{ key: thread.root.recordKey, passage }] : [];
  });
  // The words of the comment being written keep a highlight while its box is open (QB2-F11).
  const draft = comments.draft?.field === field ? comments.draft : null;
  if (draft) marks.push({ key: DRAFT_MARK, passage: draft });
  const marksKey = marks.map(mark => `${mark.key}:${mark.passage.quote}:${mark.passage.prefix}:${mark.passage.suffix}`).join('|');
  // Archived threads keep no highlight unless the pane lists them (Done or All), like pins (SPC-126).
  const archivedShown = controller.statusFilter !== 'open';
  const archived = new Set(threadsHere.filter(thread => thread.root.status === 'Resolved').map(thread => thread.root.recordKey));
  const shownBoxes = boxes.filter(box => archivedShown || !archived.has(box.key));
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
      if (mark.key !== DRAFT_MARK) hits.add(mark.key);
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
    const all = textNodes(holder);
    const passage = passageAt(all.text, start, end);
    if (!passage) { setSelected(null); return; }
    const rects = Array.from(range.getClientRects?.() ?? []).filter(rect => rect.width > 0);
    const whole = range.getBoundingClientRect?.() ?? null;
    const first = rects[0] ?? whole;
    const last = rects[rects.length - 1] ?? whole;
    const origin = box.getBoundingClientRect();
    const next = { passage: { field, ...passage } };
    // The button never covers the selected line's words: in the margin right of the text when there is room, else just
    // after the end of the selection when nothing follows it on its line for the button's width (a phone's narrow
    // column: the sentence goes on after the selection), else above the selection (below it only at the top of the
    // screen).
    if (first && last && first.height > 0) {
      if (rightLimit(box) - origin.right >= PICK_W + 2 * PICK_GAP) {
        setSelected({ ...next, place: 'margin', left: origin.width + PICK_GAP,
          top: Math.max(0, first.top - origin.top + first.height / 2 - PICK_H / 2) });
        return;
      }
      if (origin.right - last.right >= PICK_W + PICK_GAP && !wordsAfter(all.nodes, all.text, end, last, origin)) {
        setSelected({ ...next, place: 'end', left: last.right - origin.left + PICK_GAP,
          top: last.top - origin.top + last.height / 2 - PICK_H / 2 });
        return;
      }
    }
    const above = Boolean(first && first.height > 0 && first.top >= PICK_ROOM_PX);
    setSelected({
      ...next,
      top: above ? first!.top - origin.top - 6 : last ? last.bottom - origin.top + 6 : 0,
      left: (above ? first : last) ? Math.max(0, Math.min((above ? first!.left : last!.right - 40) - origin.left, origin.width - PICK_W)) : 0,
      place: above ? 'above' : 'below',
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
    const hit = shownBoxes.find(b => b.key !== DRAFT_MARK && x >= b.left - 1 && x <= b.left + b.width + 1 && y >= b.top - 1 && y <= b.top + b.height + 1);
    if (hit) comments.openKey(hit.key, 'passage');
  };

  return (
    <div ref={wrap} className={cx('nui-passage-rich', className)}
      onMouseUp={readSelection} onKeyUp={readSelection} onTouchEnd={readSelection} onClick={onClick}
      onInput={() => setSelected(null)}>
      <div ref={textRoot} className="nui-passage-rich-text">{children}</div>
      {/* Above the text (an editor paints its own background); clicks and selections go through to it. */}
      {shownBoxes.map((box, index) => (
        <span
          key={`${box.key}-${index}`}
          data-passage={box.key === DRAFT_MARK ? undefined : box.key}
          aria-hidden="true"
          className="nui-passage-mark"
          data-state={box.key === DRAFT_MARK ? 'draft' : flash?.key === box.key ? 'flash'
            : controller.threadKey === box.key ? 'selected' : undefined}
          style={{ top: box.top, left: box.left - 1, width: box.width + 2, height: box.height }}
        />
      ))}
      {selected ? (
        <div className="nui-passage-pick" data-place={selected.place}
          style={{ top: selected.top, left: selected.left }}>
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
  // The text is kept while the pane is away (`commentDrafts`); usePassageComments brings the passage back.
  const draftKey = commentDraftKey(controller.draftScope, 'passage');
  const [body, setBody] = useCommentDraftText(draft ? draftKey : null);
  // Pictures and files, like every comment box (SPC-131): paste, drop on the box or the paperclip; kept with the text
  // while the pane is away.
  const files = useCommentFiles(controller, draftKey);
  const ref = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const atPicker = useAtThreadPicker(controller);
  const { clear: clearFiles } = files;
  const cancel = useCallback(() => { clearFiles(); comments.cancelDraft(); setBody(''); }, [comments, setBody, clearFiles]);
  const where = draft ? `${draft.field}:${draft.quote}` : null;
  useEffect(() => {
    if (!where) return;
    ref.current?.focus({ preventScroll: true });
  }, [where]);
  // A list scrolled down scrolls up to show the new box whole, with its quote and To chip, inside the pane only.
  useRevealOnOpen(boxRef, where);
  useEscapeLayer('comments.passage.new', () => { cancel(); return true; },
    { priority: ESCAPE_PRIORITY.selection + 1, enabled: draft != null });
  if (!draft) return null;
  const label = comments.field(draft.field)?.label;
  const canSend = (Boolean(body.trim()) || files.ready.length > 0) && files.settled && !comments.sending && controller.canWrite;
  const send = async () => {
    if (!canSend) return;
    // A failed save keeps the text and the attached files in the box.
    if (await comments.send(body, files.ready)) { setBody(''); files.clear(); }
  };
  return (
    <div ref={boxRef} className="nui-comment-new-box" role="group" aria-label={controller.say('newComment')}
      data-dragging={files.dragging ? '' : undefined} {...files.boxHandlers}>
      <div className="nui-comment-new-head">
        {label ? <p className="nui-passage-field-name">{pick(label, controller.locale)}</p> : <span />}
        <CommentToChip controller={controller} />
      </div>
      <p className="nui-passage-quote">{draft.quote}</p>
      <textarea
        ref={ref}
        className="nui-comment-input"
        value={body}
        rows={2}
        placeholder={controller.say('commentPlaceholder')}
        aria-label={controller.say('commentPlaceholder')}
        disabled={comments.sending}
        onChange={event => setBody(atPicker(event.target.value, event.currentTarget, setBody))}
        onKeyDown={event => {
          if (sendsOnEnter(event)) { event.preventDefault(); void send(); }
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (body.trim() || files.drafts.length) event.currentTarget.blur(); else cancel();
          }
        }}
      />
      <CommentFileChips controller={controller} files={files} />
      {comments.failed ? <p className="nui-passage-error" role="alert">{controller.say('saveError')}</p> : null}
      <div className="nui-comment-new-actions">
        <CommentAttachButton controller={controller} files={files} disabled={comments.sending} />
        <span className="nui-comment-new-gap" />
        <Button size="sm" variant="ghost" onClick={cancel}>{controller.words.cancel}</Button>
        <Button size="sm" variant="primary" disabled={!canSend} icon="paper-plane-right"
          onClick={() => void send()}>{controller.words.send}</Button>
      </div>
      <CommentDropVeil controller={controller} files={files} />
    </div>
  );
}

export interface PassageCommentPaneProps extends Omit<CommentListOptions, 'order'> {
  comments: PassageCommentController;
  /**
   * The order of the threads. Default 'newest' (SPC-116). 'reading' keeps reading order (open threads first, each in
   * the order of the fields and their words), as panes beside a document often want.
   */
  order?: CommentOrder | 'reading';
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

export const PassageCommentPane = markRetiredPane(function PassageCommentPane(props: PassageCommentPaneProps) {
  const { comments } = props;
  const inner = comments.controller;
  // What the host reads: the threads (its waiting count) and the new comment, on words or the page (it opens the panel).
  const target = useHostCommentSource('passage', comments, { title: props.title },
    [inner.threads, comments.draft, inner.draftPin, inner.threadKey, inner.commentMode]);
  return target ? createPortal(<PassageCommentPaneBody {...props} />, target) : null;
});

function PassageCommentPaneBody({ comments, onClose, title, groups, onGroup, className, order = 'newest', groupBy }: PassageCommentPaneProps) {
  const { controller, draft } = comments;
  const rootRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useThreadScroller(controller, scrollRef);
  const heading = title ?? controller.say('comments');
  const threads = comments.threads();
  const open = threads.filter(thread => thread.root.status === 'Open');
  const resolved = threads.filter(thread => thread.root.status === 'Resolved');
  const status = controller.statusFilter;
  const shown = status === 'all' ? threads : status === 'done' ? resolved : open;
  const draftGroup = draft ? comments.field(draft.field)?.group ?? null : null;
  const draftHere = draft && (comments.group == null || draftGroup == null || draftGroup === comments.group) ? draft : null;
  usePaneFocusKeeper(rootRef, shown);
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
          // Passage changed: the words are gone from the text. The old quote stays and the thread stays open.
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
  if (controller.error && !controller.hasData && !controller.loading) {
    body = <Notice tone="danger" onRetry={() => void controller.refetch()}>{controller.say('readError')}</Notice>;
  } else if (!shown.length && !draftHere && !controller.draftPin && controller.loading) {
    body = <CommentListLoading controller={controller} />;
  } else if (!shown.length && !draftHere && !controller.draftPin && controller.hasData) {
    body = (
      <EmptyState className="nui-comment-empty" icon="chat-circle-text"
        title={status === 'done' ? controller.say('emptyResolved') : controller.say('emptyPassages')} />
    );
  }

  return (
    <CommentPaneKeys controller={controller} rootRef={rootRef}>
      <aside ref={rootRef} className={cx('nui-comment-pane', className)} aria-label={heading}>
        <div className="nui-comment-pane-head">
          <h2 className="nui-comment-pane-title">{heading}</h2>
          <NewCommentMenu controller={controller} />
          <CommentFilterMenu controller={controller}
            counts={{ open: open.length, done: resolved.length, all: threads.length }} />
          {onClose ? (
            <Button variant="ghost" size="sm" className="nui-comment-icon-btn" icon="x" aria-label={controller.say('closeComments')}
              onClick={onClose} />
          ) : null}
        </div>
        {/* The pane scrolls its own list; the toast below stays at the bottom of what shows (C7). */}
        <div ref={scrollRef} className="nui-comment-pane-scroll" data-comment-scroll="">
        {draftHere ? <PassageCommentBox comments={comments} />
          : controller.draftPin ? <NewCommentBox controller={controller} />
          : controller.commentMode ? <CommentModeHint controller={controller} />
          : shown.length ? <p className="nui-passage-hint">{controller.say('selectToComment')}</p> : null}
        {body}
        {shown.length ? (
          <CommentThreadList controller={controller} threads={shown} order={order === 'reading' ? 'anchor' : order}
            groupBy={groupBy}>
            {card}
          </CommentThreadList>
        ) : null}
        {others.map(item => (
          <button key={item.group} type="button" className="nui-passage-other" onClick={() => onGroup?.(item.group)}>
            {controller.say('inGroup', { n: item.count, group: pick(item.label, controller.locale) })}
          </button>
        ))}
        </div>
        <ActionToast toast={controller.toaster.toast} onUndo={() => void controller.toaster.undo()}
          onDismiss={controller.toaster.dismiss} />
      </aside>
    </CommentPaneKeys>
  );
}
