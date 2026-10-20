/**
 * The shortcut registry: owners, availability, clash checks and dispatch order. Pure (no DOM, no React), so it runs
 * under node in tests and in the design check.
 */

import {
  SCOPE_ORDER,
  keyList,
  pairClashes,
  parseKeySpec,
  selfClashes,
  type ChordSequence,
  type Clash,
  type ClashCandidate,
  type KeySpec,
  type Locale,
} from '../../words';
import type { HelpEntry, OwnerKind, ShortcutDef, ShortcutGroup } from './types';

export const ROOT_OWNER = 'notis';

/** Thrown in dev and by the design check when two defs clash or a Space takes a host key. */
export class NotisKeyClash extends Error {
  readonly clash: Clash;
  constructor(clash: Clash) {
    super(clash.message.startsWith('NotisKeyClash') ? clash.message : `NotisKeyClash: ${clash.message}`);
    this.name = 'NotisKeyClash';
    this.clash = clash;
  }
}

export interface RegisteredShortcut {
  def: ShortcutDef;
  owner: string;
  ownerKind: OwnerKind;
  /** Registration order; later wins within a scope. */
  seq: number;
  /** Scope order plus boost. */
  rank: number;
  /** Parsed alternatives. */
  chords: ChordSequence[];
}

interface OwnerRecord {
  id: string;
  kind: OwnerKind;
  parent: string;
  available: boolean;
  refs: number;
}

export interface RegistryOptions {
  strict: boolean;
  onClash?: (message: string) => void;
}

export interface DefineOwnerOptions {
  parent?: string;
  kind?: OwnerKind;
  available?: boolean;
}

const MAX_BOOST = 99;

export class ShortcutRegistry {
  private entries: RegisteredShortcut[] = [];
  private owners = new Map<string, OwnerRecord>();
  private seq = 0;
  private version = 0;
  private listeners = new Set<() => void>();
  private warned = new Set<string>();
  options: RegistryOptions;

  constructor(options: Partial<RegistryOptions> = {}) {
    this.options = { strict: options.strict ?? true, onClash: options.onClash };
  }

  // ---- change notification (useSyncExternalStore) ----

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getVersion(): number {
    return this.version;
  }

  notify(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }

  // ---- owners ----

  /** Declares a Space or a retained view. Ref counted: the last release removes it. */
  defineOwner(id: string, options: DefineOwnerOptions = {}): () => void {
    if (id === ROOT_OWNER) return () => {};
    const parent = options.parent ?? ROOT_OWNER;
    const existing = this.owners.get(id);
    if (existing) {
      existing.refs += 1;
      existing.parent = parent;
      if (options.kind) existing.kind = options.kind;
      if (options.available !== undefined && existing.available !== options.available) {
        existing.available = options.available;
      }
    } else {
      this.owners.set(id, {
        id,
        parent,
        kind: options.kind ?? this.inheritedKind(parent),
        available: options.available ?? true,
        refs: 1,
      });
    }
    this.notify();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const record = this.owners.get(id);
      if (!record) return;
      record.refs -= 1;
      if (record.refs <= 0) this.owners.delete(id);
      this.notify();
    };
  }

  setOwnerAvailable(id: string, available: boolean): void {
    const record = this.owners.get(id);
    if (!record || record.available === available) return;
    record.available = available;
    this.notify();
  }

  private inheritedKind(parent: string): OwnerKind {
    if (parent === ROOT_OWNER) return 'space';
    return this.owners.get(parent)?.kind ?? 'space';
  }

  ownerKind(id: string): OwnerKind {
    if (id === ROOT_OWNER) return 'host';
    // An owner not declared yet (its scope mounts after the def) counts as a Space.
    return this.owners.get(id)?.kind ?? 'space';
  }

  /** Available when it and every owner above it are available. Unknown owners count as available. */
  isOwnerAvailable(id: string): boolean {
    let current: string | undefined = id;
    const seen = new Set<string>();
    while (current && current !== ROOT_OWNER && !seen.has(current)) {
      seen.add(current);
      const record = this.owners.get(current);
      if (!record) return true;
      if (!record.available) return false;
      current = record.parent;
    }
    return true;
  }

  // ---- shortcuts ----

  /**
   * Registers a def. Returns an unregister function, or null when the def was dropped (production clash).
   * Strict mode throws NotisKeyClash instead of dropping.
   */
  register(def: ShortcutDef, owner: string = def.owner ?? ROOT_OWNER): (() => void) | null {
    const ownerKind = this.ownerKind(owner);
    const candidate = this.candidate(def, owner, ownerKind);
    const errors = selfClashes(candidate).filter((clash) => clash.severity === 'error');
    if (errors.length) {
      this.reject(errors[0]!);
      return null;
    }
    if (this.isOwnerAvailable(owner)) {
      for (const entry of this.entries) {
        if (entry.owner !== owner || entry.def.scope !== def.scope) continue;
        if (!this.isOwnerAvailable(entry.owner)) continue;
        const duplicate = pairClashes(this.candidate(entry.def, entry.owner, entry.ownerKind), candidate)
          .find((clash) => clash.kind === 'duplicate');
        if (duplicate) {
          this.reject(duplicate);
          return null;
        }
      }
    }
    const boost = Math.max(0, Math.min(MAX_BOOST, def.boost ?? 0));
    const entry: RegisteredShortcut = {
      def,
      owner,
      ownerKind,
      seq: ++this.seq,
      rank: SCOPE_ORDER[def.scope] + boost,
      chords: keyList(def.keys).map((spec) => parseKeySpec(spec)),
    };
    this.entries.push(entry);
    this.notify();
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const index = this.entries.indexOf(entry);
      if (index !== -1) this.entries.splice(index, 1);
      this.notify();
    };
  }

  private candidate(def: ShortcutDef, owner: string, ownerKind: OwnerKind): ClashCandidate {
    return { id: def.id, keys: def.keys, scope: def.scope, owner, ownerKind, available: true };
  }

  private reject(clash: Clash): void {
    if (this.options.strict) throw new NotisKeyClash(clash);
    if (this.warned.has(clash.message)) return;
    this.warned.add(clash.message);
    const log = this.options.onClash ?? ((message: string) => {
      if (typeof console !== 'undefined') console.warn(`[notis keys] ${message} The later shortcut was ignored.`);
    });
    log(clash.message);
  }

  /** All registered entries, registration order. */
  all(): readonly RegisteredShortcut[] {
    return this.entries;
  }

  /**
   * Entries that may answer a key now: owner available, `when` passing, highest rank first, latest first within a
   * rank. `modalOnly` keeps only the modal scope (an open dialog or menu).
   */
  active(options: { modalOnly?: boolean } = {}): RegisteredShortcut[] {
    return this.entries
      .filter((entry) => (!options.modalOnly || entry.def.scope === 'modal') && this.isOwnerAvailable(entry.owner))
      .sort((a, b) => b.rank - a.rank || b.seq - a.seq);
  }

  /** Help sheet rows: available, not hidden, `when` passing, latest def per id. Space group first, then Notis. */
  helpEntries(): HelpEntry[] {
    const byId = new Map<string, HelpEntry>();
    const ordered = [...this.entries].sort((a, b) => a.seq - b.seq);
    for (const entry of ordered) {
      const { def } = entry;
      if (def.hidden || def.scope === 'modal' || !this.isOwnerAvailable(entry.owner)) continue;
      if (def.when && !safeWhen(def.when)) continue;
      const group: ShortcutGroup = def.group ?? (entry.ownerKind === 'space' ? 'space' : 'notis');
      byId.delete(def.id);
      byId.set(def.id, { id: def.id, keys: keyList(def.keys), label: def.label, group, scope: def.scope, owner: entry.owner });
    }
    const rows = [...byId.values()];
    return [...rows.filter((row) => row.group === 'space'), ...rows.filter((row) => row.group === 'notis')];
  }

  /** Labels for the help sheet in one language, for tests and text hosts. */
  helpText(locale: Locale): Array<{ group: ShortcutGroup; label: string; keys: KeySpec[] }> {
    return this.helpEntries().map((row) => ({ group: row.group, label: row.label[locale], keys: row.keys }));
  }
}

export function safeWhen(when: () => boolean): boolean {
  try { return when() !== false; } catch { return false; }
}
