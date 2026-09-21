'use client';

import React, { useEffect, useId, useRef, type ReactNode } from 'react';

export interface DialogProps {
  open: boolean;
  /** Request dismissal. Keep open unchanged to prevent dismissal while saving. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  role?: 'dialog' | 'alertdialog';
  children: ReactNode;
}

/** Native top-layer dialog; content and actions remain app-owned. */
export function Dialog({ open, onClose, title, description, role = 'dialog', children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="notis-dialog"
      role={role}
      aria-labelledby={titleId}
      aria-describedby={description == null ? undefined : descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h2 id={titleId} className="notis-dialog-title">{title}</h2>
      {description != null && <p id={descriptionId} className="notis-dialog-description">{description}</p>}
      {children}
    </dialog>
  );
}
