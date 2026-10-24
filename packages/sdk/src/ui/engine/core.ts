/**
 * The one keyboard listener (toolkit spec 2.1). Document capture phase; React handlers no longer own keys.
 * No React here: the React pieces (`KeyboardEngine`, hooks) drive one shared core.
 */

import { DEFAULT_KEYMAP, isModifierOnlyKey, matchChord, type Chord, type Locale, type Platform } from '../../words';
import {
  blocksShortcuts,
  eventTarget,
  fieldOwnsEscape,
  foreignFloatingLayers,
  hasOpenModal,
  isActivatable,
  keysOff,
  ownsArrows,
} from './dom';
import { ROOT_OWNER, ShortcutRegistry, safeWhen, type RegisteredShortcut } from './registry';
import type { EngineSettings, ShortcutDef } from './types';

/** Escape chain order, highest first: menus and dialogs, help sheet, selection clear, detail panel, route back. */
export const ESCAPE_PRIORITY = Object.freeze({
  route: 0,
  detail: 100,
  selection: 200,
  help: 300,
  overlay: 400,
});

export const SEQUENCE_TIMEOUT_MS = 1500;

interface EscapeLayerRecord { id: string; priority: number; onEscape: (event?: KeyboardEvent) => boolean; seq: number }
interface EscapeBlockerRecord { priority: number; seq: number; isActive?: () => boolean }
interface PendingSequence { candidates: Array<{ entry: RegisteredShortcut; chords: Chord[] }>; step: number; at: number }

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const name = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(name) ? 'mac' : 'other';
}

export function detectLocale(): Locale {
  if (typeof document === 'undefined') return 'en';
  // The page language set by the host on <html>.
  const lang = document.querySelector('html')?.getAttribute('lang') ?? '';
  return /^fr\b/i.test(lang) ? 'fr' : 'en';
}

// Bundlers replace only the literal `process.env.NODE_ENV`, so a production
// build drops a clashing shortcut instead of throwing and blanking the view.
// Where nothing replaces it and no `process` exists, stay strict.
export function defaultStrict(): boolean {
  try {
    return process.env.NODE_ENV !== 'production';
  } catch {
    return true;
  }
}

function consume(event: KeyboardEvent, immediate = false): void {
  event.preventDefault();
  if (immediate) event.stopImmediatePropagation();
  else event.stopPropagation();
}

function isUnmodifiedEscape(event: KeyboardEvent): boolean {
  return event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}

export class KeyboardEngineCore {
  readonly registry: ShortcutRegistry;
  settings: EngineSettings;
  /** Mounted `<KeyboardEngine>` count. With none, settings hooks fall back to the document (lang). */
  mounted = 0;
  /** Clock, replaceable in tests. */
  now: () => number = () => Date.now();

  private layers: EscapeLayerRecord[] = [];
  private blockers: EscapeBlockerRecord[] = [];
  private seq = 0;
  private held = new Set<string>();
  private pending: PendingSequence | null = null;
  private attached = new Map<Document, { refs: number; detach: () => void }>();
  private helpOpen = false;
  private helpUnregister: (() => void) | null = null;
  private forcedRepeat = new WeakSet<KeyboardEvent>();

  constructor(settings: Partial<EngineSettings> = {}) {
    this.settings = {
      host: settings.host ?? 'portal',
      locale: settings.locale ?? detectLocale(),
      platform: settings.platform ?? detectPlatform(),
      strict: settings.strict ?? defaultStrict(),
      onClash: settings.onClash,
    };
    this.registry = new ShortcutRegistry({ strict: this.settings.strict, onClash: this.settings.onClash });
  }

  /** Updates settings. Returns true when one changed; listeners hear it unless `silent` (during a React render). */
  configure(settings: Partial<EngineSettings>, options: { silent?: boolean } = {}): boolean {
    const next = { ...this.settings };
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined) (next as Record<string, unknown>)[key] = value;
    }
    const changed = (Object.keys(next) as Array<keyof EngineSettings>).some((key) => next[key] !== this.settings[key]);
    this.settings = next;
    this.registry.options = { strict: next.strict, onClash: next.onClash };
    if (changed && !options.silent) this.registry.notify();
    return changed;
  }

  subscribe(listener: () => void): () => void {
    return this.registry.subscribe(listener);
  }

  getVersion(): number {
    return this.registry.getVersion();
  }

  // ---- listeners ----

  /** Starts listening on a document. Ref counted; the last detach removes the listeners. */
  attach(doc: Document): () => void {
    const existing = this.attached.get(doc);
    if (existing) {
      existing.refs += 1;
    } else {
      const onKeyDown = (event: Event) => this.handleKeyDown(event as KeyboardEvent);
      const onKeyUp = (event: Event) => this.handleKeyUp(event as KeyboardEvent);
      const onReset = () => this.resetHeld();
      const onVisibility = () => { if (doc.visibilityState === 'hidden') this.resetHeld(); };
      doc.addEventListener('keydown', onKeyDown, true);
      doc.addEventListener('keyup', onKeyUp, true);
      doc.addEventListener('visibilitychange', onVisibility);
      doc.defaultView?.addEventListener('blur', onReset);
      this.attached.set(doc, {
        refs: 1,
        detach: () => {
          doc.removeEventListener('keydown', onKeyDown, true);
          doc.removeEventListener('keyup', onKeyUp, true);
          doc.removeEventListener('visibilitychange', onVisibility);
          doc.defaultView?.removeEventListener('blur', onReset);
        },
      });
    }
    this.ensureHelpShortcut();
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      const record = this.attached.get(doc);
      if (!record) return;
      record.refs -= 1;
      if (record.refs <= 0) {
        record.detach();
        this.attached.delete(doc);
      }
    };
  }

  isAttached(doc: Document): boolean {
    return this.attached.has(doc);
  }

  /** The first document the engine listens on (the host page), or null before KeyboardEngine mounts. */
  attachedDocument(): Document | null {
    for (const doc of this.attached.keys()) return doc;
    return null;
  }

  private resetHeld(): void {
    this.held.clear();
    this.pending = null;
  }

  // ---- registration ----

  register(def: ShortcutDef, owner?: string): (() => void) | null {
    return this.registry.register(def, owner ?? def.owner ?? ROOT_OWNER);
  }

  defineOwner: ShortcutRegistry['defineOwner'] = (id, options) => this.registry.defineOwner(id, options);

  setOwnerAvailable(id: string, available: boolean): void {
    this.registry.setOwnerAvailable(id, available);
  }

  isOwnerAvailable(id: string): boolean {
    return this.registry.isOwnerAvailable(id);
  }

  // ---- escape chain ----

  addEscapeLayer(id: string, onEscape: (event?: KeyboardEvent) => boolean,
    priority: number = ESCAPE_PRIORITY.overlay): () => void {
    const layer: EscapeLayerRecord = { id, onEscape, priority, seq: ++this.seq };
    this.layers.push(layer);
    return () => {
      const index = this.layers.indexOf(layer);
      if (index !== -1) this.layers.splice(index, 1);
    };
  }

  addEscapeBlocker(priority: number = ESCAPE_PRIORITY.detail + 50, isActive?: () => boolean): () => void {
    const blocker: EscapeBlockerRecord = { priority, seq: ++this.seq, isActive };
    this.blockers.push(blocker);
    return () => {
      const index = this.blockers.indexOf(blocker);
      if (index !== -1) this.blockers.splice(index, 1);
    };
  }

  escapeLayerIds(): string[] {
    return this.sortedLayers().map((layer) => layer.id);
  }

  private sortedLayers(): EscapeLayerRecord[] {
    return [...this.layers].sort((a, b) => b.priority - a.priority || b.seq - a.seq);
  }

  /**
   * Runs the chain. True when a layer handled it. Called without an event by a Close button that means "Escape";
   * from a key press each layer gets the keydown.
   */
  runEscapeChain(event?: KeyboardEvent): boolean {
    const blockers = this.blockers.filter(blocker => !blocker.isActive || blocker.isActive());
    const top = blockers.reduce((max, blocker) => Math.max(max, blocker.priority), -Infinity);
    for (const layer of this.sortedLayers()) {
      if (layer.priority < top) return true;
      let handled = false;
      try { handled = layer.onEscape(event) === true; } catch (error) { reportError(error); handled = true; }
      if (handled) return true;
    }
    return blockers.length > 0;
  }

  // ---- help sheet ----

  isHelpOpen(): boolean {
    return this.helpOpen;
  }

  openHelp(): void {
    if (this.helpOpen) return;
    this.helpOpen = true;
    this.registry.notify();
  }

  closeHelp(): void {
    if (!this.helpOpen) return;
    this.helpOpen = false;
    this.registry.notify();
  }

  toggleHelp(): void {
    if (this.helpOpen) this.closeHelp(); else this.openHelp();
  }

  private ensureHelpShortcut(): void {
    if (this.helpUnregister) return;
    const entry = DEFAULT_KEYMAP['host.help'];
    this.helpUnregister = this.registry.register({
      id: entry.id,
      keys: [...entry.keys],
      scope: 'app',
      label: entry.label,
      group: 'notis',
      run: () => { this.toggleHelp(); },
    }, ROOT_OWNER);
  }

  // ---- dispatch ----

  /** True for a key repeat, including a press of a key that is still held (some hosts drop `event.repeat`). */
  isRepeat(event: KeyboardEvent): boolean {
    return event.repeat || this.forcedRepeat.has(event);
  }

  handleKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Meta') {
      // A Mac sends no keyup for keys released while Cmd was down.
      this.held.clear();
      return;
    }
    this.held.delete(event.code || event.key);
  }

  handleKeyDown(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229) return;
    const key = event.key;
    if (!key || key === 'Dead' || key === 'Process' || isModifierOnlyKey(key)) return;
    const physical = event.code || key;
    const repeat = event.repeat || this.held.has(physical);
    if (!event.metaKey) this.held.add(physical);
    if (repeat && !event.repeat) {
      this.forcedRepeat.add(event);
      try { Object.defineProperty(event, 'repeat', { value: true, configurable: true }); } catch { /* read-only host */ }
    }

    const target = eventTarget(event);
    const doc = target?.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    if (!doc || keysOff(target)) return;

    if (isUnmodifiedEscape(event) && this.handleEscape(event, target, doc, repeat)) return;
    if (event.defaultPrevented) return;

    const lower = key.toLowerCase();
    // A button takes its own plain Enter and Space; Cmd+Enter (save) still reaches the shortcuts.
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    if (plain && (lower === 'enter' || lower === ' ') && isActivatable(target)) { this.pending = null; return; }
    if (lower.startsWith('arrow') && ownsArrows(target)) return;

    let modal: boolean | null = null;
    const isModal = () => (modal ??= hasOpenModal(doc, event));
    const { platform } = this.settings;

    const eligible = (entry: RegisteredShortcut): boolean => {
      const { def } = entry;
      if (repeat && !def.repeat) return false;
      if (isModal() && def.scope !== 'modal') return false;
      if (blocksShortcuts(target, { inFields: !!def.allowInFields, modal: def.scope === 'modal' })) return false;
      if (def.when && !safeWhen(def.when)) return false;
      return true;
    };

    // A sequence in progress ('g' then 'i').
    const pending = this.pending;
    this.pending = null;
    if (pending && !repeat && this.now() - pending.at <= SEQUENCE_TIMEOUT_MS) {
      const next = pending.candidates.filter(({ entry, chords }) =>
        matchChord(event, chords[pending.step]!, platform) && this.registry.all().includes(entry) && eligible(entry));
      if (next.length) {
        const done = next.filter(({ chords }) => chords.length === pending.step + 1);
        for (const { entry } of done) {
          if (this.run(entry, event)) { consume(event); return; }
        }
        const longer = next.filter(({ chords }) => chords.length > pending.step + 1);
        if (longer.length) {
          this.pending = { candidates: longer, step: pending.step + 1, at: this.now() };
          consume(event);
          return;
        }
      }
    }

    const active = this.registry.active();
    for (const entry of active) {
      if (!entry.chords.some((chords) => chords.length === 1 && matchChord(event, chords[0]!, platform))) continue;
      if (!eligible(entry)) continue;
      if (this.run(entry, event)) { consume(event); return; }
    }

    if (repeat) return;
    const starts: PendingSequence['candidates'] = [];
    for (const entry of active) {
      for (const chords of entry.chords) {
        if (chords.length > 1 && matchChord(event, chords[0]!, platform) && eligible(entry)) starts.push({ entry, chords });
      }
    }
    if (starts.length) {
      this.pending = { candidates: starts, step: 1, at: this.now() };
      consume(event);
    }
  }

  private run(entry: RegisteredShortcut, event: KeyboardEvent): boolean {
    try {
      return entry.def.run(event) !== false;
    } catch (error) {
      reportError(error);
      return true;
    }
  }

  /** True when Escape is fully handled here (nothing else should see it as a shortcut). */
  private handleEscape(event: KeyboardEvent, target: Element | null, doc: Document, repeat: boolean): boolean {
    this.pending = null;
    // A field owns Escape, handled or not; inside a toolkit Popover or Menu, Escape in a field closes the layer.
    if (fieldOwnsEscape(target)) return true;
    const foreign = foreignFloatingLayers(doc, event);
    if (repeat) {
      // A held Escape must not peel off one layer after another.
      if (foreign.length || this.layers.length) consume(event, true);
      return true;
    }
    if (event.defaultPrevented) return true;
    // Radix and native dialogs close themselves.
    if (foreign.length) return true;
    if (!this.layers.length && !this.blockers.length) return false;
    const handled = this.runEscapeChain(event);
    if (handled) consume(event);
    return handled;
  }
}

function reportError(error: unknown): void {
  if (typeof console !== 'undefined') console.error('[notis keys] A shortcut failed.', error);
}
