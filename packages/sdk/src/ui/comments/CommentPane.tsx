/**
 * The comment pane and its pieces, rendered from a `useComments` controller:
 *
 * - `CommentPane`: the comments of the view in the host Comments panel beside the chat (the filter menu with Open, Done
 *   and All, the New comment button listing the Space's modes, Copy changes, the new comment box with its To chip, the
 *   thread cards and the Undo toast). It draws nothing inside the Space, and nothing at all while the host shows no
 *   comments (`hostComments`). Threads come flat, newest first; on the Space home (no scope) they group by page. Pass
 *   `order` and `groupBy` to list them your way.
 * - `CommentPins`: the numbered pins and zones on the anchor element. Put it inside the element the comments sit on (a
 *   slide, a section) and give that element `position: relative`. With `controller.commenting` on it covers the element:
 *   a click drops a pin, a press and drag marks a zone (when the table has zone columns). The pane's "Comment on this
 *   item" starts a comment on the whole anchor, with no pin.
 * - `CommentToolBar`: the comment tool bar on the page, one button per mode, toggled with C (SPC-118).
 * - `CommentThreadCard`, `NewCommentBox` and `CommentAvatar` for Spaces that lay the pane out themselves.
 *
 * A card archives (E) and unarchives (Shift+E) with an Undo toast (Z), edits your own comments in place and deletes at
 * once with Undo, as the viewer's rights allow. At its top, "Thread <title>" names the thread that owns it (or "Goes to"
 * the thread a reply would go to). Each signature names who wrote the comment; an agent's carries its harness logo, with
 * what it ran on in a hover card (`CommentAgentBadge`). A band name reads "Fred And The Machine" (`agentDisplayName`).
 *
 * Files: with an Attachments files column and a host that uploads (`runtime.spaceFiles`), a new comment and a reply take
 * pictures and files: paste, drop on the box or the paperclip (`commentFiles`). Otherwise the boxes take text only.
 *
 * Keyboard: Enter sends a reply or a new comment and Shift+Enter adds a line; Escape in an empty new comment drops it
 * (with text, the first Escape leaves the field); Escape leaves a comment mode; a thread card selects with Enter; with
 * focus in the pane, E archives the focused thread and Shift+E unarchives it.
 */

import React, {
  useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent,
} from 'react';
import type { KeySpec } from '../../words';
import { ActionToast } from '../actions/ActionToast';
import { Badge, Button, EmptyState, SegmentedControl } from '../blocks';
import { AttachmentGallery, ImageViewer } from '../gallery';
import { ESCAPE_PRIORITY } from '../engine/core';
import { useEscapeLayer, useShortcuts } from '../engine/hooks';
import { Icon } from '../icons';
import { Tooltip } from '../overlay';
import { cx, useIsoLayoutEffect } from '../util';
import { CommentAgentBadge } from './agentRuntime';
import {
  COMMENT_CHECK_ANSWERS, COMMENT_TEXT_FILE, agentDisplayName, clipCommentAnswer, commentAttachmentFor, commentBodyParts, commentRelativeTime, commentReplyRuns, formatCommentTime,
  isCommentZone, scrollCommentIntoView, type CommentAttachment, type CommentRecord, type CommentThread,
} from './commentModel';
import { commentDraftKey, useCommentDraftText } from './commentDrafts';
import { useRevealOnOpen } from './scrollReveal';
import { CommentAttachButton, CommentDropVeil, CommentFileChips, useCommentFiles } from './commentFiles';
import { createPortal } from 'react-dom';
import { markRetiredPane, useHostCommentSource, useHostComments } from './hostComments';
import {
  COMMENT_MODE_ICON, COMMENT_MODE_WORD, CommentFilterMenu, CommentGoesTo, CommentListLoading, CommentModeHint, CommentPaneKeys, CommentThreadList,
  CommentToChip, NewCommentMenu, commentIdleHint, commentPlaceMeta, useAtThreadPicker, usePaneFocusKeeper, useThreadScroller,
  type CommentListOptions,
} from './paneParts';
import type { CommentController } from './useComments';

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

export interface CommentAvatarProps {
  author: string;
  /** The person using the Space: their avatar is filled, everyone else's is quiet. */
  me?: string;
  className?: string;
}

/**
 * "From {name}", a link to the agent's thread for the person whose agent it is: the source of a comment an agent wrote,
 * for a Space that lays its cards out itself. The pane's cards no longer show it: the thread that owns a comment thread
 * is named once at its top, and each signature names only who wrote.
 */
export function CommentAgentSource({ controller, comment }: { controller: CommentController; comment: CommentRecord }) {
  const agent = comment.agent;
  if (!agent) return null;
  const name = agentDisplayName(agent.name);
  const label = controller.say('fromAgent', { name });
  const content = <><Icon name="arrows-left-right" /><span className="nui-comment-agent-name">{label}</span></>;
  const open = controller.openThread;
  if (!agent.threadId || !open) return <span className="nui-comment-agent">{content}</span>;
  const threadId = agent.threadId;
  return (
    <button type="button" className="nui-comment-agent" data-agent-thread={threadId}
      aria-label={controller.say('openAgentThread', { name })}
      onClick={event => { event.stopPropagation(); open(threadId); }}>
      {content}
    </button>
  );
}

/** The author's initial. Decorative: the author's name is always written next to it. */
export function CommentAvatar({ author, me, className }: CommentAvatarProps) {
  return (
    <span aria-hidden="true" className={cx('nui-comment-avatar', className)} data-me={author === me ? '' : undefined}>
      {(agentDisplayName(author).trim().slice(0, 1) || '?').toUpperCase()}
    </span>
  );
}

/** An icon button: `label` is its short tooltip, `name` (default the label) what a screen reader says. */
function IconAction({ label, name, icon, onClick, disabled }: {
  label: string; name?: string; icon: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <Tooltip label={label}>
      <Button variant="ghost" size="sm" className="nui-comment-icon-btn" aria-label={name || label} disabled={disabled}
        onClick={onClick} icon={<Icon name={icon} />} />
    </Tooltip>
  );
}

/** The start of a comment's text for a button's name: about 40 characters, cut at a word. */
export function commentExcerpt(comment: Pick<CommentRecord, 'body' | 'attachments'>): string {
  const text = comment.body.replace(/\s+/g, ' ').trim() || comment.attachments[0]?.label || '';
  if (text.length <= 40) return text;
  const cut = text.slice(0, 40);
  const space = cut.lastIndexOf(' ');
  return `${(space >= 20 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?]+$/, '')}...`;
}

/** A button's accessible name naming the comment it acts on, or the short label for a comment with no text. */
function namedAction(controller: CommentController, key: Parameters<CommentController['say']>[0], short: string,
  comment: CommentRecord, vars: Readonly<Record<string, string>> = {}): string {
  const excerpt = commentExcerpt(comment);
  return excerpt ? controller.say(key, { ...vars, excerpt }) : short;
}

/** An ask's sentence ("Claude needs a choice") with the asker's name bold. */
function AskLabel({ controller, comment }: { controller: CommentController; comment: CommentRecord }) {
  const key = comment.needs === 'check' ? 'askCheck' : comment.needs === 'choice' ? 'askChoice' : 'askInput';
  const mark = '\u0000';
  const [before = '', after = ''] = controller.say(key, { who: mark }).split(mark);
  return (
    <p className="nui-comment-ask-label">
      {before}<span className="nui-comment-ask-who">{agentDisplayName(comment.author)}</span>{after}
    </p>
  );
}

function answerLabel(controller: CommentController, answer: string): string {
  if (answer === COMMENT_CHECK_ANSWERS[0]) return controller.say('looksGood');
  if (answer === COMMENT_CHECK_ANSWERS[1]) return controller.say('undo');
  return answer;
}

function stop(event: { stopPropagation(): void }) { event.stopPropagation(); }

/** Enter sends a comment; Shift+Enter, and Enter while composing an accented letter, add to the text. */
export function sendsOnEnter(event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing;
}

/** The answers an ask offers: the author's Options, or Looks good and Undo for a check without its own. */
function askChoices(root: CommentRecord): string[] {
  if (root.needs === 'check') return root.options.length ? root.options : [...COMMENT_CHECK_ANSWERS];
  return root.needs === 'choice' ? root.options : [];
}

/** True when the ask's options are named like its pictures: they are answered from under each picture. */
function pictureAskOf(comment: CommentRecord): boolean {
  const choices = askChoices(comment);
  return choices.some(option => commentAttachmentFor(option, comment.attachments));
}

/**
 * A comment's text with its links opening in a new tab, each named by its host and path. Blank lines before and after
 * the text are left out (an agent's text often starts with one), so it starts right under its name line.
 */
function CommentBody({ body }: { body: string }) {
  const text = body.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
  if (!text) return null;
  return (
    <p className="nui-comment-body">
      {commentBodyParts(text).map((part, index) => 'href' in part ? (
        <a key={index} className="nui-comment-link" href={part.href} target="_blank" rel="noopener noreferrer"
          title={part.href} onClick={stop}>{part.label}</a>
      ) : <React.Fragment key={index}>{part.text}</React.Fragment>)}
    </p>
  );
}

/**
 * The pictures and files shown with a comment. A picture opens in the image viewer, with every picture of the comment.
 * While an ask waits, an option named like a picture is answered from under it and from the viewer's bar.
 */
function CommentAttachments({ controller, comment, choices = [], onAnswer }: {
  controller: CommentController; comment: CommentRecord; choices?: readonly string[]; onAnswer?: (answer: string) => void;
}) {
  const [viewing, setViewing] = useState<number | null>(null);
  const images = comment.attachments.filter(item => item.image);
  const files = comment.attachments.filter(item => !item.image);
  if (!images.length && !files.length) return null;
  const busy = controller.busy.has(comment.recordKey);
  const optionOf = (item: CommentAttachment | undefined) =>
    item ? choices.find(option => commentAttachmentFor(option, [item]) === item) : undefined;
  return (
    <div className="nui-comment-attachments" role="group" aria-label={controller.say('attachments')} onClick={stop} onKeyDown={stop}>
      {images.length ? (
        <div className="nui-comment-pictures" data-count={Math.min(images.length, 2)}>
          {images.map((item, index) => {
            const option = optionOf(item);
            const chosen = option != null && comment.answer === option;
            return (
              <figure key={item.url} className="nui-comment-figure" data-chosen={chosen ? '' : undefined}>
                <button type="button" className="nui-comment-thumb" aria-label={controller.say('enlarge', { name: item.label })}
                  onClick={() => setViewing(index)}>
                  <img src={item.url} alt={item.label} loading="lazy" onError={controller.refreshFiles} />
                </button>
                {option != null && onAnswer ? (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAnswer(option)}>
                    {answerLabel(controller, option)}
                  </Button>
                ) : (
                  <figcaption className="nui-comment-caption">
                    {chosen ? <Icon name="check" /> : null}<span>{item.label}</span>
                  </figcaption>
                )}
              </figure>
            );
          })}
        </div>
      ) : null}
      {files.length ? (
        <AttachmentGallery items={files.map(item => ({ url: item.url, name: item.name }))} />
      ) : null}
      {viewing != null ? (
        <ImageViewer images={images.map(item => ({ src: item.url, alt: item.label }))} initialIndex={viewing}
          onClose={() => setViewing(null)}
          actions={(_image, index) => {
            const option = optionOf(images[index]);
            return option != null && onAnswer ? (
              <button type="button" className="nui-viewer-btn" disabled={busy}
                onClick={() => { onAnswer(option); setViewing(null); }}>
                <Icon name="check" /><span>{answerLabel(controller, option)}</span>
              </button>
            ) : null;
          }} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread card
// ---------------------------------------------------------------------------

export interface CommentThreadCardProps {
  controller: CommentController;
  thread: CommentThread;
  /** Name the anchor in the card's meta line (when the pane lists every anchor). */
  showAnchor?: boolean;
}

/** Your own comment's text, edited in place: Enter saves, Shift+Enter adds a line, Escape cancels. */
function CommentEditBox({ controller, comment, onDone }: {
  controller: CommentController; comment: CommentRecord; onDone: () => void;
}) {
  const [text, setText] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    const ok = await controller.actions.edit(comment, text);
    setSaving(false);
    if (ok) onDone();
  };
  const label = controller.say('editComment');
  return (
    <div className="nui-comment-edit" role="group" aria-label={label} onClick={stop}>
      <textarea ref={ref} className="nui-comment-input" value={text} rows={2} aria-label={label}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          event.stopPropagation();
          if (sendsOnEnter(event)) { event.preventDefault(); void save(); }
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); onDone(); }
        }} />
      <div className="nui-comment-edit-actions">
        <Button size="sm" variant="ghost" onClick={onDone}>{controller.words.cancel}</Button>
        <Button size="sm" variant="primary" disabled={saving || (!text.trim() && !comment.attachments.length)}
          onClick={() => void save()}>{controller.words.save}</Button>
      </div>
    </div>
  );
}

/** "edited", after the time of a comment its author changed. */
function EditedMark({ controller, comment }: { controller: CommentController; comment: CommentRecord }) {
  return comment.editedAt ? <span className="nui-comment-edited">{controller.say('edited')}</span> : null;
}

/**
 * An agent's question on a comment (Needs check, choice or input), the first comment or a reply: its label, the
 * answer once sent, else the way to answer. An input ask is answered from its own field: the answer goes back as a reply
 * and fills that comment's Answer.
 */
function CommentAsk({ controller, thread, comment }: { controller: CommentController; thread: CommentThread; comment: CommentRecord }) {
  const { actions } = controller;
  // The answer being typed is kept while the pane is away, like a reply (`commentDrafts`).
  const [answerText, setAnswerText] = useCommentDraftText(comment.needs === 'input' && !comment.answer
    ? commentDraftKey(controller.draftScope, `answer:${comment.recordKey}`) : null);
  const [sending, setSending] = useState(false);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (comment.needs === 'none') return null;
  const busy = controller.busy.has(comment.recordKey);
  const needsLabel = comment.needs === 'check' ? controller.say('needCheck')
    : comment.needs === 'choice' ? controller.say('needChoice') : controller.say('needInput');
  const choices = askChoices(comment);
  const waiting = comment.needs !== 'input' && !comment.answer;
  // An input ask's answer is the person's reply under it (SPC-113 wakes the agent from it): the ask says it was answered
  // and shows the text only when no reply in the thread carries it.
  const answeredBelow = comment.needs === 'input' && Boolean(comment.answer) && thread.replies.some(reply =>
    reply.status !== 'Deleted' && !reply.agent && (reply.answerTo ? reply.answerTo === comment.recordKey
      : clipCommentAnswer(reply.body.trim()) === comment.answer.trim()));
  // Options named like a picture are answered from under it, inside the ask; the row below keeps the others.
  const rowChoices = choices.filter(option => !commentAttachmentFor(option, comment.attachments));
  const pictureAsk = rowChoices.length < choices.length;
  const canAnswer = Boolean(answerText.trim()) && !sending && controller.canWrite;
  const sendAnswer = async () => {
    if (!canAnswer) return;
    setSending(true);
    const ok = await actions.reply(thread, answerText.trim(), [], comment);
    setSending(false);
    if (ok) setAnswerText('');
  };
  const attach = async (file: File | undefined) => {
    if (!file) return;
    if (!(file.type.startsWith('text/') || COMMENT_TEXT_FILE.test(file.name))) { actions.notify(controller.words.textOnly); return; }
    const content = (await file.text()).slice(0, 8000);
    const current = answerRef.current?.value ?? answerText;
    setAnswerText(`${current ? `${current}\n\n` : ''}${file.name}\n${content}`);
    answerRef.current?.focus();
  };
  return (
    <div className="nui-comment-ask" data-ask={comment.recordKey} onClick={stop} onKeyDown={stop}>
      <AskLabel controller={controller} comment={comment} />
      {pictureAsk ? (
        <CommentAttachments controller={controller} comment={comment} choices={choices}
          onAnswer={waiting ? answer => actions.answer(comment, answer) : undefined} />
      ) : null}
      {comment.answer ? (
        <p className="nui-comment-answer">
          <Icon name="check" />
          <span>{answeredBelow ? controller.say('answeredInput')
            : controller.say('sent', { answer: answerLabel(controller, comment.answer).replace(/[\s.,;:!?…]+$/, '') })}</span>
        </p>
      ) : comment.needs === 'input' ? (
        <div className="nui-comment-ask-answer">
          <div className="nui-comment-compose">
            <textarea ref={answerRef} className="nui-comment-input" value={answerText} rows={1}
              placeholder={controller.say('answerPlaceholder')} aria-label={controller.say('answerPlaceholder')}
              onChange={event => setAnswerText(event.target.value)}
              onKeyDown={event => { if (sendsOnEnter(event)) { event.preventDefault(); void sendAnswer(); } }} />
            <IconAction label={controller.say('sendAnswer')} icon="paper-plane-right" disabled={!canAnswer}
              onClick={() => void sendAnswer()} />
          </div>
          <div className="nui-comment-choices">
            <Button size="sm" variant="secondary" disabled={busy} icon="paperclip"
              onClick={() => fileRef.current?.click()}>{controller.words.attach}</Button>
            <Button size="sm" variant="secondary" disabled={busy} icon="clipboard-text"
              onClick={() => answerRef.current?.focus()}>{controller.words.paste}</Button>
            <input ref={fileRef} type="file" className="nui-sr-only" tabIndex={-1} aria-hidden="true"
              accept="text/*,.md,.txt,.csv,.json"
              onChange={event => { void attach(event.target.files?.[0]); event.target.value = ''; }} />
          </div>
        </div>
      ) : rowChoices.length ? (
        <div className="nui-comment-choices" role="group" aria-label={needsLabel}>
          {rowChoices.map(choice => (
            <Button key={choice} size="sm" variant="secondary" disabled={busy}
              onClick={() => actions.answer(comment, choice)}>{answerLabel(controller, choice)}</Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CommentThreadCard({ controller, thread, showAnchor = false }: CommentThreadCardProps) {
  const { root, replies, anchor } = thread;
  const { actions, locale, now, isNew, me } = controller;
  // The reply being written, and its files, are kept while the pane is away (`commentDrafts`): another Space, a page
  // over the view or another brief unmounts the card, and the reply comes back with it.
  const replyKey = commentDraftKey(controller.draftScope, `reply:${root.recordKey}`);
  const [draft, setDraft] = useCommentDraftText(replyKey);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const files = useCommentFiles(controller, replyKey);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const resolved = root.status === 'Resolved';
  const selected = controller.threadKey === root.recordKey;
  const busy = controller.busy.has(root.recordKey);
  const number = controller.numberOf(thread);

  // In a pane's own scroller the pane scrolls the selected card into view (useThreadScroller); a card a Space lays out
  // itself scrolls its nearest scrolling box.
  useEffect(() => {
    const card = cardRef.current;
    if (selected && card && !card.closest('[data-comment-scroll]')) scrollCommentIntoView(card);
  }, [selected]);

  const canSend = (Boolean(draft.trim()) || files.ready.length > 0) && files.settled && !sending && controller.canWrite;
  const send = async () => {
    if (!canSend) return;
    setSending(true);
    // A failed save keeps the text and the attached files in the box.
    const ok = await actions.reply(thread, draft.trim(), files.ready);
    setSending(false);
    if (ok) { setDraft(''); files.clear(); }
  };

  const select = () => controller.selectThread(thread);
  const onCardKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
  };
  // Tabbing between cards moves the selected pin with the focus (the page does not move, nothing else changes).
  const onCardFocus = (event: React.FocusEvent<HTMLElement>) => {
    if (event.target === event.currentTarget && controller.threadKey !== root.recordKey) controller.setThreadKey(root.recordKey);
  };

  const pictureAsk = root.needs !== 'none' && pictureAskOf(root);
  const meta = [
    commentRelativeTime(root.createdAt, locale, now),
    showAnchor && anchor ? controller.say('anchorLabel', { n: anchor.order }) : '',
    number > 0 && root.x != null ? `#${number}` : '',
    ...commentPlaceMeta(controller, thread),
  ].filter(Boolean).join(' · ');
  const replyLabel = resolved ? controller.say('replyToReopen') : controller.say('reply');

  const newDot = (comment: CommentRecord) => isNew(comment)
    ? <span className="nui-comment-new" role="img" aria-label={controller.say('newActivity')} /> : null;

  const replyItem = (reply: CommentRecord) => (
    <li key={reply.recordKey} className="nui-comment-reply" data-comment={reply.recordKey}>
      <CommentAvatar author={reply.author} me={me} />
      <div className="nui-comment-reply-text">
        {/* The name line and the reply's buttons share one row, so the text starts right under it (no empty line). */}
        <div className="nui-comment-reply-head">
          <div className="nui-comment-who">
            <span className="nui-comment-author">{agentDisplayName(reply.author)}</span>
            <CommentAgentBadge controller={controller} comment={reply} />
            <span className="nui-comment-meta">{commentRelativeTime(reply.createdAt, locale, now)}</span>
            <EditedMark controller={controller} comment={reply} />
            {newDot(reply)}
          </div>
          {controller.canEdit(reply) || controller.canDelete(reply) ? (
            <span className="nui-comment-reply-actions" onClick={stop} onKeyDown={stop}>
              {controller.canEdit(reply) ? (
                <IconAction label={controller.say('editReply')} icon="pencil-simple"
                  name={namedAction(controller, 'editReplyNamed', controller.say('editReply'), reply)}
                  disabled={controller.busy.has(reply.recordKey)} onClick={() => setEditing(reply.recordKey)} />
              ) : null}
              {controller.canDelete(reply) ? (
                // The same reply reads the same on both buttons: "your reply" for the viewer's own, "{who}'s reply" else.
                <IconAction label={controller.say('deleteComment')} icon="trash"
                  name={controller.canEdit(reply)
                    ? namedAction(controller, 'deleteYourReply', controller.say('deleteComment'), reply)
                    : namedAction(controller, 'deleteReplyOf', controller.say('deleteComment'), reply, { who: agentDisplayName(reply.author) })}
                  disabled={controller.busy.has(reply.recordKey)} onClick={() => actions.remove(reply)} />
              ) : null}
            </span>
          ) : null}
        </div>
        {editing === reply.recordKey
          ? <CommentEditBox controller={controller} comment={reply} onDone={() => setEditing(null)} />
          : <CommentBody body={reply.body} />}
        {reply.needs !== 'none' && pictureAskOf(reply) ? null : <CommentAttachments controller={controller} comment={reply} />}
        {/* An agent's question in a reply is answered here too, like one on the first comment. */}
        <CommentAsk controller={controller} thread={thread} comment={reply} />
      </div>
    </li>
  );

  return (
    <article
      ref={cardRef}
      className="nui-comment-card"
      data-thread={root.recordKey}
      data-selected={selected ? '' : undefined}
      data-resolved={resolved ? '' : undefined}
      aria-current={selected ? 'true' : undefined}
      aria-label={controller.say('pin', { who: agentDisplayName(root.author), body: root.body })}
      tabIndex={0}
      onClick={select}
      onKeyDown={onCardKey}
      onFocus={onCardFocus}
    >
      {/* The thread that owns this comment thread, once at the top; the signatures name only who wrote (SPC-114). */}
      <CommentGoesTo controller={controller} thread={thread} />
      <header className="nui-comment-head">
        <CommentAvatar author={root.author} me={me} />
        <div className="nui-comment-who">
          <span className="nui-comment-author">{agentDisplayName(root.author)}</span>
          <CommentAgentBadge controller={controller} comment={root} />
          <span className="nui-comment-meta">{meta}</span>
          <EditedMark controller={controller} comment={root} />
          {newDot(root)}
        </div>
        <div className="nui-comment-actions" onClick={stop} onKeyDown={stop}>
          {resolved
            ? <IconAction label={controller.say('reopen')} icon="tray-arrow-up" disabled={busy}
                name={namedAction(controller, 'unarchiveThread', controller.say('reopen'), root)}
                onClick={() => actions.unarchive(root)} />
            : <IconAction label={controller.say('resolve')} icon="archive" disabled={busy}
                name={namedAction(controller, 'archiveThread', controller.say('resolve'), root)}
                onClick={() => actions.archive(root)} />}
          {/* A link that opens this page with the thread revealed (comment=<root key>), for someone else. */}
          <IconAction label={controller.say('copyLink')} icon="link" disabled={root.recordKey.startsWith('draft-')}
            name={namedAction(controller, 'copyLinkNamed', controller.say('copyLink'), root)}
            onClick={() => void actions.copyLink(root, cardRef.current)} />
          {controller.canEdit(root) ? (
            <IconAction label={controller.say('editRoot')} icon="pencil-simple" disabled={busy}
              name={namedAction(controller, 'editRootNamed', controller.say('editRoot'), root)}
              onClick={() => setEditing(root.recordKey)} />
          ) : null}
          {controller.canDelete(root) ? (
            <IconAction label={controller.say('deleteThread')} icon="trash" disabled={busy}
              name={namedAction(controller, 'deleteThreadNamed', controller.say('deleteThread'), root)}
              onClick={() => actions.remove(root)} />
          ) : null}
        </div>
      </header>

      {root.example || resolved ? (
        <div className="nui-comment-badges">
          {root.example ? <Badge>{controller.words.example}</Badge> : null}
          {resolved ? <Badge>{controller.words.resolved}</Badge> : null}
        </div>
      ) : null}
      {editing === root.recordKey
        ? <CommentEditBox controller={controller} comment={root} onDone={() => setEditing(null)} />
        : <CommentBody body={root.body} />}
      {pictureAsk ? null : <CommentAttachments controller={controller} comment={root} />}

      <CommentAsk controller={controller} thread={thread} comment={root} />

      {replies.length ? (
        <ol className="nui-comment-replies">
          {commentReplyRuns(replies).map(run => run.deleted ? (
            // Deleted replies leave one line per run, so the replies after them still read (SPC-127).
            <li key={run.replies[0]!.recordKey} className="nui-comment-reply" data-deleted="">
              <p className="nui-comment-deleted">{controller.say('commentDeleted')}</p>
            </li>
          ) : replyItem(run.reply))}
        </ol>
      ) : null}

      <div className="nui-comment-compose-box" data-dragging={files.dragging ? '' : undefined} onClick={stop} onKeyDown={stop}
        {...files.boxHandlers}>
        <CommentFileChips controller={controller} files={files} />
        <div className="nui-comment-compose">
          <textarea
            ref={replyRef}
            className="nui-comment-input"
            value={draft}
            rows={1}
            placeholder={replyLabel}
            aria-label={replyLabel}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (sendsOnEnter(event)) { event.preventDefault(); void send(); } }}
          />
          <CommentAttachButton controller={controller} files={files} disabled={sending} />
          <IconAction label={controller.say('send')} icon="paper-plane-right" disabled={!canSend}
            onClick={() => void send()} />
        </div>
        <CommentDropVeil controller={controller} files={files} />
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// New comment
// ---------------------------------------------------------------------------

export interface NewCommentBoxProps {
  controller: CommentController;
}

/**
 * The box for the comment `controller.draftPin` started. Takes focus when it opens. Its To chip names the thread the
 * comment goes to (the best match, or the one picked with the chip or by typing @ first).
 */
export function NewCommentBox({ controller }: NewCommentBoxProps) {
  const pin = controller.draftPin;
  // Text and files outlive the box while the pane is away (`commentDrafts`); the controller brings the pin back.
  const draftKey = commentDraftKey(controller.draftScope, 'new');
  const [body, setBody] = useCommentDraftText(pin ? draftKey : null);
  const [sending, setSending] = useState(false);
  const files = useCommentFiles(controller, draftKey);
  const ref = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const cancel = () => { files.clear(); controller.cancelPin(); };
  const atPicker = useAtThreadPicker(controller);
  const where = pin ? `${pin.anchorKey ?? ''}|${pin.items?.length ?? ''}|${pin.time ?? ''}` : null;
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, [where]);
  // The box opens at the top of the list: a list scrolled down scrolls up to show it whole, with its To chip.
  useRevealOnOpen(boxRef, where);
  // Escape drops the new comment: one step in the host's Escape chain. The engine leaves Escape to a focused text
  // field, so the textarea handles its own Escape below.
  useEscapeLayer('comments.new', () => { cancel(); return true; },
    { priority: ESCAPE_PRIORITY.selection + 1, enabled: pin != null });
  if (!pin) return null;
  const anchor = controller.anchors.find(item => item.recordKey === pin.anchorKey);
  const heading = pin.time != null ? controller.say('newCommentTime', { time: formatCommentTime(pin.time) })
    : pin.items && pin.items.length > 1 ? controller.say('newCommentItems', { n: pin.items.length })
    : pin.items?.length && !anchor ? controller.say('newCommentItem')
    : anchor && pin.x == null ? controller.say('newCommentWhole', { n: anchor.order })
    : anchor ? controller.say('newCommentOn', { n: anchor.order })
    : controller.anchors.length ? controller.say('newCommentPage') : controller.say('newComment');

  const canSend = (Boolean(body.trim()) || files.ready.length > 0) && files.settled && !sending && controller.canWrite;
  const send = async () => {
    if (!canSend) return;
    setSending(true);
    // A failed save keeps the text and the attached files in the box.
    const ok = await controller.sendNew(body.trim(), files.ready);
    setSending(false);
    if (ok) { setBody(''); files.clear(); }
  };

  return (
    <div ref={boxRef} className="nui-comment-new-box" role="group" aria-label={heading}
      data-dragging={files.dragging ? '' : undefined} {...files.boxHandlers}>
      <div className="nui-comment-new-head">
        <p className="nui-comment-new-title">{heading}</p>
        <CommentToChip controller={controller} />
      </div>
      <textarea
        ref={ref}
        className="nui-comment-input"
        value={body}
        rows={2}
        placeholder={controller.say('commentPlaceholder')}
        aria-label={controller.say('commentPlaceholder')}
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
      <div className="nui-comment-new-actions">
        <CommentAttachButton controller={controller} files={files} disabled={sending} />
        <span className="nui-comment-new-gap" />
        <Button size="sm" variant="ghost" onClick={cancel}>{controller.words.cancel}</Button>
        <Button size="sm" variant="primary" disabled={!canSend} icon="paper-plane-right"
          onClick={() => void send()}>{controller.words.send}</Button>
      </div>
      <CommentDropVeil controller={controller} files={files} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

export interface CommentPinsProps {
  controller: CommentController;
  /** The anchor the pins sit on. Default: `controller.anchorKey`. */
  anchorKey?: string | null;
  /**
   * A pin was pressed. Default: `controller.revealThread` (the thread is selected and the host shows its Comments
   * panel). A Space that handles it calls `controller.revealThread` itself to keep that.
   */
  onOpen?(thread: CommentThread): void;
}

/**
 * Numbered pins at each thread's x and y on the anchor element, the zones threads mark, and the pin or zone of the
 * comment being written. In Add comment mode it also covers the element to take the click or drag that places one.
 */
export function CommentPins(props: CommentPinsProps) {
  return useHostComments() ? <ShownCommentPins {...props} /> : null;
}

function ShownCommentPins({ controller, anchorKey, onOpen }: CommentPinsProps) {
  const key = anchorKey === undefined ? controller.anchorKey : anchorKey;
  // Archived threads keep no pin on the page unless the pane lists them (the Done or All filter).
  const archivedShown = controller.statusFilter !== 'open';
  const pins = controller.threadsOn(key).filter(thread => thread.root.x != null && thread.root.y != null
    && (archivedShown || thread.root.status !== 'Resolved'));
  const draft = controller.draftPin;
  const drag = controller.dragZone;
  const here = (key ?? null);
  const open = (event: ReactMouseEvent, thread: CommentThread) => {
    event.stopPropagation();
    if (onOpen) onOpen(thread); else controller.revealThread(thread);
  };
  const box = (zone: { x: number; y: number; w: number; h: number }) =>
    ({ left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `${zone.w * 100}%`, height: `${zone.h * 100}%` });
  return (
    <>
      {controller.commenting ? (
        <div className="nui-comment-capture" aria-hidden="true" {...controller.zoneHandlers(here)}
          onClick={event => event.stopPropagation()} />
      ) : null}
      {pins.filter(thread => isCommentZone(thread.root)).map(thread => (
        <span
          key={`zone-${thread.root.recordKey}`}
          className="nui-comment-zone"
          aria-hidden="true"
          data-selected={thread.root.recordKey === controller.threadKey ? '' : undefined}
          data-resolved={thread.root.status === 'Resolved' ? '' : undefined}
          style={box({ x: thread.root.x!, y: thread.root.y!, w: thread.root.w!, h: thread.root.h! })}
        />
      ))}
      {pins.map(thread => (
        <button
          key={thread.root.recordKey}
          type="button"
          className="nui-comment-pin"
          data-agent={thread.root.author !== controller.me ? '' : undefined}
          data-selected={thread.root.recordKey === controller.threadKey ? '' : undefined}
          data-resolved={thread.root.status === 'Resolved' ? '' : undefined}
          style={{ left: `${thread.root.x! * 100}%`, top: `${thread.root.y! * 100}%` }}
          aria-label={controller.say(isCommentZone(thread.root) ? 'zone' : 'pin', { who: agentDisplayName(thread.root.author), body: thread.root.body })}
          onClick={event => open(event, thread)}
        >
          {controller.numberOf(thread)}
        </button>
      ))}
      {drag && drag.anchorKey === here ? (
        <span className="nui-comment-zone" data-draft="" data-selected="" aria-hidden="true" style={box(drag)} />
      ) : null}
      {draft && draft.anchorKey === here && draft.x != null && draft.y != null ? (
        <>
          {isCommentZone(draft) ? (
            <span className="nui-comment-zone" data-draft="" data-selected="" aria-hidden="true"
              style={box({ x: draft.x, y: draft.y, w: draft.w!, h: draft.h! })} />
          ) : null}
          <span className="nui-comment-pin" data-draft="" data-selected="" aria-hidden="true"
            style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }}>+</span>
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tool bar
// ---------------------------------------------------------------------------

export interface CommentToolBarProps {
  controller: CommentController;
  /**
   * The key that shows and hides the tool bar. Default 'c' (SPC-118), registered as a Notis key while the tool bar is
   * mounted, so it wins over Notis's own C (new chat) on this page. False: no key, the Space toggles
   * `controller.setToolBar` itself.
   */
  toggleKey?: KeySpec | false;
  /** Always show the bar (it then has no close button). Default: shown while `controller.toolBar` is on. */
  pinned?: boolean;
  /**
   * 'overlay' (default): the bar floats over the top left of its positioned parent (the page card), with an inset, and
   * never moves the content below it. At phone width (480 px or less) it sits just above the card instead, and the
   * card moves down by the bar's height to make that room, so it never covers the card or its pins. 'inline': it sits
   * in the flow where the Space puts it.
   */
  place?: 'overlay' | 'inline';
  className?: string;
}

/**
 * The comment tool bar on the page (SPC-118): one button per mode the Space offers (`controller.modes`). A mode shows
 * "Point at something to comment" (or its own hint) until you point; Escape cancels. C shows and hides it. Put it where
 * the Space wants it on the page; it draws nothing while the host shows no comments.
 */
export function CommentToolBar(props: CommentToolBarProps) {
  return useHostComments() ? <ShownCommentToolBar {...props} /> : null;
}

/** The room the overlay bar's card keeps above itself at phone width: the bar's height and its 8 px gap. */
const TOOL_BAR_ROOM = '--nui-comment-toolbar-room';

/**
 * Tells the overlay bar's parent (the page card) how tall the bar is, as `--nui-comment-toolbar-room`. At phone width
 * the stylesheet puts the bar above the card and moves the card down by that much (toolkit.css); elsewhere the value
 * is unused. It follows the bar's size (a hint on two lines) and goes when the bar does.
 */
function useToolBarRoom(active: boolean) {
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  useIsoLayoutEffect(() => {
    const parent = active ? bar?.parentElement : null;
    if (!bar || !parent) return undefined;
    const measure = () => {
      parent.style.setProperty(TOOL_BAR_ROOM, `${Math.ceil(bar.getBoundingClientRect().height) + 8}px`);
    };
    measure();
    const view = bar.ownerDocument.defaultView;
    const sizes = view && typeof view.ResizeObserver !== 'undefined' ? new view.ResizeObserver(measure) : null;
    sizes?.observe(bar);
    return () => {
      sizes?.disconnect();
      parent.style.removeProperty(TOOL_BAR_ROOM);
    };
  }, [active, bar]);
  return setBar;
}

function ShownCommentToolBar({ controller, toggleKey = 'c', pinned = false, place = 'overlay', className }: CommentToolBarProps) {
  const shown = pinned || controller.toolBar;
  const { setToolBar, cancelMode, modes } = controller;
  useShortcuts(toggleKey && !pinned ? [{
    id: 'comments.toolbar', keys: toggleKey, scope: 'route', label: controller.words.toggleToolBar, owner: 'notis',
    when: () => modes.length > 0,
    run: () => {
      if (controller.toolBar) { cancelMode(); setToolBar(false); } else setToolBar(true);
      return true;
    },
  }] : [], [controller, toggleKey, pinned]);
  // Escape closes the bar once no mode waits (the mode's own Escape runs first).
  useEscapeLayer('comments.toolbar', () => { setToolBar(false); return true; },
    { priority: ESCAPE_PRIORITY.selection, enabled: shown && !pinned && controller.commentMode == null });
  const visible = shown && modes.length > 0;
  const barRef = useToolBarRoom(visible && place === 'overlay');
  if (!visible) return null;
  const mode = controller.commentMode;
  const idle = commentIdleHint(controller);
  return (
    <div ref={barRef} className={cx('nui-comment-toolbar', className)} role="toolbar" aria-label={controller.say('toolBar')}
      data-mode={mode ?? undefined} data-place={place}>
      {modes.map(item => {
        const label = controller.say(COMMENT_MODE_WORD[item]);
        return (
          <Tooltip key={item} label={label}>
            <button type="button" className="nui-comment-tool" data-mode={item} aria-label={label}
              aria-pressed={mode === item}
              onClick={() => { if (mode === item) cancelMode(); else controller.startMode(item); }}>
              <Icon name={COMMENT_MODE_ICON[item]} />
            </button>
          </Tooltip>
        );
      })}
      {mode && mode !== 'page' && mode !== 'time' ? (
        <CommentModeHint controller={controller} className="nui-comment-toolbar-hint" />
      ) : !mode && idle ? (
        <span className="nui-comment-toolbar-hint" data-idle="">{controller.say(idle)}</span>
      ) : null}
      {pinned ? null : (
        <button type="button" className="nui-comment-tool" data-part="close" aria-label={controller.say('closeToolBar')}
          onClick={() => { cancelMode(); setToolBar(false); }}>
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pane
// ---------------------------------------------------------------------------

export interface CommentPaneProps extends CommentListOptions {
  controller: CommentController;
  /** The heading. Default "Comments". */
  title?: string;
  /** Hide Copy changes (a pane read by people only). Default shown. */
  showCopy?: boolean;
  className?: string;
}

export const CommentPane = markRetiredPane(function CommentPane(props: CommentPaneProps) {
  const { controller } = props;
  // What the host reads: the threads (its waiting count) and the new comment (it opens the panel for it).
  const target = useHostCommentSource('pins', controller, { title: props.title },
    [controller.threads, controller.draftPin, controller.threadKey, controller.commentMode]);
  return target ? createPortal(<CommentPaneBody {...props} />, target) : null;
});

function CommentPaneBody({ controller, title, showCopy = true, className, order, groupBy }: CommentPaneProps) {
  const rootRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useThreadScroller(controller, scrollRef);
  const heading = title ?? controller.say('comments');
  const { visibleThreads, changes, draftPin, filter, statusFilter, anchors, anchorKey } = controller;
  const emptyTitle = statusFilter === 'done' ? controller.say('emptyResolved')
    : filter === 'anchor' ? controller.say('emptyAnchor') : controller.say('emptyAll');
  usePaneFocusKeeper(rootRef, visibleThreads);

  return (
    <CommentPaneKeys controller={controller} rootRef={rootRef}>
      <aside ref={rootRef} className={cx('nui-comment-pane', className)} aria-label={heading}>
        <div className="nui-comment-pane-head">
          <h2 className="nui-comment-pane-title">{heading}</h2>
          <NewCommentMenu controller={controller} />
          <CommentFilterMenu controller={controller} />
        </div>

        {/* The pane scrolls its own list; the toast below stays at the bottom of what shows (C7). */}
        <div ref={scrollRef} className="nui-comment-pane-scroll" data-comment-scroll="">
        {anchors.length ? (
          <SegmentedControl
            label={controller.words.scope}
            value={filter}
            onChange={value => controller.setFilter(value)}
            options={[
              { value: 'anchor', label: controller.words.thisAnchor, count: controller.scopeCounts.anchor },
              { value: 'all', label: controller.words.allItems, count: controller.scopeCounts.all },
            ]}
          />
        ) : null}

        {showCopy ? (
          <Button variant="secondary" className="nui-comment-copy" icon="copy"
            disabled={!changes.length || controller.copying} onClick={() => void controller.copyChanges(rootRef.current)}>
            <span className="nui-comment-copy-label">{controller.say('copy')}</span>
            <span className="nui-comment-count">{changes.length}</span>
          </Button>
        ) : null}

        {draftPin ? <NewCommentBox controller={controller} /> : anchors.length && controller.anchor ? (
          <div className="nui-comment-start">
            <Button variant="secondary" icon="chat-circle-text" onClick={() => controller.placePin(anchorKey, null, null)}>
              {controller.say('commentOnAnchor', { n: controller.anchor.order })}
            </Button>
            <CommentModeHint controller={controller} />
          </div>
        ) : controller.commentMode ? (
          <div className="nui-comment-start"><CommentModeHint controller={controller} /></div>
        ) : null}

        {visibleThreads.length ? (
          <CommentThreadList controller={controller} threads={visibleThreads} order={order} groupBy={groupBy}>
            {thread => (
              <CommentThreadCard key={thread.root.recordKey} controller={controller} thread={thread}
                showAnchor={filter === 'all'} />
            )}
          </CommentThreadList>
        ) : draftPin ? null : controller.loading ? (
          <CommentListLoading controller={controller} />
        ) : (
          <EmptyState className="nui-comment-empty" icon="chat-circle-text" title={emptyTitle} />
        )}
        </div>

        <ActionToast toast={controller.toaster.toast} onUndo={() => void controller.toaster.undo()}
          onDismiss={controller.toaster.dismiss} />
      </aside>
    </CommentPaneKeys>
  );
}
