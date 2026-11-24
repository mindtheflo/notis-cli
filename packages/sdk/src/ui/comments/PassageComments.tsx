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
import { CommentThreadCard, NewCommentBox, NewCommentFrame, commentWaitingChoices } from './CommentPane';
import { reviewRunKept, useNextCardComesIntoPlace, useReviewRunPane } from './reviewRun';
import { commentDraftKey, useCommentDraftText } from './commentDrafts';
import { useCommentFiles } from './commentFiles';
import type { CommentOrder, CommentThread } from './commentModel';
import {
  CommentListLoading, CommentListMore, CommentModeHint, CommentPaneBar, CommentPaneKeys, CommentThreadList,
  usePaneFocusKeeper, useThreadScroller, type CommentListOptions,
} from './paneParts';
import {
  PASSAGE_COMMENT_EVENT, SELECTION_BAR_COMMENTS_ATTR, locatePassage, passageAt, type PassageAnchor,
} from './passageModel';
import { createPortal } from 'react-dom';
import { trimRange } from '../../components/selectionRange';
import { markHostPane, useHostCommentSource, useHostComments } from './hostComments';
import { useHandedPaneKey } from './handover';
import { usePaneOutlet } from './paneOutlet';
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

/** Where a range starts and ends in the text of holder. */
function rangeOffsets(holder: Node, range: Range): { start: number; end: number } {
  const before = (holder.ownerDocument ?? document).createRange();
  before.selectNodeContents(holder);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { start, end: start + range.toString().length };
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
type SelectionEnds = { startContainer: Node; startOffset: number; endContainer: Node; endOffset: number };
const endsOf = (range: Range): SelectionEnds => ({ startContainer: range.startContainer, startOffset: range.startOffset,
  endContainer: range.endContainer, endOffset: range.endOffset });
const sameEnds = (a: SelectionEnds, b: SelectionEnds) => a.startContainer === b.startContainer
  && a.startOffset === b.startOffset && a.endContainer === b.endContainer && a.endOffset === b.endOffset;
/** How long a touch selection rests before the Comment button is placed for it again. */
const TOUCH_SETTLE_MS = 450;

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

  // The selection the Comment button was placed for: it goes as soon as the selection is cleared (a click away, Cite),
  // leaves the text or becomes another one, until that one is read again (MGR-386, SPC-470).
  const readEnds = useRef<SelectionEnds | null>(null);
  const readSelection = () => {
    const box = wrap.current;
    const root = textRoot.current;
    if (!box || !root) return;
    const holder = textHolder(root);
    const selection = selectionOf(root);
    const live = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    // A paragraph selection ends at the next block's start, outside this text: read it up to its last word.
    const range = live && trimRange(live);
    readEnds.current = null;
    if (!live || !range || range.collapsed || !holder.contains(range.startContainer) || !holder.contains(range.endContainer)) {
      setSelected(null);
      return;
    }
    // The Space page's selection bar shows Comment next to Cite for this text: no second button (SPC-487).
    if (box.closest(`[${SELECTION_BAR_COMMENTS_ATTR}]`)) { setSelected(null); return; }
    readEnds.current = endsOf(live);
    const all = textNodes(holder);
    const { start, end } = rangeOffsets(holder, range);
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

  const shown = selected != null;
  // The touch settle timer keeps the listener below alive while Comment is hidden, so every newer move restarts the
  // wait and only the last stop is read. It is cancelled by a newer move or on unmount.
  const settleRef = useRef<{ view: Window; id: number } | null>(null);
  const [settling, setSettling] = useState(false);
  useEffect(() => () => {
    const settle = settleRef.current;
    if (settle) settle.view.clearTimeout(settle.id);
  }, []);
  useEffect(() => {
    const root = textRoot.current;
    if (!(shown || settling) || !root) return undefined;
    const document = root.ownerDocument;
    const view = document.defaultView;
    const scope = root.getRootNode() as Document | ShadowRoot;
    const onSelectionChange = () => {
      const selection = selectionOf(root);
      const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
      const kept = readEnds.current;
      if (range && !range.collapsed && kept && sameEnds(endsOf(range), kept)) return;
      setSelected(null);
      // A touch selection has no mouse or key up when its handles move: it is read once they stop.
      if (settleRef.current) settleRef.current.view.clearTimeout(settleRef.current.id);
      settleRef.current = null;
      if (view && range && !range.collapsed && view.matchMedia?.('(pointer: coarse)').matches) {
        const id = view.setTimeout(() => {
          settleRef.current = null;
          setSettling(false);
          readSelectionRef.current();
        }, TOUCH_SETTLE_MS);
        settleRef.current = { view, id };
        setSettling(true);
      } else {
        setSettling(false);
      }
    };
    document.addEventListener('selectionchange', onSelectionChange);
    if (scope !== document) scope.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      if (scope !== document) scope.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [shown, settling]);
  const readSelectionRef = useRef(readSelection);
  readSelectionRef.current = readSelection;

  // The Space page's selection bar pressed Comment on words of this text: a new comment on them, as this text's own
  // button would start (SPC-487).
  const startDraftRef = useRef(comments.startDraft);
  startDraftRef.current = comments.startDraft;
  useEffect(() => {
    const root = textRoot.current;
    if (!root) return undefined;
    const onComment = (event: Event) => {
      const range = (event as CustomEvent<{ range?: Range }>).detail?.range;
      const holder = textHolder(root);
      if (!range || range.collapsed || !holder.contains(range.startContainer) || !holder.contains(range.endContainer)) return;
      const { start, end } = rangeOffsets(holder, range);
      const passage = passageAt(textNodes(holder).text, start, end);
      if (!passage) return;
      event.preventDefault();
      setSelected(null);
      startDraftRef.current({ field, ...passage });
    };
    root.addEventListener(PASSAGE_COMMENT_EVENT, onComment);
    return () => root.removeEventListener(PASSAGE_COMMENT_EVENT, onComment);
  }, [field]);

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

/**
 * Whether a quote names its field: only when more than one commentable text is on screen, so a page with one text
 * reads like a Notes page (SPC-489).
 */
function namesFields(comments: PassageCommentController): boolean {
  return comments.fields.filter(item => comments.group == null || item.group == null || item.group === comments.group).length > 1;
}

/** The box of a new comment on selected words: the shared new comment box, with the words as its quote pill. */
function PassageCommentBox({ comments }: { comments: PassageCommentController }) {
  const { controller, draft } = comments;
  // The text is kept while the pane is away (`commentDrafts`); usePassageComments brings the passage back.
  const draftKey = commentDraftKey(controller.draftScope, 'passage');
  const [body, setBody] = useCommentDraftText(draft ? draftKey : null);
  // Pictures and files, like every comment box (SPC-131): paste, drop on the box or the paperclip; kept with the text
  // while the pane is away.
  const files = useCommentFiles(controller, draftKey);
  if (!draft) return null;
  const label = namesFields(comments) ? comments.field(draft.field)?.label : undefined;
  return (
    <NewCommentFrame controller={controller}
      label={label ? `${controller.say('newCommentText')} · ${pick(label, controller.locale)}` : controller.say('newCommentText')}
      quote={draft.quote} place={null} where={`${draft.field}:${draft.quote}`} body={body} setBody={setBody} files={files}
      failed={comments.failed} sending={comments.sending} draftKey={draftKey}
      cancel={() => { comments.cancelDraft(); setBody(''); }}
      save={(text, uploaded) => comments.send(text, uploaded)} />
  );
}

export interface PassageCommentPaneProps extends Omit<CommentListOptions, 'order'> {
  comments: PassageCommentController;
  /**
   * The order of the threads. Default 'newest' (SPC-116). 'reading' keeps reading order (open threads first, each in
   * the order of the fields and their words), as panes beside a document often want.
   */
  order?: CommentOrder | 'reading';
  /**
   * Kept for Spaces written before the host drew the Comments panel: the panel's own header row has the close button,
   * so the pane draws none and never calls this.
   */
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

export const PassageCommentPane = markHostPane(function PassageCommentPane(props: PassageCommentPaneProps) {
  const { comments } = props;
  const inner = comments.controller;
  // What the host reads: the threads (its waiting count) and the new comment, on words or the page (it opens the panel).
  const target = useHostCommentSource('passage', comments, { title: props.title },
    [inner.threads, comments.draft, inner.draftPin, inner.threadKey, inner.commentMode]);
  // A host that draws panes itself keeps this one's elements when a new version of the view replaces this view.
  const key = useHandedPaneKey(inner, 'passage');
  const body = <PassageCommentPaneBody {...props} />;
  const hosted = usePaneOutlet(target, key, body, !inner.loading);
  return target && !hosted ? createPortal(body, target) : null;
});

function PassageCommentPaneBody({ comments, title, groups, onGroup, className, order = 'newest', groupBy }: PassageCommentPaneProps) {
  const { controller, draft } = comments;
  const rootRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useThreadScroller(controller, scrollRef);
  const heading = title ?? controller.say('comments');
  const threads = comments.threads();
  const open = threads.filter(thread => thread.root.status === 'Open');
  const resolved = threads.filter(thread => thread.root.status === 'Resolved');
  const status = controller.statusFilter;
  const waiting = open.filter(controller.waits);
  // Under "Waiting for you" a card answered while nothing moves by itself stays listed, showing its answer.
  const shown = controller.waitingFilter ? open.filter(thread => controller.waits(thread) || reviewRunKept(thread.root.recordKey))
    : status === 'all' ? threads : status === 'done' ? resolved : open;
  const draftGroup = draft ? comments.field(draft.field)?.group ?? null : null;
  const draftHere = draft && (comments.group == null || draftGroup == null || draftGroup === comments.group) ? draft : null;
  usePaneFocusKeeper(rootRef, shown);
  const run = useReviewRunPane({ controller, rootRef, threads, drafting: Boolean(draftHere || controller.draftPin), asking: commentWaitingChoices });
  useNextCardComesIntoPlace(rootRef, `${controller.filter}|${controller.statusFilter}|${controller.waitingFilter}|${controller.anchorKey ?? ''}`);
  const others = groups && onGroup ? Object.entries(groups).filter(([group]) => group !== comments.group).map(([group, label]) => ({
    group, label, count: comments.threads(group).filter(thread => thread.root.status === 'Open'
      && comments.passageOf(thread.root.recordKey) != null).length,
  })).filter(item => item.count > 0) : [];

  const card = (thread: CommentThread) => {
    const passage = comments.passageOf(thread.root.recordKey);
    const label = passage && namesFields(comments) ? comments.field(passage.field)?.label : undefined;
    const gone = comments.isChanged(thread.root.recordKey);
    // The card itself starts with the quoted words (the field's name only when it quotes none), as every comments list.
    return (
      <CommentThreadCard key={thread.root.recordKey} controller={controller} thread={thread}
        passageQuote={passage?.quote ?? null} passageGone={gone}
        placeLabel={!passage && label ? pick(label, controller.locale) : null}
        onSelect={picked => comments.open(picked, 'quote')} />
    );
  };

  let body: ReactNode = null;
  if (controller.error && !controller.hasData && !controller.loading) {
    body = <Notice tone="danger" onRetry={() => void controller.refetch()}>{controller.say('readError')}</Notice>;
  } else if (!shown.length && !draftHere && !controller.draftPin && (controller.loading || controller.loadingMore)) {
    body = <CommentListLoading controller={controller} />;
  } else if (!shown.length && !draftHere && !controller.draftPin && controller.hasMore) {
    // Older Done threads are left to read: the list's end below reads them, and "No comments" waits for the last.
    body = null;
  } else if (!shown.length && !draftHere && !controller.draftPin && controller.hasData) {
    // The hint shows only on an empty list of open comments.
    // In a review run the host says what the empty list means (the next page, or "All caught up").
    body = controller.waitingFilter ? (run.running && run.count !== null ? null : (
      <EmptyState className="nui-comment-empty" icon="chat-circle-text" title={controller.say('emptyWaiting')} />
    )) : (
      <EmptyState className="nui-comment-empty" icon="chat-circle-text"
        title={status === 'done' ? controller.say('emptyResolved') : controller.say('emptyAll')}
        body={status === 'done' ? undefined : controller.say('selectToComment')} />
    );
  }

  return (
    <CommentPaneKeys controller={controller} rootRef={rootRef}>
      <aside ref={rootRef} className={cx('nui-comment-pane', className)} aria-label={heading} {...run.attrs}>
        <CommentPaneBar controller={controller} rootRef={rootRef} showCopy={false} waitingCount={waiting.length} runCount={run.count} />
        {/* The pane scrolls its own list; the toast below stays at the bottom of what shows (C7). */}
        <div ref={scrollRef} className="nui-comment-pane-scroll" data-comment-scroll="">
        {draftHere ? <PassageCommentBox comments={comments} />
          : controller.draftPin ? <NewCommentBox controller={controller} />
          : controller.commentMode ? <CommentModeHint controller={controller} /> : null}
        {body}
        {shown.length ? (
          <CommentThreadList controller={controller} threads={shown} order={order === 'reading' ? 'anchor' : order}
            groupBy={groupBy}>
            {card}
          </CommentThreadList>
        ) : null}
        {/* Older Done threads are read a page at a time, as the end of the list comes into view. */}
        {controller.hasMore && !draftHere && !controller.draftPin && (shown.length || !controller.loadingMore)
          ? <CommentListMore controller={controller} /> : null}
        {others.map(item => (
          <button key={item.group} type="button" className="nui-passage-other" onClick={() => onGroup?.(item.group)}>
            {controller.say('inGroup', { n: item.count, group: pick(item.label, controller.locale) })}
          </button>
        ))}
        {/* What the host adds after the last card (the review run's next page). */}
        {draftHere || controller.draftPin ? null : <slot name="after-list" />}
        </div>
        {/* The review run's bar when no card is selected: the selected card holds it. */}
        <slot name="run-bar" />
        <ActionToast toast={controller.toaster.toast} onUndo={() => void controller.toaster.undo()}
          onDismiss={controller.toaster.dismiss} />
      </aside>
    </CommentPaneKeys>
  );
}
