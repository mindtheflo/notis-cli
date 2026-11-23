/**
 * The comment pane drawn by the host, not by the Space view that owns its controller.
 *
 * A pane used to be a React portal from the Space view into the host Comments panel, so it was made again whenever
 * the view was: a new published version of the page emptied the list, lost its scroll and closed the box being
 * written in. Comments do not depend on the page's version. Where the host says it draws panes for the element it
 * hands out (`registerPaneOutlet`), `CommentPane` and `PassageCommentPane` no longer portal: after each of their
 * renders they hand the host what to draw (`usePaneOutlet`), and the host renders it in its own React tree
 * (`CommentPaneOutlet`). When the view that owned the pane goes away, what it last handed over stays drawn until the
 * view that replaces it hands over its own; with the same key (`handover`) React keeps every element of the pane: the
 * cards, the list's scroll, an open reply box and its caret.
 *
 * A host that registers no outlet (a test, an older host) gets the portal as before.
 */

import { Component, Fragment, useCallback, useRef, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useIsoLayoutEffect } from '../util';

interface Entry {
  owner: object;
  key: string;
  node: ReactNode;
  /** False while the pane's first read of its comments has not settled. */
  ready: boolean;
  /** False once the view that handed it over went away: it stays drawn until another one takes its place. */
  live: boolean;
}

interface Outlet {
  current: Entry | null;
  /** A pane of the replacing view that is not ready yet: the one before it stays drawn meanwhile. */
  waiting: Entry | null;
  timer: ReturnType<typeof setTimeout> | null;
  version: number;
  listeners: Set<() => void>;
}

const outlets = new WeakMap<HTMLElement, Outlet>();

/** How long a pane left behind by its view stays drawn while the pane that replaces it reads its comments. */
export const PANE_OUTLET_WAIT_MS = 2500;

function emit(outlet: Outlet): void {
  outlet.version += 1;
  for (const listener of [...outlet.listeners]) listener();
}

function clearTimer(outlet: Outlet): void {
  if (outlet.timer) { clearTimeout(outlet.timer); outlet.timer = null; }
}

/**
 * The host says it draws the panes handed the element `target` (with `<CommentPaneOutlet target={target} />`), until
 * the returned call-back runs. Call it before the element is handed to a source (`SpaceCommentSource.show`).
 */
export function registerPaneOutlet(target: HTMLElement): () => void {
  const outlet: Outlet = outlets.get(target) ?? { current: null, waiting: null, timer: null, version: 0, listeners: new Set() };
  outlets.set(target, outlet);
  return () => {
    if (outlets.get(target) !== outlet) return;
    clearTimer(outlet);
    outlets.delete(target);
    outlet.current = null;
    outlet.waiting = null;
    emit(outlet);
  };
}

/** Whether the host draws the panes handed `target`. */
export function paneOutletFor(target: HTMLElement | null): boolean {
  return Boolean(target && outlets.has(target));
}

function publish(target: HTMLElement, entry: Entry): void {
  const outlet = outlets.get(target);
  if (!outlet) return;
  const shown = outlet.current;
  // The pane left behind by the view this one replaces stays until this one has read its comments: the list never
  // shows loading rows in between. Another page's pane (another key) is replaced at once.
  const holds = shown && shown.owner !== entry.owner && !shown.live && shown.key === entry.key && !entry.ready;
  if (holds) {
    outlet.waiting = entry;
    if (!outlet.timer) {
      outlet.timer = setTimeout(() => {
        outlet.timer = null;
        if (!outlet.waiting) return;
        outlet.current = outlet.waiting;
        outlet.waiting = null;
        emit(outlet);
      }, PANE_OUTLET_WAIT_MS);
    }
    return;
  }
  clearTimer(outlet);
  outlet.waiting = null;
  outlet.current = entry;
  emit(outlet);
}

function retire(target: HTMLElement, owner: object): void {
  const outlet = outlets.get(target);
  if (!outlet) return;
  if (outlet.waiting?.owner === owner) { outlet.waiting = null; clearTimer(outlet); }
  // No redraw: what it showed last stays as it is until another pane takes its place or the host's element goes.
  if (outlet.current?.owner === owner) outlet.current = { ...outlet.current, live: false };
}

/**
 * Hands the host what the pane draws in `target`, after each render. True when the host draws it (the pane then
 * renders nothing itself); false when no host outlet is registered for `target` and the pane must portal as before.
 */
export function usePaneOutlet(target: HTMLElement | null, key: string, node: ReactNode, ready: boolean): boolean {
  const owner = useRef<object>({}).current;
  const hosted = paneOutletFor(target);
  useIsoLayoutEffect(() => {
    if (hosted && target) publish(target, { owner, key, node, ready, live: true });
  });
  useIsoLayoutEffect(() => {
    if (!hosted || !target) return undefined;
    return () => retire(target, owner);
  }, [hosted, target, owner]);
  return hosted;
}

/** A pane that throws never takes the host's panel (or the page) with it: it draws nothing until its key changes. */
class PaneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[comments] pane failed', error, info.componentStack); }
  render() { return this.state.failed ? null : this.props.children; }
}

const noop = () => {};

/** Draws, in the host's own React tree, the pane handed the element `target` (see the file's note). */
export function CommentPaneOutlet({ target }: { target: HTMLElement | null }): ReactNode {
  const outlet = target ? outlets.get(target) : undefined;
  const subscribe = useCallback((listener: () => void) => {
    if (!outlet) return noop;
    outlet.listeners.add(listener);
    return () => { outlet.listeners.delete(listener); };
  }, [outlet]);
  useSyncExternalStore(subscribe, () => outlet?.version ?? 0, () => 0);
  const entry = outlet?.current;
  if (!target || !entry) return null;
  return createPortal(<PaneBoundary key={entry.key}><Fragment>{entry.node}</Fragment></PaneBoundary>, target);
}
