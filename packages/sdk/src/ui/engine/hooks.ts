/**
 * React hooks of the keyboard engine (toolkit spec 2.1). Every hook works without a mounted `<KeyboardEngine>`
 * (unit tests, a bare preview): registrations land in the shared core, which listens only once an engine mounts or
 * `core.attach(document)` is called, and settings fall back to the document language and the browser platform.
 */

import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { keyList, type Locale, type Platform } from '../../words';
import { ESCAPE_PRIORITY, detectLocale, detectPlatform, type KeyboardEngineCore } from './core';
import { getSharedInstance } from './instance';
import type { EngineSettings, OwnerKind, ScopeHandle, ShortcutDef } from './types';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** The engine core in effect here: an injected one, else the shared one. */
export function useEngineCore(): KeyboardEngineCore {
  const shared = getSharedInstance();
  return useContext(shared.EngineContext) ?? shared.core;
}

/** The owner shortcuts register under: the nearest `<ShortcutScope>`, else 'notis'. */
export function useShortcutOwner(): string {
  return useContext(getSharedInstance().OwnerContext);
}

function useSetting<V>(read: (core: KeyboardEngineCore) => V): V {
  const core = useEngineCore();
  const getSnapshot = () => read(core);
  return useSyncExternalStore(useCallback((listener) => core.subscribe(listener), [core]), getSnapshot, getSnapshot);
}

/** Toolkit language. Without a mounted engine: the document's `lang` ('fr...' gives 'fr', else 'en'). */
export function useToolkitLocale(): Locale {
  return useSetting((core) => (core.mounted > 0 ? core.settings.locale : detectLocale()));
}

/** 'mac' or 'other'. Without a mounted engine: detected from the browser. */
export function useToolkitPlatform(): Platform {
  return useSetting((core) => (core.mounted > 0 ? core.settings.platform : detectPlatform()));
}

/** Host, locale, platform and strict mode. */
export function useToolkitSettings(): Readonly<EngineSettings> {
  const locale = useToolkitLocale();
  const platform = useToolkitPlatform();
  const core = useEngineCore();
  const host = useSetting((c) => c.settings.host);
  const strict = useSetting((c) => c.settings.strict);
  return { host, locale, platform, strict, onClash: core.settings.onClash };
}

// ---- shortcuts ----

function defKey(def: ShortcutDef, owner: string): string {
  return JSON.stringify([
    def.id, keyList(def.keys), def.scope, def.owner ?? owner, def.group ?? '', !!def.hidden, !!def.repeat,
    !!def.allowInFields, def.boost ?? 0, def.label.en, def.label.fr,
  ]);
}

/** A def whose `run` and `when` always read the latest render's def, so handlers never go stale. */
function liveDef(ref: { readonly current: ShortcutDef }): ShortcutDef {
  const def = ref.current;
  return {
    ...def,
    when: () => { const when = ref.current.when; return when ? when() : true; },
    run: (event) => ref.current.run(event),
  };
}

/**
 * Registers one shortcut while mounted. Re-registers only when its id, keys, scope, owner, words or flags change
 * (or `deps` change); `run` and `when` are read live.
 */
export function useShortcut(def: ShortcutDef, deps: readonly unknown[] = []): void {
  const core = useEngineCore();
  const owner = useShortcutOwner();
  const ref = useRef(def);
  ref.current = def;
  const key = defKey(def, owner);
  useEffect(() => {
    const unregister = core.register(liveDef(ref), ref.current.owner ?? owner);
    return () => { unregister?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, owner, key, ...deps]);
}

/** Registers several shortcuts while mounted (same rules as `useShortcut`). */
export function useShortcuts(defs: readonly ShortcutDef[], deps: readonly unknown[] = []): void {
  const core = useEngineCore();
  const owner = useShortcutOwner();
  const ref = useRef(defs);
  ref.current = defs;
  const key = defs.map((def) => defKey(def, owner)).join('\n');
  useEffect(() => {
    const unregisters = ref.current.map((def, index) => {
      const live = { get current() { return ref.current[index] ?? def; } };
      return core.register(liveDef(live), def.owner ?? owner);
    });
    return () => { for (const unregister of unregisters) unregister?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, owner, key, ...deps]);
}

// ---- owners ----

export interface ShortcutScopeOptions {
  /** False for a hidden retained view or a Space in the background: all its shortcuts go silent. */
  available: boolean;
  /** 'space' (default under the root) for Space code, 'host' for Notis pages. Inherited from the parent owner. */
  kind?: OwnerKind;
}

/**
 * Declares a Space or a retained view as an owner, nested under the current owner. Its shortcuts are those
 * registered under a `<ShortcutScope owner>` with the same id (or with `def.owner`).
 */
export function useShortcutScope(owner: string, options: ShortcutScopeOptions): ScopeHandle {
  const core = useEngineCore();
  const parent = useShortcutOwner();
  const { available, kind } = options;
  const availableRef = useRef(available);
  availableRef.current = available;
  // Layout effect: owners exist before their children's shortcuts register (passive effects).
  useIsoLayoutEffect(
    () => core.defineOwner(owner, { parent, kind, available: availableRef.current }),
    [core, owner, parent, kind],
  );
  useIsoLayoutEffect(() => { core.setOwnerAvailable(owner, available); }, [core, owner, available]);
  return { owner, available, isAvailable: () => core.isOwnerAvailable(owner) };
}

// ---- escape ----

export interface EscapeLayerOptions {
  /** Chain position (ESCAPE_PRIORITY). Default overlay. */
  priority?: number;
  /** False keeps the hook mounted without a layer. Default true. */
  enabled?: boolean;
}

/**
 * Adds a step to the Escape chain while mounted. `onEscape` returns true when it handled the key (the chain
 * stops), false to let the next step run. Higher priority runs first; the latest wins within a priority. It gets the
 * keydown when a key press runs the chain (none from `runEscapeChain()` without an event).
 */
export function useEscapeLayer(id: string, onEscape: (event?: KeyboardEvent) => boolean,
  options: EscapeLayerOptions = {}): void {
  const core = useEngineCore();
  const owner = useShortcutOwner();
  const ref = useRef(onEscape);
  ref.current = onEscape;
  const priority = options.priority ?? ESCAPE_PRIORITY.overlay;
  const enabled = options.enabled ?? true;
  useEffect(() => {
    if (!enabled) return undefined;
    return core.addEscapeLayer(id, (event) => core.isOwnerAvailable(owner) && ref.current(event), priority);
  }, [core, owner, id, priority, enabled]);
}

/**
 * Stops the Escape chain below `priority` while `active` (the composer holds text). Default priority sits between
 * the detail panel and selection clear, so Escape still clears a selection but never leaves the page.
 */
export function useEscapeBlocker(active: boolean, options: { priority?: number } = {}): void {
  const core = useEngineCore();
  const owner = useShortcutOwner();
  const priority = options.priority ?? ESCAPE_PRIORITY.detail + 50;
  useEffect(() => (active ? core.addEscapeBlocker(priority, () => core.isOwnerAvailable(owner)) : undefined), [core, owner, active, priority]);
}

// ---- help sheet ----

export interface HelpSheetControls {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen: boolean;
}

export function useHelpSheet(): HelpSheetControls {
  const core = useEngineCore();
  const isOpen = useSetting((c) => c.isHelpOpen());
  return {
    open: useCallback(() => core.openHelp(), [core]),
    close: useCallback(() => core.closeHelp(), [core]),
    toggle: useCallback(() => core.toggleHelp(), [core]),
    isOpen,
  };
}

/** Re-renders on every registry change (the help sheet, dev overlays). */
export function useRegistryVersion(): number {
  return useSetting((core) => core.getVersion());
}
