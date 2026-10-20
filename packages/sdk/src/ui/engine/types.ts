import type { KeySpec, Locale, Platform, Scope, Words } from '../../words';

export type { KeySpec, Locale, Platform, Scope, Words };

export type ShortcutGroup = 'space' | 'notis';

export interface ShortcutDef {
  /** Stable id: 'list.next', 'space:tickets.triage'. */
  id: string;
  /** One spec or alternatives. */
  keys: KeySpec | KeySpec[];
  scope: Scope;
  label: Words;
  /** Help sheet group. Default 'space' under a Space owner, 'notis' otherwise. */
  group?: ShortcutGroup;
  /** Extra gate, evaluated at dispatch (and when the help sheet opens). */
  when?: () => boolean;
  /** Fire on key repeat (a held key). Default false. */
  repeat?: boolean;
  /** Fire while focus is in a text field. Default false. */
  allowInFields?: boolean;
  /** Not listed in the help sheet. */
  hidden?: boolean;
  /**
   * Added to the scope order (0 to 99). The selection bar registers its actions at `collection` with
   * `boost: 25` while something is selected, so they win over row keys.
   */
  boost?: number;
  /** Owner override. Default: the nearest `<ShortcutScope>` (or `useShortcutScope`) above, else 'notis'. */
  owner?: string;
  /** Return false when not handled: the engine keeps looking. */
  run: (event: KeyboardEvent) => void | boolean;
}

export type OwnerKind = 'space' | 'host';

export interface ScopeHandle {
  owner: string;
  available: boolean;
  isAvailable(): boolean;
}

export type EngineHost = 'portal' | 'preview';

export interface EngineSettings {
  host: EngineHost;
  locale: Locale;
  platform: Platform;
  /** Dev and design check: clashes throw. Production: the later def is dropped and logged once. */
  strict: boolean;
  /** Production clash log (telemetry). Default console.warn, once per message. */
  onClash?: (message: string) => void;
}

export interface HelpEntry {
  id: string;
  keys: KeySpec[];
  label: Words;
  group: ShortcutGroup;
  scope: Scope;
  owner: string;
}
