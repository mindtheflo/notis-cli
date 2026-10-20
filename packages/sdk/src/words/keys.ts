/**
 * Key specs: parsing, canonical forms and matching against a plain keyboard event.
 * Pure: `matchKey` takes `{ key, code, metaKey, ctrlKey, altKey, shiftKey }`, not a DOM event.
 *
 * Rules (toolkit spec 2.1):
 * - Letters and symbols match on `event.key`, so they follow the keyboard layout (`#` and `?` work on AZERTY).
 * - Any chord with Alt matches on `event.code`, because Option on a Mac changes `event.key` (Option+P gives "π").
 * - `mod` is Cmd on a Mac and Ctrl elsewhere.
 */

import type { KeySpec, Platform } from './types';

export interface Chord {
  /** Normalized key: a lowercase letter, a digit, a symbol, or a named key ('escape', 'arrowdown', ...). */
  key: string;
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

/** One alternative: a single chord, or a sequence of chords ('g i'). */
export type ChordSequence = Chord[];

/** The fields of a KeyboardEvent the matcher reads. */
export interface KeyEventLike {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

const KEY_ALIASES: Readonly<Record<string, string>> = {
  esc: 'escape',
  return: 'enter',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  del: 'delete',
  spacebar: 'space',
  ' ': 'space',
  plus: '+',
  pgup: 'pageup',
  pgdn: 'pagedown',
};

const MOD_ALIASES: Readonly<Record<string, keyof Omit<Chord, 'key'>>> = {
  mod: 'mod',
  cmd: 'mod',
  command: 'mod',
  meta: 'mod',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
};

export const NAMED_KEYS: ReadonlySet<string> = new Set([
  'escape', 'enter', 'tab', 'space', 'backspace', 'delete', 'insert',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
  'home', 'end', 'pageup', 'pagedown',
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
]);

/** US physical key of each symbol, for Alt chords (matched on `event.code`). */
const SYMBOL_CODES: Readonly<Record<string, { code: string; shift: boolean }>> = {
  '/': { code: 'Slash', shift: false }, '?': { code: 'Slash', shift: true },
  '[': { code: 'BracketLeft', shift: false }, '{': { code: 'BracketLeft', shift: true },
  ']': { code: 'BracketRight', shift: false }, '}': { code: 'BracketRight', shift: true },
  ',': { code: 'Comma', shift: false }, '<': { code: 'Comma', shift: true },
  '.': { code: 'Period', shift: false }, '>': { code: 'Period', shift: true },
  ';': { code: 'Semicolon', shift: false }, ':': { code: 'Semicolon', shift: true },
  "'": { code: 'Quote', shift: false }, '"': { code: 'Quote', shift: true },
  '`': { code: 'Backquote', shift: false }, '~': { code: 'Backquote', shift: true },
  '-': { code: 'Minus', shift: false }, '_': { code: 'Minus', shift: true },
  '=': { code: 'Equal', shift: false }, '+': { code: 'Equal', shift: true },
  '\\': { code: 'Backslash', shift: false }, '|': { code: 'Backslash', shift: true },
  '!': { code: 'Digit1', shift: true }, '@': { code: 'Digit2', shift: true },
  '#': { code: 'Digit3', shift: true }, '$': { code: 'Digit4', shift: true },
  '%': { code: 'Digit5', shift: true }, '^': { code: 'Digit6', shift: true },
  '&': { code: 'Digit7', shift: true }, '*': { code: 'Digit8', shift: true },
  '(': { code: 'Digit9', shift: true }, ')': { code: 'Digit0', shift: true },
};

const NAMED_CODES: Readonly<Record<string, readonly string[]>> = {
  escape: ['Escape'], enter: ['Enter', 'NumpadEnter'], tab: ['Tab'], space: ['Space'],
  backspace: ['Backspace'], delete: ['Delete'], insert: ['Insert'],
  arrowup: ['ArrowUp'], arrowdown: ['ArrowDown'], arrowleft: ['ArrowLeft'], arrowright: ['ArrowRight'],
  home: ['Home'], end: ['End'], pageup: ['PageUp'], pagedown: ['PageDown'],
};

export function isLetterKey(key: string): boolean {
  return /^[a-z]$/.test(key);
}

export function isDigitKey(key: string): boolean {
  return /^[0-9]$/.test(key);
}

/** A printable key that is neither a letter nor a digit ('#', '?', '[', ...). */
export function isSymbolKey(key: string): boolean {
  return key.length === 1 && !isLetterKey(key) && !isDigitKey(key);
}

function normalizeKeyName(raw: string): string {
  if (raw.length === 1) {
    const lower = raw.toLowerCase();
    return KEY_ALIASES[raw] ?? lower;
  }
  const lower = raw.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

export class KeySpecError extends Error {
  constructor(spec: string, reason: string) {
    super(`Invalid key spec "${spec}": ${reason}`);
    this.name = 'KeySpecError';
  }
}

function parseChord(step: string, spec: string): Chord {
  const chord: Chord = { key: '', mod: false, ctrl: false, alt: false, shift: false };
  let parts: string[];
  if (step === '+') parts = ['+'];
  else if (step.endsWith('++')) parts = [...step.slice(0, -2).split('+'), '+'];
  else parts = step.split('+');
  const rawKey = parts.pop() ?? '';
  if (!rawKey) throw new KeySpecError(spec, 'missing key');
  for (const part of parts) {
    const modifier = MOD_ALIASES[part.toLowerCase()];
    if (!modifier) throw new KeySpecError(spec, `unknown modifier "${part}"`);
    chord[modifier] = true;
  }
  const key = normalizeKeyName(rawKey);
  if (key.length !== 1 && !NAMED_KEYS.has(key)) throw new KeySpecError(spec, `unknown key "${rawKey}"`);
  chord.key = key;
  // A symbol already says whether Shift is down ('?' is Shift+/ on a US keyboard, a plain key elsewhere).
  if (isSymbolKey(key) && !chord.alt) chord.shift = false;
  return chord;
}

const parseCache = new Map<string, ChordSequence>();

/** 'g i' gives two chords; 'shift+e' one. Throws KeySpecError on an unknown key or modifier. */
export function parseKeySpec(spec: KeySpec): ChordSequence {
  const cached = parseCache.get(spec);
  if (cached) return cached;
  const trimmed = spec.trim();
  if (!trimmed) throw new KeySpecError(spec, 'empty');
  const steps = trimmed === '+' ? ['+'] : trimmed.split(/\s+/);
  const parsed = steps.map((step) => parseChord(step, spec));
  parseCache.set(spec, parsed);
  return parsed;
}

export function isValidKeySpec(spec: KeySpec): boolean {
  try { parseKeySpec(spec); return true; } catch { return false; }
}

export function isSequenceSpec(spec: KeySpec): boolean {
  return parseKeySpec(spec).length > 1;
}

/** Alternatives as a list. */
export function keyList(keys: KeySpec | readonly KeySpec[] | null | undefined): KeySpec[] {
  if (keys == null) return [];
  return typeof keys === 'string' ? [keys] : [...keys];
}

function chordToString(chord: Chord, platform: Platform): string {
  const mod = chord.mod || (platform === 'other' && chord.ctrl);
  const ctrl = platform === 'mac' && chord.ctrl;
  const parts: string[] = [];
  if (mod) parts.push('mod');
  if (ctrl) parts.push('ctrl');
  if (chord.alt) parts.push('alt');
  if (chord.shift) parts.push('shift');
  parts.push(chord.key);
  return parts.join('+');
}

/** One normalized string per spec, for comparing keys ('Shift+E' and 'shift+e' are the same). */
export function canonicalKey(spec: KeySpec, platform: Platform = 'mac'): string {
  return parseKeySpec(spec).map((chord) => chordToString(chord, platform)).join(' ');
}

/** Codes a chord's key sits on, for Alt chords. */
function codesFor(chord: Chord): { codes: string[]; shift: boolean | null } {
  const { key } = chord;
  if (isLetterKey(key)) return { codes: [`Key${key.toUpperCase()}`], shift: null };
  if (isDigitKey(key)) return { codes: [`Digit${key}`, `Numpad${key}`], shift: null };
  const named = NAMED_CODES[key];
  if (named) return { codes: [...named], shift: null };
  const symbol = SYMBOL_CODES[key];
  if (symbol) return { codes: [symbol.code], shift: symbol.shift };
  return { codes: [], shift: null };
}

function normalizedEventKey(key: string): string {
  if (key === ' ' || key === 'Spacebar') return 'space';
  if (key === 'Esc') return 'escape';
  if (key === 'Up' || key === 'Down' || key === 'Left' || key === 'Right') return `arrow${key.toLowerCase()}`;
  if (key === 'Del') return 'delete';
  return key.length === 1 ? key.toLowerCase() : key.toLowerCase();
}

/** Does this event press this chord? */
export function matchChord(event: KeyEventLike, chord: Chord, platform: Platform): boolean {
  const meta = !!event.metaKey;
  const ctrl = !!event.ctrlKey;
  const alt = !!event.altKey;
  const shift = !!event.shiftKey;
  const wantMeta = platform === 'mac' ? chord.mod : false;
  const wantCtrl = platform === 'mac' ? chord.ctrl : chord.mod || chord.ctrl;

  if (chord.alt) {
    // Physical key: Option changes event.key on a Mac.
    if (!alt || meta !== wantMeta || ctrl !== wantCtrl) return false;
    const { codes, shift: symbolShift } = codesFor(chord);
    if (!event.code || !codes.includes(event.code)) return false;
    const wantShift = symbolShift ?? chord.shift;
    return shift === wantShift;
  }

  const key = normalizedEventKey(event.key ?? '');

  if (isSymbolKey(chord.key)) {
    if (key !== chord.key) return false;
    // Layouts put symbols behind Shift, Option (Mac) or AltGr (Ctrl+Alt elsewhere): those do not count.
    if (meta !== wantMeta) return false;
    if (platform === 'other') {
      if (wantCtrl) return ctrl;
      return !ctrl || alt;
    }
    return ctrl === wantCtrl;
  }

  if (alt || meta !== wantMeta || ctrl !== wantCtrl) return false;

  if (isLetterKey(chord.key)) {
    if (shift !== chord.shift) return false;
    if (key === chord.key) return true;
    // Non-Latin layouts (Cyrillic, Greek...): the letter is not on event.key, so fall back to the physical key.
    // Only for letters outside a-z: a Latin layout that moves keys (AZERTY's comma on KeyM) keeps event.key.
    const foreignLetter = key.length === 1 && /\p{L}/u.test(key) && !/^[a-z]$/.test(key);
    return foreignLetter && event.code === `Key${chord.key.toUpperCase()}`;
  }

  if (isDigitKey(chord.key)) {
    // Shift may be needed to type a digit (AZERTY), so it does not count.
    return key === chord.key;
  }

  return key === chord.key && shift === chord.shift;
}

/** Does this event press this single-chord spec (or the first step of a sequence when `firstStep`)? */
export function matchKey(event: KeyEventLike, spec: KeySpec, platform: Platform, firstStep = false): boolean {
  let chords: ChordSequence;
  try { chords = parseKeySpec(spec); } catch { return false; }
  if (chords.length > 1 && !firstStep) return false;
  return matchChord(event, chords[0]!, platform);
}

/** Pure modifier keys never start or finish a chord. */
export function isModifierOnlyKey(key: string): boolean {
  return key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta' || key === 'AltGraph'
    || key === 'CapsLock' || key === 'OS' || key === 'Fn' || key === 'Hyper' || key === 'Super';
}

/**
 * Keys the Notis host owns. A Space may not bind them (toolkit spec 2.1, clash rule 1).
 * '?' help sheet, '/' search, 'c' new chat, 'shift+c' call, the rest host chrome.
 */
export const HOST_RESERVED_KEYS: readonly KeySpec[] = Object.freeze([
  '/', 'c', 'shift+c', 'shift+tab', 'mod+s', 'mod+d', 'alt+p', 'alt+s', '?', 'escape', 'mod+k',
]);

const reservedCanonical = {
  mac: new Set(HOST_RESERVED_KEYS.map((spec) => canonicalKey(spec, 'mac'))),
  other: new Set(HOST_RESERVED_KEYS.map((spec) => canonicalKey(spec, 'other'))),
};

/** True when the spec is host-reserved on either platform, or starts with a reserved key ('escape x'). */
export function isHostReserved(spec: KeySpec): boolean {
  for (const platform of ['mac', 'other'] as const) {
    const canonical = canonicalKey(spec, platform);
    const first = canonical.split(' ')[0]!;
    if (reservedCanonical[platform].has(canonical) || reservedCanonical[platform].has(first)) return true;
  }
  return false;
}
