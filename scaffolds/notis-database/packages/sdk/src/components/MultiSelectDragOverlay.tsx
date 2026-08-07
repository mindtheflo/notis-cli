'use client';

import { type CSSProperties, type ReactElement } from 'react';
import type { DragRect } from '../hooks/useMultiSelect';

export interface MultiSelectDragOverlayProps {
  rect: DragRect | null;
  className?: string;
  style?: CSSProperties;
}

const overlayBaseStyle: CSSProperties = {
  position: 'fixed',
  borderRadius: '3px',
  border: '1px solid rgba(35, 131, 226, 0.3)',
  background: 'rgba(35, 131, 226, 0.08)',
  pointerEvents: 'none',
  zIndex: 50,
};

export function MultiSelectDragOverlay({
  rect,
  className,
  style,
}: MultiSelectDragOverlayProps): ReactElement | null {
  if (!rect) return null;
  if (rect.width === 0 && rect.height === 0) return null;

  const merged: CSSProperties = {
    ...overlayBaseStyle,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    ...(style || null),
  };

  return <div aria-hidden className={className} style={merged} />;
}
