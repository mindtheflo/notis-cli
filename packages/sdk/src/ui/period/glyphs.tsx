/** Small inline glyphs of the date pieces that the shared icon set does not carry (16 by 16, currentColor). */

import * as React from 'react';

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Glyph({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg className={className ? `nui-icon ${className}` : 'nui-icon'} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export function CaretLeftGlyph({ className }: { className?: string }) {
  return <Glyph className={className}><path {...STROKE} d="M10 4L6 8l4 4" /></Glyph>;
}

export function CaretRightGlyph({ className }: { className?: string }) {
  return <Glyph className={className}><path {...STROKE} d="M6 4l4 4-4 4" /></Glyph>;
}

export function CaretDownGlyph({ className }: { className?: string }) {
  return <Glyph className={className}><path {...STROKE} d="M4 6l4 4 4-4" /></Glyph>;
}

export function CheckGlyph({ className }: { className?: string }) {
  return <Glyph className={className}><path {...STROKE} d="M3 8.5l3 3 7-7" /></Glyph>;
}

export function CalendarGlyph({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <g {...STROKE}><rect x="2.5" y="3.5" width="11" height="10" rx="1.25" /><path d="M2.5 6.5h11M5.5 2v2.5M10.5 2v2.5" /></g>
    </Glyph>
  );
}

/** The tray of items with no date. */
export function TrayGlyph({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <g {...STROKE}><rect x="2.5" y="2.5" width="11" height="11" rx="1.25" /><path d="M2.5 9.5h3l1 1.5h3l1-1.5h3" /></g>
    </Glyph>
  );
}
