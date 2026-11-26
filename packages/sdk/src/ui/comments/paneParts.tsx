/**
 * Pieces both comment panes share (the pins pane `CommentPane` and the passage pane `PassageCommentPane`): the one
 * header row (New comment, the filter with "Waiting for you" first, the "..." menu), the hint a mode shows, the To chip
 * of a new comment, how a thread a comment goes to is named, the ordered and grouped list, and E / Shift+E.
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ShortcutScope } from '../engine/KeyboardEngine';
import { useShortcuts } from '../engine/hooks';
import { SHELL_WORDS } from '../../words';
import { Icon } from '../icons';
import { Menu, Tooltip } from '../overlay';
import {
  agentDisplayName, commentAnchorsOf, formatCommentTime, groupCommentThreads, orderCommentThreads, type CommentAnchor, type CommentGroup,
  type CommentOrder, type CommentThread,
} from './commentModel';
import type { SpaceCommentThreadRef } from '../../space';
import type { CommentWordKey } from './commentWords';
import { archiveThenNext, notifyReviewRunAction } from './reviewRun';
import { revealInScroller } from './scrollReveal';
import { elsewhere, outsideClaim, pickMentionText } from './useCommentRouting';
import { COMMENT_HARNESS_NAMES, CommentHarnessLogo, isHarness } from './agentRuntime';
import type { CommentMode } from './commentModel';
import type { CommentController, CommentStatusView } from './useComments';
import { commentsShadowHost, useWaitingCommentCount } from './hostPanel';

export const COMMENT_MODE_ICON: Readonly<Record<CommentMode, string>> = {
  text: 'file-text', point: 'circle', box: 'square-center', items: 'copy', time: 'clock', page: 'file',
};
export const COMMENT_MODE_WORD: Readonly<Record<CommentMode, CommentWordKey>> = {
  text: 'modeText', point: 'modePoint', box: 'modeBox', items: 'modeItems', time: 'modeTime', page: 'modePage',
};
const MODE_HINT: Partial<Record<CommentMode, CommentWordKey>> = {
  text: 'hintText', point: 'hintPoint', box: 'hintBox', items: 'hintItems',
};

function stop(event: { stopPropagation(): void }) { event.stopPropagation(); }

/** The filter's status choices under "Waiting for you", in the menu's order. */
const STATUS_VIEWS = ['open', 'done', 'all'] as const;

export interface CommentPaneBarProps {
  controller: CommentController;
  /** The pane's root: Copy changes falls back to it when the clipboard needs an element. */
  rootRef: RefObject<HTMLElement | null>;
  /** Shows Copy changes behind "...". Default true. */
  showCopy?: boolean;
  /**
   * What waits for the viewer in this pane. Default: the controller's count for its anchor filter. In the host panel
   * the host's own number replaces it (`setWaitingCommentCount`): what waits in the Space on screen.
   */
  waitingCount?: number;
  /**
   * In a review run: what waits in the run's scope. The "Waiting for you" chip then reads "5 waiting" and counts down
   * as the person goes (at none it reads "Waiting for you" again); a press on it shows every open comment again.
   */
  runCount?: number | null;
}

/**
 * The pane's one header row, the same on a phone and a computer: the host's Chat | Comments switch (`lead` slot), then
 * New comment (+), Filter, the "..." menu of what the Space adds to its panel, then the host's close button (`trail`
 * slot).
 *
 * - New comment starts the Space's one mode at once, or opens a menu of its modes, with "Comment on all of <item>"
 *   first on a page with items.
 * - Waiting for you is a toggle on the row with its number (the only one: no totals), as Focus mode in the Manager. The
 *   host says whether a pane starts with it on (`SpaceCommentsTransport.waitingFirst`, the person's Focus mode setting).
 * - "..." holds the rarer choices: Open, Done or All; where (this page or the whole Space on a record page; this item or
 *   all items, on a page with items); then what the Space adds to its panel.
 * - A second row shows only while those choices are not the usual ones (open threads, this page, this item): one chip
 *   per choice that differs, and a press on it puts that choice back.
 */
export function CommentPaneBar({ controller, rootRef, showCopy = true, waitingCount: listed = controller.waitingCount, runCount = null }: CommentPaneBarProps) {
  // In the host panel the number is the host's own (what waits in the Space on screen), the same as on its switch.
  const hostCount = useWaitingCommentCount();
  const [hosted, setHosted] = useState(false);
  useEffect(() => { setHosted(Boolean(commentsShadowHost(rootRef.current))); });
  const waitingCount = hosted && hostCount !== null ? hostCount : listed;
  const { modes, anchors, filter, changes, waitingFilter } = controller;
  // Where the pane holds a part of the Space, the host counted the changes (`changeCount`).
  const changeCount = controller.changeCount ?? changes.length;
  const statusFilter: CommentStatusView = controller.statusFilter === 'resolved' ? 'done' : controller.statusFilter;
  const statusLabel = (value: CommentStatusView) => controller.say(value === 'open' ? 'open' : value === 'done' ? 'resolvedFilter' : 'all');
  const scoped = anchors.length > 0;
  const widened = scoped && filter !== 'anchor';
  const spaceWide = controller.pageFilter === 'space';
  // Waiting for you shows on its own toggle only, in a review run too (Flo, 2026-11-25: "I don't like the filter
  // displayed like this"): the run's count is on its bar. A chip says only a choice of "...".
  const runWaiting = waitingFilter && runCount != null;
  const statusChip = !waitingFilter && statusFilter !== 'open';
  const filtered = statusChip || (widened && !runWaiting) || spaceWide;
  const shownStatus = statusLabel(statusFilter);
  const newLabel = controller.say('newCommentMenu');
  const wholeAnchor = scoped && controller.anchor ? controller.anchor : null;
  const oneMode = modes.length === 1 && !wholeAnchor ? modes[0]! : null;
  const newButton = (
    <button type="button" className="nui-comment-bar-btn" aria-label={newLabel} data-part="new-comment-button"
      onClick={oneMode ? () => controller.startMode(oneMode) : undefined}>
      <Icon name="plus" />
    </button>
  );
  return (
    <>
      <div className="nui-comment-bar" data-part="pane-bar">
        <slot name="lead" />
        <span className="nui-comment-bar-gap" />
        {!modes.length && !wholeAnchor ? null : oneMode ? (
          <Tooltip label={newLabel}>{newButton}</Tooltip>
        ) : (
          <Menu align="end" label={controller.words.newCommentMenu} accelerators={false} trigger={newButton}>
            {wholeAnchor ? (
              <Menu.Item icon="chat-circle-text" onSelect={() => controller.placePin(controller.anchorKey, null, null)}>
                <span data-new-comment="anchor">
                  {controller.say('commentOnAnchor', { n: wholeAnchor.order, anchor: controller.say('anchorLabel', { n: wholeAnchor.order }) })}
                </span>
              </Menu.Item>
            ) : null}
            {modes.map(mode => (
              <Menu.Item key={mode} icon={COMMENT_MODE_ICON[mode]} checked={controller.commentMode === mode ? true : undefined}
                onSelect={() => controller.startMode(mode)}>
                {controller.say(COMMENT_MODE_WORD[mode])}
              </Menu.Item>
            ))}
          </Menu>
        )}
        {/* Waiting for you is a toggle on the row, as Focus mode in the Manager: on, the list is what waits for you; off,
            the open comment threads. It is the only number: no totals. */}
        <Tooltip label={controller.say('waitingForYou')}>
          <button type="button" className="nui-comment-bar-btn" data-part="waiting-toggle" aria-pressed={waitingFilter}
            data-count={waitingCount > 0 ? '' : undefined}
            aria-label={waitingCount > 0 ? `${controller.say('waitingForYou')}, ${controller.say('waitingCount', { n: waitingCount })}` : controller.say('waitingForYou')}
            onClick={() => controller.setWaitingFilter(!waitingFilter)}>
            <Icon name="chat-circle-dots" />
            {waitingCount > 0 ? <span className="nui-comment-count" data-waiting="" aria-hidden="true">{waitingCount}</span> : null}
          </button>
        </Tooltip>
        {/* The rarer choices sit in "...": Open, Done or All, where (this page or the whole Space, this item or all
            items), then what the Space adds to its panel. */}
        <Menu align="end" label={controller.words.paneMore} accelerators={false}
          trigger={(
            <button type="button" className="nui-comment-bar-btn" data-part="more-button" data-active={filtered ? '' : undefined}
              data-filter={waitingFilter ? 'waiting' : statusFilter}
              aria-label={controller.say('paneMore')}>
              <Icon name="dots-three" />
            </button>
          )}>
          {STATUS_VIEWS.map(value => (
            <Menu.Item key={value} checked={!waitingFilter && statusFilter === value} onSelect={() => controller.setStatusFilter(value)}>
              <span className="nui-comment-filter-item" data-filter={value}><span>{statusLabel(value)}</span></span>
            </Menu.Item>
          ))}
          {controller.pageFilter ? <Menu.Separator /> : null}
          {controller.pageFilter ? (['page', 'space'] as const).map(value => (
            <Menu.Item key={`page-${value}`} checked={controller.pageFilter === value} onSelect={() => controller.setPageFilter(value)}>
              <span className="nui-comment-filter-item" data-scope={value}>
                <span>{controller.say(value === 'page' ? 'thisPage' : 'wholeSpace')}</span>
              </span>
            </Menu.Item>
          )) : null}
          {scoped ? <Menu.Separator /> : null}
          {scoped ? (['anchor', 'all'] as const).map(value => (
            <Menu.Item key={`scope-${value}`} checked={filter === value} onSelect={() => controller.setFilter(value)}>
              <span className="nui-comment-filter-item" data-scope={value}>
                <span>{controller.say(value === 'anchor' ? 'thisAnchor' : 'allItems')}</span>
              </span>
            </Menu.Item>
          )) : null}
          {showCopy ? <Menu.Separator /> : null}
          {showCopy ? (
            <Menu.Item icon="copy" disabled={!changeCount || controller.copying}
              onSelect={() => void controller.copyChanges(rootRef.current)}>
              <span className="nui-comment-filter-item" data-part="copy-changes">
                <span>{controller.say('copy')}</span>
                {changeCount ? <span className="nui-comment-count">{changeCount}</span> : null}
              </span>
            </Menu.Item>
          ) : null}
        </Menu>
        <slot name="trail" />
      </div>
      {filtered ? (
        <div className="nui-comment-chips" data-part="filter-chips">
          {statusChip ? (
            <button type="button" className="nui-comment-chip" data-chip={statusFilter}
              aria-label={controller.say('removeFilter', { filter: shownStatus })}
              onClick={() => controller.setStatusFilter('open')}>
              <span data-part="chip-label">{shownStatus}</span>
              <Icon name="x" />
            </button>
          ) : null}
          {spaceWide ? (
            <button type="button" className="nui-comment-chip" data-chip="whole-space"
              aria-label={controller.say('removeFilter', { filter: controller.say('wholeSpace') })}
              onClick={() => controller.setPageFilter('page')}>
              <span>{controller.say('wholeSpace')}</span><Icon name="x" />
            </button>
          ) : null}
          {widened && !runWaiting ? (
            <button type="button" className="nui-comment-chip" data-chip="all-items"
              aria-label={controller.say('removeFilter', { filter: controller.say('allItems') })}
              onClick={() => controller.setFilter('anchor')}>
              <span>{controller.say('allItems')}</span><Icon name="x" />
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * What the tool bar says before a mode starts: the hint of the first mode that waits for you to point (no "Point at"
 * on a Space without point mode), or nothing when every mode opens the box at once (time, page).
 */
export function commentIdleHint(controller: CommentController): CommentWordKey | null {
  const first = (['point', 'box', 'text', 'items'] as const).find(mode => controller.modes.includes(mode));
  return first ? MODE_HINT[first] ?? null : null;
}

/** The short hint a mode shows until you point at something, with how to cancel it. */
export function CommentModeHint({ controller, className = 'nui-comment-hint' }: { controller: CommentController; className?: string }) {
  const mode = controller.commentMode;
  // In the pane, point mode says what a click and a drag do; the tool bar keeps the short hint.
  const key = mode === 'point' && className === 'nui-comment-hint' ? controller.zones ? 'zoneHint' : 'pinHint'
    : mode ? MODE_HINT[mode] : undefined;
  if (!mode || !key) return null;
  return (
    <p className={className} role="status" data-mode={mode}>
      <span>{controller.say(key)}</span> <span className="nui-comment-hint-cancel">{controller.say('hintCancel')}</span>
    </p>
  );
}

/** A harness id as people read it: "claude" reads "Claude". */
export function commentHarnessName(harness: string | null | undefined): string {
  const name = (harness ?? '').trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : '';
}

/**
 * How a thread a comment goes to is named: its title, or "a new Claude thread" for a new-thread pick or a pending link
 * (no thread yet, the first wake starts it), or "a new thread" without one.
 */
export function commentThreadName(controller: CommentController, thread: SpaceCommentThreadRef | { newThread: string } | null):
  { title: string; to: string; pending: boolean } {
  const harness = thread && 'newThread' in thread ? thread.newThread : thread && !thread.threadId ? thread.harness : null;
  if (thread && 'threadId' in thread && thread.threadId) {
    return { title: thread.title, to: controller.say('toThread', { title: thread.title }), pending: false };
  }
  const name = commentHarnessName(harness);
  return name
    ? { title: controller.say('goesToNewHarness', { harness: name }), to: controller.say('toNewHarness', { harness: name }), pending: true }
    : { title: controller.say('goesToNew'), to: controller.say('toNew'), pending: true };
}

/** An @mention in a comment's words, as the server reads it (space_comments._MENTION). */
const MENTION = /(?<![\p{L}\p{N}_@])@([^\s@,.;:!?()[\]{}"'<>]{1,80})/gu;

/** A name as an @ token reads it (space_comments.mention_slug): lowercase, other characters one hyphen. */
function mentionForms(text: string): string[] {
  const slug = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return slug ? [slug, slug.replace(/-/g, '')] : [];
}

/** The @ tokens that name a harness ("@claude", "@codex", "@notis"), by id and by label. */
const HARNESS_FORMS = new Set(Object.entries(COMMENT_HARNESS_NAMES).flatMap(([id, label]) =>
  [...mentionForms(id), ...mentionForms(id.split('_')[0]!), ...mentionForms(label)]));

/**
 * The people a comment is for when its @mentions name only the Space's people (SPC-1540): it wakes no agent, it waits
 * for them. Their first names, in the order written; null when it has no @, when an @ names an agent (a harness, or an
 * agent that wrote on this page) or someone the Space's people (`viewer.people`, for an editor) do not include: the
 * comment then goes where it goes today.
 */
export function commentForPeople(controller: CommentController, text: string): string[] | null {
  const people = controller.viewer?.people;
  if (!people?.length || !text.includes('@')) return null;
  const tokens = [...text.matchAll(MENTION)].map(match => match[1]!).filter(token => mentionForms(token).length);
  if (!tokens.length) return null;
  const agents = new Set(controller.comments.flatMap(comment => comment.agent ? mentionForms(comment.agent.name) : []));
  const byForm = new Map<string, string>();
  for (const name of people) {
    const first = name.trim().split(/\s+/)[0] ?? '';
    for (const form of [...mentionForms(name), ...mentionForms(first)]) if (!byForm.has(form)) byForm.set(form, first);
  }
  const named: string[] = [];
  for (const token of tokens) {
    const forms = mentionForms(token);
    if (forms.some(form => agents.has(form) || HARNESS_FORMS.has(form))) return null;
    const person = forms.map(form => byForm.get(form)).find(Boolean);
    if (!person) return null;
    if (!named.includes(person)) named.push(person);
  }
  return named;
}

/** "Florian", "Florian and Ed", "Florian, Ed and Sam", in the pane's language. */
function sayNames(controller: CommentController, names: readonly string[]): string {
  if (names.length < 2) return names[0] ?? '';
  return controller.say('namesAnd', { names: names.slice(0, -1).join(', '), last: names[names.length - 1]! });
}

/**
 * Under a reply box whose words @mention only people (SPC-1540): "For Florian · wakes no agent". Nothing otherwise.
 */
export function CommentForPeopleNote({ controller, text }: { controller: CommentController; text: string }) {
  const people = commentForPeople(controller, text);
  if (!people) return null;
  return (
    <p className="nui-comment-unread" data-part="for-people" role="status">
      <Icon name="chat-circle-text" />{controller.say('forPeople', { names: sayNames(controller, people) })}
    </p>
  );
}

/**
 * The "To <thread>" chip of a new comment (SPC-117): the thread picked, else the best match, else "To a new thread";
 * "Choose a thread" when the best match could not be read. A click opens the @ thread picker, at any time. Nothing on a host without best matches or the picker. A long name
 * ends with an ellipsis (never cut mid-word without one); its title attribute has it in full. When the words being
 * written @mention only people (`text`, SPC-1540) it reads "To Florian · wakes no agent" instead: no agent wakes.
 */
export function CommentToChip({ controller, text = '', onMention }: {
  controller: CommentController; text?: string;
  /** An agent outside Notis picked: the box writes its @ in front of the words (SPC-1546). */
  onMention?: (mention: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const routing = controller.routing;
  const people = commentForPeople(controller, text);
  if (people) {
    const to = controller.say('toPeople', { names: sayNames(controller, people) });
    return <span className="nui-comment-to" data-part="to-chip" data-people="" title={to}><span>{to}</span></span>;
  }
  if (!routing.hasBestMatch && !routing.canPick && !routing.newPick) return null;
  // The best match could not be read: the chip offers the picker without naming a thread (never "To a new thread").
  const unread = !routing.newPick && routing.bestMatchLost === true;
  if (unread && !routing.canPick) return null;
  const named = unread ? { to: controller.say('toPick') } : commentThreadName(controller, routing.newPick ?? routing.bestMatch);
  if (!routing.canPick) return <span className="nui-comment-to" data-part="to-chip" title={named.to}><span>{named.to}</span></span>;
  return (
    <button ref={ref} type="button" className="nui-comment-to" data-part="to-chip" title={`${named.to}. ${controller.say('pickThread')}`}
      aria-label={`${named.to}. ${controller.say('pickThread')}`}
      onClick={event => {
        stop(event);
        if (!ref.current) return;
        void routing.pickForNew(ref.current).then(pick => { const mention = pickMentionText(pick); if (mention) onMention?.(mention); });
      }}>
      <Icon name="arrow-bend-up-right" /><span>{named.to}</span>
    </button>
  );
}

/**
 * For a new comment's text box: an @ typed in the empty box opens the thread picker instead of writing the @. A pick
 * leaves the box empty, but an agent outside Notis picked writes its @ ("@fred-and-the-machine ", SPC-1546); dismissing
 * the picker (Escape) puts the @ back with the caret after it, so "@Alice" still mentions someone. `setValue` writes
 * the box's text.
 */
export function useAtThreadPicker(controller: CommentController) {
  const { routing } = controller;
  return useCallback((value: string, field: HTMLElement, setValue?: (value: string) => void): string => {
    if (value === '@' && routing.canPick) {
      void routing.pickForNew(field).then(pick => {
        const mention = pickMentionText(pick);
        if ((pick && !mention) || !setValue) return;
        setValue(mention ?? '@');
        // After React writes the @ back: the caret goes after it.
        setTimeout(() => {
          if (!(field instanceof field.ownerDocument.defaultView!.HTMLTextAreaElement) || !field.isConnected) return;
          field.focus({ preventScroll: true });
          field.setSelectionRange(field.value.length, field.value.length);
        }, 0);
      });
      return '';
    }
    return value;
  }, [routing]);
}

/** The name of the agent outside Notis a `claimed` ref names, as its comments sign it. */
export function commentOutsideName(ref: SpaceCommentThreadRef): string {
  return agentDisplayName(ref.agentName || ref.title || ref.subagent || '');
}

/** The agent outside Notis that holds this comment thread (SPC-535), else null. */
export function commentOutsideClaim(controller: CommentController, thread: CommentThread): SpaceCommentThreadRef | null {
  const { routing } = controller;
  const rootKey = thread.root.recordKey;
  if (!routing.links || rootKey.startsWith('draft-') || (routing.known && !routing.known(rootKey))) return null;
  const target = routing.goesTo(rootKey);
  return target && outsideClaim(target) ? target : null;
}

const time = (value: string | null | undefined) => (value ? Date.parse(value) : Number.NaN);

/**
 * SPC-536: whether the agent outside Notis that holds this thread has not read the person's latest word yet: someone
 * replied or answered after the agent last wrote, and the agent has not read the thread since (`readAt`, recorded
 * when it reads comments through the CLI or replies).
 */
export function commentOutsideUnread(thread: CommentThread, claim: SpaceCommentThreadRef): boolean {
  let agentAt = Number.NEGATIVE_INFINITY;
  let personAt = Number.NEGATIVE_INFINITY;
  for (const comment of [thread.root, ...thread.replies]) {
    if (comment.status === 'Deleted') continue;
    const at = time(comment.createdAt);
    if (!Number.isNaN(at)) {
      if (comment.agent) agentAt = Math.max(agentAt, at);
      else personAt = Math.max(personAt, at);
    }
    const answered = time(comment.answeredAt);
    if (comment.answer && !Number.isNaN(answered)) personAt = Math.max(personAt, answered);
  }
  if (!(personAt > agentAt)) return false;
  const read = time(claim.readAt);
  return Number.isNaN(read) || read < personAt;
}

const NAMED_ITEMS = 3;
const ITEM_NAME_MAX = 32;

/**
 * The items a comment is on, named (SPC-463): each item's title, else its anchor label ("Task 2"), the first three
 * then "+N" for the rest. `total` counts items the Space no longer lists too; with none of them listed it reads
 * "3 items".
 */
export function commentItemNames(controller: Pick<CommentController, 'say'>, items: readonly CommentAnchor[],
  total = items.length): string {
  if (!items.length) return controller.say('itemsLabel', { n: total });
  const name = (item: CommentAnchor) => {
    const title = (item.title ?? '').trim() || controller.say('anchorLabel', { n: item.order });
    return title.length > ITEM_NAME_MAX ? `${title.slice(0, ITEM_NAME_MAX - 1).trimEnd()}…` : title;
  };
  const shown = items.slice(0, NAMED_ITEMS).map(name).join(', ');
  const rest = Math.max(total, items.length) - Math.min(items.length, NAMED_ITEMS);
  return rest > 0 ? controller.say('moreItems', { items: shown, n: rest }) : shown;
}

export interface CommentListOptions {
  /**
   * The order of the threads (SPC-116). Default 'newest': the newest thread first, by when its first comment was
   * written (a reply never moves a thread). 'oldest', 'anchor' (the order of the anchors, then creation) or the
   * Space's own comparator.
   */
  order?: CommentOrder;
  /**
   * Group headings. Default: by page when the controller covers the whole Space (no scope record), else none. Pass a
   * function to group your way (by slide, by time, by status), or false for a flat list.
   */
  groupBy?: ((thread: CommentThread) => CommentGroup | null) | false;
  /**
   * 'always': a heading over every group, also when there is only one (a host that lists a part of a Space's comments
   * names the page of each). Default 'auto': headings only when there is more than one group.
   */
  groupHeadings?: 'auto' | 'always';
}

/** The slot a group's heading leaves for its host, after the group's name (Open the page). */
export function commentGroupSlot(groupKey: string): string {
  return `group:${groupKey}`;
}

/** The threads in order, under group headings when there is more than one group. */
export function CommentThreadList({ controller, threads, order = 'newest', groupBy, groupHeadings = 'auto', children }: CommentListOptions & {
  controller: CommentController; threads: readonly CommentThread[]; children: (thread: CommentThread) => ReactNode;
}) {
  const ordered = orderCommentThreads(threads, order);
  const by = groupBy === false ? null : groupBy ?? (controller.wholeSpace ? controller.groupOf : null);
  const groups = by ? groupCommentThreads(ordered, by) : [{ group: null, threads: ordered }];
  const titled = groups.length > 1 || groupHeadings === 'always';
  return (
    <div className="nui-comment-list">
      {groups.map(({ group, threads: items }, index) => (
        <React.Fragment key={group?.key ?? `none-${index}`}>
          {titled && group ? (
            <h3 className="nui-comment-group" data-group={group.key}>
              <span className="nui-comment-group-name">{group.label}</span>
              <slot name={commentGroupSlot(group.key)} />
            </h3>
          ) : null}
          {items.map(children)}
        </React.Fragment>
      ))}
    </div>
  );
}

/** The keys that scroll a list. */
const LIST_SCROLL_KEYS = new Set(['PageDown', 'ArrowDown', 'End', ' ']);

/** The nearest box around `node` that scrolls up and down (through shadow roots), or null when nothing scrolls it. */
function scrollBoxOf(node: Element): HTMLElement | null {
  const view = node.ownerDocument.defaultView;
  let current: Node | null = node.parentNode;
  while (current) {
    if (current instanceof (view?.ShadowRoot ?? ShadowRoot)) { current = (current as ShadowRoot).host; continue; }
    const element = current as HTMLElement;
    if (element.nodeType === 1 && element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1) {
      const overflow = view?.getComputedStyle(element).overflowY ?? '';
      if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') return element;
    }
    current = current.parentNode;
  }
  return null;
}

/**
 * The end of a list that has older Done threads left to read (`controller.hasMore`). It shows as one loading card.
 * The next page is read when the end is in view and the reader moved the list since the last page (a wheel, a
 * finger, a scroll key, the scroll bar), never page after page by itself: a card kept in view at the end of the list
 * (the comment a link opened) would otherwise pull every page of the Space. A list too short to scroll reads on
 * until it can. Where the browser cannot watch the end, the pages are read one after the other.
 */
export function CommentListMore({ controller }: {
  controller: Pick<CommentController, 'say' | 'loadMore' | 'loadingMore'>;
  /** @deprecated The end is watched against what the window shows, whatever box scrolls the list. */
  scrollRef?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(controller);
  latest.current = controller;
  const state = useRef({ inView: false, moved: false });
  const tryLoad = useCallback(() => {
    const node = ref.current;
    const { loadMore, loadingMore } = latest.current;
    if (!node || !loadMore || loadingMore || !state.current.inView) return;
    if (!state.current.moved && scrollBoxOf(node)) return;
    state.current.moved = false;
    loadMore();
  }, []);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const doc = node.ownerDocument;
    const view = doc.defaultView;
    if (!view || typeof view.IntersectionObserver === 'undefined') {
      state.current.inView = true;
      state.current.moved = true;
      tryLoad();
      return undefined;
    }
    const watch = new view.IntersectionObserver((entries) => {
      state.current.inView = entries.some(entry => entry.isIntersecting);
      tryLoad();
    });
    watch.observe(node);
    // The reader's own hand on the list: the page that follows is theirs to ask for.
    const moved = () => {
      state.current.moved = true;
      view.setTimeout(tryLoad, 0);
    };
    const key = (event: Event) => {
      const target = event.composedPath()[0] as HTMLElement | undefined;
      if (!LIST_SCROLL_KEYS.has((event as KeyboardEvent).key) || target?.isContentEditable || target?.matches?.('input, textarea, select')) return;
      moved();
    };
    // A press on the scroll bar reaches the box that scrolls, not a card in it.
    const bar = (event: Event) => { if (event.composedPath()[0] === scrollBoxOf(node)) moved(); };
    doc.addEventListener('wheel', moved, { capture: true, passive: true });
    doc.addEventListener('touchmove', moved, { capture: true, passive: true });
    doc.addEventListener('keydown', key, true);
    doc.addEventListener('pointerdown', bar, true);
    return () => {
      watch.disconnect();
      doc.removeEventListener('wheel', moved, true);
      doc.removeEventListener('touchmove', moved, true);
      doc.removeEventListener('keydown', key, true);
      doc.removeEventListener('pointerdown', bar, true);
    };
  }, [tryLoad]);
  // A page landed: a list still too short to scroll reads the next one.
  const { loadingMore } = controller;
  useEffect(() => {
    if (loadingMore) return;
    if (typeof ref.current?.ownerDocument.defaultView?.IntersectionObserver === 'undefined') state.current.moved = true;
    tryLoad();
  }, [loadingMore, tryLoad]);
  return (
    <div ref={ref} className="nui-comment-loading" role="status" aria-busy="true" data-part="loading-more">
      <span className="nui-sr-only">{controller.say('loadingComments')}</span>
      <div className="nui-comment-loading-card" aria-hidden="true">
        <span className="nui-skel nui-skel-head" />
        <span className="nui-skel nui-skel-line" />
        <span className="nui-skel nui-skel-line nui-comment-loading-short" />
      </div>
    </div>
  );
}

/**
 * Scrolls the selected thread's card into view inside the pane's own scroller (C7): when a deep link or the page picks
 * a thread (`threadKey`, and each `revealRequest`). While the panel is hidden (no height) or the card is not drawn
 * yet, it waits; once both are there it reveals the card and keeps it in view while the panel finishes opening
 * (`revealInScroller`: measured against the scroller, again on each resize and frame until the layout settles, then on
 * each change of the card's size for a while, as its pictures load). The page around the panel never moves.
 */
export function useThreadScroller(controller: CommentController, scrollRef: RefObject<HTMLElement | null>) {
  const key = controller.threadKey;
  const reveal = controller.revealRequest ?? 0;
  const pending = useRef<string | null>(null);
  const running = useRef<(() => void) | null>(null);
  const tryScroll = useCallback(() => {
    const box = scrollRef.current;
    const want = pending.current;
    if (!box || !want || box.clientHeight <= 0) return;
    const find = () => Array.from(box.querySelectorAll<HTMLElement>('[data-thread]')).find(item => item.dataset.thread === want) ?? null;
    if (!find()) return;
    pending.current = null;
    running.current?.();
    running.current = revealInScroller(box, find);
  }, [scrollRef]);
  useLayoutEffect(() => {
    pending.current = key;
    if (!key) { running.current?.(); running.current = null; return; }
    tryScroll();
  }, [key, reveal, tryScroll]);
  // The card may come later (the list reads), and the panel may show later (it was hidden behind Chat).
  useEffect(() => { if (pending.current) tryScroll(); });
  useEffect(() => {
    const box = scrollRef.current;
    const view = box?.ownerDocument.defaultView;
    if (!box || !view || typeof view.ResizeObserver === 'undefined') return undefined;
    const sizes = new view.ResizeObserver(() => { if (pending.current) tryScroll(); });
    sizes.observe(box);
    return () => sizes.disconnect();
  }, [scrollRef, tryScroll]);
  useEffect(() => () => { running.current?.(); running.current = null; }, []);
}

/** True when focus is inside `root`, across a shadow root. */
function focusInside(root: HTMLElement | null): boolean {
  if (!root) return false;
  const node = root.getRootNode() as Document | ShadowRoot;
  const active = node.activeElement;
  return Boolean(active && root.contains(active));
}

/** The pane's Undo key goes before the other keys of its scope, whichever was registered last. */
const PANE_UNDO_BOOST = 10;

function PaneKeys({ controller, rootRef }: { controller: CommentController; rootRef: RefObject<HTMLElement | null> }) {
  const target = () => {
    const root = rootRef.current;
    const active = root ? (root.getRootNode() as Document | ShadowRoot).activeElement : null;
    const key = active?.closest('[data-thread]')?.getAttribute('data-thread') ?? controller.threadKey;
    return controller.threads.find(thread => thread.root.recordKey === key);
  };
  // With focus in the pane, E and Shift+E are the pane's even when there is nothing to archive: they never fall
  // through to the chat beside it (which would archive the conversation out of sight).
  useShortcuts([
    {
      id: 'comments.archive', keys: 'e', scope: 'detail', label: controller.words.resolve,
      when: () => focusInside(rootRef.current),
      run: () => {
        const thread = target();
        if (thread?.root.status !== 'Open') return true;
        // Done moves on: in a review run the run takes it; else the card that takes its place gets the selection.
        if (!notifyReviewRunAction({ kind: 'done', key: thread.root.recordKey })) {
          const card = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-thread]') ?? [])]
            .find(item => item.dataset.thread === thread.root.recordKey) ?? null;
          archiveThenNext(controller, thread.root, card);
        }
        return true;
      },
    },
    {
      id: 'comments.unarchive', keys: 'shift+e', scope: 'detail', label: controller.words.reopen,
      when: () => focusInside(rootRef.current),
      run: () => {
        const thread = target();
        if (thread?.root.status === 'Resolved') controller.actions.unarchive(thread.root);
        return true;
      },
    },
    {
      // The toast's own Z waits at route scope (ActionToast). Beside a conversation (the Manager), that conversation's
      // Z sits above it and would take the key to undo nothing here: with the focus in the pane and its toast
      // offering Undo, Z is this pane's. A review run keeps its own Z (it selects the card again, reviewRun.ts).
      id: 'comments.undo', keys: 'z', scope: 'detail', label: SHELL_WORDS.undo, boost: PANE_UNDO_BOOST,
      when: () => Boolean(controller.toaster.toast?.undo) && !controller.waitingFilter && focusInside(rootRef.current),
      // A running Undo keeps the key: a second press neither undoes twice nor reaches the conversation.
      run: () => { if (!controller.toaster.toast?.undoing) void controller.toaster.undo(); return true; },
    },
  ], [controller]);
  return null;
}

/**
 * Keeps focus in the pane when the focused card leaves the list (archived with E, deleted): it moves to the card that
 * took its place, else the pane, instead of falling to the page body, so Z and the next keys still reach the pane.
 */
export function usePaneFocusKeeper(rootRef: RefObject<HTMLElement | null>, listKey: unknown) {
  const last = useRef<{ index: number; element: Element } | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const onFocus = (event: FocusEvent) => {
      const target = event.target as Element | null;
      const card = target?.closest?.('[data-thread]');
      last.current = card && target ? { index: [...root.querySelectorAll('[data-thread]')].indexOf(card), element: target } : null;
    };
    root.addEventListener('focusin', onFocus);
    return () => root.removeEventListener('focusin', onFocus);
  }, [rootRef]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const was = last.current;
    // Only when the focused element itself left the page: a click elsewhere keeps focus where it went.
    if (!root || !was || was.element.isConnected) return;
    const home = root.getRootNode() as Document | ShadowRoot;
    const doc = root.ownerDocument;
    const inShadow = home !== doc;
    if (inShadow && (home as ShadowRoot).activeElement) return;
    if (doc.activeElement && doc.activeElement !== doc.body) return;
    last.current = null;
    const cards = [...root.querySelectorAll<HTMLElement>('[data-thread]')];
    const next = cards[Math.min(was.index, cards.length - 1)];
    if (next) { next.focus({ preventScroll: true }); return; }
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
    root.focus({ preventScroll: true });
  }, [rootRef, listKey]);
}

/**
 * A pane's own shortcut owner: E archives and Shift+E unarchives the focused (or selected) thread while focus is in
 * the pane, and the Undo toast's Z belongs to this pane, so two panes on one page never clash.
 */
export function CommentPaneKeys({ controller, rootRef, children }: {
  controller: CommentController; rootRef: RefObject<HTMLElement | null>; children: ReactNode;
}) {
  const owner = `comments-pane-${useId()}`;
  return (
    <ShortcutScope owner={owner} available>
      <PaneKeys controller={controller} rootRef={rootRef} />
      {children}
    </ShortcutScope>
  );
}

/**
 * Placeholders where the threads come while the first read of the comments has not settled (C4): a page opened in a
 * new tab shows that it is loading, never "No comments" for a moment before its threads arrive.
 */
export function CommentListLoading({ controller }: { controller: Pick<CommentController, 'say'> }) {
  return (
    <div className="nui-comment-loading" role="status" aria-busy="true" data-part="loading">
      <span className="nui-sr-only">{controller.say('loadingComments')}</span>
      {[0, 1, 2].map(card => (
        <div key={card} className="nui-comment-loading-card" aria-hidden="true">
          <span className="nui-skel nui-skel-head" />
          <span className="nui-skel nui-skel-line" />
          <span className="nui-skel nui-skel-line nui-comment-loading-short" />
        </div>
      ))}
    </div>
  );
}
