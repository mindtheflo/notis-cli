/**
 * How keys read on screen (toolkit spec 2.2), matching the review deck:
 * - Mac: glyphs in ctrl, alt, shift, cmd order, then the key ("⇧E", "⌘A").
 * - Elsewhere: names joined by "+" ("Ctrl+A"); French says "Maj" for Shift.
 * - Sequences join with "then" / "puis"; alternatives with "or" / "ou".
 */

import { keyList, parseKeySpec, type Chord } from './keys';
import type { KeySpec, Locale, Platform, Words } from './types';

export interface FormatKeyOptions {
  platform: Platform;
  locale: Locale;
}

export const KEY_JOIN_WORDS: Readonly<{ then: Words; or: Words }> = Object.freeze({
  then: { en: 'then', fr: 'puis' },
  or: { en: 'or', fr: 'ou' },
});

const MAC_GLYPH = { ctrl: '⌃', alt: '⌥', shift: '⇧', mod: '⌘' } as const;

function keyName(key: string, mac: boolean, fr: boolean): string {
  switch (key) {
    case 'enter': return mac ? '↵' : fr ? 'Entrée' : 'Enter';
    // French says Échap on every computer, as the Portal does.
    case 'escape': return fr ? 'Échap' : 'Esc';
    case 'space': return fr ? 'Espace' : 'Space';
    case 'arrowdown': return '↓';
    case 'arrowup': return '↑';
    case 'arrowleft': return '←';
    case 'arrowright': return '→';
    case 'tab': return 'Tab';
    case 'backspace': return mac ? '⌫' : fr ? 'Retour arrière' : 'Backspace';
    case 'delete': return mac ? '⌦' : fr ? 'Suppr' : 'Delete';
    case 'insert': return fr ? 'Inser' : 'Insert';
    case 'home': return fr ? 'Début' : 'Home';
    case 'end': return fr ? 'Fin' : 'End';
    case 'pagedown': return fr ? 'Pg suiv' : 'PgDn';
    case 'pageup': return fr ? 'Pg préc' : 'PgUp';
    default:
      if (key.length === 1) return key.toUpperCase();
      return key[0]!.toUpperCase() + key.slice(1);
  }
}

/** One chord as shown on a single keycap. */
export function formatChord(chord: Chord, { platform, locale }: FormatKeyOptions): string {
  const mac = platform === 'mac';
  const fr = locale === 'fr';
  if (mac) {
    const glyphs = (['ctrl', 'alt', 'shift', 'mod'] as const).filter((m) => chord[m]).map((m) => MAC_GLYPH[m]).join('');
    return glyphs + keyName(chord.key, mac, fr);
  }
  const names: string[] = [];
  if (chord.mod || chord.ctrl) names.push('Ctrl');
  if (chord.alt) names.push('Alt');
  if (chord.shift) names.push(fr ? 'Maj' : 'Shift');
  return [...names, keyName(chord.key, mac, fr)].join('+');
}

/**
 * Keycap parts: one entry per alternative, each a list of caps (one per sequence step).
 * `[['⇧E']]`, `[['G', 'I']]`, `[['J'], ['↓']]`.
 */
export function formatKeyParts(spec: KeySpec | readonly KeySpec[], options: FormatKeyOptions): string[][] {
  return keyList(spec).map((one) => parseKeySpec(one).map((chord) => formatChord(chord, options)));
}

/** The whole spec as one string: "J or ↓", "G then I", "⇧E". */
export function formatKey(spec: KeySpec | readonly KeySpec[], options: FormatKeyOptions): string {
  const then = ` ${KEY_JOIN_WORDS.then[options.locale]} `;
  const or = ` ${KEY_JOIN_WORDS.or[options.locale]} `;
  return formatKeyParts(spec, options).map((caps) => caps.join(then)).join(or);
}

const ARIA_KEY: Readonly<Record<string, string>> = {
  escape: 'Escape', enter: 'Enter', tab: 'Tab', space: 'Space', backspace: 'Backspace', delete: 'Delete',
  insert: 'Insert', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
};

/** Value for the `aria-keyshortcuts` attribute ("Shift+E J ArrowDown"). Sequences are left out (ARIA has no syntax). */
export function toAriaKeyShortcuts(spec: KeySpec | readonly KeySpec[], platform: Platform): string {
  return keyList(spec)
    .map((one) => parseKeySpec(one))
    .filter((chords) => chords.length === 1)
    .map(([chord]) => {
      const parts: string[] = [];
      if (chord!.mod) parts.push(platform === 'mac' ? 'Meta' : 'Control');
      if (chord!.ctrl && !(chord!.mod && platform !== 'mac')) parts.push('Control');
      if (chord!.alt) parts.push('Alt');
      if (chord!.shift) parts.push('Shift');
      const key = chord!.key;
      parts.push(ARIA_KEY[key] ?? (key.length === 1 ? key.toUpperCase() : key[0]!.toUpperCase() + key.slice(1)));
      return parts.join('+');
    })
    .join(' ');
}

const SPOKEN_KEY: Readonly<Record<string, Words>> = Object.freeze({
  enter: { en: 'Enter', fr: 'Entrée' },
  escape: { en: 'Escape', fr: 'Échap' },
  space: { en: 'Space', fr: 'Espace' },
  arrowdown: { en: 'Down arrow', fr: 'Flèche bas' },
  arrowup: { en: 'Up arrow', fr: 'Flèche haut' },
  arrowleft: { en: 'Left arrow', fr: 'Flèche gauche' },
  arrowright: { en: 'Right arrow', fr: 'Flèche droite' },
  backspace: { en: 'Backspace', fr: 'Retour arrière' },
  delete: { en: 'Delete', fr: 'Suppr' },
  pagedown: { en: 'Page down', fr: 'Page suivante' },
  pageup: { en: 'Page up', fr: 'Page précédente' },
});

const SPOKEN_MOD = Object.freeze({
  ctrl: { en: 'Control', fr: 'Contrôle' },
  alt: { mac: { en: 'Option', fr: 'Option' }, other: { en: 'Alt', fr: 'Alt' } },
  shift: { en: 'Shift', fr: 'Maj' },
  mod: { mac: { en: 'Command', fr: 'Commande' }, other: { en: 'Control', fr: 'Contrôle' } },
});

/** Words for screen readers: glyphs spelled out ("Command A", "G then I"). Used for the Keycap sr-only label. */
export function formatKeySpoken(spec: KeySpec | readonly KeySpec[], { platform, locale }: FormatKeyOptions): string {
  const then = ` ${KEY_JOIN_WORDS.then[locale]} `;
  const or = ` ${KEY_JOIN_WORDS.or[locale]} `;
  const chordWords = (chord: Chord): string => {
    const parts: string[] = [];
    if (chord.ctrl && !(chord.mod && platform !== 'mac')) parts.push(SPOKEN_MOD.ctrl[locale]);
    if (chord.alt) parts.push(SPOKEN_MOD.alt[platform][locale]);
    if (chord.shift) parts.push(SPOKEN_MOD.shift[locale]);
    if (chord.mod) parts.push(SPOKEN_MOD.mod[platform][locale]);
    parts.push(SPOKEN_KEY[chord.key]?.[locale] ?? keyName(chord.key, false, locale === 'fr'));
    return parts.join(' ');
  };
  return keyList(spec).map((one) => parseKeySpec(one).map(chordWords).join(then)).join(or);
}
