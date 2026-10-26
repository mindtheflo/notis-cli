/**
 * Captured loading skeletons (`notis-space-skeleton/v1`). `notis spaces verify` measures the final view at build
 * time into bones and ships them beside the bundle; the host passes them as `NotisRuntimeContext.skeleton` and
 * `ViewSkeleton` draws the region named by its `skeletonKey`.
 */

/**
 * One rectangle: `[x, y, w, h, r, t]`. x and w are percent of the region width, y and h px from the region (or row)
 * top, r the corner radius in px, t the type: 0 leaf, 1 filled container, 2 four-side box (outline), 3 divider.
 */
export type SkeletonBone = [number, number, number, number, number, 0 | 1 | 2 | 3];

/** A row template stacked from `y` until the visible pane is filled. Its bones are relative to the row top. */
export interface NotisSkeletonRow {
  y: number;
  h: number;
  bones: SkeletonBone[];
  repeat: 'fill';
}

/** The bones of one region at one width and one locale. */
export interface NotisSkeletonEntry {
  height: number;
  bones: SkeletonBone[];
  rows?: NotisSkeletonRow[];
}

export type NotisSkeletonWidth = '390' | '1440';
export type NotisSkeletonLocale = 'en' | 'fr';

export interface NotisSpaceSkeleton {
  schema: 'notis-space-skeleton/v1';
  /** sha256 hex of the `bundle/app.js` the bones were measured from. */
  sourceHash: string;
  regions: Record<string, Partial<Record<NotisSkeletonWidth, Partial<Record<NotisSkeletonLocale, NotisSkeletonEntry>>>>>;
}

export const SPACE_SKELETON_SCHEMA = 'notis-space-skeleton/v1';

const REGION_KEY = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const WIDTHS = new Set(['390', '1440']);
const LOCALES = new Set(['en', 'fr']);
const MAX_REGIONS = 16;
const MAX_ROWS = 8;
const MAX_BONES = 400;
const MAX_ROW_BONES = 64;
const MAX_PX = 100000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumberIn = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

function isBone(value: unknown): value is SkeletonBone {
  return Array.isArray(value) && value.length === 6
    && isNumberIn(value[0], 0, 100) && isNumberIn(value[1], 0, MAX_PX)
    && isNumberIn(value[2], 0, 100) && isNumberIn(value[3], 0, MAX_PX)
    && isNumberIn(value[4], 0, 64) && (value[5] === 0 || value[5] === 1 || value[5] === 2 || value[5] === 3);
}

function isBones(value: unknown, max: number): value is SkeletonBone[] {
  return Array.isArray(value) && value.length <= max && value.every(isBone);
}

function isEntry(value: unknown): value is NotisSkeletonEntry {
  if (!isObject(value) || !isNumberIn(value.height, 0, MAX_PX) || !isBones(value.bones, MAX_BONES)) return false;
  if (value.rows === undefined) return true;
  return Array.isArray(value.rows) && value.rows.length <= MAX_ROWS && value.rows.every((row) =>
    isObject(row) && row.repeat === 'fill' && isNumberIn(row.y, 0, MAX_PX) && isNumberIn(row.h, 1, MAX_PX)
    && isBones(row.bones, MAX_ROW_BONES));
}

/**
 * A light shape check of a captured skeleton: the schema tag, the region, width and locale keys, and numeric bones.
 * The server validates strictly at publish; this only keeps a malformed file from reaching the drawing code.
 */
export function isNotisSpaceSkeleton(value: unknown): value is NotisSpaceSkeleton {
  if (!isObject(value) || value.schema !== SPACE_SKELETON_SCHEMA || typeof value.sourceHash !== 'string') return false;
  if (!isObject(value.regions)) return false;
  const regions = Object.entries(value.regions);
  if (regions.length > MAX_REGIONS) return false;
  return regions.every(([key, widths]) => REGION_KEY.test(key) && isObject(widths)
    && Object.entries(widths).every(([width, locales]) => WIDTHS.has(width) && isObject(locales)
      && Object.entries(locales).every(([locale, entry]) => LOCALES.has(locale) && isEntry(entry))));
}

/**
 * The entry a region draws: the width bucket asked for, else the other one; the locale asked for, else the other one.
 * Null when the region has no entry at all.
 */
export function pickSkeletonEntry(skeleton: NotisSpaceSkeleton | null | undefined, key: string,
  width: NotisSkeletonWidth, locale: NotisSkeletonLocale): NotisSkeletonEntry | null {
  const region = skeleton?.regions?.[key];
  if (!region) return null;
  const otherWidth: NotisSkeletonWidth = width === '390' ? '1440' : '390';
  const otherLocale: NotisSkeletonLocale = locale === 'en' ? 'fr' : 'en';
  for (const w of [width, otherWidth]) {
    const locales = region[w];
    const entry = locales?.[locale] ?? locales?.[otherLocale];
    if (entry) return entry;
  }
  return null;
}
