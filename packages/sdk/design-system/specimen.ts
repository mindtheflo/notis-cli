/**
 * The specimen contract of the design system book (design review spec, section 4).
 *
 * One file per specimen at `specimens/<group>/<Name>.specimen.tsx` exports `specimen = defineSpecimen({...})`.
 * `defineSpecimen` only returns its argument with the type checked; `completeness.test.tsx` checks the rest.
 */
import type { ReactNode } from 'react';
import type { ComponentEntry } from './api.mjs';

/** The public entries a specimen may document: `COMPONENT_ENTRIES` of `api.mjs`. Every cover must be exported by it. */
export type SpecimenEntry = ComponentEntry;
export type SpecimenLang = 'en' | 'fr';
export type SpecimenTheme = 'light' | 'dark';

/** The widths the book offers; a state may fix another width. */
export const BOOK_WIDTHS = [390, 768, 1440] as const;

/** The fixed instant every frame runs at (2026-06-15T09:30:00Z); fixtures date things relative to it. */
export const FIXED_NOW = Date.UTC(2026, 5, 15, 9, 30, 0);

export interface SpecimenCopy<T = string> {
  en: T;
  fr: T;
}

export interface SpecimenRenderContext {
  lang: SpecimenLang;
  theme: SpecimenTheme;
  /** The frame's viewport width in px. */
  width: number;
  /** Picks the copy of the current language: `t({ en: 'Save', fr: 'Enregistrer' })`. */
  t: <T>(copy: SpecimenCopy<T>) => T;
}

export interface SpecimenState {
  /** `^[a-z0-9-]+$`, unique in the specimen. */
  id: string;
  label: string;
  render: (context: SpecimenRenderContext) => ReactNode;
  /** Fixes this state's viewport width (px); the width toggle is ignored. */
  width?: number;
  /** Fixed frame height (px); required when the state opens an overlay. */
  height?: number;
  /** Forces the theme; the theme toggle is ignored. */
  theme?: SpecimenTheme;
  /** Run before the state is ready (open a menu, type). The render smoke test runs it under jsdom too. */
  interact?: (root: HTMLElement) => Promise<void>;
}

export interface Specimen {
  /** Kebab case, unique across the book. */
  id: string;
  /** Equals the file name before `.specimen.tsx`. */
  name: string;
  /** Equals the folder; a key of `groups.json`. */
  group: string;
  from: SpecimenEntry;
  /** The component exports this specimen shows, at least one. */
  covers: readonly string[];
  /** One line on what it is for. */
  summary: string;
  states: readonly SpecimenState[];
}

export function defineSpecimen<const S extends Specimen>(specimen: S): S {
  return specimen;
}

/** The render context of one state, shared by the frame and the tests. */
export function renderContext(lang: SpecimenLang, theme: SpecimenTheme, width: number): SpecimenRenderContext {
  return { lang, theme, width, t: (copy) => copy[lang] };
}

/** Waits for the next animation frame (or a macrotask where there is none), for `interact` steps. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}
