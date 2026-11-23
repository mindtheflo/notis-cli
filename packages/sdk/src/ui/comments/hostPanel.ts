/**
 * What a comment pane and the host panel around it share. The pane is SDK code drawn in the host Comments panel's
 * shadow root (`hostComments`); the host (the Portal) owns the panel's frame. `@notis/sdk/ui` is one module instance
 * for the host and every Space on the page (`runtimeModules`), so these stores are read on both sides.
 *
 * - Slots. The pane's one header row leaves `<slot name="lead">` and `<slot name="trail">` for the host's own
 *   Chat | Comments switch and close button, its list ends with `<slot name="after-list">`, and the selected card
 *   starts with `<slot name="run-bar">` (the pane's foot holds a second one, which shows the bar only while no card
 *   is selected: the first slot of a name in the tree takes the host's element). They are real shadow DOM slots: the
 *   host renders children of the shadow host with a `slot` attribute, which keep the host's styles and React tree. A
 *   pane drawn anywhere else leaves them empty.
 * - Waiting for you. The host tells the pane which comment threads wait for the viewer, as the server counts them
 *   (`setWaitingCommentThreads`), so the pane's "Waiting for you" filter lists exactly what the host's numbers count,
 *   and the number on its switch (`setWaitingCommentCount`), which the Filter shows beside "Waiting for you".
 * - Comment boxes. A new comment and a reply are written in the host's own composer (the chat box's parts: the pills,
 *   the / and @ menus, attach, Send). The pane asks for one (`useHostComposer`), which adds a slotted box to the shadow
 *   host; the host lists the requests (`subscribeHostComposers`) and draws its composer into each box, so the composer
 *   keeps the host's styles and React tree while it sits inside the card. Where no host draws composers the pane keeps
 *   its own plain text box.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useIsoLayoutEffect } from '../util';

/** The slot names a pane leaves for its host. */
export const COMMENT_PANE_SLOTS = Object.freeze({
  /** The start of the header row: the host's Chat | Comments switch. */
  lead: 'lead',
  /** The end of the header row: the host's close button. */
  trail: 'trail',
  /** After the last card: where the review run says what follows this page. */
  afterList: 'after-list',
  /** The top of the selected card, above its quoted words (the pane's foot while none is selected): the review run's bar. */
  runBar: 'run-bar',
} as const);

/** The shadow host of the host Comments panel `element` draws in, or null (a card a Space lays out itself). */
export function commentsShadowHost(element: Element | null): HTMLElement | null {
  if (!element || !element.closest('[data-notis-comments-mount]')) return null;
  const root = element.getRootNode() as ShadowRoot;
  const host = root.host;
  // Not `instanceof HTMLElement`: a pane drawn in another window (a test DOM) has that window's own classes.
  return host && host.nodeType === 1 ? host as HTMLElement : null;
}

// ---------- Waiting for you ----------

let waitingIds: ReadonlySet<string> | null = null;
const waitingListeners = new Set<() => void>();

/**
 * The comment threads that wait for the viewer (their first comments' ids), as the server counts them: a mention, an
 * agent's question, a reply in a thread they started or replied to. Null: not read (the pane then counts what it can
 * see for itself, an agent's unanswered question).
 */
export function setWaitingCommentThreads(ids: readonly string[] | null): void {
  if (!ids && !waitingIds) return;
  if (ids && waitingIds && ids.length === waitingIds.size && ids.every(id => waitingIds!.has(id))) return;
  waitingIds = ids ? new Set(ids) : null;
  for (const listener of [...waitingListeners]) listener();
}

export function waitingCommentThreads(): ReadonlySet<string> | null { return waitingIds; }

export function useWaitingCommentThreads(): ReadonlySet<string> | null {
  const [value, setValue] = useState(waitingIds);
  useEffect(() => {
    const listener = () => setValue(waitingIds);
    waitingListeners.add(listener);
    listener();
    return () => { waitingListeners.delete(listener); };
  }, []);
  return value;
}

let waitingHere: number | null = null;
const waitingHereListeners = new Set<() => void>();

/**
 * The number the host shows on its Chat | Comments switch: what waits for the viewer in the Space on screen. The
 * pane's Filter shows the same number beside "Waiting for you", so the two never disagree. Null: the host shows none
 * (the pane then counts what waits on the page it lists).
 */
export function setWaitingCommentCount(count: number | null): void {
  if (waitingHere === count) return;
  waitingHere = count;
  for (const listener of [...waitingHereListeners]) listener();
}

export function useWaitingCommentCount(): number | null {
  const [value, setValue] = useState(waitingHere);
  useEffect(() => {
    const listener = () => setValue(waitingHere);
    waitingHereListeners.add(listener);
    listener();
    return () => { waitingHereListeners.delete(listener); };
  }, []);
  return value;
}

// ---------- Comment boxes ----------

/** Who a comment goes to, as the box's first pill says it. */
export interface HostComposerTo {
  /** "To Deck polish", "To a new Claude thread", "To Velvet Margin Echo". */
  label: string;
  /** An agent outside Notis: the pill adds "outside Notis". */
  outside: boolean;
  outsideLabel: string;
  /** The app or harness that runs it, for its logo. */
  harness: string | null;
  /** Opens the picker under `anchor`; true once something was picked. Absent: the pill only says where it goes. */
  pick?: (anchor: HTMLElement) => Promise<boolean>;
  pickLabel: string;
}

/** What the pane hands the host for one comment box. Read fresh by the host each time it draws. */
export interface HostComposerProps {
  kind: 'new' | 'reply';
  /** "Add a comment", "Reply to Claude". */
  placeholder: string;
  /** The box's accessible name ("New comment on Slide 2", "Reply to Claude"). */
  label: string;
  to: HostComposerTo | null;
  /** The words a new text comment quotes. */
  quote: string | null;
  /** Where a new comment sits when it quotes nothing ("Point 1 on hero.png", "Whole page"). */
  place: string | null;
  /** The draft kept while the pane was away. */
  initialText: string;
  onText(text: string): void;
  /**
   * The files the box held when it went away (another page and back, a save that failed): the host attaches them
   * again, and says with `onFiles` each time what it holds, so the pane keeps them (`commentDrafts`).
   */
  initialFiles: readonly File[];
  onFiles(files: readonly File[]): void;
  /** Sends the comment; the host's files upload first. True once saved. */
  send(text: string, files: File[]): Promise<boolean>;
  /** Drops a new comment (Escape in an empty box, the cross on a phone); a reply box folds back to its one line. */
  dismiss(): void;
  canWrite: boolean;
  /** Whether files can be attached here. */
  attach: boolean;
  /** Goes up each time the pane asks for the caret in this box (Other on a question, a key). */
  focusToken: number;
  /** A new comment takes the caret as it opens; a reply box waits for a press. */
  autoFocus: boolean;
}

export interface HostComposerRequest {
  id: string;
  /** The slotted element the host draws the composer in. */
  box: HTMLElement;
  props(): HostComposerProps;
}

const composers = new Map<string, HostComposerRequest>();
const composerListeners = new Set<() => void>();
let composerList: readonly HostComposerRequest[] = [];
let composerHosts = 0;
let composerSeq = 0;

function emitComposers() {
  composerList = [...composers.values()];
  for (const listener of [...composerListeners]) listener();
}

export function subscribeHostComposers(listener: () => void): () => void {
  composerListeners.add(listener);
  return () => { composerListeners.delete(listener); };
}
/** The boxes the panes ask for now. The same array until one comes, goes or changes what it shows. */
export function listHostComposers(): readonly HostComposerRequest[] { return composerList; }

/** The host says it draws comment boxes, until the returned call-back runs. */
export function registerHostComposerHost(): () => void {
  composerHosts += 1;
  emitComposers();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    composerHosts -= 1;
    emitComposers();
  };
}
export function hostComposerAvailable(): boolean { return composerHosts > 0; }

/**
 * Asks the host for its composer at `marker` (an element of the pane, beside the `<slot>` the box shows in). Returns
 * the slot's name once the box exists, or null when no host draws composers here (the pane then keeps its own text
 * box). `watch` lists what the host draws from `props`: it draws again when one changes, never on each keystroke.
 */
export function useHostComposer(marker: RefObject<HTMLElement | null>, active: boolean, props: HostComposerProps,
  watch: readonly unknown[]): string | null {
  const [name, setName] = useState<string | null>(null);
  const [hosted, setHosted] = useState(hostComposerAvailable);
  const latest = useRef(props);
  latest.current = props;
  // A host that starts drawing after the pane (or stops) is heard.
  useEffect(() => {
    const sync = () => setHosted(hostComposerAvailable());
    sync();
    return subscribeHostComposers(sync);
  }, []);
  useIsoLayoutEffect(() => {
    if (!active || !hosted) { setName(null); return undefined; }
    const host = commentsShadowHost(marker.current);
    if (!host) { setName(null); return undefined; }
    const id = `comment-box-${composerSeq += 1}`;
    const box = host.ownerDocument.createElement('div');
    box.slot = id;
    box.setAttribute('data-comment-box', latest.current.kind);
    host.appendChild(box);
    composers.set(id, { id, box, props: () => latest.current });
    setName(id);
    emitComposers();
    return () => {
      composers.delete(id);
      box.remove();
      emitComposers();
    };
  }, [active, hosted, marker]);
  useEffect(() => { if (name) emitComposers(); }, [name, ...watch]); // eslint-disable-line react-hooks/exhaustive-deps
  return name;
}
