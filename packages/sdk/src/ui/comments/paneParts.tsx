/**
 * Pieces both comment panes share (the pins pane `CommentPane` and the passage pane `PassageCommentPane`): the filter
 * menu (Open, Done, All with counts), the New comment button listing the Space's modes, the hint a mode shows, the
 * To chip of a new comment, the Goes to line under a reply, the ordered and grouped list, and E / Shift+E.
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Button } from '../blocks';
import { ShortcutScope } from '../engine/KeyboardEngine';
import { useShortcuts } from '../engine/hooks';
import { Icon } from '../icons';
import { Menu } from '../overlay';
import {
  formatCommentTime, groupCommentThreads, orderCommentThreads, type CommentGroup, type CommentOrder, type CommentThread,
} from './commentModel';
import type { SpaceCommentThreadRef } from '../../space';
import type { CommentWordKey } from './commentWords';
import { revealInScroller } from './scrollReveal';
import type { CommentController, CommentMode, CommentStatusView } from './useComments';

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

/** Open (default), Done and All, each with its count, behind one menu (SPC-126). */
export function CommentFilterMenu({ controller, counts = controller.counts }: {
  controller: CommentController;
  /** The counts shown. Default: the controller's, for its anchor filter. */
  counts?: Readonly<Record<CommentStatusView, number>>;
}) {
  // 'resolved' is an older name of Done.
  const statusFilter: CommentStatusView = controller.statusFilter === 'resolved' ? 'done' : controller.statusFilter;
  const label = (filter: CommentStatusView) => controller.say(filter === 'open' ? 'open' : filter === 'done' ? 'resolvedFilter' : 'all');
  return (
    <Menu align="end" label={controller.words.filter} accelerators={false}
      trigger={(
        <button type="button" className="nui-comment-filter" data-filter={statusFilter}
          aria-label={controller.say('filterLabel', { filter: controller.say('filter'), status: label(statusFilter), n: counts[statusFilter] })}>
          <span>{label(statusFilter)}</span>
          <span className="nui-comment-count">{counts[statusFilter]}</span>
          <Icon name="caret-down" />
        </button>
      )}>
      {(['open', 'done', 'all'] as const).map(filter => (
        <Menu.Item key={filter} checked={statusFilter === filter} onSelect={() => controller.setStatusFilter(filter)}>
          <span className="nui-comment-filter-item" data-filter={filter}>
            <span>{label(filter)}</span><span className="nui-comment-count">{counts[filter]}</span>
          </span>
        </Menu.Item>
      ))}
    </Menu>
  );
}

/** The pane header's New comment button: one mode starts at once, several open a menu of the Space's modes. */
export function NewCommentMenu({ controller }: { controller: CommentController }) {
  const { modes } = controller;
  if (!modes.length) return null;
  const label = controller.say('newCommentMenu');
  if (modes.length === 1) {
    const mode = modes[0]!;
    return (
      <Button size="sm" variant="ghost" className="nui-comment-new-btn" icon="plus" aria-label={label}
        onClick={() => controller.startMode(mode)}>{label}</Button>
    );
  }
  return (
    <Menu align="end" label={controller.words.newCommentMenu} accelerators={false}
      trigger={(
        <Button size="sm" variant="ghost" className="nui-comment-new-btn" icon="plus" aria-label={label}>{label}</Button>
      )}>
      {modes.map(mode => (
        <Menu.Item key={mode} icon={COMMENT_MODE_ICON[mode]} checked={controller.commentMode === mode ? true : undefined}
          onSelect={() => controller.startMode(mode)}>
          {controller.say(COMMENT_MODE_WORD[mode])}
        </Menu.Item>
      ))}
    </Menu>
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

/**
 * The "To <thread>" chip of a new comment (SPC-117): the thread picked, else the best match, else "To a new thread".
 * A click opens the @ thread picker, at any time. Nothing on a host without best matches or the picker. A long name
 * ends with an ellipsis (never cut mid-word without one); its title attribute has it in full.
 */
export function CommentToChip({ controller }: { controller: CommentController }) {
  const ref = useRef<HTMLButtonElement>(null);
  const routing = controller.routing;
  if (!routing.hasBestMatch && !routing.canPick && !routing.newPick) return null;
  const named = commentThreadName(controller, routing.newPick ?? routing.bestMatch);
  if (!routing.canPick) return <span className="nui-comment-to" data-part="to-chip" title={named.to}><span>{named.to}</span></span>;
  return (
    <button ref={ref} type="button" className="nui-comment-to" data-part="to-chip" title={`${named.to}. ${controller.say('pickThread')}`}
      aria-label={`${named.to}. ${controller.say('pickThread')}`}
      onClick={event => { stop(event); if (ref.current) void routing.pickForNew(ref.current); }}>
      <Icon name="arrow-bend-up-right" /><span>{named.to}</span>
    </button>
  );
}

/**
 * For a new comment's text box: an @ typed in the empty box opens the thread picker instead of writing the @. A pick
 * leaves the box empty; dismissing the picker (Escape) puts the @ back with the caret after it, so "@Alice" still
 * mentions someone. `setValue` writes the box's text.
 */
export function useAtThreadPicker(controller: CommentController) {
  const { routing } = controller;
  return useCallback((value: string, field: HTMLElement, setValue?: (value: string) => void): string => {
    if (value === '@' && routing.canPick) {
      void routing.pickForNew(field).then(pick => {
        if (pick || !setValue) return;
        setValue('@');
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

/**
 * At the top of a comment thread's card, the thread that owns it: "Thread <title>" (its first linked thread), else
 * "Goes to <best match>" or "Goes to a new thread", with Change, which opens the @ thread picker and links the pick
 * (SPC-114). The signatures below it name only who wrote each comment. Nothing when the host does not link threads;
 * "Goes to" and a quiet placeholder (no name, no Change) while where it goes is still being read.
 */
export function CommentGoesTo({ controller, thread }: { controller: CommentController; thread: CommentThread }) {
  const ref = useRef<HTMLButtonElement>(null);
  const { routing } = controller;
  const rootKey = thread.root.recordKey;
  if (!routing.links || rootKey.startsWith('draft-')) return null;
  // Still being read: a neutral line in the same place, never a guess that turns into another thread a moment later.
  if (routing.known && !routing.known(rootKey)) {
    return (
      <p className="nui-comment-goes" data-part="goes-to" data-loading="" aria-busy="true" onClick={stop} onKeyDown={stop}>
        <span className="nui-comment-goes-label">{controller.say('goesTo')}</span>{' '}
        <span className="nui-skel nui-comment-goes-skel" aria-hidden="true" />
        <span className="nui-sr-only">{controller.say('goesToLoading')}</span>
      </p>
    );
  }
  const target = routing.goesTo(rootKey);
  const named = commentThreadName(controller, target);
  const linked = Boolean(target?.threadId) && routing.linksOf(rootKey).some(link => link.threadId === target!.threadId);
  const title = named.pending ? named.title : target?.title || controller.say('goesToNew');
  const open = routing.open;
  const threadId = target?.threadId ?? null;
  // A pick being linked shows at once, quiet until it is saved (a failure puts the line back and says so).
  const saving = routing.saving?.(rootKey) ?? false;
  return (
    <p className="nui-comment-goes" data-part="goes-to" data-pending={named.pending ? '' : undefined}
      data-saving={saving ? '' : undefined} aria-busy={saving || undefined} title={saving ? controller.say('linking') : undefined}
      onClick={stop} onKeyDown={stop}>
      <Icon name="chat-circle-text" />
      <span className="nui-comment-goes-label">{controller.say(linked ? 'ownerThread' : 'goesTo')}</span>{' '}
      {threadId && open ? (
        <button type="button" className="nui-comment-goes-title" data-thread-id={threadId}
          aria-label={controller.say('openLinkedThread', { title })} onClick={() => open(threadId)}>{title}</button>
      ) : <span className="nui-comment-goes-title">{title}</span>}
      {routing.canLink ? (
        <>
          {' '}
          <button ref={ref} type="button" className="nui-comment-goes-change" aria-label={controller.say('changeThread')}
            disabled={saving} onClick={() => { if (ref.current) void routing.change(rootKey, ref.current); }}>{controller.say('change')}</button>
        </>
      ) : null}
    </p>
  );
}

/** A thread's place, for the card meta line: a moment ("0:24") and how many items it is on. */
export function commentPlaceMeta(controller: CommentController, thread: CommentThread): string[] {
  const parts: string[] = [];
  if (thread.root.time != null) parts.push(formatCommentTime(thread.root.time));
  if (thread.root.anchorIds.length > 1) parts.push(controller.say('itemsLabel', { n: thread.root.anchorIds.length }));
  return parts;
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
}

/** The threads in order, under group headings when there is more than one group. */
export function CommentThreadList({ controller, threads, order = 'newest', groupBy, children }: CommentListOptions & {
  controller: CommentController; threads: readonly CommentThread[]; children: (thread: CommentThread) => ReactNode;
}) {
  const ordered = orderCommentThreads(threads, order);
  const by = groupBy === false ? null : groupBy ?? (controller.wholeSpace ? controller.groupOf : null);
  const groups = by ? groupCommentThreads(ordered, by) : [{ group: null, threads: ordered }];
  const titled = groups.length > 1;
  return (
    <div className="nui-comment-list">
      {groups.map(({ group, threads: items }, index) => (
        <React.Fragment key={group?.key ?? `none-${index}`}>
          {titled && group ? <h3 className="nui-comment-group" data-group={group.key}>{group.label}</h3> : null}
          {items.map(children)}
        </React.Fragment>
      ))}
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
        if (thread?.root.status === 'Open') controller.actions.archive(thread.root);
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
