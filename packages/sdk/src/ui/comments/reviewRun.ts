/**
 * The review run: one comment after the other. With "Waiting for you" on, the pane lists the comment threads that wait
 * for the viewer; an answer, Done or a sent reply takes the next step, and J and K move between cards. The host (the
 * Portal) knows what the pane cannot: whether a run is going, how many wait in its scope, whether another page follows
 * this one and what the person's setting says. They share this module (`@notis/sdk/ui` is one instance for both).
 *
 * - The host tells the pane (`setReviewRunHost`): a run is going, the count in its scope, whether another page with
 *   waiting comments follows, and the setting "Move to the next one after sending".
 * - The pane tells the host what it shows (`publishReviewRunPane`): the cards listed in order, the one selected; and
 *   what happened (`emitReviewRunEvent`): a card was selected, answered, the page's last card was passed, the run left
 *   (Escape, or "Waiting for you" turned off). The host also ends the run when its panel is closed.
 * - The host moves the pane (`reviewRunCommands`): next and previous, the last card, the filter.
 * - On a phone the host shows comments as a sheet over the page and says its height (`sheet`): the pane then draws the
 *   selected card alone (half), the list (full) or nothing (low). This holds with or without a run going.
 *
 * One step. Done always moves on. An option picked and a sent reply move on when the setting is on: the card leaves the
 * list and the next one is selected. With the setting off the answer stays in view on its card, which stays listed
 * (it no longer counts as waiting), and next (the bar, J) goes on.
 *
 * Keys, the same as in a conversation: J and K next and previous, Enter the recommended option, 1 to 9 an option by
 * its position, R reply, E Done, Z undo, Escape leaves the run (the panel stays as it is). They are read on the window
 * while a run is going, so they still work once the focus fell back to the page's body (a card that just left the list
 * no longer holds it). They are the run's only with the focus in the Comments panel or on the body: a page that holds
 * the focus keeps its own keys, and a panel that is closed or shows Chat takes none. Out of a run, only with the focus
 * in the pane.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { CommentRecord, CommentThread } from './commentModel';
import type { CommentController } from './useComments';
import { useWaitingCommentThreads } from './hostPanel';

// ---------- What the host tells the pane ----------

export interface ReviewRunHost {
  /** A run is going: the pane keeps "Waiting for you" on, selects a card and takes the keys from the page's body too. */
  active: boolean;
  /** Goes up by one each time a run starts or crosses to this page: the pane selects its first waiting card again. */
  startToken: number;
  /** The card a crossing asked for (the next page's first waiting one), else the list's first. */
  startKey: string | null;
  /** What waits in the run's scope (this Space, or everywhere from the Spaces root); null: not read yet. */
  scopeCount: number | null;
  /** Another page with waiting comments follows this one. */
  hasNext: boolean;
  /** The person's setting "Move to the next one after sending": an answer or a sent reply moves on. */
  advance: boolean;
  /**
   * On a phone the host shows comments as a sheet over the page, and says the height it rests at: at 'half' the pane
   * shows the selected card alone, at 'low' nothing (the host draws its one line), at 'full' the list. Null: no sheet.
   */
  sheet: ReviewRunSheet | null;
}

/** The three heights a phone's comments sheet rests at. */
export type ReviewRunSheet = 'low' | 'half' | 'full';

const HOST_DEFAULT: ReviewRunHost = { active: false, startToken: 0, startKey: null, scopeCount: null, hasNext: false, advance: false, sheet: null };
let host: ReviewRunHost = HOST_DEFAULT;
const hostListeners = new Set<() => void>();

export function reviewRunHost(): ReviewRunHost { return host; }
export function setReviewRunHost(next: Partial<ReviewRunHost>): void {
  let changed = false;
  for (const key of Object.keys(next) as Array<keyof ReviewRunHost>) if (host[key] !== next[key]) changed = true;
  if (!changed) return;
  host = { ...host, ...next };
  for (const listener of [...hostListeners]) listener();
}
export function subscribeReviewRunHost(listener: () => void): () => void {
  hostListeners.add(listener);
  return () => { hostListeners.delete(listener); };
}
export function useReviewRunHost(): ReviewRunHost {
  const [value, setValue] = useState(host);
  useEffect(() => {
    const listener = () => setValue(host);
    listener();
    return subscribeReviewRunHost(listener);
  }, []);
  return value;
}

// ---------- What the pane shows ----------

export interface ReviewRunPaneState {
  /** "Waiting for you" is on. */
  waiting: boolean;
  /** The cards listed, in the list's order (their threads' first comments). */
  keys: readonly string[];
  /** The listed cards that still wait (an answered card that stays listed is not one of them). */
  waitingKeys: readonly string[];
  selected: string | null;
  /** A new comment is being written. */
  drafting: boolean;
  /** What the selected card is about, in a few words: the words it quotes, else its place, else how it starts. */
  words?: string | null;
}

let pane: ReviewRunPaneState | null = null;
const paneListeners = new Set<() => void>();
const sameList = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((key, index) => key === right[index]);
export function reviewRunPane(): ReviewRunPaneState | null { return pane; }
export function publishReviewRunPane(next: ReviewRunPaneState | null): void {
  if (!next && !pane) return;
  if (next && pane && next.waiting === pane.waiting && next.selected === pane.selected && next.drafting === pane.drafting
    && (next.words ?? null) === (pane.words ?? null) && sameList(next.keys, pane.keys) && sameList(next.waitingKeys, pane.waitingKeys)) return;
  pane = next;
  for (const listener of [...paneListeners]) listener();
}
export function subscribeReviewRunPane(listener: () => void): () => void {
  paneListeners.add(listener);
  return () => { paneListeners.delete(listener); };
}

// ---------- What happened in the pane ----------

export type ReviewRunEvent =
  /** A card was selected by the run (a key, the bar, an answer that moved on): the page shows where it sits. */
  | { type: 'selected'; key: string; direction: 'next' | 'previous'; by: 'start' | 'step' | 'answer' }
  /** A card no longer waits: answered, marked done, or replied to. */
  | { type: 'answered'; key: string }
  /** A card waits again: Undo brought it back, or the server refused its answer. */
  | { type: 'restored'; key: string }
  /** The list's last card was passed. `advance`: an answer did it (the setting is on), not next or J. */
  | { type: 'end'; advance: boolean }
  /** The run is left: Escape (the panel stays as it is), or "Waiting for you" turned off (its chip, another filter). */
  | { type: 'leave' };

const eventListeners = new Set<(event: ReviewRunEvent) => void>();
export function emitReviewRunEvent(event: ReviewRunEvent): void {
  for (const listener of [...eventListeners]) listener(event);
}
export function subscribeReviewRunEvents(listener: (event: ReviewRunEvent) => void): () => void {
  eventListeners.add(listener);
  return () => { eventListeners.delete(listener); };
}

// ---------- What the host asks of the pane ----------

export interface ReviewRunCommands {
  /** Selects the next (1) or previous (-1) card. False at the list's end. */
  step(delta: 1 | -1): boolean;
  /** Selects the list's last card. */
  last(): boolean;
  /** Turns "Waiting for you" on or off. */
  setWaiting(on: boolean): void;
}

let commands: ReviewRunCommands | null = null;
export function registerReviewRunCommands(next: ReviewRunCommands): () => void {
  commands = next;
  return () => { if (commands === next) commands = null; };
}
export function reviewRunCommands(): ReviewRunCommands | null { return commands; }

// ---------- Answered here, before the server counts again ----------

/**
 * How long an answer given here outweighs the host's list of what waits. The server files an answer a few seconds
 * later (up to about 24); after that its own list is the truth again (a new question in the same thread waits again).
 */
export const REVIEW_RUN_ANSWER_HOLD_MS = 45_000;

const answered = new Map<string, { at: number; kept: boolean }>();
const answeredListeners = new Set<() => void>();
let answeredVersion = 0;
function emitAnswered() {
  answeredVersion += 1;
  for (const listener of [...answeredListeners]) listener();
}
/** A thread answered in this run: `kept` when its card stays listed with the answer (the setting is off). */
export function markReviewRunAnswered(key: string, kept: boolean, now = Date.now()): void {
  answered.set(key, { at: now, kept });
  emitAnswered();
}
/** Undo: the thread waits again. */
export function unmarkReviewRunAnswered(key: string): void {
  if (answered.delete(key)) emitAnswered();
}
/** Forgets every answer held here (a run that starts, "Waiting for you" turned off). */
export function resetReviewRunAnswered(): void {
  if (!answered.size) return;
  answered.clear();
  emitAnswered();
}
/** Whether the thread was answered here a moment ago: it no longer waits, whatever the host's list says. */
export function reviewRunAnswered(key: string, now = Date.now()): boolean {
  const entry = answered.get(key);
  return Boolean(entry) && now - entry!.at < REVIEW_RUN_ANSWER_HOLD_MS;
}
/** Whether the thread's card stays listed under "Waiting for you" though it was answered (the setting is off). */
export function reviewRunKept(key: string): boolean {
  return answered.get(key)?.kept === true;
}
export function subscribeReviewRunAnswered(listener: () => void): () => void {
  answeredListeners.add(listener);
  return () => { answeredListeners.delete(listener); };
}
/** Re-renders the caller when an answer is marked or undone; returns a number that changes with it. */
export function useReviewRunAnswered(): number {
  const [version, setVersion] = useState(answeredVersion);
  useEffect(() => {
    const listener = () => setVersion(answeredVersion);
    listener();
    return subscribeReviewRunAnswered(listener);
  }, []);
  return version;
}

// ---------- What a card reports ----------

export type ReviewRunAction = {
  kind: 'answered' | 'replied' | 'done'; key: string;
  /** An option picked: whether its write was saved. A refused answer was never given: the thread waits again. */
  saved?: Promise<boolean>;
};

const actionListeners = new Set<(action: ReviewRunAction) => boolean>();
/**
 * A card says what the person just did on it. True when a pane's run took it (it moves on, or keeps the card); false
 * when none did and the card acts alone (Done then archives the thread itself).
 */
export function notifyReviewRunAction(action: ReviewRunAction): boolean {
  let taken = false;
  for (const listener of [...actionListeners]) taken = listener(action) || taken;
  return taken;
}

// ---------- A comment being sent ----------

let sending = 0;
/**
 * A reply is being sent from a comment box, until the returned call-back runs: the run's keys stand still meanwhile.
 * The box's field is switched off while it sends and may lose the focus to the page, where a second Enter would
 * otherwise pick the card's recommended option.
 */
export function holdReviewRunKeys(): () => void {
  sending += 1;
  let done = false;
  return () => { if (!done) { done = true; sending -= 1; } };
}

// ---------- The pane's side ----------

const TRAVEL_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** How long the next card takes to come into place, as the next conversation does. */
export const REVIEW_RUN_TRAVEL_MS = 320;

/**
 * A card comes into place the way the next conversation does: from below for next, from above for previous, over
 * REVIEW_RUN_TRAVEL_MS; a fade alone for reduced motion.
 */
export function cardComesIntoPlace(card: HTMLElement, direction: 'next' | 'previous'): void {
  if (typeof card.animate !== 'function') return;
  const view = card.ownerDocument.defaultView;
  const reduced = view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const sign = direction === 'next' ? 1 : -1;
  card.animate([reduced ? { opacity: 0 } : { transform: `translateY(${sign * 28}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
    { duration: REVIEW_RUN_TRAVEL_MS, easing: TRAVEL_EASING });
}

/** The card that takes the place of one that left the list: the key at the index `before` held it, when nothing else changed. */
export function cardThatTookThePlace(before: readonly string[], after: readonly string[]): string | null {
  if (after.length !== before.length - 1) return null;
  const index = before.findIndex((key, at) => after[at] !== key);
  if (index < 0) return null;
  // Everything else is as it was: one card left (an answer, Done, Delete), nothing was filtered or added.
  for (let at = index; at < after.length; at += 1) if (after[at] !== before[at + 1]) return null;
  return after[index] ?? null;
}

/**
 * After an answer that moves on, Done or Delete, the next card comes into place: the card that takes the place of the
 * one that left slides up into it. A list that changes any other way (a filter, a new comment, Undo) does not move.
 */
export function useNextCardComesIntoPlace(rootRef: RefObject<HTMLElement | null>, scope: unknown): void {
  const seen = useRef<{ keys: string[]; scope: unknown } | null>(null);
  useEffect(() => {
    const cards = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-comment-scroll] [data-thread]') ?? [])];
    const keys = cards.map(card => card.dataset.thread ?? '');
    const before = seen.current;
    seen.current = { keys, scope };
    // Another filter or item is another list, not a card that left.
    if (!before || before.scope !== scope) return;
    const next = cardThatTookThePlace(before.keys, keys);
    const card = next ? cards.find(item => item.dataset.thread === next) : null;
    if (card) cardComesIntoPlace(card, 'next');
  });
}

/** How long after a run starts a list that fills in may still change which card is first. */
export const START_SETTLE_MS = 6000;

export interface ReviewRunPaneOptions {
  controller: CommentController;
  rootRef: RefObject<HTMLElement | null>;
  /** The threads the pane can list (for the keys and the first card). */
  threads: readonly CommentThread[];
  /** A new comment is being written: the run's keys stand still. */
  drafting: boolean;
  /** The options of a thread's question still waiting for a pick, and the recommended one. */
  asking(thread: CommentThread): { comment: CommentRecord; options: string[]; recommended: string | null } | null;
}

export interface ReviewRunPaneView {
  /** "Waiting for you" is on in the host panel's main pane: the run's rules apply. */
  running: boolean;
  /** Attributes for the pane's root element. */
  attrs: Record<string, string | undefined>;
  /** The count the "n waiting" chip shows while a run is going; null: the chip reads "Waiting for you". */
  count: number | null;
}

/** The pane the host panel shows beside a page; the stacked panes of the Spaces root and Home stay out of a run. */
function mainPane(root: HTMLElement | null): boolean {
  if (!root || !root.closest('[data-notis-comments-mount]')) return false;
  const shadowHost = (root.getRootNode() as ShadowRoot).host as HTMLElement | undefined;
  return Boolean(shadowHost) && !shadowHost!.hasAttribute('data-space-pane');
}

/** The pane is drawn and can be used: a closed right panel keeps its width, and is inert, like the side that shows Chat. */
function shown(root: HTMLElement | null): boolean {
  if (!root || !root.isConnected || !root.getClientRects().length) return false;
  for (let node: Element | null = root; node;) {
    if (node.closest('[inert]')) return false;
    const home = node.getRootNode() as ShadowRoot;
    node = home.host && home.host.nodeType === 1 ? home.host : null;
  }
  return true;
}

/**
 * Whether a run going in the pane at `root` may take a key: the focus is in the Comments panel (the pane, its bar, a
 * box of it) or nowhere (the page's body). An element of the page that holds the focus keeps its keys.
 */
export function reviewRunHoldsKeys(root: HTMLElement): boolean {
  const doc = root.ownerDocument;
  const focus = doc.activeElement;
  if (!focus || focus === doc.body || focus === doc.documentElement) return true;
  const shadowHost = (root.getRootNode() as ShadowRoot).host as Element | undefined;
  const panel = shadowHost?.closest('[data-notis-comments-panel]') ?? shadowHost ?? root;
  return panel.contains(focus);
}

/** Runs `fn` on the window's next frame (a window that draws no frames: its next turn); returns the way to call it off. */
function nextFrame(view: Window | null | undefined, fn: () => void): () => void {
  if (view && typeof view.requestAnimationFrame === 'function') {
    const id = view.requestAnimationFrame(fn);
    return () => view.cancelAnimationFrame(id);
  }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
}

/** Done on a card outside a run: archives it, then selects the card that takes its place, so E archives it in turn. */
export function archiveThenNext(controller: CommentController, root: CommentThread['root'], card: HTMLElement | null): void {
  const scroller = card?.closest('[data-comment-scroll]') ?? null;
  const cards = scroller ? [...scroller.querySelectorAll<HTMLElement>('[data-thread]')] : [];
  const index = card ? cards.indexOf(card) : -1;
  const nextKey = index >= 0 ? (cards[index + 1] ?? cards[index - 1])?.dataset.thread : undefined;
  controller.actions.archive(root);
  const next = nextKey ? controller.threads.find(item => item.root.recordKey === nextKey) : undefined;
  if (!next) return;
  controller.selectThread(next);
  setTimeout(() => {
    const target = scroller ? [...scroller.querySelectorAll<HTMLElement>('[data-thread]')].find(item => item.dataset.thread === nextKey) : null;
    target?.focus({ preventScroll: true });
  }, 0);
}

export function useReviewRunPane({ controller, rootRef, threads, drafting, asking }: ReviewRunPaneOptions): ReviewRunPaneView {
  const run = useReviewRunHost();
  useReviewRunAnswered();
  const live = useRef({ controller, threads, run, asking, drafting });
  live.current = { controller, threads, run, asking, drafting };
  const consumed = useRef(-1);
  // The threads marked Done in this run, and whether each was seen archived since: one that is open again came back
  // (the toast's Undo, Z, a refused write). The last one is the card Z selects again.
  const doneHere = useRef(new Map<string, boolean>());
  const lastDone = useRef<string | null>(null);
  // The card the start picked, until the person moves: a list that fills in after the start (the host's read of what
  // waits lands a moment later) may put another card first, and the run starts on the first one, never the second.
  const startPick = useRef<{ key: string | null; at: number } | null>(null);
  const waitingIds = useWaitingCommentThreads();
  const waitingOn = controller.waitingFilter;

  const cardKeys = () => [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-thread]') ?? [])]
    .map(card => card.dataset.thread ?? '').filter(Boolean);
  const cardOf = (key: string) => [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-thread]') ?? [])]
    .find(card => card.dataset.thread === key) ?? null;
  const threadOf = (key: string | null) => (key ? live.current.threads.find(thread => thread.root.recordKey === key) : undefined);

  const select = (key: string, direction: 'next' | 'previous', by: 'start' | 'step' | 'answer') => {
    const thread = threadOf(key);
    if (!thread) return false;
    live.current.controller.selectThread(thread);
    if (by !== 'start') startPick.current = null;
    const view = rootRef.current?.ownerDocument.defaultView;
    // The card is drawn selected a frame later: it takes the focus, and comes into place the way a conversation does
    // (from below for next, from above for previous; a fade alone for reduced motion).
    const settle = (tries: number) => {
      const card = cardOf(key);
      if (!card) { if (tries > 0) nextFrame(view, () => settle(tries - 1)); return; }
      card.focus({ preventScroll: true });
      // A step (J, K, the bar) brings the card in from the side it comes from. A card that takes the place of one that
      // left (an answer, Done) is moved by the list itself (`useNextCardComesIntoPlace`).
      if (by === 'step') cardComesIntoPlace(card, direction);
    };
    if (view) nextFrame(view, () => settle(6)); else settle(0);
    emitReviewRunEvent({ type: 'selected', key, direction, by });
    return true;
  };

  const step = (delta: 1 | -1): boolean => {
    const keys = cardKeys();
    const current = live.current.controller.threadKey;
    const index = current ? keys.indexOf(current) : -1;
    const target = index < 0 ? (delta > 0 ? keys[0] : keys[keys.length - 1]) : keys[index + delta];
    if (target) return select(target, delta > 0 ? 'next' : 'previous', 'step');
    // Past the page's last card: the host crosses to the next page when one follows; else the selection stays.
    if (delta > 0 && keys.length && live.current.run.hasNext) emitReviewRunEvent({ type: 'end', advance: false });
    return false;
  };

  /** The card left the waiting list: the next one is selected, or the list's end takes over. */
  const moveOn = (key: string) => {
    const keys = cardKeys();
    const index = keys.indexOf(key);
    if (index < 0) return;
    // After the last card comes a card skipped earlier on this page; with none, the next page.
    const next = keys[index + 1] ?? keys.find(item => item !== key);
    if (next && select(next, 'next', 'answer')) return;
    live.current.controller.setThreadKey(null);
    emitReviewRunEvent({ type: 'end', advance: true });
  };

  // What a card reports. Done always moves on; an answer and a sent reply move on with the setting, else they stay.
  useEffect(() => {
    const listener = (action: ReviewRunAction): boolean => {
      const now = live.current;
      if (!mainPane(rootRef.current) || !now.controller.waitingFilter) return false;
      if (action.kind === 'done') {
        const thread = threadOf(action.key);
        if (!thread || thread.root.status !== 'Open') return true;
        // The next card is read before the archive takes this one out of the list.
        const keys = cardKeys();
        const index = keys.indexOf(action.key);
        const next = keys[index + 1] ?? keys.find(item => item !== action.key);
        now.controller.actions.archive(thread.root);
        doneHere.current.set(action.key, false);
        lastDone.current = action.key;
        emitReviewRunEvent({ type: 'answered', key: action.key });
        if (next && select(next, 'next', 'answer')) return true;
        now.controller.setThreadKey(null);
        emitReviewRunEvent({ type: 'end', advance: true });
        return true;
      }
      // An answer the server refuses was never given: the thread waits again and the host's numbers come back. When
      // the run has nothing selected by then (it had reached its end), the card that came back is selected.
      void action.saved?.then((ok) => {
        if (ok) return;
        unmarkReviewRunAnswered(action.key);
        emitReviewRunEvent({ type: 'restored', key: action.key });
        if (live.current.controller.threadKey) return;
        const view = rootRef.current?.ownerDocument.defaultView;
        view?.setTimeout(() => { if (!live.current.controller.threadKey && cardOf(action.key)) select(action.key, 'previous', 'step'); }, 60);
      });
      if (!now.run.advance) {
        // The setting is off: the answer stays in view on its card, and only the count changes.
        markReviewRunAnswered(action.key, true);
        emitReviewRunEvent({ type: 'answered', key: action.key });
        return true;
      }
      // The next card is read while this one is still listed, then it leaves the list.
      moveOn(action.key);
      markReviewRunAnswered(action.key, false);
      emitReviewRunEvent({ type: 'answered', key: action.key });
      return true;
    };
    actionListeners.add(listener);
    return () => { actionListeners.delete(listener); };
    // The handlers read `live`; nothing here changes between renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A thread marked Done here that is open again waits again: the host's numbers come back, whatever undid it (the
  // toast's Undo button, Z, a write the server refused).
  useEffect(() => {
    for (const [key, archived] of doneHere.current) {
      const thread = controller.threads.find(item => item.root.recordKey === key);
      if (!thread) continue;
      if (thread.root.status !== 'Open') { if (!archived) doneHere.current.set(key, true); continue; }
      if (!archived) continue;
      doneHere.current.delete(key);
      emitReviewRunEvent({ type: 'restored', key });
    }
  });

  // What the host asks.
  useEffect(() => {
    if (!mainPane(rootRef.current)) return undefined;
    return registerReviewRunCommands({
      step,
      last: () => {
        const keys = cardKeys();
        const key = keys[keys.length - 1];
        return key ? select(key, 'previous', 'step') : false;
      },
      setWaiting: next => {
        if (!next) resetReviewRunAnswered();
        live.current.controller.setWaitingFilter(next);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A run that starts here, or crosses to this page: the filter goes on, for every item of the page, and the first
  // waiting card is selected (the one the crossing asked for, else the list's first).
  const ready = !controller.loading;
  useEffect(() => {
    if (!run.active || !ready || consumed.current === run.startToken || !mainPane(rootRef.current)) return undefined;
    if (!waitingOn) {
      resetReviewRunAnswered();
      controller.setWaitingFilter(true);
      if (controller.anchors.length) controller.setFilter('all');
      return undefined;
    }
    // The filtered list is drawn by now: its first card, read from the list itself, never from the threads' order.
    const view = rootRef.current?.ownerDocument.defaultView;
    const start = () => {
      if (consumed.current === run.startToken) return;
      const keys = cardKeys();
      // Nothing listed while the host has not said what waits: the list is not known yet, so this is not the end.
      if (!keys.length && waitingIds === null) return;
      consumed.current = run.startToken;
      const key = run.startKey && keys.includes(run.startKey) ? run.startKey : keys[0];
      startPick.current = { key: key ?? null, at: Date.now() };
      if (key) select(key, 'next', 'start');
      else { live.current.controller.setThreadKey(null); emitReviewRunEvent({ type: 'end', advance: false }); }
    };
    if (!view) { start(); return undefined; }
    return nextFrame(view, start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.active, run.startToken, run.startKey, ready, waitingOn, waitingIds]);

  // The list filled in after the start and the person has not moved: the start's pick is taken again.
  useEffect(() => {
    const pick = startPick.current;
    if (!pick || !run.active || !waitingOn) return;
    if (Date.now() - pick.at > START_SETTLE_MS || controller.threadKey !== pick.key) { startPick.current = null; return; }
    const keys = cardKeys();
    const key = run.startKey && keys.includes(run.startKey) ? run.startKey : keys[0];
    if (!key || key === pick.key) return;
    startPick.current = { key, at: pick.at };
    select(key, 'next', 'start');
  });

  // "Waiting for you" turned off while a run is going (its chip removed, another filter picked, a thread that does not
  // wait opened, a new comment started): the run is left, so the next page opened does not turn the filter on again.
  const wasWaiting = useRef(waitingOn);
  useEffect(() => {
    const was = wasWaiting.current;
    wasWaiting.current = waitingOn;
    if (was && !waitingOn && live.current.run.active && mainPane(rootRef.current)) emitReviewRunEvent({ type: 'leave' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingOn]);

  // What the host reads: the cards listed, those that still wait, the one selected.
  useEffect(() => {
    if (!mainPane(rootRef.current)) return;
    const keys = cardKeys();
    const selected = controller.threadKey && keys.includes(controller.threadKey) ? controller.threadKey : null;
    // The selected card's own first words, as it draws them: its quote, its place, else the comment's text.
    const about = selected ? cardOf(selected)?.querySelector('[data-part="quote"], [data-part="place"], .nui-comment-body') : null;
    const words = about?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) || null;
    publishReviewRunPane({
      waiting: waitingOn, keys, waitingKeys: keys.filter(key => { const thread = threadOf(key); return Boolean(thread) && controller.waits(thread!); }),
      selected, drafting, words,
    });
  });
  useEffect(() => () => { if (mainPane(rootRef.current) || !rootRef.current) publishReviewRunPane(null); }, [rootRef]);

  // The keys.
  useEffect(() => {
    const root = rootRef.current;
    const view = root?.ownerDocument.defaultView;
    if (!view || !mainPane(root)) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const now = live.current;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      // A key held down acts once: the Enter that sent a reply never goes on to answer the card.
      if (event.repeat || sending > 0) return;
      if (!shown(rootRef.current) || now.drafting || !now.controller.waitingFilter) return;
      const target = event.composedPath()[0];
      const element = target && (target as Element).nodeType === 1 ? target as Element : null;
      // A field keeps its keys, also while it is switched off to send (`contenteditable="false"`).
      if (element?.closest('input, textarea, select, [contenteditable], [role="textbox"], [role="menu"], [role="dialog"], [role="listbox"]')) return;
      const home = rootRef.current!.getRootNode() as ShadowRoot | Document;
      const inside = Boolean(home.activeElement && rootRef.current!.contains(home.activeElement));
      // In a run the keys are the run's with the focus in the Comments panel or on the page's body, never while an
      // element of the page holds it (a Space with keys of its own); out of a run, only with the focus in the pane.
      if (now.run.active ? !reviewRunHoldsKeys(rootRef.current!) : !inside) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const take = () => { event.preventDefault(); event.stopPropagation(); };
      const thread = threadOf(now.controller.threadKey);
      if (key === 'j' || key === 'k') {
        if (event.shiftKey) return;
        take();
        step(key === 'j' ? 1 : -1);
        return;
      }
      if (key === 'Escape') {
        if (!now.run.active) return;
        // An open menu or picker takes this Escape, wherever the focus is: the run is not left by closing it.
        if (rootRef.current?.querySelector('[role="menu"], [role="dialog"], [role="listbox"]')) return;
        take();
        emitReviewRunEvent({ type: 'leave' });
        return;
      }
      if (key === 'z' && !event.shiftKey) {
        // Z is the toast's Undo (a Done, a Delete) and nothing else: an option picked or a reply sent has no undo, so
        // Z after one changes nothing, here or on the server.
        if (!now.controller.toaster.toast?.undo) return;
        take();
        const back = lastDone.current;
        void now.controller.toaster.undo().then(() => {
          // The Done this undid, if it is the last one: its card is selected again once it is listed.
          view.setTimeout(() => {
            if (!back || live.current.controller.threads.find(item => item.root.recordKey === back)?.root.status !== 'Open') return;
            if (lastDone.current === back) lastDone.current = null;
            if (cardOf(back)) select(back, 'previous', 'step');
          }, 60);
        });
        return;
      }
      if (!thread || event.shiftKey) return;
      // A button keeps its own Enter and Space (an option row, the bar); the card and the page give theirs to the run.
      const onControl = Boolean(element?.closest('button, a[href], [role="button"]')) && !element?.matches('.nui-comment-card');
      const ask = now.controller.canWrite ? now.asking(thread) : null;
      const reply = () => cardOf(thread.root.recordKey)?.dispatchEvent(new view.CustomEvent('notis-comment-reply', { bubbles: false }));
      if (key === 'Enter') {
        if (onControl || !ask?.recommended) return;
        take();
        notifyReviewRunAction({ kind: 'answered', key: thread.root.recordKey, saved: now.controller.actions.answer(ask.comment, ask.recommended) });
        return;
      }
      if (/^[1-9]$/.test(key)) {
        if (!ask) return;
        const position = Number(key);
        if (position > ask.options.length + 1) return;
        take();
        if (position <= ask.options.length) {
          notifyReviewRunAction({ kind: 'answered', key: thread.root.recordKey,
            saved: now.controller.actions.answer(ask.comment, ask.options[position - 1]!) });
        } else reply();
        return;
      }
      if (key === 'r') {
        take();
        reply();
        return;
      }
      if (key === 'e') {
        if (thread.root.status !== 'Open') return;
        take();
        notifyReviewRunAction({ kind: 'done', key: thread.root.recordKey });
      }
    };
    view.addEventListener('keydown', onKey, true);
    return () => view.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const main = mainPane(rootRef.current);
  const running = waitingOn && main;
  return {
    running,
    count: running && run.active ? run.scopeCount : null,
    attrs: {
      'data-run': running && run.active ? '' : undefined,
      'data-run-drafting': running && drafting ? '' : undefined,
      // A phone's sheet: the height it rests at, and whether a card or a new comment is there to show at half.
      'data-sheet': main && run.sheet ? run.sheet : undefined,
      'data-sheet-card': main && run.sheet && controller.threadKey && !drafting ? '' : undefined,
      'data-sheet-drafting': main && run.sheet && drafting ? '' : undefined,
    },
  };
}
