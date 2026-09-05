'use client';

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import type { ResolvedCollectionAction } from '../interactions/actions';
import { shortcutDisplay, useShortcuts, type ShortcutDefinition } from '../interactions/shortcuts';
import type { ShortcutScope } from '../interactions/shortcuts';

export type MultiSelectAction = ResolvedCollectionAction;

export interface MultiSelectActionBarProps {
  selectedCount: number;
  actions: MultiSelectAction[];
  /** Override the "{count} selected" label units. Default: "selected" with no item word. */
  itemLabel?: { singular: string; plural: string };
  /** Optional extra class on the outer container (composed alongside the inline styles). */
  className?: string;
  /** Optional override for the bar's positioning style. Defaults to bottom-center floating. */
  style?: CSSProperties;
  /** Disable action key bindings while leaving the visible toolbar mounted. */
  shortcutsEnabled?: boolean;
  /** Override the default collection shortcut scope. */
  shortcutScope?: ShortcutScope;
}

const containerBaseStyle: CSSProperties = {
  position: 'fixed',
  bottom: 'calc(var(--notis-viewport-bottom, 0px) + max(1rem, var(--notis-safe-area-bottom, env(safe-area-inset-bottom, 0px))))',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 60,
  display: 'flex',
  alignItems: 'center',
  gap: '0.25rem',
  padding: '0.375rem 0.5rem',
  borderRadius: '0.5rem',
  background: 'color-mix(in srgb, hsl(var(--foreground)) 95%, transparent)',
  color: 'hsl(var(--background))',
  boxShadow: '0 10px 25px -10px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.08)',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  pointerEvents: 'auto',
  fontSize: '13px',
  lineHeight: 1.2,
  width: 'max-content',
  maxWidth: 'calc(100% - 2rem)',
};

const countStyle: CSSProperties = {
  flexShrink: 0,
  padding: '0 0.5rem',
  fontSize: '12px',
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  color: 'color-mix(in srgb, hsl(var(--background)) 70%, transparent)',
};

const dividerStyle: CSSProperties = {
  width: '1px',
  height: '1rem',
  margin: '0 0.125rem',
  background: 'color-mix(in srgb, hsl(var(--background)) 20%, transparent)',
};

const baseButtonStyle: CSSProperties = {
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.375rem',
  padding: '0.25rem 0.5rem',
  border: 0,
  background: 'transparent',
  color: 'color-mix(in srgb, hsl(var(--background)) 90%, transparent)',
  borderRadius: '0.375rem',
  cursor: 'pointer',
  fontSize: '13px',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  transition: 'background-color 120ms ease, color 120ms ease',
};

const keycapStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: '20px',
  height: '20px',
  padding: '0 4px',
  borderRadius: '4px',
  border: '1px solid color-mix(in srgb, hsl(var(--background)) 20%, transparent)',
  background: 'color-mix(in srgb, hsl(var(--background)) 15%, transparent)',
  color: 'inherit',
  fontSize: '11px',
  fontWeight: 500,
  lineHeight: 1,
  fontFamily: 'inherit',
};

const iconSlotStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  opacity: 0.8,
};

export function MultiSelectActionBar({
  selectedCount,
  actions,
  itemLabel,
  className,
  style,
  shortcutsEnabled = true,
  shortcutScope = 'collection',
}: MultiSelectActionBarProps): ReactElement | null {
  const barRef = useRef<HTMLDivElement>(null);
  const visible = selectedCount > 0;
  useEffect(() => {
    const bar = barRef.current;
    if (!visible || !bar) return;
    // Also reaches a Portal launcher when an app renders inside a shadow root.
    const root = document.documentElement;
    const property = '--notis-bulk-actions-height';
    const previous = root.style.getPropertyValue(property);
    const update = () => root.style.setProperty(property, `${bar.getBoundingClientRect().height + 12}px`);
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      if (previous) root.style.setProperty(property, previous);
      else root.style.removeProperty(property);
    };
  }, [visible]);

  const actionShortcuts = useMemo<ShortcutDefinition[]>(() => {
    return actions.flatMap((action): ShortcutDefinition[] => {
        if (!action.shortcut || action.disabled || action.pending) return [];
        return [{
          id: `collection.action.${action.id}`,
          keys: action.shortcut,
          label: action.label,
          onTrigger: () => action.onRun(),
        }];
      });
  }, [actions]);
  useShortcuts(actionShortcuts, {
    enabled: shortcutsEnabled && selectedCount > 0,
    scope: shortcutScope,
    priority: 25,
  });

  if (selectedCount === 0) return null;

  const countWord = itemLabel
    ? selectedCount === 1
      ? itemLabel.singular
      : itemLabel.plural
    : 'selected';
  const countLabel = itemLabel
    ? `${selectedCount} ${countWord} selected`
    : `${selectedCount} selected`;

  const composedStyle: CSSProperties = { ...containerBaseStyle, ...(style || {}) };

  return (
    <div
      ref={barRef}
      data-notis-bulk-actions
      role="toolbar"
      aria-label={`Bulk actions for ${selectedCount} selected ${countWord}`}
      className={className}
      style={composedStyle}
    >
      <style>{`
        [data-notis-bulk-action-icon][data-has-shortcut] { display: none !important; }
        @media (max-width: 639px) {
          [data-notis-bulk-actions] { flex-wrap: wrap; width: calc(100% - 2rem) !important; }
          [data-notis-bulk-count] { flex-basis: 100%; padding: 0.375rem 0.5rem !important; font-size: 14px !important; }
          [data-notis-bulk-divider] { display: none; }
          [data-notis-bulk-action-list] { width: 100%; }
          [data-notis-bulk-actions] button { min-height: 48px; font-size: 16px !important; }
          [data-notis-bulk-actions] kbd { display: none !important; }
          [data-notis-bulk-action-icon][data-has-shortcut] { display: inline-flex !important; }
        }
        @media (hover: none) { [data-notis-bulk-actions] kbd { display: none !important; } }
      `}</style>
      <span data-notis-bulk-count style={countStyle}>{countLabel}</span>
      {actions.length > 0 ? <span data-notis-bulk-divider aria-hidden style={dividerStyle} /> : null}
      <div data-notis-bulk-action-list style={{ display: 'flex', minWidth: 0, overflowX: 'auto', overscrollBehaviorX: 'contain', gap: '0.25rem' }}>
        {actions.map((action) => (
          <ActionButton key={action.id} action={action} />
        ))}
      </div>
    </div>
  );
}

function ActionButton({ action }: { action: MultiSelectAction }) {
  const [hover, setHover] = useState(false);
  const display = action.shortcut ? shortcutDisplay(action.shortcut) : null;
  const buttonStyle: CSSProperties = {
    ...baseButtonStyle,
    background: hover
      ? 'color-mix(in srgb, hsl(var(--background)) 12%, transparent)'
      : 'transparent',
    color: hover
      ? 'hsl(var(--background))'
      : baseButtonStyle.color,
    opacity: action.disabled ? 0.45 : 1,
    cursor: action.disabled || action.pending ? 'not-allowed' : 'pointer',
  };

  return (
    <button
      type="button"
      onClick={() => {
        if (!action.disabled && !action.pending) void action.onRun();
      }}
      disabled={action.disabled || action.pending}
      aria-busy={action.pending || undefined}
      aria-keyshortcuts={action.shortcut || undefined}
      data-destructive={action.destructive ? 'true' : 'false'}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={buttonStyle}
    >
      {action.icon ? (
        <span data-notis-bulk-action-icon data-has-shortcut={action.shortcut ? '' : undefined} aria-hidden style={iconSlotStyle}>{action.icon}</span>
      ) : null}
      {display ? <kbd aria-hidden style={keycapStyle}>{display}</kbd> : null}
      <span>{action.pending ? `${action.label}…` : action.label}</span>
    </button>
  );
}
