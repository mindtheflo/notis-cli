/**
 * The reveal rule shared by the Manager chat edge and Space `Panels`, without a framework.
 *
 * A side pane (the chat, or a Space's reader) that slides over its main pane (the page, or the
 * list) leaves a strip of it visible. A rest of the pointer on that strip (200ms; a pass is not a
 * rest) reveals the main pane: the side pane steps aside until the main pane has its minimum
 * again. It stays so until the pointer is back on the side pane (its drag edge is exempt, so the
 * edge stays put and can still be grabbed). Leaving the main pane elsewhere only cancels a pending
 * rest, so menus and dialogs opened from it keep it revealed. Keyboard focus moving into the
 * covered main pane reveals it too.
 *
 * The owner keeps the revealed state and draws it; this only listens on the two pane elements
 * (never on window or document) and says when to reveal or cover again.
 */
import { PANELS_HOVER_DELAY_MS } from './panelMath';

export type CoverRevealTrigger = 'hover' | 'keyboard';

export interface CoverRevealTarget {
  /** The pane that may be covered (the page, the list). */
  main: HTMLElement;
  /** The pane that covers it (the chat, the reader). */
  side: HTMLElement;
  /** The drag edge on the side pane, exempt from covering again. Read lazily. */
  edge(): HTMLElement | null;
  /** The side pane covers part of the main pane right now. */
  covering(): boolean;
  /** The main pane is revealed now. */
  revealed(): boolean;
  /** A drag runs: nothing moves under it. */
  dragging(): boolean;
  /** Whether a focus inside the main pane counts as keyboard focus. Default: the focused element matches `:focus-visible`. */
  keyboardFocus?(event: FocusEvent): boolean;
  /** Reveal (true) or cover again (false). Returns true when the state changed. */
  setRevealed(revealed: boolean, trigger: CoverRevealTrigger | null): boolean;
  /** Called after a change by `trigger`, for analytics. */
  onRevealed?(trigger: CoverRevealTrigger): void;
  /** The rest that reveals, in ms. Default 200. */
  delayMs?: number;
}

export interface CoverReveal {
  /** Drop a pending rest (a width was chosen, the pane closed). */
  cancel(): void;
  /** Stop listening. */
  detach(): void;
}

/** Hover belongs to mouse and pen; a tap on the strip just uses the pane. */
export function isHoverPointer(event: PointerEvent): boolean {
  return event.pointerType === 'mouse' || event.pointerType === 'pen';
}

/**
 * The element that actually took focus. Focus inside a Space's shadow root reaches the page as an
 * event retargeted to the shadow host, which does not match `:focus-visible` itself; the composed
 * path still starts at the focused element.
 */
export function focusedElement(event: FocusEvent): EventTarget | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  return path[0] ?? event.target;
}

export function isFocusVisible(target: EventTarget | null): boolean {
  const element = target as Element | null;
  if (!element || typeof element.matches !== 'function') return false;
  try {
    return element.matches(':focus-visible');
  } catch {
    return false;
  }
}

export function followCoverReveal(target: CoverRevealTarget): CoverReveal {
  const { main, side } = target;
  const delay = target.delayMs ?? PANELS_HOVER_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const set = (revealed: boolean, trigger: CoverRevealTrigger | null) => {
    cancel();
    if (target.setRevealed(revealed, trigger) && revealed && trigger) target.onRevealed?.(trigger);
  };
  const keyboardFocus = target.keyboardFocus ?? ((event: FocusEvent) => isFocusVisible(focusedElement(event)));

  // Only a covered main pane is revealed, and only after a rest: crossing the strip on the way
  // somewhere else must not move anything.
  const onMainPointer = (event: PointerEvent) => {
    if (!isHoverPointer(event) || target.dragging() || !target.covering()) return;
    if (target.revealed() || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      set(true, 'hover');
    }, delay);
  };
  const onMainLeave = (event: PointerEvent) => {
    if (isHoverPointer(event)) cancel();
  };
  const onSidePointer = (event: PointerEvent) => {
    if (!isHoverPointer(event) || target.edge()?.contains(event.target as Node)) return;
    set(false, null);
  };
  // A click or tap that focuses a text field matches :focus-visible too, so the input counts.
  const onMainFocus = (event: FocusEvent) => {
    if (!target.covering() || !keyboardFocus(event)) return;
    set(true, 'keyboard');
  };

  main.addEventListener('pointerenter', onMainPointer);
  main.addEventListener('pointermove', onMainPointer);
  main.addEventListener('pointerleave', onMainLeave);
  main.addEventListener('focusin', onMainFocus);
  side.addEventListener('pointerover', onSidePointer);
  return {
    cancel,
    detach() {
      cancel();
      main.removeEventListener('pointerenter', onMainPointer);
      main.removeEventListener('pointermove', onMainPointer);
      main.removeEventListener('pointerleave', onMainLeave);
      main.removeEventListener('focusin', onMainFocus);
      side.removeEventListener('pointerover', onSidePointer);
    },
  };
}
