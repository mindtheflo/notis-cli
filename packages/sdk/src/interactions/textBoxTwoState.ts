/**
 * The two states of a text box (docs/portal-design-system.md, "Two states of a text box"), for every box a person
 * writes a message or a comment in: the Portal's chat box, quick box and comment box (through its
 * `composerTwoState.ts`) and the comment pane's own fields, where the host draws none.
 *
 * - At rest (no focus; on a phone, the keyboard closed): one line, the placeholder or the first line of a draft.
 * - Open (the focus is in the box): the text takes the full width on top and the buttons a line of their own under it.
 *
 * This file holds what every box shares, so they open and fold the same way: when a box is open
 * ({@link textBoxOpen}), how long a blur waits before it folds ({@link TEXT_BOX_FOLD_DELAY_MS}), how its height moves
 * between the two states ({@link useHeightFollowsState}) and the hook that ties them to an element
 * ({@link useTextBoxTwoState}). The element gets `data-composer-state="rest" | "open"`; each stylesheet draws the two
 * states from that attribute (`globals.css` in the Portal, `toolkit.css` in a comment pane's shadow root).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { deepActiveElement } from './swipeDownToDismiss';

const LG_QUERY = '(min-width: 1024px)';
/** How long a blur waits before the box folds: a press on one of its own menus or buttons is no blur. */
export const TEXT_BOX_FOLD_DELAY_MS = 160;
/** How long the box takes to change height between its two states. */
export const TEXT_BOX_STATE_MS = 200;
/** Something of a box drawn outside it (the thread picker, a menu, the @ list): the focus there keeps the box open. */
export const TEXT_BOX_OUTSIDE_PARTS = '[data-notis-thread-picker], [role="menu"], [data-mention-dropdown]';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** True from 1024px up (a computer's layout); true before the first effect, as the server draws it. */
export function useWideScreen(): boolean {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const query = window.matchMedia?.(LG_QUERY);
    if (!query) return undefined;
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);
  return wide;
}

/**
 * Whether a box is open: it has the focus, or is busy (recording, sending); on a computer a draft keeps it open too.
 * On a phone a draft at rest is one line.
 */
export function textBoxOpen(input: { focused: boolean; busy: boolean; hasDraft: boolean; wide: boolean }): boolean {
  return input.focused || input.busy || (input.wide && input.hasDraft);
}

/**
 * The box's surface changes height between its two states over TEXT_BOX_STATE_MS, from the height it had to the one
 * its new layout takes (nothing moves for reduced motion, or where the browser cannot animate). The surface is the
 * holder's first element, or what `surfaceOf` picks in it.
 */
export function useHeightFollowsState(holder: RefObject<HTMLElement | null>, state: string | null,
  surfaceOf?: (holder: HTMLElement) => HTMLElement | null): void {
  const last = useRef<{ state: string | null; height: number } | null>(null);
  const pick = useRef(surfaceOf);
  pick.current = surfaceOf;
  useIsoLayoutEffect(() => {
    // One state only (the Desktop overlay, a computer's quick box): nothing is read from the page.
    if (!state) { last.current = null; return; }
    const element = holder.current;
    const surface = element ? (pick.current ? pick.current(element) : element.firstElementChild as HTMLElement | null) : null;
    if (!surface) return;
    const height = surface.getBoundingClientRect().height;
    const before = last.current;
    last.current = { state, height };
    if (!before || before.state === state || !state || !before.state || Math.abs(before.height - height) < 1) return;
    const view = surface.ownerDocument.defaultView;
    if (typeof surface.animate !== 'function' || view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    surface.animate([{ height: `${before.height}px`, overflow: 'hidden' }, { height: `${height}px`, overflow: 'hidden' }],
      { duration: TEXT_BOX_STATE_MS, easing: 'ease-out' });
  });
}

/**
 * Runs `fold` once the focus has left `box` for good, TEXT_BOX_FOLD_DELAY_MS after a blur. While something of the box
 * drawn outside it is open (`TEXT_BOX_OUTSIDE_PARTS`, or `keep`), it waits and looks again, so a box whose menu or
 * picker closed without giving it the focus back still folds. `timer` holds the pending look; a focus that returns
 * clears it. The focus is read through shadow roots, so a box inside a comment pane counts its own field.
 */
export function foldOnceFocusLeft(timer: { current: ReturnType<typeof setTimeout> | null }, box: () => HTMLElement | null,
  fold: () => void, keep?: () => boolean): void {
  if (timer.current) clearTimeout(timer.current);
  const look = () => {
    timer.current = null;
    const element = box();
    if (element && element.contains(deepActiveElement(element.ownerDocument))) return;
    if (keep?.() || document.querySelector(TEXT_BOX_OUTSIDE_PARTS)) { timer.current = setTimeout(look, TEXT_BOX_FOLD_DELAY_MS); return; }
    fold();
  };
  timer.current = setTimeout(look, TEXT_BOX_FOLD_DELAY_MS);
}

export interface TextBoxTwoStateOptions {
  /** The box takes the two states here. False: one state, no attribute, and nothing is read from the page. */
  enabled: boolean;
  /** The two states on a phone only: from 1024px up the box keeps its one state. */
  phoneOnly?: boolean;
  hasDraft: boolean;
  /** Something keeps the box open without the focus (a voice message being recorded). */
  busy?: boolean;
  /** A message is being sent, or the box says why it could not: it stays in the state it was in. */
  hold?: boolean;
  /** Something of the box drawn outside it is open (a dialog it started): a blur toward it is no blur. */
  keepOpen?: () => boolean;
  /** The element whose height follows the state, when it is not the holder's first element. */
  surfaceOf?: (holder: HTMLElement) => HTMLElement | null;
  /**
   * The box can lose the focus without hearing of it: a browser sends no blur when the focused field or button is
   * switched off or taken away (Send once the message is sent, the field while a voice message is recorded). With
   * this on, the box looks again each time what holds it changes, and folds when the focus is no longer in it.
   */
  looksAgain?: boolean;
}

export interface TextBoxTwoState<T extends HTMLElement = HTMLDivElement> {
  /** False where the box has one state: no attribute is set. */
  on: boolean;
  open: boolean;
  state: 'rest' | 'open' | null;
  /** Spread on the element that wraps the box's surface. */
  bind: {
    ref: RefObject<T | null>;
    onFocusCapture(): void;
    onBlurCapture(): void;
    'data-composer-state'?: 'rest' | 'open';
  };
}

/** The two states of one box: open with the focus, folded TEXT_BOX_FOLD_DELAY_MS after it left, its height following. */
export function useTextBoxTwoState<T extends HTMLElement = HTMLDivElement>({ enabled: asked, phoneOnly = false, hasDraft,
  busy = false, hold = false, keepOpen, surfaceOf, looksAgain = false }: TextBoxTwoStateOptions): TextBoxTwoState<T> {
  const [focused, setFocused] = useState(false);
  const wide = useWideScreen();
  const enabled = asked && !(phoneOnly && wide);
  const ref = useRef<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keep = useRef(keepOpen);
  keep.current = keepOpen;
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // A box that comes and goes (the quick box closes; a window crosses 1024px) reads where the focus is each time it
  // takes the two states: a field taken off the page never said it lost the focus.
  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const element = ref.current;
    setFocused(Boolean(enabled && element && element.contains(deepActiveElement(element.ownerDocument))));
  }, [enabled]);
  const onFocusCapture = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setFocused(true);
  }, []);
  const onBlurCapture = useCallback(() => {
    foldOnceFocusLeft(timer, () => ref.current, () => setFocused(false), () => Boolean(keep.current?.()));
  }, []);
  // `looksAgain`: each time what holds the box changes, it looks once more, TEXT_BOX_FOLD_DELAY_MS later, and folds
  // when the focus is no longer in it (no blur said so).
  useEffect(() => {
    if (!looksAgain || !enabled || !focused || hold) return;
    foldOnceFocusLeft(timer, () => ref.current, () => setFocused(false), () => Boolean(keep.current?.()));
  }, [looksAgain, enabled, focused, hold, busy, hasDraft]);
  const natural = textBoxOpen({ focused, busy, hasDraft, wide });
  const kept = useRef(natural);
  if (!hold) kept.current = natural;
  const open = enabled && (hold ? kept.current : natural);
  const state = enabled ? (open ? 'open' : 'rest') : null;
  useHeightFollowsState(ref, state, surfaceOf);
  return {
    on: enabled, open, state,
    bind: { ref, onFocusCapture, onBlurCapture, ...(state ? { 'data-composer-state': state } : {}) },
  };
}
