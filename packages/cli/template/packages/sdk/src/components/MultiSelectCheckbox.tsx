'use client';

import React, { type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react';

export interface MultiSelectCheckboxProps {
  isSelected: boolean;
  onClick: (event: ReactMouseEvent) => void;
  disabled?: boolean;
  /** When true, the checkbox is always visible. Default false (hover/focus reveal via the parent's :hover state). */
  alwaysVisible?: boolean;
  /** Optional aria-label override. Defaults to "Select item" / "Deselect item". */
  ariaLabel?: string;
  className?: string;
  /** Optional inline-style override merged with the defaults. */
  style?: CSSProperties;
}

const baseStyle: CSSProperties = {
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '16px',
  height: '16px',
  borderRadius: '4px',
  border: '1px solid hsl(var(--border))',
  background: 'transparent',
  color: 'hsl(var(--primary-foreground))',
  cursor: 'pointer',
  padding: 0,
  transition: 'background-color 120ms ease, border-color 120ms ease, opacity 150ms ease',
};

const selectedStyle: CSSProperties = {
  background: 'hsl(var(--primary))',
  borderColor: 'hsl(var(--primary))',
};

const checkPath = 'M3.5 7.5l2.5 2.5 6.5-6.5';

export function MultiSelectCheckbox({
  isSelected,
  onClick,
  disabled = false,
  alwaysVisible = false,
  ariaLabel,
  className,
  style,
}: MultiSelectCheckboxProps): ReactElement {
  const merged: CSSProperties = {
    ...baseStyle,
    ...(isSelected ? selectedStyle : null),
    ...(alwaysVisible || isSelected ? { opacity: 1 } : null),
    ...(disabled ? { opacity: 0.45, cursor: 'not-allowed' } : null),
    ...(style || null),
  };

  // When alwaysVisible is false and the row isn't selected, defer the
  // hover-reveal to the parent — consumers wrap the checkbox in a `.group`
  // hover scope and pass `data-notis-hover-reveal` styles via className.
  // Out of the box, we render the checkbox at full opacity if selected,
  // otherwise inherit the parent's reveal state.
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isSelected}
      disabled={disabled}
      aria-label={ariaLabel ?? (isSelected ? 'Deselect item' : 'Select item')}
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      data-notis-multiselect-checkbox=""
      data-selected={isSelected ? 'true' : 'false'}
      className={className}
      style={merged}
    >
      {isSelected ? (
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          focusable="false"
        >
          <path d={checkPath} />
        </svg>
      ) : null}
    </button>
  );
}
