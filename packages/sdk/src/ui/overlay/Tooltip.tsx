/**
 * Tooltip (toolkit spec 2.8): a label and an optional shortcut on a black pill, the Manager's tooltip. Shows after
 * 500ms of hover or at once on keyboard focus; hides on leave, blur, a press or any key. Never takes focus.
 */

import React, { useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { KeySpec, Words } from '../../words';
import { Keycap, KeycapSurface } from '../keycap';
import { useStableId, useT } from '../util';
import { useFloatingStyle } from './floating';
import { findLayerRoot, usePinnedLayerRoot } from './layerRoot';
import type { Align, Side } from './position';
import { cloneTrigger } from './trigger';

export interface TooltipProps {
  label: Words | string;
  keys?: KeySpec | KeySpec[];
  side?: Side;
  align?: Align;
  /** Hover delay in ms. Default 500. */
  delay?: number;
  /** One focusable element. */
  children: ReactElement;
  disabled?: boolean;
}

export function Tooltip({ label, keys, side = 'top', align = 'center', delay = 500, children, disabled }: TooltipProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = usePinnedLayerRoot();
  const id = useStableId('nui-tip');
  const { style } = useFloatingStyle(open, anchorRef, tipRef, { side, align, offset: 6 });

  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const show = (now: boolean) => {
    if (disabled) return;
    clear();
    if (now) setOpen(true);
    else timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => { clear(); setOpen(false); };

  useEffect(() => () => clear(), []);
  useEffect(() => { if (disabled) hide(); }, [disabled]);
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const onKey = () => hide();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onKey, true);
    };
  }, [open]);

  const layerRoot = open ? (pinned ?? findLayerRoot(anchorRef.current)) : null;
  const trigger = cloneTrigger(children, {
    ref: (node: HTMLElement | null) => { anchorRef.current = node; },
    'aria-describedby': open ? id : undefined,
    onPointerEnter: (event: React.PointerEvent) => { if (event.pointerType !== 'touch') show(false); },
    onPointerLeave: hide,
    onFocus: (event: React.FocusEvent) => {
      const target = event.target as HTMLElement;
      // Keyboard focus only (a click focuses too).
      let visible = true;
      try { visible = target.matches(':focus-visible'); } catch { visible = true; }
      if (visible) show(true);
    },
    onBlur: hide,
  });

  return (
    <>
      {trigger}
      {open && layerRoot ? createPortal(
        <KeycapSurface on="tooltip">
          <div ref={tipRef} id={id} role="tooltip" className="nui-tip" style={style}>
            <span>{t(label)}</span>
            {keys ? <Keycap keys={keys} /> : null}
          </div>
        </KeycapSurface>,
        layerRoot,
      ) : null}
    </>
  );
}
