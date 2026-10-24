'use client';

import React, { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useIsoLayoutEffect } from '../ui/util';

export interface DialogProps {
  open: boolean;
  /** Request dismissal. Keep open unchanged to prevent dismissal while saving. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  role?: 'dialog' | 'alertdialog';
  /**
   * A confirmation: on phones and tablets the operating system's own dialog asks instead of the card. OK clicks the
   * button marked `data-dialog-confirm`; Cancel clicks the one marked `data-dialog-cancel`, else calls `onClose`.
   * Desktop browsers and the Desktop app keep the card.
   */
  nativeOnTouch?: boolean;
  children: ReactNode;
}

/** How long the card stays hidden after OK while the work runs; a slow or failed action shows it again. */
const NATIVE_CONFIRM_REVEAL_MS = 1500;
/** A Cancel faster than this came from a browser with no OS dialog (an embedded view): show the card instead. */
const NATIVE_CONFIRM_MISSING_MS = 30;

/** Touch-first devices confirm with the operating system's dialog, as the Portal's AlertDialog does. */
export function prefersNativeConfirm(): boolean {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false;
  if ((window as Window & { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron) return false;
  return window.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true;
}

/** One OS dialog: the question first, then each line of the explanation as its own paragraph. */
function nativeConfirmMessage(title: string, description: string): string {
  return [title, ...description.split(/\n+/)].map((part) => part.trim()).filter(Boolean).join('\n\n');
}

/** Native top-layer dialog; content and actions remain app-owned. */
export function Dialog({ open, onClose, title, description, role = 'dialog', nativeOnTouch = false, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Each opening asks the OS again.
  const [native, setNative] = useState(false);

  // Before paint, so a touch confirmation never flashes the card first.
  useIsoLayoutEffect(() => {
    if (!open) return;
    const dialog = ref.current!;
    dialog.showModal();
    setNative(nativeOnTouch && prefersNativeConfirm());
    return () => { if (dialog.open) dialog.close(); };
  }, [open, nativeOnTouch]);

  useEffect(() => {
    if (!open || !native) return;
    const dialog = ref.current!;
    let reveal: ReturnType<typeof setTimeout> | undefined;
    // Let the dialog finish opening (title, buttons) before the OS takes over.
    const ask = setTimeout(() => {
      const asked = performance.now();
      const describedBy = dialog.querySelector('.notis-dialog-description') as HTMLElement | null;
      const confirmed = window.confirm(nativeConfirmMessage(
        dialog.querySelector('.notis-dialog-title')?.textContent ?? '',
        describedBy ? (typeof describedBy.innerText === 'string' ? describedBy.innerText : describedBy.textContent ?? '') : '',
      ));
      if (!confirmed && performance.now() - asked < NATIVE_CONFIRM_MISSING_MS) {
        setNative(false);
        return;
      }
      if (confirmed) dialog.querySelector<HTMLButtonElement>('[data-dialog-confirm]')?.click();
      else {
        const cancel = dialog.querySelector<HTMLButtonElement>('[data-dialog-cancel]');
        if (cancel) cancel.click(); else onCloseRef.current();
      }
      reveal = setTimeout(() => setNative(false), confirmed ? NATIVE_CONFIRM_REVEAL_MS : 0);
    }, 0);
    return () => {
      clearTimeout(ask);
      if (reveal !== undefined) clearTimeout(reveal);
    };
  }, [open, native]);

  return (
    <dialog
      ref={ref}
      className="notis-dialog"
      role={role}
      aria-labelledby={titleId}
      aria-describedby={description == null ? undefined : descriptionId}
      data-native-confirm={native ? '' : undefined}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h2 id={titleId} className="notis-dialog-title">{title}</h2>
      {description != null && <p id={descriptionId} className="notis-dialog-description">{description}</p>}
      {children}
    </dialog>
  );
}
