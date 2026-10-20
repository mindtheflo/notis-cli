/**
 * `useToast` (toolkit spec 2.7): the toast a page shows after something it did, the same toast the actions show.
 * One at a time: a new one replaces the one on screen. It stays ACTION_TOAST_MS; an Undo that is running keeps it,
 * busy, until the Undo ends. Draw it with `<ActionToast toast={toaster.toast} onUndo={toaster.undo}
 * onDismiss={toaster.dismiss} />`. `useActions` and ListReader use it, so a ListReader page reaches it through its
 * controller or ReaderCtx.notify.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { actionErrorReason, toWords, type UndoFn, type Words } from '../../words';
import { ACTION_TOAST_MS, ACTION_WORDS } from './actionWords';

export interface ActionToastState {
  id: number;
  words: Words;
  /** A muted second line: why it failed, or a note on what happened. */
  reason: Words | null;
  tone: 'default' | 'danger';
  /** Present when the toast offers Undo: the button shows and Z undoes. */
  undo: UndoFn | null;
  /** The Undo is running: its button says so, and a second press does nothing. */
  undoing: boolean;
}

export interface ToastOptions {
  /** `danger` for a failure. */
  tone?: 'default' | 'danger';
  /** Offers Undo (the button, and Z). An UndoFn that throws shows "Could not undo that." with an ActionError's reason. */
  undo?: UndoFn | null;
  /** A muted second line under the words. */
  reason?: Words | string | null;
}

export interface UseToastOptions {
  /** An Undo threw or rejected (the toast already says so). */
  onError?: (error: unknown) => void;
}

export interface ToastController {
  toast: ActionToastState | null;
  /** Shows `words`, replacing the toast on screen. */
  notify(words: Words | string, options?: ToastOptions): void;
  /** Runs the toast's Undo. The toast stays, busy, until it ends, then says whether it worked. */
  undo(): Promise<void>;
  /** Hides the toast (not while its Undo runs: the outcome still shows). */
  dismiss(): void;
}

type ToastInput = Omit<ActionToastState, 'id' | 'undoing'>;

export function useToast(options: UseToastOptions = {}): ToastController {
  const [toast, setToast] = useState<ActionToastState | null>(null);
  // The toast on screen, read by undo so a second press in the same tick sees the first one running.
  const current = useRef<ActionToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const set = (next: ActionToastState | null) => {
    current.current = next;
    setToast(next);
  };
  useEffect(() => clearTimer, []);

  const show = useCallback((next: ToastInput) => {
    clearTimer();
    const state: ActionToastState = { ...next, undoing: false, id: ++seq.current };
    set(state);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (current.current?.id === state.id && !current.current.undoing) set(null);
    }, ACTION_TOAST_MS);
  }, []);

  const notify = useCallback((words: Words | string, notifyOptions: ToastOptions = {}) => {
    show({
      words: toWords(words),
      reason: notifyOptions.reason ? toWords(notifyOptions.reason) : null,
      tone: notifyOptions.tone ?? 'default',
      undo: notifyOptions.undo ?? null,
    });
  }, [show]);

  const dismiss = useCallback(() => {
    if (current.current?.undoing) return;
    clearTimer();
    set(null);
  }, []);

  const undo = useCallback(async () => {
    const shown = current.current;
    if (!shown?.undo || shown.undoing) return;
    clearTimer();
    set({ ...shown, undoing: true });
    try {
      await shown.undo();
      // A toast shown while the Undo ran keeps its place; a failure below always shows.
      if (!current.current || current.current.id === shown.id) {
        show({ words: ACTION_WORDS.undone, reason: null, tone: 'default', undo: null });
      }
    } catch (error) {
      const reason = actionErrorReason(error);
      show({ words: ACTION_WORDS.undoFailed, reason: reason ? toWords(reason) : null, tone: 'danger', undo: null });
      optionsRef.current.onError?.(error);
    }
  }, [show]);

  return useMemo(() => ({ toast, notify, undo, dismiss }), [toast, notify, undo, dismiss]);
}
