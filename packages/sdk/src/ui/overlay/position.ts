/** Placement of a floating panel next to its anchor (pure). Flips to the other side when it does not fit. */

export type Side = 'bottom' | 'top' | 'right' | 'left';
export type Align = 'start' | 'center' | 'end';

export interface RectLike { top: number; left: number; right: number; bottom: number; width: number; height: number }

export interface PlaceOptions {
  side?: Side;
  align?: Align;
  offset?: number;
  /** Keeps this far from the viewport edges. */
  margin?: number;
  viewport: { width: number; height: number };
}

export interface Placement { top: number; left: number; side: Side }

export function place(anchor: RectLike, size: { width: number; height: number }, options: PlaceOptions): Placement {
  const { align = 'start', offset = 4, margin = 8, viewport } = options;
  let side = options.side ?? 'bottom';
  const vertical = side === 'bottom' || side === 'top';
  if (vertical) {
    const below = viewport.height - anchor.bottom - offset - margin;
    const above = anchor.top - offset - margin;
    if (side === 'bottom' && size.height > below && above > below) side = 'top';
    else if (side === 'top' && size.height > above && below > above) side = 'bottom';
  } else {
    const right = viewport.width - anchor.right - offset - margin;
    const left = anchor.left - offset - margin;
    if (side === 'right' && size.width > right && left > right) side = 'left';
    else if (side === 'left' && size.width > left && right > left) side = 'right';
  }
  let top: number;
  let left: number;
  if (side === 'bottom' || side === 'top') {
    top = side === 'bottom' ? anchor.bottom + offset : anchor.top - offset - size.height;
    left = align === 'start' ? anchor.left : align === 'end' ? anchor.right - size.width
      : anchor.left + anchor.width / 2 - size.width / 2;
  } else {
    left = side === 'right' ? anchor.right + offset : anchor.left - offset - size.width;
    top = align === 'start' ? anchor.top : align === 'end' ? anchor.bottom - size.height
      : anchor.top + anchor.height / 2 - size.height / 2;
  }
  const maxLeft = Math.max(margin, viewport.width - margin - size.width);
  const maxTop = Math.max(margin, viewport.height - margin - size.height);
  return { top: Math.round(clamp(top, margin, maxTop)), left: Math.round(clamp(left, margin, maxLeft)), side };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
