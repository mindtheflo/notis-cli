'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';

export interface MultiSelectAction {
  id: string;
  label: string;
  icon: ReactNode;
  /** Single-key (e.g. "E", "#") or "Mod+K" shortcut. Bound while the bar is mounted with count > 0. */
  shortcut?: string;
  onRun: () => void | Promise<void>;
  /** Hint for future destructive styling. Currently unused visually. */
  destructive?: boolean;
}

export interface MultiSelectActionBarProps {
  selectedCount: number;
  actions: MultiSelectAction[];
  /** Override the "{count} selected" label units. Default: "selected" with no item word. */
  itemLabel?: { singular: string; plural: string };
  /** Optional extra class on the outer container (composed alongside the inline styles). */
  className?: string;
  /** Optional override for the bar's positioning style. Defaults to bottom-center floating. */
  style?: CSSProperties;
}

interface ParsedShortcut {
  key: string;
  needsMod: boolean;
  needsShift: boolean;
}

function parseShortcut(raw: string): ParsedShortcut | null {
  const parts = raw.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  let needsMod = false;
  let needsShift = false;
  let key = '';
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'mod' || lower === 'cmd' || lower === 'ctrl' || lower === 'meta') {
      needsMod = true;
    } else if (lower === 'shift') {
      needsShift = true;
    } else {
      key = lower;
    }
  }
  if (!key) return null;
  return { key, needsMod, needsShift };
}

function shortcutMatches(shortcut: ParsedShortcut, event: KeyboardEvent): boolean {
  const eventKey = event.key.toLowerCase();
  // Special-case "#" so Shift+3 matches without the consumer specifying Shift.
  if (shortcut.key === '#') {
    if (eventKey === '#') return true;
    if (event.shiftKey && eventKey === '3') return true;
    return false;
  }
  if (eventKey !== shortcut.key) return false;
  if (shortcut.needsMod !== Boolean(event.metaKey || event.ctrlKey)) return false;
  if (shortcut.needsShift !== event.shiftKey) return false;
  if (event.altKey) return false;
  return true;
}

function isEditableEvent(event: Event): boolean {
  // Notis apps mount inside a Shadow DOM, so a document-level listener sees
  // `event.target` retargeted to the shadow host. `composedPath()[0]` pierces
  // the shadow boundary to the real focused element, so action-bar shortcuts
  // don't fire while the user is typing in an app input.
  const target = event.composedPath?.()[0] ?? event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function shortcutDisplay(raw: string): string {
  const parts = raw.split('+').map((p) => p.trim()).filter(Boolean);
  return parts
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'mod' || lower === 'cmd' || lower === 'meta') return '⌘';
      if (lower === 'ctrl') return '⌃';
      if (lower === 'shift') return '⇧';
      if (lower === 'alt' || lower === 'option') return '⌥';
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join('');
}

const containerBaseStyle: CSSProperties = {
  position: 'fixed',
  bottom: '1rem',
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
};

const countStyle: CSSProperties = {
  padding: '0 0.5rem',
  fontSize: '12px',
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
  color: 'color-mix(in srgb, hsl(var(--background)) 70%, transparent)',
};

const dividerStyle: CSSProperties = {
  width: '1px',
  height: '1rem',
  margin: '0 0.125rem',
  background: 'color-mix(in srgb, hsl(var(--background)) 20%, transparent)',
};

const baseButtonStyle: CSSProperties = {
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
}: MultiSelectActionBarProps): ReactElement | null {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const parsedShortcuts = useMemo(() => {
    return actions
      .map((action) => {
        if (!action.shortcut) return null;
        const parsed = parseShortcut(action.shortcut);
        return parsed ? { action, parsed } : null;
      })
      .filter((entry): entry is { action: MultiSelectAction; parsed: ParsedShortcut } => entry !== null);
  }, [actions]);

  useEffect(() => {
    if (selectedCount === 0 || parsedShortcuts.length === 0) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableEvent(event)) return;
      for (const { action, parsed } of parsedShortcuts) {
        if (shortcutMatches(parsed, event)) {
          event.preventDefault();
          event.stopPropagation();
          if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
          }
          void action.onRun();
          return;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [parsedShortcuts, selectedCount]);

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
      role="toolbar"
      aria-label={`Bulk actions for ${selectedCount} selected ${countWord}`}
      className={className}
      style={composedStyle}
    >
      <span style={countStyle}>{countLabel}</span>
      {actions.length > 0 ? <span aria-hidden style={dividerStyle} /> : null}
      {actions.map((action) => (
        <ActionButton key={action.id} action={action} />
      ))}
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
  };

  return (
    <button
      type="button"
      onClick={() => void action.onRun()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={buttonStyle}
    >
      <span aria-hidden style={iconSlotStyle}>{action.icon}</span>
      {display ? <kbd aria-hidden style={keycapStyle}>{display}</kbd> : null}
      <span>{action.label}</span>
    </button>
  );
}
