'use client';

import React, { type CSSProperties, type ReactElement } from 'react';
import { shortcutDisplay } from '../interactions/shortcuts';

export interface ShortcutHint {
  id: string;
  keys: string;
  label: string;
}

export interface ShortcutHintsProps {
  shortcuts: ShortcutHint[];
  className?: string;
  style?: CSSProperties;
}

const listStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '0.75rem',
  color: 'hsl(var(--muted-foreground))',
  fontSize: '12px',
};

const hintStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
};

const keyStyle: CSSProperties = {
  minWidth: '20px',
  border: '1px solid hsl(var(--border))',
  borderRadius: '4px',
  background: 'hsl(var(--muted))',
  color: 'hsl(var(--foreground))',
  padding: '1px 5px',
  textAlign: 'center',
  font: 'inherit',
};

export function ShortcutHints({ shortcuts, className, style }: ShortcutHintsProps): ReactElement | null {
  if (shortcuts.length === 0) return null;
  return (
    <div aria-label="Keyboard shortcuts" className={className} style={{ ...listStyle, ...style }}>
      {shortcuts.map((shortcut) => (
        <span key={shortcut.id} style={hintStyle}>
          <kbd style={keyStyle}>{shortcutDisplay(shortcut.keys)}</kbd>
          <span>{shortcut.label}</span>
        </span>
      ))}
    </div>
  );
}
