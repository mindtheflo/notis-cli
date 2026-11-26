/**
 * The comment pane and its pieces, rendered from a `useComments` controller:
 *
 * - `CommentPane`: the comments of the view in the host Comments panel beside the chat (one header row with New comment,
 *   the filter and the "..." menu holding Copy changes, the new comment box with its To chip, the thread cards and the
 *   Undo toast). It draws nothing inside the Space, and nothing at all while the host shows no
 *   comments (`hostComments`). Threads come flat, newest first; on the Space home (no scope) they group by page. Pass
 *   `order` and `groupBy` to list them your way.
 * - `CommentPins`: the numbered pins and zones on the anchor element. Put it inside the element the comments sit on (a
 *   slide, a section) and give that element `position: relative`. With `controller.commenting` on it covers the element:
 *   a click drops a pin, a press and drag marks a zone (when the table has zone columns). The pane's "Comment on this
 *   item" starts a comment on the whole anchor, with no pin.
 * - `CommentToolBar`: the comment tool bar on the page, one button per mode, toggled with C (SPC-118).
 * - `CommentThreadCard`, `NewCommentBox` and `CommentAvatar`: the pane's own pieces, also drawn by the passage pane.
 *
 * A card archives (E) and unarchives (Shift+E) with an Undo toast (Z), edits your own comments in place and deletes at
 * once with Undo, as the viewer's rights allow. It starts with where it sits (the quoted words, or "Whole page", a point,
 * the items, a moment), with Done and "..." at its top right. Each comment names who wrote it on two lines beside the
 * avatar; an agent's avatar carries its app's logo, and its name opens a card with what it ran on. A band name reads
 * "Fred And The Machine" (`agentDisplayName`). Where a reply goes is said once, by the reply box.
 *
 * Files: with an Attachments files column and a host that uploads (`runtime.spaceFiles`), a new comment and a reply take
 * pictures and files: paste, drop on the box or the paperclip (`commentFiles`). Otherwise the boxes take text only.
 *
 * Keyboard: Enter sends a reply or a new comment and Shift+Enter adds a line; Escape in an empty new comment drops it
 * (with text, the first Escape leaves the field); Escape leaves a comment mode; a thread card selects with Enter; with
 * focus in the pane, E archives the focused thread and Shift+E unarchives it.
 */

import React, {
  useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent, type ReactNode,
} from 'react';
import type { KeySpec, Words } from '../../words';
import { ActionToast } from '../actions/ActionToast';
import { Badge, Button, EmptyState } from '../blocks';
import { AttachmentGallery, ImageViewer } from '../gallery';
import { ESCAPE_PRIORITY, type KeyboardEngineCore } from '../engine/core';
import { useEngineCore, useEscapeLayer, useShortcutOwner } from '../engine/hooks';
import { Icon } from '../icons';
import { Keycap } from '../keycap/Keycap';
import { Menu, Tooltip } from '../overlay';
import { fixedOrigin } from '../overlay/floating';
import { LAYER_ROOT_ATTRIBUTE, findLayerRoot, usePinnedLayerRoot } from '../overlay/layerRoot';
import { cx, useIsoLayoutEffect } from '../util';
import {
  COMMENT_HARNESS_NAMES, CommentAgentRuntimeCard, CommentHarnessLogo, commentAgentRuntimeView, isHarness, type CommentHarness,
} from './agentRuntime';
import {
  COMMENT_CHECK_ANSWERS, agentDisplayName, clipCommentAnswer, commentAttachmentFor, commentBodyParts, commentRelativeTime, commentReplyRuns, formatCommentTime,
  commentAnchorsOf, isCommentZone, scrollCommentIntoView, type CommentAnchor, type CommentAttachment, type CommentRecord, type CommentThread,
} from './commentModel';
import { commentDraftKey, readHostDraftFiles, useCommentDraftText, writeHostDraftFiles } from './commentDrafts';
import { useRevealOnOpen } from './scrollReveal';
import { usePassageChanged } from './textHighlights';
import { useSwipeDownToDismiss } from '../../interactions/swipeDownToDismiss';
import { useTextBoxTwoState } from '../../interactions/textBoxTwoState';
import { CommentAttachButton, CommentDropVeil, CommentFileChips, useCommentFiles, type CommentFilesState } from './commentFiles';
import { createPortal } from 'react-dom';
import { markHostPane, useHostCommentSource, useHostComments } from './hostComments';
import { useHostComposer, type HostComposerTo } from './hostPanel';
import { useHandedPaneKey } from './handover';
import { usePaneOutlet } from './paneOutlet';
import { archiveThenNext, holdReviewRunKeys, notifyReviewRunAction, useNextCardComesIntoPlace, useReviewRunPane } from './reviewRun';
import {
  COMMENT_MODE_ICON, COMMENT_MODE_WORD, commentHarnessName, commentOutsideClaim, commentOutsideName, commentOutsideUnread,
  commentThreadName, CommentListLoading, CommentListMore, CommentModeHint, CommentPaneKeys, CommentThreadList, CommentPaneBar, CommentToChip, CommentForPeopleNote,
  commentIdleHint, commentItemNames, useAtThreadPicker, usePaneFocusKeeper, useThreadScroller,
  type CommentListOptions,
} from './paneParts';
import { elsewhere, outsideClaim, pickMentionText, withPickMention } from './useCommentRouting';
import type { CommentController, CommentFile } from './useComments';

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
  /** Name the anchor where the card says where it sits (when the pane lists every anchor). */
  showAnchor?: boolean;
  /** The words a passage pane quotes for this thread (default: the comment's own passage), and whether they are gone. */
  passageQuote?: string | null;
  passageGone?: boolean;
  /** Where the thread sits when it quotes no words (default: its point, its moment, its items or "Whole page"). */
  placeLabel?: string | null;
  /** A press on the card. Default: `controller.selectThread(thread)`. */
  onSelect?(thread: CommentThread): void;
}

const composeOf = (holder: HTMLElement) => holder.querySelector<HTMLElement>('.nui-comment-compose');

/**
 * The frame of one of the pane's own one-line fields: a reply where the host draws no comment box, and the answer to
 * a question. On a phone it has the two states of a text box, as the host's boxes (`textBoxTwoState.ts`; drawn in
 * toolkit.css from `data-composer-state`): one line at rest, a draft folded to its first line; with the focus the text
 * on top at the full width and the buttons on a line of their own. A computer keeps its one line.
 */
function OwnTextBox({ hasDraft, hold = false, children, ...rest }: {
  hasDraft: boolean;
  /** Being sent: the field stays in the state it was in. */
  hold?: boolean;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  const box = useTextBoxTwoState<HTMLDivElement>({ enabled: true, phoneOnly: true, hasDraft, hold, looksAgain: true, surfaceOf: composeOf });
  // Folded, the one line is the draft's first: the field goes back to its top.
  const { state } = box;
  useEffect(() => {
    if (state !== 'rest') return;
    const field = box.bind.ref.current?.querySelector('textarea');
    if (field) field.scrollTop = 0;
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div {...rest} data-swipe-dismiss="" {...box.bind}>{children}</div>;
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
    <div className="nui-comment-edit" data-swipe-dismiss="" role="group" aria-label={label} onClick={stop}>
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

/** The options of the first question of a thread still waiting for a pick, for the card's Enter and 1 to 9 keys. */
export function commentWaitingChoices(thread: CommentThread): { comment: CommentRecord; options: string[]; recommended: string | null } | null {
  for (const comment of [thread.root, ...thread.replies]) {
    if (comment.status === 'Deleted' || comment.answer || (comment.needs !== 'choice' && comment.needs !== 'check')) continue;
    const options = askChoices(comment).filter(option => !commentAttachmentFor(option, comment.attachments));
    if (options.length) {
      return { comment, options, recommended: comment.recommended && options.includes(comment.recommended) ? comment.recommended : null };
    }
  }
  return null;
}

/**
 * An agent's question on a comment (Needs check, choice or input), the first comment or a reply: the answer once sent,
 * else the way to answer. The comment right above says who asks, so the question adds no line of its own.
 *
 * A check or a choice reads like a question in a conversation: one row per option, each with its number, a short line
 * under it when the asker gave one (`optionDetails`) and the Recommended tag on the asker's pick (`recommended`), then
 * Other, which opens the reply box for the person's own words: the reply sent from it answers the question (`answer_to`).
 * An input ask has no field of its own: the card's reply box
 * answers it (`actions.reply` names the latest open input ask), and the reply fills that comment's Answer.
 */
function CommentAsk({ controller, thread, comment, onOther, enter, mark }: {
  controller: CommentController; thread: CommentThread; comment: CommentRecord;
  /** Other: the reply box takes the caret. */
  onOther(): void;
  /** The card is selected and this is its waiting question: Enter picks the recommended option. */
  enter: boolean;
  /** Shown after the sent answer (the read mark of a thread an agent outside Notis holds). */
  mark?: React.ReactNode;
}) {
  const { actions } = controller;
  // An option picked answers the question; in a review run the next card then takes its place, or the answer stays.
  const pick = (choice: string) => {
    const saved = actions.answer(comment, choice);
    notifyReviewRunAction({ kind: 'answered', key: thread.root.recordKey, saved });
  };
  if (comment.needs === 'none') return null;
  const busy = controller.busy.has(comment.recordKey);
  const needsLabel = comment.needs === 'check' ? controller.say('needCheck')
    : comment.needs === 'choice' ? controller.say('needChoice') : controller.say('needInput');
  const choices = askChoices(comment);
  const waiting = comment.needs !== 'input' && !comment.answer;
  // An input ask's answer, or a check's or a choice's written after Other, is the person's reply under it (SPC-113 wakes
  // the agent from it): the ask says it was answered and shows the text only when no reply in the thread carries it.
  const answeredBelow = Boolean(comment.answer) && thread.replies.some(reply =>
    reply.status !== 'Deleted' && !reply.agent && (reply.answerTo ? reply.answerTo === comment.recordKey
      : comment.needs === 'input' && clipCommentAnswer(reply.body.trim()) === comment.answer.trim()));
  // Options named like a picture are answered from under it, inside the ask; the rows below keep the others.
  const rowChoices = choices.filter(option => !commentAttachmentFor(option, comment.attachments));
  const pictureAsk = rowChoices.length < choices.length;
  return (
    <div className="nui-comment-ask" data-ask={comment.recordKey} data-needs={comment.needs} onClick={stop} onKeyDown={stop}>
      {pictureAsk ? (
        <CommentAttachments controller={controller} comment={comment} choices={choices}
          onAnswer={waiting ? pick : undefined} />
      ) : null}
      {comment.answer ? (
        <p className="nui-comment-answer">
          <Icon name="check" />
          <span>{answeredBelow ? controller.say('answeredInput')
            : controller.say('sent', { answer: answerLabel(controller, comment.answer).replace(/[\s.,;:!?…]+$/, '') })}</span>
          {mark ?? null}
        </p>
      ) : rowChoices.length ? (
        <div className="nui-comment-options" role="group" aria-label={needsLabel}>
          {rowChoices.map((choice, index) => {
            const recommended = comment.recommended === choice;
            const detail = comment.optionDetails?.[choice] ?? '';
            return (
              <button key={choice} type="button" className="nui-comment-option" disabled={busy || !controller.canWrite}
                data-option={choice} data-recommended={recommended ? '' : undefined} data-detail={detail || recommended ? '' : undefined}
                aria-keyshortcuts={recommended && enter ? 'Enter' : undefined}
                onClick={() => pick(choice)}>
                <span className="nui-comment-option-key" aria-hidden="true">{index + 1}</span>
                <span className="nui-comment-option-text">
                  <span className="nui-comment-option-head">
                    <span className="nui-comment-option-label">{answerLabel(controller, choice)}</span>
                    {recommended ? <span className="nui-comment-option-badge" data-part="recommended">{controller.say('recommended')}</span> : null}
                  </span>
                  {detail ? <span className="nui-comment-option-detail">{detail}</span> : null}
                </span>
                {recommended ? (
                  <span className="nui-comment-option-enter" aria-hidden="true" data-shown={enter ? '' : undefined}><Keycap keys="enter" /></span>
                ) : null}
              </button>
            );
          })}
          <button type="button" className="nui-comment-option" data-other="" data-detail="" disabled={busy || !controller.canWrite}
            onClick={onOther}>
            <span className="nui-comment-option-key" aria-hidden="true">{rowChoices.length + 1}</span>
            <span className="nui-comment-option-text">
              <span className="nui-comment-option-label">{controller.say('otherOption')}</span>
              <span className="nui-comment-option-detail">{controller.say('otherOptionHint')}</span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The harness whose logo an agent's avatar carries: what it ran on, else the harness it declared. */
function agentHarnessOf(comment: CommentRecord): CommentHarness | null {
  const agent = comment.agent;
  if (!agent) return null;
  const harness = agent.runtime?.provider ?? agent.harness;
  return isHarness(harness) ? harness : null;
}

/** A comment's avatar; an agent's carries its app's logo as a small badge. */
function CommentEntryAvatar({ comment, me }: { comment: CommentRecord; me: string }) {
  const harness = agentHarnessOf(comment);
  return (
    <span aria-hidden="true" className="nui-comment-avatar" data-me={comment.author === me ? '' : undefined}
      data-harness={harness ?? undefined}>
      {(agentDisplayName(comment.author).trim().slice(0, 1) || '?').toUpperCase()}
      {harness ? <span className="nui-comment-avatar-badge"><CommentHarnessLogo harness={harness} className="" /></span> : null}
    </span>
  );
}

/**
 * The writer's name. An agent's opens a card on hover and on keyboard focus (Tab reaches it; its accessible name says
 * everything the card shows): what ran it, as the chat timeline's badge says it, or the app that runs an agent outside
 * Notis and that it works outside Notis.
 */
function CommentAuthorName({ controller, comment }: { controller: CommentController; comment: CommentRecord }) {
  const name = agentDisplayName(comment.author);
  const agent = comment.agent;
  const view = agent?.runtime ? commentAgentRuntimeView(controller.say, name, agent.runtime) : null;
  const harness = agentHarnessOf(comment);
  const outside = agent?.outside ? controller.say('outsideNotis') : '';
  if (!agent || (!view && !harness && !outside)) return <span className="nui-comment-author">{name}</span>;
  const runs = !view && harness ? controller.say('agentHarness', { harness: COMMENT_HARNESS_NAMES[harness] }) : '';
  const label = view ? view.label : [name, runs, outside].filter(Boolean).join(' · ');
  const card = view ? <CommentAgentRuntimeCard name={name} view={view} /> : (
    <span className="nui-runtime-card">
      <span className="nui-runtime-card-head">
        <span className="nui-runtime-card-name">{name}</span>
        {harness ? <span className="nui-runtime-glyphs"><CommentHarnessLogo harness={harness} /></span> : null}
      </span>
      {runs ? <span className="nui-runtime-card-line">{runs}</span> : null}
      {outside ? <span className="nui-runtime-card-line">{outside}</span> : null}
    </span>
  );
  return (
    <Tooltip label={label} side="bottom" align="start" delay={200} card={card}>
      <span className="nui-comment-author" tabIndex={0} role="img" aria-label={label}
        data-part={view ? 'agent-runtime' : 'agent-harness'} data-harness={harness ?? undefined} onClick={stop}>{name}</span>
    </Tooltip>
  );
}

/**
 * The mark a sent bubble carries after its time in a conversation: one check once sent, two once the agent has read it.
 * On the person's latest word in a comment thread an agent outside Notis holds (SPC-536).
 */
function CommentReadMark({ read, label }: { read: boolean; label: string }) {
  return (
    <svg role="img" aria-label={label} className="nui-comment-read" data-part="read-mark" data-read={read ? '' : undefined}
      width={read ? 18 : 14} height="14" viewBox={read ? '0 0 18 14' : '0 0 14 14'} fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {read ? <><path d="M1 7.5L4 10.5L9 4" /><path d="M6 7.5L9 10.5L14 4" /></> : <path d="M3 7.5L6 10.5L11 4" />}
    </svg>
  );
}

/**
 * Who holds a comment thread, as its reply box names it ("Reply to Claude"): the agent outside Notis that holds it, else
 * what runs the thread a reply goes to. Null while that is not known or names nothing (the box then reads "Reply").
 */
export function commentThreadHolder(controller: CommentController, thread: CommentThread): {
  who: string; outside: boolean; harness: string | null; to: string;
} | null {
  const { routing } = controller;
  const rootKey = thread.root.recordKey;
  if (!routing.links || rootKey.startsWith('draft-') || routing.lost?.(rootKey)) return null;
  if (routing.known && !routing.known(rootKey)) return null;
  const target = routing.goesTo(rootKey);
  // A plain reply wakes an agent another person runs: no name rather than a thread it does not go to (SPC-467).
  if (elsewhere(target)) return null;
  if (target && outsideClaim(target)) {
    const who = commentOutsideName(target);
    return { who, outside: true, harness: target.harness ?? null, to: controller.say('toWho', { who }) };
  }
  const harness = target && !('newThread' in target) ? target.harness ?? null : null;
  return { who: commentHarnessName(harness) || controller.say('notis'), outside: false, harness: harness ?? 'notis',
    to: commentThreadName(controller, target).to };
}

/** Where a thread sits when it quotes no words: its point, its moment, its items or its item, else "Whole page". */
function threadPlace(controller: CommentController, thread: CommentThread, showAnchor: boolean): string {
  const { root, anchor } = thread;
  const number = controller.numberOf(thread);
  const item = anchor ? commentItemNames(controller, [anchor]) : '';
  if (root.anchorIds.length > 1) {
    return commentItemNames(controller, commentAnchorsOf(root, controller.anchors), root.anchorIds.length);
  }
  if (root.x != null && number > 0) {
    return item && showAnchor ? controller.say('placePointOn', { n: number, item }) : controller.say('placePoint', { n: number });
  }
  if (root.time != null) {
    const at = controller.say('placeTime', { time: formatCommentTime(root.time) });
    return item && showAnchor ? `${at} · ${item}` : at;
  }
  // A comment on a whole item names the item; one on no item at all sits on the whole page.
  return item || controller.say('placeWholePage');
}

/** Per reply draft key: the question whose Other the person pressed, so the reply sent next answers it. */
const armedOther = new Map<string, string>();

/**
 * One comment thread as a card, the same in every comments list:
 *
 * - First, where it sits: the quoted words on one or two lines ("Passage changed" once they are gone from the page), or
 *   "Whole page", "Point 1 on <item>", the items, the moment.
 * - Done (a check; Unarchive on an archived thread) and "..." at the top right: Copy link, Change who it goes to, Edit
 *   and Delete. Quiet until the card is hovered, focused or selected; always shown on a touch screen.
 * - Each comment starts with two lines beside its avatar: the name, then the agent's thread and the time in a quieter
 *   line. Its words, pictures and question take the card's full width under that block. A reply keeps Copy link, Edit
 *   and Delete in one "..." of its own.
 * - No mark on a comment not read yet. The person's latest word in a thread an agent outside Notis holds carries the
 *   chat bubble's check after its time: one until that agent has read it, two after.
 * - Where a reply goes is said once, by the reply box ("Reply to The Paper Lanterns").
 *
 * While the card is selected and a question of it waits, Enter picks the recommended option and 1 to 9 an option by
 * its position (the number after the last option is Other).
 */
export function CommentThreadCard({ controller, thread, showAnchor = false, passageQuote, passageGone, placeLabel, onSelect }: CommentThreadCardProps) {
  const { root, replies } = thread;
  // A swipe down in the reply field puts the keyboard away (swipeDownToDismiss).
  useSwipeDownToDismiss();
  const { actions, locale, now, me } = controller;
  // The reply being written, and its files, are kept while the pane is away (`commentDrafts`): another Space, a page
  // over the view or another brief unmounts the card, and the reply comes back with it.
  const replyKey = commentDraftKey(controller.draftScope, `reply:${root.recordKey}`);
  // Where an Other the person pressed is kept (`armedOther`): with the draft's key, else the card's.
  const otherKey = replyKey ?? `reply:${root.recordKey}`;
  const [draft, setDraft] = useCommentDraftText(replyKey);
  // What the reply box holds now, read after a failed save (the person may have typed on while it was sent).
  const draftNow = useRef(draft);
  draftNow.current = draft;
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const files = useCommentFiles(controller, replyKey);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const resolved = root.status === 'Resolved';
  const selected = controller.threadKey === root.recordKey;
  const busy = controller.busy.has(root.recordKey);
  const isDraft = root.recordKey.startsWith('draft-');
  const goneHere = usePassageChanged(root.passage && !root.passage.field ? root.recordKey : null);
  const gone = passageGone ?? goneHere;
  const quoteText = passageQuote || root.passage?.quote || null;
  const place = quoteText ? '' : placeLabel || threadPlace(controller, thread, showAnchor);

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
    // The reply shows in the thread at once, so the box empties at once too; a failed save puts the text back, and the
    // attached files stay until the save succeeds.
    const text = draft.trim();
    setDraft('');
    const ok = await actions.reply(thread, text, files.ready, otherAnswers());
    setSending(false);
    if (ok) { armedOther.delete(otherKey); files.clear(); notifyReviewRunAction({ kind: 'replied', key: root.recordKey }); }
    else setDraft(draftNow.current.trim() ? `${text}\n${draftNow.current}` : text);
  };
  // Other on a question, and its number: the reply box takes the caret, whoever draws it.
  const [focusToken, setFocusToken] = useState(0);
  // A picked agent outside Notis's @ for a reply box the host draws (its text is the host's, SPC-1546).
  const [replyMention, setReplyMention] = useState<{ token: number; text: string } | null>(null);
  const openReply = () => { setFocusToken(value => value + 1); replyRef.current?.focus({ preventScroll: true }); };
  // Other on a question (its row or its number): the reply written next answers that question in the person's own
  // words (`answer_to`), so it stops waiting like a picked option does. The choice is kept with the reply's draft key, so
  // it comes back with the draft after the card leaves; it holds only while that question is the thread's newest open one.
  const openOther = (ask: CommentRecord) => { armedOther.set(otherKey, ask.recordKey); openReply(); };
  const otherAnswers = () => {
    const key = armedOther.get(otherKey);
    if (!key) return undefined;
    const items = [root, ...thread.replies];
    const at = items.findIndex(item => item.recordKey === key);
    const open = (item: CommentRecord) => item.needs !== 'none' && !item.answer && item.status !== 'Deleted';
    const ask = at >= 0 ? items[at] : undefined;
    if (ask && open(ask) && !items.slice(at + 1).some(open)) return ask;
    armedOther.delete(otherKey);
    return undefined;
  };
  // The review run's R key (and its number for Other, which names its question) asks the card for its reply box.
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;
    const onReply = (event: Event) => {
      // R opens a plain reply: it drops an Other picked earlier.
      const other = (event as CustomEvent<{ other?: string } | null>).detail?.other;
      if (other) armedOther.set(otherKey, other); else armedOther.delete(otherKey);
      openReply();
    };
    card.addEventListener('notis-comment-reply', onReply);
    return () => card.removeEventListener('notis-comment-reply', onReply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const answer = (comment: CommentRecord, choice: string) => {
    const saved = actions.answer(comment, choice);
    notifyReviewRunAction({ kind: 'answered', key: root.recordKey, saved });
  };
  // Done: in a review run the run archives and moves on; else the card archives and the next one takes the selection.
  const done = () => { if (!notifyReviewRunAction({ kind: 'done', key: root.recordKey })) archiveThenNext(controller, root, cardRef.current); };

  const select = () => { if (onSelect) onSelect(thread); else controller.selectThread(thread); };
  // A question waiting for a pick: while the card is selected, Enter picks the recommended option and 1 to 9 pick by
  // position (the number after the last option is Other, which opens the reply box), as on a question in a conversation.
  const asking = controller.canWrite ? commentWaitingChoices(thread) : null;
  const onCardKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (asking && selected && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      if (event.key === 'Enter' && asking.recommended) {
        event.preventDefault(); event.stopPropagation();
        answer(asking.comment, asking.recommended);
        return;
      }
      const position = /^[1-9]$/.test(event.key) ? Number(event.key) : 0;
      if (position && position <= asking.options.length + 1) {
        event.preventDefault(); event.stopPropagation();
        if (position <= asking.options.length) answer(asking.comment, asking.options[position - 1]!);
        else openOther(asking.comment);
        return;
      }
    }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
    // Down and Up move the focus to the next or previous card of this pane, and the selection with it (`onCardFocus`);
    // the page's own arrow keys (a list's rows) never take them while a card holds the focus (SPC-1631).
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      const card = event.currentTarget;
      const pane = card.closest('.nui-comment-pane') ?? card.parentElement;
      const cards = pane ? [...pane.querySelectorAll<HTMLElement>('.nui-comment-card[data-thread]')] : [];
      const next = cards[cards.indexOf(card) + (event.key === 'ArrowDown' ? 1 : -1)];
      next?.focus();
    }
  };
  // Tabbing between cards moves the selected pin with the focus (the page does not move, nothing else changes).
  const onCardFocus = (event: React.FocusEvent<HTMLElement>) => {
    if (event.target === event.currentTarget && controller.threadKey !== root.recordKey) controller.setThreadKey(root.recordKey);
  };

  // SPC-535, SPC-536: a thread an agent outside Notis holds. The box says who reads the reply, and the person's latest
  // word carries the read mark: one check until that agent reads the thread after it, two once it has.
  const holder = commentThreadHolder(controller, thread);
  const outside = commentOutsideClaim(controller, thread);
  const outsideUnread = Boolean(outside) && commentOutsideUnread(thread, outside!);
  let markOn: { key: string; where: 'comment' | 'answer' } | null = null;
  if (outside) {
    const stamp = (value: string | null | undefined) => { const at = Date.parse(value ?? ''); return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at; };
    let latest = Number.NEGATIVE_INFINITY;
    for (const comment of [root, ...replies]) {
      if (comment.status === 'Deleted') continue;
      if (!comment.agent && stamp(comment.createdAt) >= latest) { latest = stamp(comment.createdAt); markOn = { key: comment.recordKey, where: 'comment' }; }
      if (comment.answer && stamp(comment.answeredAt) > latest) { latest = stamp(comment.answeredAt); markOn = { key: comment.recordKey, where: 'answer' }; }
    }
  }
  const readMark = outside ? (
    <CommentReadMark read={!outsideUnread}
      label={controller.say(outsideUnread ? 'outsideUnread' : 'outsideRead', { who: commentOutsideName(outside) })} />
  ) : null;
  const replyLabel = holder ? controller.say('replyToWho', { who: holder.who })
    : resolved ? controller.say('replyToReopen') : controller.say('reply');
  const canChange = Boolean(holder) && controller.routing.canLink;
  // The reply box is the host's composer where the host draws comment boxes: one line at rest ("Reply to Claude"),
  // then the To pill inside the field and the buttons on a line of their own.
  const replyMarker = useRef<HTMLSpanElement>(null);
  const replySlot = useHostComposer(replyMarker, !isDraft, {
    kind: 'reply', placeholder: replyLabel, label: replyLabel, quote: null, place: null,
    to: holder ? {
      label: holder.to, outside: holder.outside, outsideLabel: controller.say('outsideNotis'), harness: holder.harness,
      pick: canChange ? anchor => controller.routing.change(root.recordKey, anchor).then(mention => mention ?? true) : undefined,
      pickLabel: controller.say('changeWho'),
    } : null,
    initialText: draft, onText: setDraft,
    // The host's files are kept with the reply's text while the pane is away, until the reply is saved.
    initialFiles: readHostDraftFiles(replyKey), onFiles: picked => writeHostDraftFiles(replyKey, picked),
    send: (text, picked) => withUploads(controller, picked, async uploaded => {
      setSending(true);
      const ok = await actions.reply(thread, text.trim(), uploaded, otherAnswers());
      setSending(false);
      if (ok) { armedOther.delete(otherKey); setDraft(''); writeHostDraftFiles(replyKey, []); notifyReviewRunAction({ kind: 'replied', key: root.recordKey }); }
      return ok;
    }),
    dismiss: () => undefined,
    canWrite: controller.canWrite, attach: controller.attach === 'on', transcribe: controller.transcribe ?? null, focusToken,
    autoFocus: false, mention: replyMention,
  }, [replyLabel, holder?.to, holder?.outside, holder?.harness, canChange, controller.canWrite, controller.attach, controller.transcribe, focusToken, replyMention]);
  // The Notis thread a reply goes to, opened in Chat from "..." (never an agent outside Notis: it has none here).
  const goesTo = holder && !holder.outside ? controller.routing.goesTo(root.recordKey) : null;
  const openThreadId = goesTo?.threadId ?? null;
  const openThread = controller.routing.open;
  // The thread an agent's comment came from, for its quieter line: the one it declared (an agent outside Notis), else
  // the title of the linked thread it ran in.
  const linkTitles = new Map(controller.routing.links ? controller.routing.linksOf(root.recordKey).map(link => [link.threadId, link.title]) : []);
  const threadNameOf = (comment: CommentRecord) => comment.agent?.threadName
    || (comment.agent?.threadId ? linkTitles.get(comment.agent.threadId) : '') || '';

  const threadActions = (
    <div className="nui-comment-actions" ref={actionsRef} onClick={stop} onKeyDown={stop}>
      {resolved ? (
        <Tooltip label={controller.say('reopen')} keys="shift+e">
          <button type="button" className="nui-comment-act" disabled={busy} data-part="reopen"
            aria-label={namedAction(controller, 'unarchiveThread', controller.say('reopen'), root)}
            onClick={() => actions.unarchive(root)}><Icon name="tray-arrow-up" /></button>
        </Tooltip>
      ) : (
        <Tooltip label={controller.say('markDone')} keys="e">
          <button type="button" className="nui-comment-act" disabled={busy || isDraft} data-part="done"
            aria-label={namedAction(controller, 'archiveThread', controller.say('resolve'), root)}
            onClick={done}><Icon name="check" /></button>
        </Tooltip>
      )}
      <Menu align="end" label={controller.words.threadMore} accelerators={false}
        trigger={(
          <button type="button" className="nui-comment-act" data-part="thread-more"
            aria-label={namedAction(controller, 'threadMoreNamed', controller.say('threadMore'), root)}>
            <Icon name="dots-three" />
          </button>
        )}>
        {/* A link that opens this page with the thread revealed (comment=<root key>), for someone else. */}
        <Menu.Item icon="link" disabled={isDraft} onSelect={() => void actions.copyLink(root, cardRef.current)}>
          <span data-thread-action="copy-link">{controller.say('copyLink')}</span>
        </Menu.Item>
        {/* Where the host draws the card away from its page: the page opens with this thread shown on it. */}
        {controller.showOnPage && !isDraft ? (
          <Menu.Item icon="arrow-square-out" onSelect={() => controller.showOnPage?.(root.recordKey)}>
            <span data-thread-action="show-on-page">{controller.say('showOnPage')}</span>
          </Menu.Item>
        ) : null}
        {openThreadId && openThread ? (
          <Menu.Item icon="chat-circle-text" onSelect={() => openThread(openThreadId)}>
            <span data-thread-action="open-thread">{controller.say('openLinkedThread', { title: goesTo?.title || controller.say('goesToNew') })}</span>
          </Menu.Item>
        ) : null}
        {canChange ? (
          <Menu.Item icon="arrow-bend-up-right" disabled={controller.routing.saving?.(root.recordKey)}
            onSelect={() => {
              if (!actionsRef.current) return;
              // An agent outside Notis picked: its @ goes in front of the reply (SPC-1546).
              void controller.routing.change(root.recordKey, actionsRef.current)
                .then(mention => {
                  if (!mention) return;
                  // The host's box writes it (its text is its own); the pane's own box takes it in its draft.
                  if (replySlot) setReplyMention(current => ({ token: (current?.token ?? 0) + 1, text: mention }));
                  else setDraft(withPickMention(draftNow.current, mention));
                });
            }}>
            <span data-thread-action="change">{controller.say('changeWho')}</span>
          </Menu.Item>
        ) : null}
        {controller.canEdit(root) ? (
          <Menu.Item icon="pencil-simple" disabled={busy} onSelect={() => setEditing(root.recordKey)}>
            <span data-thread-action="edit">{controller.say('editRoot')}</span>
          </Menu.Item>
        ) : null}
        {controller.canDelete(root) ? (
          <Menu.Item icon="trash" tone="danger" disabled={busy} onSelect={() => actions.remove(root)}>
            <span data-thread-action="delete">{controller.say('deleteThread')}</span>
          </Menu.Item>
        ) : null}
      </Menu>
    </div>
  );

  const replyMenu = (reply: CommentRecord) => (
    <span className="nui-comment-entry-more" onClick={stop} onKeyDown={stop}>
      <Menu align="end" label={controller.words.replyMore} accelerators={false}
        trigger={(
          <button type="button" className="nui-comment-act" data-part="reply-more"
            aria-label={namedAction(controller, 'replyMoreNamed', controller.say('replyMore'), reply)}>
            <Icon name="dots-three" />
          </button>
        )}>
        {/* Every reply has its own Copy link, which opens its thread. */}
        <Menu.Item icon="link" disabled={isDraft} onSelect={() => void actions.copyLink(root, cardRef.current)}>
          <span data-reply-action="copy-link">{controller.say('copyLink')}</span>
        </Menu.Item>
        {controller.canEdit(reply) ? (
          <Menu.Item icon="pencil-simple" disabled={controller.busy.has(reply.recordKey)} onSelect={() => setEditing(reply.recordKey)}>
            <span data-reply-action="edit">{controller.say('editReply')}</span>
          </Menu.Item>
        ) : null}
        {controller.canDelete(reply) ? (
          <Menu.Item icon="trash" tone="danger" disabled={controller.busy.has(reply.recordKey)} onSelect={() => actions.remove(reply)}>
            <span data-reply-action="delete">{controller.say('deleteComment')}</span>
          </Menu.Item>
        ) : null}
      </Menu>
    </span>
  );

  // Only the latest reply shows; the replies before it fold into one line that opens them (SPC-1630, Flo's pick C).
  // "Latest" is the last reply still there: deleted lines after it stay beside it. Only the replies before the first
  // one that must stay fold, so the line never hides a reply between two shown ones. A reply stays when it still asks
  // something, answers the first comment, carries the read mark, is being edited, is the one a link names, was already
  // on screen or arrived after the card did, so nothing disappears under the reader; a fold of deleted lines only is
  // not drawn.
  const [showEarlier, setShowEarlier] = useState(false);
  const shownReplies = useRef(new Set<string>());
  const replyRuns = commentReplyRuns(replies);
  const runKey = (run: (typeof replyRuns)[number]) => (run.deleted ? run.replies[0]! : run.reply).recordKey;
  // Replies that arrive while the card is on screen (your own included) show where they land.
  const foundReplies = useRef<Set<string> | null>(null);
  if (!foundReplies.current) foundReplies.current = new Set(replies.map(reply => reply.recordKey));
  const answersRoot = (reply: CommentRecord) => !reply.agent && (reply.answerTo ? reply.answerTo === root.recordKey
    : root.needs === 'input' && Boolean(root.answer) && clipCommentAnswer(reply.body.trim()) === root.answer!.trim());
  const staysOpen = (run: (typeof replyRuns)[number]) => shownReplies.current.has(runKey(run))
    || !foundReplies.current!.has(runKey(run))
    || (run.deleted ? run.replies : [run.reply]).some(reply => reply.recordKey === controller.linkKey)
    || (!run.deleted && ((run.reply.needs !== 'none' && !run.reply.answer) || answersRoot(run.reply)
      || markOn?.key === run.reply.recordKey || editing === run.reply.recordKey));
  let latest = replyRuns.length - 1;
  while (latest > 0 && replyRuns[latest]!.deleted) latest -= 1;
  let foldEnd = 0;
  if (!showEarlier) while (foldEnd < latest && !staysOpen(replyRuns[foldEnd]!)) foldEnd += 1;
  const folded = replyRuns.slice(0, foldEnd).filter(run => !run.deleted).length;
  const shownRuns = folded ? replyRuns.slice(foldEnd) : replyRuns;
  // The fold line leaves once pressed: the focus goes to the card, so the keys keep working.
  const openEarlier = (event: React.MouseEvent) => {
    event.stopPropagation();
    setShowEarlier(true);
    cardRef.current?.focus({ preventScroll: true });
  };
  for (const run of shownRuns) shownReplies.current.add(runKey(run));

  const entry = (comment: CommentRecord, isRoot: boolean) => (
    <li key={comment.recordKey} className="nui-comment-entry" data-comment={comment.recordKey} data-root={isRoot ? '' : undefined}>
      {/* Two lines beside the avatar: the name, then the agent's thread and the time in a quieter line. */}
      <div className="nui-comment-entry-head">
        <CommentEntryAvatar comment={comment} me={me} />
        <div className="nui-comment-who">
          <div className="nui-comment-name"><CommentAuthorName controller={controller} comment={comment} /></div>
          <div className="nui-comment-sub" data-part="author-line-2">
            {threadNameOf(comment) ? (
              <span className="nui-comment-agent-thread" data-part="agent-thread-name" title={threadNameOf(comment)}>{threadNameOf(comment)}</span>
            ) : null}
            <span className="nui-comment-meta">{commentRelativeTime(comment.createdAt, locale, now)}</span>
            <EditedMark controller={controller} comment={comment} />
            {markOn?.key === comment.recordKey && markOn.where === 'comment' ? readMark : null}
          </div>
        </div>
        {isRoot ? null : replyMenu(comment)}
      </div>
      {/* The words, the pictures and the question take the card's full width: nothing is indented under the avatar. */}
      <div className="nui-comment-entry-main">
        {isRoot && (root.example || resolved) ? (
          <div className="nui-comment-badges">
            {root.example ? <Badge>{controller.words.example}</Badge> : null}
            {resolved ? <Badge>{controller.words.resolved}</Badge> : null}
          </div>
        ) : null}
        {editing === comment.recordKey
          ? <CommentEditBox controller={controller} comment={comment} onDone={() => setEditing(null)} />
          : <CommentBody body={comment.body} />}
        {comment.needs !== 'none' && pictureAskOf(comment) ? null : <CommentAttachments controller={controller} comment={comment} />}
        {/* An agent's question in a reply is answered here too, like one on the first comment. */}
        <CommentAsk controller={controller} thread={thread} comment={comment} onOther={() => openOther(comment)}
          enter={selected && asking?.comment === comment}
          mark={markOn?.key === comment.recordKey && markOn.where === 'answer' ? readMark : null} />
      </div>
    </li>
  );

  return (
    <article
      ref={cardRef}
      className="nui-comment-card"
      data-thread={root.recordKey}
      data-selected={selected ? '' : undefined}
      data-notis-arrows="own"
      data-resolved={resolved ? '' : undefined}
      data-outside={outside ? '' : undefined}
      aria-current={selected ? 'true' : undefined}
      aria-label={controller.say('pin', { who: agentDisplayName(root.author), body: root.body })}
      tabIndex={0}
      onClick={select}
      onKeyDown={onCardKey}
      onFocus={onCardFocus}
    >
      {/* In a review run the host's bar sits at the top of the selected card, above its quoted words (the `run-bar`
          slot: the first one in the pane takes the bar, so the pane's foot keeps it only while no card is selected). */}
      {selected ? <slot name="run-bar" /> : null}
      {/* Where it sits, first, so every comments list reads the same (SPC-489), then the thread's two buttons. */}
      <div className="nui-comment-top">
        <div className="nui-comment-anchor" data-changed={gone ? '' : undefined}>
          {quoteText ? (
            <>
              <p className="nui-comment-quote" data-part="quote">{quoteText}</p>
              {/* Passage changed: the words are gone from the page. The old quote stays and the thread stays open. */}
              {gone ? <span className="nui-comment-changed" data-part="passage-changed" title={controller.say('textChangedHint')}>{controller.say('textChanged')}</span> : null}
            </>
          ) : <span className="nui-comment-place" data-part="place">{place}</span>}
        </div>
        {threadActions}
      </div>

      <ol className="nui-comment-entries">
        {entry(root, true)}
        {folded ? (
          <li key="earlier" className="nui-comment-entry" data-earlier="">
            <button type="button" className="nui-comment-earlier" data-part="earlier-replies" onClick={openEarlier}>
              {folded === 1 ? controller.say('earlierReply') : controller.say('earlierReplies', { n: String(folded) })}
            </button>
          </li>
        ) : null}
        {shownRuns.map(run => run.deleted ? (
          // Deleted replies leave one line per run, so the replies after them still read (SPC-127).
          <li key={run.replies[0]!.recordKey} className="nui-comment-entry" data-deleted="">
            <p className="nui-comment-deleted">{controller.say('commentDeleted')}</p>
          </li>
        ) : entry(run.reply, false))}
      </ol>

      {/* Words that @mention only people wake no agent (SPC-1540): "For Ed · wakes no agent". */}
      <CommentForPeopleNote controller={controller} text={draft} />
      {/* Where a reply goes is said once, here: "Reply to The Paper Lanterns". */}
      <div className="nui-comment-reply-box" data-hosted={replySlot ? '' : undefined} onClick={stop} onKeyDown={stop}>
        <span ref={replyMarker} className="nui-comment-box-marker" aria-hidden="true" />
        {replySlot ? <slot name={replySlot} /> : (
        <OwnTextBox className="nui-comment-compose-box" hasDraft={Boolean(draft.trim()) || files.drafts.length > 0} hold={sending}
          data-dragging={files.dragging ? '' : undefined} {...files.boxHandlers}>
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
        </OwnTextBox>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// New comment
// ---------------------------------------------------------------------------

/** Uploads the host composer's files as the pane's own boxes do, then hands them to `save`. False when one fails. */
async function withUploads(controller: CommentController, files: readonly File[],
  save: (uploaded: CommentFile[]) => Promise<boolean>): Promise<boolean> {
  // The host's field is switched off while it sends: the review run's keys stand still until it is back.
  const release = holdReviewRunKeys();
  try {
    const uploaded: CommentFile[] = [];
    for (const file of files) uploaded.push(await controller.uploadFile(file));
    return await save(uploaded);
  } catch (error) {
    console.warn('[comments] upload failed', error);
    controller.actions.notify(controller.words.saveError);
    return false;
  } finally {
    release();
  }
}

/**
 * Who a new comment goes to, as its box's first pill says it: the thread picked, else the best match, else "To a new
 * thread"; "Choose a thread" when the best match could not be read. Null on a host without best matches or the picker.
 */
function newCommentTo(controller: CommentController): HostComposerTo | null {
  const { routing } = controller;
  if (!routing.hasBestMatch && !routing.canPick && !routing.newPick) return null;
  const unread = !routing.newPick && routing.bestMatchLost === true;
  if (unread && !routing.canPick) return null;
  const pick = routing.newPick ?? routing.bestMatch;
  const ref = pick && 'threadId' in pick ? pick : null;
  const outside = outsideClaim(ref);
  return {
    label: outside ? controller.say('toWho', { who: commentOutsideName(ref!) })
      : unread ? controller.say('toPick') : commentThreadName(controller, pick).to,
    outside, outsideLabel: controller.say('outsideNotis'),
    harness: ref?.harness ?? (pick && 'newThread' in pick ? pick.newThread : null),
    pick: routing.canPick ? anchor => routing.pickForNew(anchor).then(picked => pickMentionText(picked) ?? Boolean(picked)) : undefined,
    pickLabel: controller.say('pickThread'),
  };
}

export interface NewCommentFrameProps {
  controller: CommentController;
  /** The box's accessible name: what the new comment is on ("New comment on Slide 2"). */
  label: string;
  /** The words it quotes, or where it sits when it quotes none ("Whole page", the items, a moment). */
  quote: string | null;
  place: string | null;
  /** Changes when the box starts another comment: it takes the caret and scrolls into view again. */
  where: string | null;
  body: string;
  setBody(text: string): void;
  files: CommentFilesState;
  /** Saves the comment with its uploaded files. True once saved. */
  save(text: string, files: CommentFile[]): Promise<boolean>;
  /** Drops the new comment. */
  cancel(): void;
  /** The last save failed: the box says so. */
  failed?: boolean;
  sending?: boolean;
  /**
   * Where the box's draft is kept (`commentDrafts`): the files the host's composer holds are kept there too, so they
   * come back after the pane was away or a save failed. Without it they live in the composer only.
   */
  draftKey?: string | null;
}

/**
 * The box of a new comment, the same for a pin, items, a moment, the whole page and quoted words. It is the chat box's
 * parts: where it goes is its first pill ("To Deck polish", which opens the picker), then the words it quotes or its
 * place, inside the text field; no title, no grey quote box and no Cancel button. Escape drops an empty box (with text,
 * the first Escape leaves the field); a touch screen, which has no Escape, has a small cross on the pill line.
 *
 * The host draws its own composer in the box when it draws comment boxes (`useHostComposer`); otherwise the pane keeps
 * this plain box with the same parts, where an @ typed first opens the thread picker.
 */
export function NewCommentFrame({ controller, label, quote, place, where, body, setBody, files, save, cancel, failed = false,
  sending = false, draftKey = null }: NewCommentFrameProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const atPicker = useAtThreadPicker(controller);
  const drop = () => { files.clear(); writeHostDraftFiles(draftKey, []); cancel(); };
  const to = newCommentTo(controller);
  const slot = useHostComposer(marker, true, {
    kind: 'new', placeholder: controller.say('commentPlaceholder'), label, to, quote, place,
    initialText: body, onText: setBody,
    // The host's files are kept with the text: a save that fails after the upload brings the box back with them.
    initialFiles: readHostDraftFiles(draftKey), onFiles: picked => writeHostDraftFiles(draftKey, picked),
    send: (text, picked) => withUploads(controller, picked, async (uploaded) => {
      const ok = await save(text, uploaded);
      if (ok) writeHostDraftFiles(draftKey, []);
      return ok;
    }),
    dismiss: drop, canWrite: controller.canWrite, attach: controller.attach === 'on', transcribe: controller.transcribe ?? null,
    focusToken: 0, autoFocus: true,
  }, [where, label, to?.label, to?.outside, to?.harness, Boolean(to?.pick), quote, place, controller.canWrite, controller.attach, controller.transcribe]);
  useEffect(() => { if (!slot) ref.current?.focus({ preventScroll: true }); }, [where, slot]);
  // The box opens at the top of the list: a list scrolled down scrolls up to show it whole, with its pills.
  useRevealOnOpen(boxRef, where);
  // Escape drops the new comment: one step in the host's Escape chain. The engine leaves Escape to a focused text
  // field, so the field handles its own Escape.
  useEscapeLayer('comments.new', () => { drop(); return true; }, { priority: ESCAPE_PRIORITY.selection + 1 });

  const canSend = (Boolean(body.trim()) || files.ready.length > 0) && files.settled && !sending && controller.canWrite;
  const send = async () => {
    if (!canSend) return;
    // The new comment shows in the list at once, so the box empties at once too (the text never shows twice while the
    // store answers); a failed save brings the text back, and the attached files stay.
    const text = body;
    setBody('');
    if (await save(text, files.ready)) files.clear(); else setBody(text);
  };
  return (
    <div ref={boxRef} className="nui-comment-new-box" data-swipe-dismiss="" role="group" aria-label={label} data-hosted={slot ? '' : undefined}
      data-dragging={!slot && files.dragging ? '' : undefined} {...(slot ? {} : files.boxHandlers)}>
      <span ref={marker} className="nui-comment-box-marker" aria-hidden="true" />
      {slot ? (
        <>
          <slot name={slot} />
          {/* The host draws the To pill; words that @mention only people say here that no agent wakes (SPC-1540). */}
          <CommentForPeopleNote controller={controller} text={body} />
        </>
      ) : (
        <>
          {/* Where it goes, then what it is on: the pills of the box, never a title or a quote box of their own. */}
          <div className="nui-comment-box-pills" data-part="box-pills">
            <CommentToChip controller={controller} text={body} onMention={mention => setBody(withPickMention(body, mention))} />
            {quote ? (
              <span className="nui-comment-pill" data-pill="quote" title={quote}><Icon name={COMMENT_MODE_ICON.text} /><span>{quote}</span></span>
            ) : place ? (
              <span className="nui-comment-pill" data-pill="place" title={place}><Icon name={COMMENT_MODE_ICON.page} /><span>{place}</span></span>
            ) : null}
            <button type="button" className="nui-comment-box-drop" data-part="discard" aria-label={controller.say('discardComment')}
              onClick={drop}><Icon name="x" /></button>
          </div>
          <textarea
            ref={ref}
            className="nui-comment-input"
            value={body}
            rows={2}
            placeholder={controller.say('commentPlaceholder')}
            aria-label={controller.say('commentPlaceholder')}
            disabled={sending}
            onChange={event => setBody(atPicker(event.target.value, event.currentTarget, setBody))}
            onKeyDown={event => {
              if (sendsOnEnter(event)) { event.preventDefault(); void send(); }
              if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (body.trim() || files.drafts.length) event.currentTarget.blur(); else drop();
              }
            }}
          />
          <CommentFileChips controller={controller} files={files} />
          {failed ? <p className="nui-passage-error" role="alert">{controller.say('saveError')}</p> : null}
          <div className="nui-comment-new-actions">
            <CommentAttachButton controller={controller} files={files} disabled={sending} />
            <span className="nui-comment-new-gap" />
            <IconAction label={controller.say('send')} icon="paper-plane-right" disabled={!canSend} onClick={() => void send()} />
          </div>
          <CommentDropVeil controller={controller} files={files} />
        </>
      )}
    </div>
  );
}

export interface NewCommentBoxProps {
  controller: CommentController;
}

/** The box for the comment `controller.draftPin` started: a pin, a zone, items, a moment or the whole page. */
export function NewCommentBox({ controller }: NewCommentBoxProps) {
  const pin = controller.draftPin;
  useSwipeDownToDismiss();
  // Text and files outlive the box while the pane is away (`commentDrafts`); the controller brings the pin back.
  const draftKey = commentDraftKey(controller.draftScope, 'new');
  const [body, setBody] = useCommentDraftText(pin ? draftKey : null);
  const [sending, setSending] = useState(false);
  const files = useCommentFiles(controller, draftKey);
  // The new comment shows in the list at once, so the box goes at once too; a failed save brings it back.
  if (!pin || sending) return null;
  const where = `${pin.anchorKey ?? ''}|${pin.items?.length ?? ''}|${pin.time ?? ''}|${pin.text?.quote ?? ''}`;
  const anchor = controller.anchors.find(item => item.recordKey === pin.anchorKey);
  const heading = pin.text?.quote ? controller.say('newCommentText')
    : pin.time != null ? controller.say('newCommentTime', { time: formatCommentTime(pin.time) })
    : pin.items && pin.items.length > 1 ? controller.say('newCommentItems', { n: pin.items.length })
    : pin.items?.length && !anchor ? controller.say('newCommentItem')
    : anchor && pin.x == null ? sayOnAnchor(controller, 'newCommentWhole', anchor)
    : anchor ? sayOnAnchor(controller, 'newCommentOn', anchor)
    : controller.anchors.length ? controller.say('newCommentPage') : controller.say('newComment');
  // Where it sits, as its pill says it: the items named (SPC-463), the moment, the item, else the whole page.
  const place = pin.text?.quote ? null
    : pin.items?.length && (pin.items.length > 1 || !anchor) ? commentItemNames(controller, pin.items)
    : pin.time != null ? controller.say('placeTime', { time: formatCommentTime(pin.time) })
    : anchor ? commentItemNames(controller, [anchor]) : controller.say('placeWholePage');
  return (
    <NewCommentFrame controller={controller} label={heading} quote={pin.text?.quote ?? null} place={place} where={where}
      body={body} setBody={setBody} files={files} draftKey={draftKey} cancel={() => controller.cancelPin()}
      save={async (text, uploaded) => {
        setSending(true);
        const ok = await controller.sendNew(text.trim(), uploaded);
        setSending(false);
        return ok;
      }} />
  );
}

/** Words about one anchor, with the Space's own anchor label as "{anchor}" ("New comment on Slide 2", SPC-462). */
function sayOnAnchor(controller: CommentController, key: 'newCommentOn' | 'newCommentWhole' | 'commentOnAnchor',
  anchor: Pick<CommentAnchor, 'order'>): string {
  return controller.say(key, { n: anchor.order, anchor: controller.say('anchorLabel', { n: anchor.order }) });
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
  const pressed = useRef<string | null>(null);
  const selectedPin = useRef<HTMLButtonElement | null>(null);
  const open = (event: ReactMouseEvent, thread: CommentThread) => {
    event.stopPropagation();
    pressed.current = thread.root.recordKey;
    if (onOpen) onOpen(thread); else controller.revealThread(thread);
  };
  // A thread picked in the pane (or a link) brings its pin into view when the page is scrolled away from it: on a phone
  // the pane closes over the page, and the page is then already on the pin, which pops. A pressed pin stays put.
  useEffect(() => {
    const selected = controller.threadKey;
    if (!selected || pressed.current === selected) { pressed.current = null; return; }
    const pin = selectedPin.current;
    const view = pin?.ownerDocument.defaultView;
    if (!pin || !view) return;
    const at = pin.getBoundingClientRect();
    if (at.top >= 0 && at.bottom <= view.innerHeight) return;
    const still = view.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    pin.scrollIntoView?.({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  }, [controller.threadKey]);
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
          data-pin={thread.root.recordKey}
          data-agent={thread.root.author !== controller.me ? '' : undefined}
          ref={thread.root.recordKey === controller.threadKey ? selectedPin : undefined}
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
   * card moves down by the bar's height to make that room, so it never covers the card or its pins; there it draws in
   * the layer root (as menus do), so no parent that clips its overflow hides it (SPC-464). 'inline': it sits in the
   * flow where the Space puts it.
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

/** The width at which the overlay bar leaves the card (toolkit.css uses the same query). */
const PHONE_WIDTH = '(max-width: 480px)';

function phoneWidthNow(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(PHONE_WIDTH).matches === true;
}

/** True at phone width while `active`, following the screen as it turns or a panel resizes. */
function usePhoneWidth(active: boolean): boolean {
  const [phone, setPhone] = useState(phoneWidthNow);
  useEffect(() => {
    if (!active || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(PHONE_WIDTH);
    const sync = () => setPhone(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, [active]);
  return active && phone;
}

/**
 * True when something outside the Space covers the card where the lifted bar stands (the host's Comments or Chat sheet
 * on a phone): the bar is in the layer root, which stacks over the host, so it hides instead of floating over that
 * sheet (SPC-464). The probe is a point just inside the card's top left corner, which the bar never covers (it sits
 * above the card); a hit on the card or on the Space's own layer counts as visible. A card off screen counts as
 * covered. Without `elementFromPoint` (a test DOM) nothing counts as covered.
 */
function cardCovered(card: HTMLElement, rect: DOMRect): boolean {
  const root = card.getRootNode() as Document | ShadowRoot;
  if (typeof root.elementFromPoint !== 'function') return false;
  const view = card.ownerDocument.defaultView;
  const x = rect.left + Math.min(12, rect.width / 2);
  const y = rect.top + Math.min(12, rect.height / 2);
  if (view && (x < 0 || y < 0 || x >= view.innerWidth || y >= view.innerHeight)) return true;
  const hit = root.elementFromPoint(x, y);
  if (!hit) return false;
  return !card.contains(hit) && !hit.closest(`[${LAYER_ROOT_ATTRIBUTE}]`);
}

/** How often the lifted bar checks for a host sheet opening over its card (no event says so). */
const COVER_CHECK_MS = 400;

/**
 * Where the lifted bar goes: fixed, 8 px above the card's top edge (in the room the card keeps), from its left edge
 * and never wider than it. It follows scrolling, resizing and the bar's own size, and hides while the host covers
 * its card.
 */
function useLiftedBarStyle(lifted: boolean, card: HTMLElement | null, bar: HTMLElement | null): CSSProperties | undefined {
  const [style, setStyle] = useState<{ top: number; left: number; maxWidth: number; covered: boolean } | null>(null);
  useIsoLayoutEffect(() => {
    if (!lifted || !card || !bar) { setStyle(null); return undefined; }
    const update = () => {
      const rect = card.getBoundingClientRect();
      const origin = fixedOrigin(bar);
      const next = { top: rect.top - bar.getBoundingClientRect().height - 8 - origin.y, left: rect.left - origin.x,
        maxWidth: rect.width, covered: cardCovered(card, rect) };
      setStyle(current => current && current.top === next.top && current.left === next.left
        && current.maxWidth === next.maxWidth && current.covered === next.covered ? current : next);
    };
    update();
    const view = bar.ownerDocument.defaultView;
    view?.addEventListener('resize', update);
    view?.addEventListener('scroll', update, true);
    const sizes = view && typeof view.ResizeObserver !== 'undefined' ? new view.ResizeObserver(update) : null;
    sizes?.observe(bar);
    sizes?.observe(card);
    const timer = view ? view.setInterval(update, COVER_CHECK_MS) : undefined;
    return () => {
      view?.removeEventListener('resize', update);
      view?.removeEventListener('scroll', update, true);
      sizes?.disconnect();
      if (timer !== undefined) view?.clearInterval(timer);
    };
  }, [lifted, card, bar]);
  if (!lifted) return undefined;
  if (!style) return { visibility: 'hidden' };
  return { top: style.top, left: style.left, maxWidth: style.maxWidth, ...(style.covered ? { visibility: 'hidden' as const } : {}) };
}

/**
 * Tells the overlay bar's card how tall the bar is, as `--nui-comment-toolbar-room`. At phone width the stylesheet
 * puts the bar above the card and moves the card down by that much (toolkit.css); elsewhere the value is unused. It
 * follows the bar's size (a hint on two lines) and goes when the bar does. The card is the bar's parent, or the
 * parent of the slot the bar left when it draws in the layer root.
 */
function useToolBarRoom(active: boolean, bar: HTMLElement | null, card: HTMLElement | null) {
  useIsoLayoutEffect(() => {
    const parent = active ? card : null;
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
  }, [active, bar, card]);
}

/** A mounted comment tool bar that takes its toggle key, with the owner (Space or retained view) it draws in. */
interface ToolBarTaker { owner: string; label: Words; takes(): boolean; toggle(): void }

/**
 * One registration of a toggle key for every comment tool bar mounted on an engine (SPC-491). The key is one Notis
 * keeps (C), so it registers as Notis, and two tool bars on screen at once (a page and the one it opens, a retained
 * view) would clash: the one key toggles the newest tool bar whose Space or view is on screen.
 */
interface ToolBarKeySlot { takers: ToolBarTaker[]; unregister: (() => void) | null }
const TOOL_BAR_KEYS = new WeakMap<KeyboardEngineCore, Map<string, ToolBarKeySlot>>();

function useToolBarKey(key: string | false | undefined, taker: ToolBarTaker): void {
  const core = useEngineCore();
  const owner = useShortcutOwner();
  const ref = useRef(taker);
  ref.current = { ...taker, owner };
  useEffect(() => {
    if (!key) return undefined;
    const byKey = TOOL_BAR_KEYS.get(core) ?? new Map<string, ToolBarKeySlot>();
    TOOL_BAR_KEYS.set(core, byKey);
    const slot: ToolBarKeySlot = byKey.get(key) ?? { takers: [], unregister: null };
    byKey.set(key, slot);
    const mine: ToolBarTaker = {
      get owner() { return ref.current.owner; },
      get label() { return ref.current.label; },
      takes: () => ref.current.takes(),
      toggle: () => ref.current.toggle(),
    };
    slot.takers.push(mine);
    const pick = () => [...slot.takers].reverse()
      .find(item => core.registry.isOwnerAvailable(item.owner) && item.takes()) ?? null;
    if (!slot.unregister) {
      slot.unregister = core.register({
        id: 'comments.toolbar', keys: key, scope: 'route', owner: 'notis',
        get label() { return (pick() ?? slot.takers[slot.takers.length - 1] ?? mine).label; },
        when: () => pick() != null,
        run: () => {
          const taker = pick();
          if (!taker) return false;
          taker.toggle();
          return true;
        },
      }, 'notis');
    }
    return () => {
      slot.takers = slot.takers.filter(item => item !== mine);
      if (!slot.takers.length) {
        slot.unregister?.();
        slot.unregister = null;
        byKey.delete(key);
      }
    };
  }, [core, key]);
}

function ShownCommentToolBar({ controller, toggleKey = 'c', pinned = false, place = 'overlay', className }: CommentToolBarProps) {
  const shown = pinned || controller.toolBar;
  const { setToolBar, cancelMode, modes } = controller;
  useToolBarKey(!pinned && toggleKey, {
    owner: '', label: controller.words.toggleToolBar,
    takes: () => modes.length > 0,
    toggle: () => {
      if (controller.toolBar) { cancelMode(); setToolBar(false); } else setToolBar(true);
    },
  });
  // Escape closes the bar once no mode waits (the mode's own Escape runs first).
  useEscapeLayer('comments.toolbar', () => { setToolBar(false); return true; },
    { priority: ESCAPE_PRIORITY.selection, enabled: shown && !pinned && controller.commentMode == null });
  const visible = shown && modes.length > 0;
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const [slot, setSlot] = useState<HTMLSpanElement | null>(null);
  // At phone width the overlay bar sits outside its card, where a parent that clips its overflow would hide it: it
  // draws in the layer root instead, and an empty slot in the card keeps its room (SPC-464).
  const lifted = usePhoneWidth(visible && place === 'overlay');
  const card = lifted ? slot?.parentElement ?? null : bar?.parentElement ?? null;
  useToolBarRoom(visible && place === 'overlay', bar, card);
  const liftedStyle = useLiftedBarStyle(lifted, card, bar);
  const pinnedLayer = usePinnedLayerRoot();
  if (!visible) return null;
  const mode = controller.commentMode;
  const idle = commentIdleHint(controller);
  const toolBar = (
    <div ref={setBar} className={cx('nui-comment-toolbar', className)} role="toolbar" aria-label={controller.say('toolBar')}
      data-mode={mode ?? undefined} data-place={place} data-lifted={lifted ? '' : undefined} style={liftedStyle}>
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
  if (!lifted) return toolBar;
  const layer = pinnedLayer ?? (slot ? findLayerRoot(slot) : null);
  return (
    <>
      <span ref={setSlot} className="nui-comment-toolbar-slot" data-place="overlay" aria-hidden="true" />
      {layer ? createPortal(toolBar, layer) : null}
    </>
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

export const CommentPane = markHostPane(function CommentPane(props: CommentPaneProps) {
  const { controller } = props;
  // What the host reads: the threads (its waiting count) and the new comment (it opens the panel for it).
  const target = useHostCommentSource('pins', controller, { title: props.title },
    [controller.threads, controller.draftPin, controller.threadKey, controller.commentMode]);
  // A host that draws panes itself keeps this one's elements when a new version of the view replaces this view.
  const key = useHandedPaneKey(controller, 'pins');
  const body = <CommentPaneBody {...props} />;
  const hosted = usePaneOutlet(target, key, body, !controller.loading);
  return target && !hosted ? createPortal(body, target) : null;
});

function CommentPaneBody({ controller, title, showCopy = true, className, order, groupBy, groupHeadings }: CommentPaneProps) {
  const rootRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useThreadScroller(controller, scrollRef);
  const heading = title ?? controller.say('comments');
  const { visibleThreads, draftPin, filter, statusFilter, waitingFilter } = controller;
  const emptyTitle = waitingFilter ? controller.say('emptyWaiting') : statusFilter === 'done' ? controller.say('emptyResolved')
    : filter === 'anchor' ? controller.say('emptyAnchor') : controller.say('emptyAll');
  // The hint shows only on an empty list of open comments, where the Space takes comments on words.
  const emptyHint = !waitingFilter && statusFilter !== 'done' && controller.modes.includes('text');
  usePaneFocusKeeper(rootRef, visibleThreads);
  const run = useReviewRunPane({ controller, rootRef, threads: controller.threads, drafting: Boolean(draftPin), asking: commentWaitingChoices });
  useNextCardComesIntoPlace(rootRef, `${controller.filter}|${controller.statusFilter}|${controller.waitingFilter}|${controller.anchorKey ?? ''}`);

  return (
    <CommentPaneKeys controller={controller} rootRef={rootRef}>
      <aside ref={rootRef} className={cx('nui-comment-pane', className)} aria-label={heading} {...run.attrs}>
        <CommentPaneBar controller={controller} rootRef={rootRef} showCopy={showCopy} runCount={run.count} />

        {/* The pane scrolls its own list; the toast below stays at the bottom of what shows (C7). */}
        <div ref={scrollRef} className="nui-comment-pane-scroll" data-comment-scroll="">
        {draftPin ? <NewCommentBox controller={controller} /> : controller.commentMode ? (
          <div className="nui-comment-start"><CommentModeHint controller={controller} /></div>
        ) : null}

        {visibleThreads.length ? (
          <CommentThreadList controller={controller} threads={visibleThreads} order={order} groupBy={groupBy} groupHeadings={groupHeadings}>
            {thread => (
              <CommentThreadCard key={thread.root.recordKey} controller={controller} thread={thread}
                showAnchor={filter === 'all'} />
            )}
          </CommentThreadList>
        ) : draftPin ? null : controller.loading || controller.loadingMore ? (
          <CommentListLoading controller={controller} />
        // Older Done threads are left to read: the list's end below reads them, and "No comments" waits for the last.
        ) : controller.hasMore || (run.running && run.count !== null) ? null : (
          // In a review run the host says what the empty list means (the next page, or "All caught up").
          <EmptyState className="nui-comment-empty" icon="chat-circle-text" title={emptyTitle}
            body={emptyHint ? controller.say('selectToComment') : undefined} />
        )}
        {/* Older Done threads are read a page at a time, as the end of the list comes into view. */}
        {controller.hasMore && !draftPin && (visibleThreads.length || !controller.loadingMore)
          ? <CommentListMore controller={controller} /> : null}
        {/* What the host adds after the last card (the review run's next page). */}
        {draftPin ? null : <slot name="after-list" />}
        </div>

        {/* The review run's bar when no card is selected (a page's last one was marked Done): the selected card holds it. */}
        <slot name="run-bar" />
        <ActionToast toast={controller.toaster.toast} onUndo={() => void controller.toaster.undo()}
          onDismiss={controller.toaster.dismiss} />
      </aside>
    </CommentPaneKeys>
  );
}
