/** Shared vocabulary of the toolkit. Pure: no React, no DOM. */

export type Locale = 'en' | 'fr';
export type Platform = 'mac' | 'other';

/** Every user-facing string the toolkit shows, in both languages. */
export type Words = { en: string; fr: string };

/** 'j', 'shift+j', 'mod+a', 'g i' (one key, then another), '#', '?'. */
export type KeySpec = string;

/** Keyboard scopes, lowest to highest. A higher scope is asked first. */
export type Scope = 'app' | 'route' | 'collection' | 'detail' | 'modal';

export const SCOPE_ORDER: Readonly<Record<Scope, number>> = Object.freeze({
  app: 0,
  route: 100,
  collection: 200,
  detail: 300,
  modal: 400,
});

export const SCOPES: readonly Scope[] = Object.freeze(['app', 'route', 'collection', 'detail', 'modal'] as Scope[]);

export function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SCOPE_ORDER, value);
}

export function isWords(value: unknown): value is Words {
  return !!value && typeof value === 'object'
    && typeof (value as Words).en === 'string' && typeof (value as Words).fr === 'string';
}

/** The string for a locale. A plain string is returned as is (Space code may pass its own words). */
export function pick(words: Words | string, locale: Locale): string {
  if (typeof words === 'string') return words;
  return locale === 'fr' ? words.fr : words.en;
}

/** Replaces `{name}` placeholders. Unknown names stay as written. */
export function interpolate(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole);
}

/** Fills the same placeholders in both languages. */
export function fillWords(words: Words, vars: Readonly<Record<string, string | number>>): Words {
  return { en: interpolate(words.en, vars), fr: interpolate(words.fr, vars) };
}

/** Shorthand for a Words pair. */
export function w(en: string, fr: string): Words {
  return { en, fr };
}

/** Narrow no-break space, used in French before `:` `?` `!` `;`. */
export const NNBSP = ' ';

/**
 * "Label: value" (an accessible name such as "Status: Done"). French puts the narrow no-break space before the
 * colon: "Statut : Terminé".
 */
export function labelValue(label: string, value: string, locale: Locale): string {
  return locale === 'fr' ? `${label}${NNBSP}: ${value}` : `${label}: ${value}`;
}
