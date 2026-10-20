/**
 * Popover (toolkit spec 2.8): a trigger and a floating panel in the layer root (inside the Space shadow root).
 * Closes on a press outside and on Escape (the engine's escape chain). `modal` traps Tab and isolates page keys
 * to the modal scope (aria-modal); a non-modal popover leaves page keys alone.
 */

import React, {
  useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { Words } from '../../words';
import { ESCAPE_PRIORITY } from '../engine/core';
import { useEscapeLayer } from '../engine/hooks';
import { cx, deepActiveElement, useLatest, useStableId, useT } from '../util';
import { useFloatingStyle, useOutsidePress } from './floating';
import { findLayerRoot, usePinnedLayerRoot } from './layerRoot';
import type { Align, Side } from './position';
import { cloneTrigger } from './trigger';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), '
  + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export interface PopoverController { close(): void }

export interface PopoverProps {
  trigger: ReactElement;
  /** The panel content, or a function that receives `close`. */
  content: ReactNode | ((controller: PopoverController) => ReactNode);
  side?: Side;
  align?: Align;
  /** Traps Tab and isolates page keys while open. Default false. */
  modal?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Accessible name of the panel. */
  label?: Words | string;
  className?: string;
  /** Focus the first focusable element on open (default true); else the panel itself. */
  autoFocus?: boolean;
}

function focusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[inert]'));
}

export function Popover({ trigger, content, side = 'bottom', align = 'start', modal = false, open: controlledOpen,
  onOpenChange, label, className, autoFocus = true }: PopoverProps) {
  const t = useT();
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const pinned = usePinnedLayerRoot();
  const [layerRoot, setLayerRoot] = useState<HTMLElement | null>(null);
  const id = useStableId('nui-popover');
  const latest = useLatest({ onOpenChange, controlled: controlledOpen !== undefined });

  const setOpen = useCallback((next: boolean) => {
    if (!latest.current.controlled) setUncontrolled(next);
    latest.current.onOpenChange?.(next);
  }, [latest]);

  const close = useCallback((focusTrigger = false) => {
    const panel = panelRef.current;
    const active = deepActiveElement(triggerRef.current?.getRootNode() as Document | ShadowRoot | undefined);
    const focusInside = !!panel && !!active && panel.contains(active);
    setOpen(false);
    if ((focusTrigger || focusInside) && triggerRef.current) triggerRef.current.focus({ preventScroll: true });
  }, [setOpen]);

  const controller = useMemo<PopoverController>(() => ({ close: () => close(true) }), [close]);
  const { style, side: placedSide } = useFloatingStyle(open && !!layerRoot, triggerRef, panelRef, { side, align, offset: 6 });

  useEffect(() => {
    if (open) setLayerRoot(pinned ?? findLayerRoot(triggerRef.current));
  }, [open, pinned]);

  useEffect(() => {
    if (!open || !layerRoot) return;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = autoFocus ? focusables(panel)[0] : undefined;
      (first ?? panel).focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, layerRoot, autoFocus]);

  useOutsidePress(open, () => [triggerRef.current, panelRef.current], () => setOpen(false));
  useEscapeLayer(`popover:${id}`, () => {
    if (!open) return false;
    close(true);
    return true;
  }, { priority: ESCAPE_PRIORITY.overlay });

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!modal || event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const list = focusables(panel);
    if (!list.length) { event.preventDefault(); return; }
    const active = deepActiveElement(panel.getRootNode() as Document | ShadowRoot);
    const first = list[0]!;
    const last = list[list.length - 1]!;
    if (event.shiftKey && (active === first || active === panel)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };

  const triggerNode = cloneTrigger(trigger, {
    ref: (node: HTMLElement | null) => { triggerRef.current = node; },
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    'aria-controls': open ? id : undefined,
    onClick: (event: ReactMouseEvent) => {
      event.stopPropagation();
      setOpen(!open);
    },
  });

  return (
    <>
      {triggerNode}
      {open && layerRoot ? createPortal(
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          aria-modal={modal ? 'true' : undefined}
          aria-label={label ? t(label) : undefined}
          tabIndex={-1}
          data-notis-escape-owned=""
          data-notis-floating=""
          data-notis-nonmodal={modal ? undefined : ''}
          data-side={placedSide}
          className={cx('nui-popover', className)}
          style={style}
          onKeyDown={onKeyDown}
        >
          {typeof content === 'function' ? content(controller) : content}
        </div>,
        layerRoot,
      ) : null}
    </>
  );
}
