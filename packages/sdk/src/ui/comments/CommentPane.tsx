/**
 * The comment pane and its pieces, rendered from a `useComments` controller:
 *
 * - `CommentPane`: the side panel (filters, Copy changes, the new comment box, the thread cards, the delete
 *   confirmation and the toast).
 * - `CommentPins`: the numbered pins and zones on the anchor element. Put it inside the element the comments sit on (a
 *   slide, a section) and give that element `position: relative`. With `controller.commenting` on it covers the element:
 *   a click drops a pin, a press and drag marks a zone (when the table has zone columns). The pane's "Comment on this
 *   item" starts a comment on the whole anchor, with no pin.
 * - `CommentThreadCard`, `NewCommentBox` and `CommentAvatar` for Spaces that lay the pane out themselves.
 *
 * Keyboard: Enter sends a reply or a new comment and Shift+Enter adds a line; Escape in an empty new comment drops it
 * (with text, the first Escape leaves the field); Escape leaves Add comment mode; a thread card selects with Enter.
 */

import React, {
  useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent,
} from 'react';
import { Dialog } from '../../components/Dialog';
import { ActionToast } from '../actions/ActionToast';
import { Badge, Button, EmptyState, SegmentedControl } from '../blocks';
import { ESCAPE_PRIORITY } from '../engine/core';
import { useEscapeLayer } from '../engine/hooks';
import { Icon } from '../icons';
import { Tooltip } from '../overlay';
import { cx } from '../util';
import {
  COMMENT_CHECK_ANSWERS, COMMENT_TEXT_FILE, commentRelativeTime, isCommentZone, scrollCommentIntoView, type CommentRecord,
  type CommentThread,
} from './commentModel';
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

/** The author's initial. Decorative: the author's name is always written next to it. */
export function CommentAvatar({ author, me, className }: CommentAvatarProps) {
  return (
    <span aria-hidden="true" className={cx('nui-comment-avatar', className)} data-me={author === me ? '' : undefined}>
      {(author.trim().slice(0, 1) || '?').toUpperCase()}
    </span>
  );
}

function IconAction({ label, icon, onClick, disabled }: {
  label: string; icon: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <Tooltip label={label}>
      <Button variant="ghost" size="sm" className="nui-comment-icon-btn" aria-label={label} disabled={disabled}
        onClick={onClick} icon={<Icon name={icon} />} />
    </Tooltip>
  );
}

function answerLabel(controller: CommentController, answer: string): string {
  if (answer === COMMENT_CHECK_ANSWERS[0]) return controller.say('looksGood');
  if (answer === COMMENT_CHECK_ANSWERS[1]) return controller.say('undo');
  return answer;
}

function stop(event: { stopPropagation(): void }) { event.stopPropagation(); }

function sendsOnEnter(event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing;
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

export function CommentThreadCard({ controller, thread, showAnchor = false }: CommentThreadCardProps) {
  const { root, replies, anchor } = thread;
  const { actions, locale, now, isNew, me } = controller;
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const resolved = root.status === 'Resolved';
  const selected = controller.threadKey === root.recordKey;
  const busy = controller.busy.has(root.recordKey);
  const number = controller.numberOf(thread);

  useEffect(() => {
    if (selected && cardRef.current) scrollCommentIntoView(cardRef.current);
  }, [selected]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const ok = await actions.reply(thread, body);
    setSending(false);
    if (ok) setDraft('');
  };

  const attach = async (file: File | undefined) => {
    if (!file) return;
    if (!(file.type.startsWith('text/') || COMMENT_TEXT_FILE.test(file.name))) { actions.notify(controller.words.textOnly); return; }
    const content = (await file.text()).slice(0, 8000);
    setDraft(current => `${current ? `${current}\n\n` : ''}${file.name}\n${content}`);
    replyRef.current?.focus();
  };

  const select = () => controller.selectThread(thread);
  const onCardKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
  };

  const needsLabel = root.needs === 'check' ? controller.say('needCheck')
    : root.needs === 'choice' ? controller.say('needChoice') : controller.say('needInput');
  const choices = root.needs === 'check' ? [...COMMENT_CHECK_ANSWERS] : root.options;
  const meta = [
    commentRelativeTime(root.createdAt, locale, now),
    showAnchor && anchor ? controller.say('anchorLabel', { n: anchor.order }) : '',
    number > 0 && root.x != null ? `#${number}` : '',
  ].filter(Boolean).join(' · ');
  const replyLabel = resolved ? controller.say('replyToReopen') : controller.say('reply');

  const newDot = (comment: CommentRecord) => isNew(comment)
    ? <span className="nui-comment-new" role="img" aria-label={controller.say('newActivity')} /> : null;

  return (
    <article
      ref={cardRef}
      className="nui-comment-card"
      data-thread={root.recordKey}
      data-selected={selected ? '' : undefined}
      data-resolved={resolved ? '' : undefined}
      aria-current={selected ? 'true' : undefined}
      aria-label={controller.say('pin', { who: root.author, body: root.body })}
      tabIndex={0}
      onClick={select}
      onKeyDown={onCardKey}
    >
      <header className="nui-comment-head">
        <CommentAvatar author={root.author} me={me} />
        <div className="nui-comment-who">
          <span className="nui-comment-author">{root.author}</span>
          <span className="nui-comment-meta">{meta}</span>
          {newDot(root)}
        </div>
        <div className="nui-comment-actions" onClick={stop} onKeyDown={stop}>
          {resolved
            ? <IconAction label={controller.say('reopen')} icon="arrow-counter-clockwise" disabled={busy}
                onClick={() => actions.setStatus(root, 'Open')} />
            : <IconAction label={controller.say('resolve')} icon="check" disabled={busy}
                onClick={() => actions.setStatus(root, 'Resolved')} />}
          <IconAction label={controller.say('delete')} icon="trash" disabled={busy} onClick={() => actions.askDelete(root)} />
        </div>
      </header>

      {root.example || resolved ? (
        <div className="nui-comment-badges">
          {root.example ? <Badge>{controller.words.example}</Badge> : null}
          {resolved ? <Badge>{controller.words.resolved}</Badge> : null}
        </div>
      ) : null}
      <p className="nui-comment-body">{root.body}</p>

      {root.needs !== 'none' ? (
        <div className="nui-comment-ask" onClick={stop} onKeyDown={stop}>
          <p className="nui-comment-ask-label">
            <span className="nui-comment-ask-who">{controller.say('needs', { who: root.author })}</span> {needsLabel}
          </p>
          {root.answer ? (
            <p className="nui-comment-answer">
              <Icon name="check" />
              <span>{controller.say('sent', { answer: answerLabel(controller, root.answer) })}</span>
            </p>
          ) : root.needs === 'input' ? (
            <div className="nui-comment-choices">
              <Button size="sm" variant="secondary" disabled={busy} icon="paperclip"
                onClick={() => fileRef.current?.click()}>{controller.words.attach}</Button>
              <Button size="sm" variant="secondary" disabled={busy} icon="clipboard-text"
                onClick={() => replyRef.current?.focus()}>{controller.words.paste}</Button>
              <input ref={fileRef} type="file" className="nui-sr-only" tabIndex={-1} aria-hidden="true"
                accept="text/*,.md,.txt,.csv,.json"
                onChange={event => { void attach(event.target.files?.[0]); event.target.value = ''; }} />
            </div>
          ) : (
            <div className="nui-comment-choices" role="group" aria-label={needsLabel}>
              {choices.map(choice => (
                <Button key={choice} size="sm" variant="secondary" disabled={busy}
                  onClick={() => actions.answer(root, choice)}>{answerLabel(controller, choice)}</Button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {replies.length ? (
        <ol className="nui-comment-replies">
          {replies.map(reply => (
            <li key={reply.recordKey} className="nui-comment-reply">
              <CommentAvatar author={reply.author} me={me} />
              <div className="nui-comment-reply-text">
                <div className="nui-comment-who">
                  <span className="nui-comment-author">{reply.author}</span>
                  <span className="nui-comment-meta">{commentRelativeTime(reply.createdAt, locale, now)}</span>
                  {newDot(reply)}
                </div>
                <p className="nui-comment-body">{reply.body}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="nui-comment-compose" onClick={stop} onKeyDown={stop}>
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
        <IconAction label={controller.say('send')} icon="paper-plane-right" disabled={!draft.trim() || sending}
          onClick={() => void send()} />
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

/** The box for the comment `controller.draftPin` started. Takes focus when it opens. */
export function NewCommentBox({ controller }: NewCommentBoxProps) {
  const pin = controller.draftPin;
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancel = controller.cancelPin;
  const where = pin?.anchorKey ?? null;
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, [where]);
  // Escape drops the new comment: one step in the host's Escape chain. The engine leaves Escape to a focused text
  // field, so the textarea handles its own Escape below.
  useEscapeLayer('comments.new', () => { cancel(); return true; },
    { priority: ESCAPE_PRIORITY.selection + 1, enabled: pin != null });
  if (!pin) return null;
  const anchor = controller.anchors.find(item => item.recordKey === pin.anchorKey);
  const heading = anchor && pin.x == null ? controller.say('newCommentWhole', { n: anchor.order })
    : anchor ? controller.say('newCommentOn', { n: anchor.order }) : controller.say('newComment');

  const send = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    const ok = await controller.sendNew(body.trim());
    setSending(false);
    if (ok) setBody('');
  };

  return (
    <div className="nui-comment-new-box" role="group" aria-label={heading}>
      <p className="nui-comment-new-title">{heading}</p>
      <textarea
        ref={ref}
        className="nui-comment-input"
        value={body}
        rows={2}
        placeholder={controller.say('commentPlaceholder')}
        aria-label={controller.say('commentPlaceholder')}
        onChange={event => setBody(event.target.value)}
        onKeyDown={event => {
          if (sendsOnEnter(event)) { event.preventDefault(); void send(); }
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (body.trim()) event.currentTarget.blur(); else cancel();
          }
        }}
      />
      <div className="nui-comment-new-actions">
        <Button size="sm" variant="ghost" onClick={cancel}>{controller.words.cancel}</Button>
        <Button size="sm" variant="primary" disabled={!body.trim() || sending} icon="paper-plane-right"
          onClick={() => void send()}>{controller.words.send}</Button>
      </div>
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
  /** A pin was pressed. Default: `controller.selectThread`. */
  onOpen?(thread: CommentThread): void;
}

/**
 * Numbered pins at each thread's x and y on the anchor element, the zones threads mark, and the pin or zone of the
 * comment being written. In Add comment mode it also covers the element to take the click or drag that places one.
 */
export function CommentPins({ controller, anchorKey, onOpen }: CommentPinsProps) {
  const key = anchorKey === undefined ? controller.anchorKey : anchorKey;
  const pins = controller.threadsOn(key).filter(thread => thread.root.x != null && thread.root.y != null);
  const draft = controller.draftPin;
  const drag = controller.dragZone;
  const here = (key ?? null);
  const open = (event: ReactMouseEvent, thread: CommentThread) => {
    event.stopPropagation();
    if (onOpen) onOpen(thread); else controller.selectThread(thread);
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
          aria-label={controller.say(isCommentZone(thread.root) ? 'zone' : 'pin', { who: thread.root.author, body: thread.root.body })}
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
// Pane
// ---------------------------------------------------------------------------

export interface CommentPaneProps {
  controller: CommentController;
  /** The heading. Default "Comments". */
  title?: string;
  /** Hide Copy changes (a pane read by people only). Default shown. */
  showCopy?: boolean;
  className?: string;
}

export function CommentPane({ controller, title, showCopy = true, className }: CommentPaneProps) {
  const rootRef = useRef<HTMLElement>(null);
  const heading = title ?? controller.say('comments');
  const { threads, visibleThreads, changes, draftPin, filter, statusFilter, anchors, anchorKey } = controller;
  const scoped = filter === 'anchor' ? controller.threadsOn(anchorKey) : threads;
  const openCount = scoped.filter(thread => thread.root.status === 'Open').length;
  const resolvedCount = scoped.filter(thread => thread.root.status === 'Resolved').length;
  const emptyTitle = statusFilter === 'resolved' ? controller.say('emptyResolved')
    : filter === 'anchor' ? controller.say('emptyAnchor') : controller.say('emptyAll');

  return (
    <aside ref={rootRef} className={cx('nui-comment-pane', className)} aria-label={heading}>
      <div className="nui-comment-pane-head">
        <h2 className="nui-comment-pane-title">{heading}</h2>
        {anchors.length ? (
          <SegmentedControl
            label={controller.words.scope}
            value={filter}
            onChange={value => controller.setFilter(value)}
            options={[
              { value: 'anchor', label: controller.words.thisAnchor, count: controller.threadsOn(anchorKey).length },
              { value: 'all', label: controller.words.all, count: threads.length },
            ]}
          />
        ) : null}
      </div>

      <SegmentedControl
        label={controller.words.status}
        value={statusFilter}
        onChange={value => controller.setStatusFilter(value)}
        options={[
          { value: 'open', label: controller.words.open, count: openCount },
          { value: 'resolved', label: controller.words.resolvedFilter, count: resolvedCount },
        ]}
      />

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
          {controller.commenting ? (
            <p className="nui-comment-hint">{controller.say(controller.zones ? 'zoneHint' : 'pinHint')}</p>
          ) : null}
        </div>
      ) : null}

      {visibleThreads.length ? (
        <div className="nui-comment-list">
          {visibleThreads.map(thread => (
            <CommentThreadCard key={thread.root.recordKey} controller={controller} thread={thread}
              showAnchor={filter === 'all'} />
          ))}
        </div>
      ) : !draftPin && !controller.loading ? (
        <EmptyState className="nui-comment-empty" icon="chat-circle-text" title={emptyTitle} />
      ) : null}

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
