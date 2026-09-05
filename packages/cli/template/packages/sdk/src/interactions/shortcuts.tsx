'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ShortcutScope = 'app' | 'route' | 'collection' | 'detail' | 'modal';

export const SHORTCUT_SCOPE_PRIORITY: Record<ShortcutScope, number> = {
  app: 0,
  route: 100,
  collection: 200,
  detail: 300,
  modal: 400,
};

export interface ShortcutDefinition {
  id: string;
  /** A chord (`Mod+A`) or timed sequence (`G I`). */
  keys: string | string[];
  label?: string;
  enabled?: boolean;
  allowInEditable?: boolean;
  allowRepeat?: boolean;
  preventDefault?: boolean;
  stopPropagation?: boolean;
  onTrigger: (event: KeyboardEvent) => void | Promise<void>;
}

export interface UseShortcutsOptions {
  enabled?: boolean;
  scope?: ShortcutScope;
  /** Added to the scope priority for local precedence within a scope. */
  priority?: number;
  sequenceTimeoutMs?: number;
  /** Internal owner used to route collection shortcuts to the last interacted collection. */
  collectionOwnerId?: string;
}

interface ShortcutRegistration {
  id: number;
  order: number;
  scope: ShortcutScope;
  priority: number;
  enabled: boolean;
  sequenceTimeoutMs: number;
  collectionOwnerId?: string;
  getShortcuts: () => ShortcutDefinition[];
}

interface ShortcutRegistry {
  register: (registration: Omit<ShortcutRegistration, 'id' | 'order'>) => () => void;
}

const SHORTCUT_CONTEXT_SYMBOL = Symbol.for('notis.sdk.shortcut_context');
type ShortcutContextGlobal = typeof globalThis & {
  [SHORTCUT_CONTEXT_SYMBOL]?: React.Context<ShortcutRegistry | null>;
};

function getShortcutContext(): React.Context<ShortcutRegistry | null> {
  const scope = globalThis as ShortcutContextGlobal;
  if (!scope[SHORTCUT_CONTEXT_SYMBOL]) {
    scope[SHORTCUT_CONTEXT_SYMBOL] = createContext<ShortcutRegistry | null>(null);
  }
  return scope[SHORTCUT_CONTEXT_SYMBOL]!;
}

const ShortcutContext = getShortcutContext();

const SHORTCUT_COLLECTION_STATE_SYMBOL = Symbol.for('notis.sdk.shortcut_collection_state');
type ShortcutCollectionGlobal = typeof globalThis & {
  [SHORTCUT_COLLECTION_STATE_SYMBOL]?: { activeOwnerId: string | null; nextOwnerId: number };
};

function getShortcutCollectionState() {
  const scope = globalThis as ShortcutCollectionGlobal;
  if (!scope[SHORTCUT_COLLECTION_STATE_SYMBOL]) {
    scope[SHORTCUT_COLLECTION_STATE_SYMBOL] = { activeOwnerId: null, nextOwnerId: 1 };
  }
  return scope[SHORTCUT_COLLECTION_STATE_SYMBOL]!;
}

export function createShortcutCollectionOwner(): string {
  const state = getShortcutCollectionState();
  return `collection-${state.nextOwnerId++}`;
}

export function activateShortcutCollection(ownerId: string): void {
  getShortcutCollectionState().activeOwnerId = ownerId;
}

interface ParsedChord {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

interface ParsedShortcut {
  definition: ShortcutDefinition;
  sequence: ParsedChord[];
}

interface SequenceState {
  chords: string[];
  at: number;
}

function normalizeKey(key: string): string {
  const lower = key.trim().toLowerCase();
  if (lower === 'esc') return 'escape';
  if (lower === 'return') return 'enter';
  if (lower === 'space') return ' ';
  if (lower === 'arrowup' || lower === 'up') return 'arrowup';
  if (lower === 'arrowdown' || lower === 'down') return 'arrowdown';
  if (lower === 'arrowleft' || lower === 'left') return 'arrowleft';
  if (lower === 'arrowright' || lower === 'right') return 'arrowright';
  return lower;
}

function parseChord(raw: string): ParsedChord | null {
  const parts = raw.split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  let key = '';
  let mod = false;
  let shift = false;
  let alt = false;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'mod' || lower === 'cmd' || lower === 'ctrl' || lower === 'meta') {
      mod = true;
    } else if (lower === 'shift') {
      shift = true;
    } else if (lower === 'alt' || lower === 'option') {
      alt = true;
    } else {
      key = normalizeKey(part);
    }
  }
  return key ? { key, mod, shift, alt } : null;
}

function parseShortcut(definition: ShortcutDefinition): ParsedShortcut[] {
  const values = Array.isArray(definition.keys) ? definition.keys : [definition.keys];
  return values.flatMap((value) => {
    const sequence = value
      .trim()
      .split(/\s+/)
      .map(parseChord)
      .filter((chord): chord is ParsedChord => chord !== null);
    return sequence.length > 0 ? [{ definition, sequence }] : [];
  });
}

function chordToken(chord: ParsedChord): string {
  return `${chord.mod ? 'm' : '-'}${chord.shift ? 's' : '-'}${chord.alt ? 'a' : '-'}:${chord.key}`;
}

function eventChord(event: KeyboardEvent): ParsedChord {
  let key = normalizeKey(event.key);
  let shift = event.shiftKey;
  if (key === '3' && shift) key = '#';
  if (key === '#' || key === '?') shift = false;
  return {
    key,
    mod: Boolean(event.metaKey || event.ctrlKey),
    shift,
    alt: event.altKey,
  };
}

export function isEditableShortcutEvent(event: Event): boolean {
  const path = event.composedPath?.() ?? [event.target];
  return path.some((target) => {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') return true;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'SUMMARY') {
      return true;
    }
    if (tag === 'A' && target.hasAttribute('href')) return true;
    return ['button', 'link', 'menuitem', 'switch', 'tab'].includes(
      target.getAttribute('role') || '',
    );
  });
}

function matchPrefix(tokens: string[], candidate: ParsedShortcut): boolean {
  if (tokens.length > candidate.sequence.length) return false;
  return tokens.every((token, index) => token === chordToken(candidate.sequence[index]!));
}

function consumeShortcut(event: KeyboardEvent, definition: ShortcutDefinition): void {
  if (definition.preventDefault !== false) event.preventDefault();
  if (definition.stopPropagation !== false) {
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }
  void definition.onTrigger(event);
}

export function ShortcutProvider({ children }: { children: ReactNode }) {
  const parentRegistry = useContext(ShortcutContext);
  if (parentRegistry) return <>{children}</>;
  return <ShortcutProviderRoot>{children}</ShortcutProviderRoot>;
}

export interface ShortcutHelpEntry {
  id: string;
  keys: string[];
  label: string;
  scope: ShortcutScope;
}

const HELP_SCOPE_LABELS: Record<ShortcutScope, string> = {
  modal: 'Dialog',
  detail: 'Detail',
  collection: 'Collection',
  route: 'This view',
  app: 'App',
};

const HELP_SCOPE_ORDER: ShortcutScope[] = ['modal', 'detail', 'collection', 'route', 'app'];

function applicableRegistrations(
  registrations: Iterable<ShortcutRegistration>,
): ShortcutRegistration[] {
  const ordered = Array.from(registrations)
    .filter((registration) => registration.enabled)
    .sort((a, b) => b.priority - a.priority || b.order - a.order);
  const activeCollectionOwner = getShortcutCollectionState().activeOwnerId;
  const hasActiveCollection = Boolean(
    activeCollectionOwner
    && ordered.some((registration) => registration.collectionOwnerId === activeCollectionOwner),
  );
  return hasActiveCollection
    ? ordered.filter(
        (registration) => !registration.collectionOwnerId
          || registration.collectionOwnerId === activeCollectionOwner,
      )
    : ordered;
}

function shortcutToken(raw: string): string | null {
  const definition: ShortcutDefinition = { id: '', keys: raw, onTrigger: () => undefined };
  const parsed = parseShortcut(definition)[0];
  return parsed ? parsed.sequence.map(chordToken).join(' ') : null;
}

function collectShortcutHelpEntries(
  registrations: Iterable<ShortcutRegistration>,
): ShortcutHelpEntry[] {
  const claimed = new Set<string>();
  const entries: ShortcutHelpEntry[] = [];
  for (const registration of applicableRegistrations(registrations)) {
    for (const shortcut of registration.getShortcuts()) {
      if (shortcut.enabled === false || !shortcut.label) continue;
      const values = Array.isArray(shortcut.keys) ? shortcut.keys : [shortcut.keys];
      const keys = values.filter((value) => {
        const token = shortcutToken(value);
        if (!token || claimed.has(token)) return false;
        claimed.add(token);
        return true;
      });
      if (keys.length > 0) {
        entries.push({ id: shortcut.id, keys, label: shortcut.label, scope: registration.scope });
      }
    }
  }
  return entries;
}

function ShortcutProviderRoot({ children }: { children: ReactNode }) {
  const registrationsRef = useRef(new Map<number, ShortcutRegistration>());
  const nextIdRef = useRef(1);
  const nextOrderRef = useRef(1);
  const sequenceRef = useRef<SequenceState>({ chords: [], at: 0 });
  const [helpOpen, setHelpOpen] = useState(false);
  const helpOpenRef = useRef(false);
  const [, setRegistryVersion] = useState(0);

  const updateHelpOpen = useCallback((open: boolean) => {
    helpOpenRef.current = open;
    setHelpOpen(open);
  }, []);

  const register = useCallback((input: Omit<ShortcutRegistration, 'id' | 'order'>) => {
    const id = nextIdRef.current++;
    registrationsRef.current.set(id, {
      ...input,
      id,
      order: nextOrderRef.current++,
    });
    if (helpOpenRef.current) setRegistryVersion((version) => version + 1);
    return () => {
      registrationsRef.current.delete(id);
      if (helpOpenRef.current) setRegistryVersion((version) => version + 1);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const editable = isEditableShortcutEvent(event);
      if (!editable && !event.repeat && event.key === '?' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        updateHelpOpen(!helpOpenRef.current);
        return;
      }
      if (helpOpenRef.current) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          updateHelpOpen(false);
        }
        return;
      }

      const registrations = applicableRegistrations(registrationsRef.current.values());
      if (registrations.length === 0) return;
      const token = chordToken(eventChord(event));
      const now = Date.now();

      for (const registration of registrations) {
        const candidates = registration.getShortcuts()
          .filter((shortcut) => shortcut.enabled !== false)
          .filter((shortcut) => !editable || shortcut.allowInEditable)
          .filter((shortcut) => !event.repeat || shortcut.allowRepeat)
          .flatMap(parseShortcut);
        if (candidates.length === 0) continue;

        const previous = now - sequenceRef.current.at <= registration.sequenceTimeoutMs
          ? sequenceRef.current.chords
          : [];
        const attempts = previous.length > 0 ? [[...previous, token], [token]] : [[token]];

        for (const attempt of attempts) {
          const matches = candidates.filter((candidate) => matchPrefix(attempt, candidate));
          if (matches.length === 0) continue;
          const exact = matches.find((candidate) => candidate.sequence.length === attempt.length);
          const hasLonger = matches.some((candidate) => candidate.sequence.length > attempt.length);
          if (exact && !hasLonger) {
            sequenceRef.current = { chords: [], at: 0 };
            consumeShortcut(event, exact.definition);
            return;
          }
          sequenceRef.current = { chords: attempt, at: now };
          event.preventDefault();
          return;
        }
      }

      sequenceRef.current = { chords: [], at: 0 };
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [updateHelpOpen]);

  const registry = useMemo<ShortcutRegistry>(() => ({ register }), [register]);
  const helpEntries = helpOpen ? collectShortcutHelpEntries(registrationsRef.current.values()) : [];
  return (
    <ShortcutContext.Provider value={registry}>
      {children}
      {helpOpen ? <ShortcutHelpDialog entries={helpEntries} onClose={() => updateHelpOpen(false)} /> : null}
    </ShortcutContext.Provider>
  );
}

function ShortcutHelpDialog({
  entries,
  onClose,
}: {
  entries: ShortcutHelpEntry[];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    return () => previousFocusRef.current?.focus({ preventScroll: true });
  }, []);
  const grouped = HELP_SCOPE_ORDER.map((scope) => ({
    scope,
    entries: entries.filter((entry) => entry.scope === scope),
  })).filter((group) => group.entries.length > 0);

  return (
    <div
      role="presentation"
      data-notis-shortcut-help-backdrop=""
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={helpBackdropStyle}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="notis-shortcut-help-title"
        data-notis-shortcut-help=""
        onKeyDown={(event) => {
          // The help surface has one interactive control. Keep keyboard focus
          // in the modal instead of allowing Tab to escape into app chrome.
          if (event.key === 'Tab') {
            event.preventDefault();
            closeRef.current?.focus({ preventScroll: true });
          }
        }}
        style={helpDialogStyle}
      >
        <header style={helpHeaderStyle}>
          <div>
            <h2 id="notis-shortcut-help-title" style={helpTitleStyle}>Keyboard shortcuts</h2>
            <p style={helpSubtitleStyle}>Available in this view</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close keyboard shortcuts"
            onClick={onClose}
            style={helpCloseStyle}
          >
            Esc
          </button>
        </header>
        <div style={helpBodyStyle}>
          {grouped.map((group) => (
            <section key={group.scope} aria-label={HELP_SCOPE_LABELS[group.scope]}>
              <h3 style={helpGroupTitleStyle}>{HELP_SCOPE_LABELS[group.scope]}</h3>
              <div style={helpListStyle}>
                {group.entries.map((entry) => (
                  <div key={`${group.scope}:${entry.id}`} style={helpRowStyle}>
                    <span>{entry.label}</span>
                    <span style={helpKeysStyle}>
                      {entry.keys.map((keys) => (
                        <kbd key={keys} style={helpKeyStyle}>{shortcutDisplay(keys)}</kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
          <section aria-label="Help">
            <h3 style={helpGroupTitleStyle}>Help</h3>
            <div style={helpListStyle}>
              <div style={helpRowStyle}>
                <span>Show keyboard shortcuts</span>
                <kbd style={helpKeyStyle}>?</kbd>
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

const helpBackdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'grid',
  placeItems: 'center',
  padding: '1.5rem',
  background: 'rgba(0, 0, 0, 0.42)',
  backdropFilter: 'blur(3px)',
};

const helpDialogStyle: React.CSSProperties = {
  width: 'min(34rem, 100%)',
  maxHeight: 'min(42rem, calc(100dvh - 3rem))',
  overflow: 'hidden',
  border: '1px solid hsl(var(--border))',
  borderRadius: '0.875rem',
  background: 'hsl(var(--background))',
  color: 'hsl(var(--foreground))',
  boxShadow: '0 24px 70px rgba(0, 0, 0, 0.28)',
  fontFamily: 'inherit',
};

const helpHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '1rem',
  padding: '1.25rem 1.25rem 1rem',
  borderBottom: '1px solid hsl(var(--border))',
};

const helpTitleStyle: React.CSSProperties = { margin: 0, fontSize: '1rem', fontWeight: 650 };
const helpSubtitleStyle: React.CSSProperties = {
  margin: '0.2rem 0 0',
  color: 'hsl(var(--muted-foreground))',
  fontSize: '0.75rem',
};
const helpCloseStyle: React.CSSProperties = {
  border: '1px solid hsl(var(--border))',
  borderRadius: '0.35rem',
  background: 'hsl(var(--muted))',
  color: 'hsl(var(--muted-foreground))',
  padding: '0.2rem 0.45rem',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: '0.7rem',
};
const helpBodyStyle: React.CSSProperties = {
  display: 'grid',
  gap: '1.1rem',
  maxHeight: 'calc(min(42rem, 100dvh - 3rem) - 5rem)',
  overflowY: 'auto',
  padding: '1rem 1.25rem 1.25rem',
};
const helpGroupTitleStyle: React.CSSProperties = {
  margin: '0 0 0.35rem',
  color: 'hsl(var(--muted-foreground))',
  fontSize: '0.68rem',
  fontWeight: 650,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};
const helpListStyle: React.CSSProperties = { display: 'grid' };
const helpRowStyle: React.CSSProperties = {
  display: 'flex',
  minHeight: '2rem',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
  borderBottom: '1px solid color-mix(in srgb, hsl(var(--border)) 65%, transparent)',
  fontSize: '0.8rem',
};
const helpKeysStyle: React.CSSProperties = {
  display: 'inline-flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: '0.3rem',
};
const helpKeyStyle: React.CSSProperties = {
  minWidth: '1.6rem',
  border: '1px solid hsl(var(--border))',
  borderBottomWidth: '2px',
  borderRadius: '0.35rem',
  background: 'hsl(var(--muted))',
  color: 'hsl(var(--foreground))',
  padding: '0.15rem 0.4rem',
  textAlign: 'center',
  font: 'inherit',
  fontSize: '0.72rem',
};

export function useShortcuts(
  shortcuts: ShortcutDefinition[],
  options: UseShortcutsOptions = {},
): void {
  const registry = useContext(ShortcutContext);
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;
  const {
    enabled = true,
    scope = 'route',
    priority = 0,
    sequenceTimeoutMs = 1500,
    collectionOwnerId,
  } = options;

  useEffect(() => {
    if (!registry || !enabled) return;
    return registry.register({
      enabled,
      scope,
      priority: SHORTCUT_SCOPE_PRIORITY[scope] + priority,
      sequenceTimeoutMs,
      collectionOwnerId,
      getShortcuts: () => shortcutsRef.current,
    });
  }, [collectionOwnerId, enabled, priority, registry, scope, sequenceTimeoutMs]);

  // Compatibility fallback for SDK components rendered outside a provider.
  useEffect(() => {
    if (registry || !enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableShortcutEvent(event)) return;
      const token = chordToken(eventChord(event));
      for (const shortcut of shortcutsRef.current) {
        if (shortcut.enabled === false || event.repeat && !shortcut.allowRepeat) continue;
        const match = parseShortcut(shortcut).find(
          (candidate) => candidate.sequence.length === 1 && chordToken(candidate.sequence[0]!) === token,
        );
        if (match) {
          consumeShortcut(event, shortcut);
          return;
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [enabled, registry]);
}

export function shortcutDisplay(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((chord) => chord
      .split('+')
      .map((part) => {
        const lower = part.toLowerCase();
        if (lower === 'mod' || lower === 'cmd' || lower === 'meta') return '⌘';
        if (lower === 'ctrl') return '⌃';
        if (lower === 'shift') return '⇧';
        if (lower === 'alt' || lower === 'option') return '⌥';
        if (lower === 'arrowup' || lower === 'up') return '↑';
        if (lower === 'arrowdown' || lower === 'down') return '↓';
        if (lower === 'arrowleft' || lower === 'left') return '←';
        if (lower === 'arrowright' || lower === 'right') return '→';
        return part.length === 1 ? part.toUpperCase() : part;
      })
      .join(''))
    .join(' ');
}
