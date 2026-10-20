/**
 * Periods for dashboards (toolkit spec 2.11). Pure: date-fns only, no React, no DOM.
 *
 * A period is a preset (or a custom day range) plus a comparison. Ranges are whole local days: `from` is the start of
 * its first day and `to` the end of its last day, both inclusive. Custom days are ISO dates (`2026-01-31`).
 *
 * URL value (one text param, `period` by default):
 *   `last30`                       preset, default comparison
 *   `last30~year`                  preset with a comparison
 *   `2026-01-01..2026-01-31~none`  custom range
 * The comparison is left out when it equals the default, so links stay short.
 */

import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  format as formatDate,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfYear,
  subMonths,
  subYears,
} from 'date-fns';

export type PresetId =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'last90'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQuarter'
  | 'thisYear'
  | 'custom';

export type CompareId = 'prev' | 'year' | 'none';

export interface Period {
  preset: PresetId;
  compare: CompareId;
  /** ISO day, custom ranges only. */
  from?: string;
  /** ISO day, custom ranges only. */
  to?: string;
}

export interface DateRange {
  from: Date;
  to: Date;
}

export const PRESETS: readonly PresetId[] = Object.freeze([
  'today',
  'yesterday',
  'last7',
  'last30',
  'last90',
  'thisMonth',
  'lastMonth',
  'thisQuarter',
  'thisYear',
  'custom',
] as PresetId[]);

export const COMPARES: readonly CompareId[] = Object.freeze(['prev', 'year', 'none'] as CompareId[]);

export const DEFAULT_PRESET: PresetId = 'last30';
export const DEFAULT_COMPARE: CompareId = 'prev';

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === 'string' && (PRESETS as readonly string[]).includes(value);
}

export function isCompareId(value: unknown): value is CompareId {
  return typeof value === 'string' && (COMPARES as readonly string[]).includes(value);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `2026-01-31` for a local date. */
export function toIsoDay(date: Date): string {
  return formatDate(date, 'yyyy-MM-dd');
}

/** A local date at the start of an ISO day, or null when the text is not a real day. */
export function fromIsoDay(value: string | undefined | null): Date | null {
  if (!value || !ISO_DAY.test(value)) return null;
  const date = parseISO(value);
  return isValid(date) && toIsoDay(date) === value ? startOfDay(date) : null;
}

function wholeDays(from: Date, to: Date): DateRange {
  return { from: startOfDay(from), to: endOfDay(to) };
}

/** Number of calendar days in a range, both ends included. */
export function dayCount(range: DateRange): number {
  return differenceInCalendarDays(range.to, range.from) + 1;
}

/**
 * The days a preset covers, as of `now`.
 * A custom range must end today or earlier with its first day first; anything else falls back to the last 30 days.
 */
export function presetRange(preset: PresetId, now: Date = new Date(), custom?: { from?: string; to?: string }): DateRange {
  const today = startOfDay(now);
  switch (preset) {
    case 'today':
      return wholeDays(today, today);
    case 'yesterday': {
      const day = addDays(today, -1);
      return wholeDays(day, day);
    }
    case 'last7':
      return wholeDays(addDays(today, -6), today);
    case 'last30':
      return wholeDays(addDays(today, -29), today);
    case 'last90':
      return wholeDays(addDays(today, -89), today);
    case 'thisMonth':
      return wholeDays(startOfMonth(today), today);
    case 'lastMonth': {
      const last = subMonths(startOfMonth(today), 1);
      return wholeDays(last, endOfMonth(last));
    }
    case 'thisQuarter': {
      const month = today.getMonth();
      return wholeDays(new Date(today.getFullYear(), month - (month % 3), 1), today);
    }
    case 'thisYear':
      return wholeDays(startOfYear(today), today);
    case 'custom': {
      const from = fromIsoDay(custom?.from);
      const to = fromIsoDay(custom?.to);
      if (from && to && from <= to && to <= today) return wholeDays(from, to);
      return wholeDays(addDays(today, -29), today);
    }
    default:
      return wholeDays(addDays(today, -29), today);
  }
}

/**
 * The range a period is compared with.
 * - prev: the same number of days just before (`[from - n, from - 1]`).
 * - year: the same calendar days one year back (29 February lands on 28 February).
 * - none: no comparison.
 */
export function compareRange(range: DateRange, compare: CompareId): DateRange | null {
  if (compare === 'none') return null;
  if (compare === 'year') return wholeDays(subYears(startOfDay(range.from), 1), subYears(startOfDay(range.to), 1));
  const n = dayCount(range);
  const from = startOfDay(range.from);
  return wholeDays(addDays(from, -n), addDays(from, -1));
}

/** The range and comparison range of a period. */
export function periodRanges(period: Period, now: Date = new Date()): { range: DateRange; compareRange: DateRange | null } {
  const range = presetRange(period.preset, now, period);
  return { range, compareRange: compareRange(range, period.compare) };
}

/** A period whose custom days are dropped unless the preset is custom. */
export function normalizePeriod(period: Period): Period {
  if (period.preset !== 'custom') return { preset: period.preset, compare: period.compare };
  return { preset: 'custom', compare: period.compare, from: period.from, to: period.to };
}

/** A custom period for two days, in any order. */
export function customPeriod(a: Date, b: Date, compare: CompareId): Period {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return { preset: 'custom', compare, from: toIsoDay(lo), to: toIsoDay(hi) };
}

/** The URL value of a period. The comparison is left out when it equals `defaultCompare`. */
export function formatPeriodParam(period: Period, defaultCompare: CompareId = DEFAULT_COMPARE): string {
  const head = period.preset === 'custom' && period.from && period.to ? `${period.from}..${period.to}` : period.preset;
  return period.compare === defaultCompare ? head : `${head}~${period.compare}`;
}

/** Reads a URL value; anything unreadable gives the defaults. */
export function parsePeriodParam(
  value: string | null | undefined,
  defaults: { preset?: PresetId; compare?: CompareId } = {},
): Period {
  const fallbackPreset = defaults.preset ?? DEFAULT_PRESET;
  const fallbackCompare = defaults.compare ?? DEFAULT_COMPARE;
  const fallback: Period = fallbackPreset === 'custom'
    ? { preset: DEFAULT_PRESET, compare: fallbackCompare }
    : { preset: fallbackPreset, compare: fallbackCompare };
  if (!value) return fallback;
  const [head = '', cmp] = value.trim().split('~');
  const compare = isCompareId(cmp) ? cmp : fallbackCompare;
  if (head.includes('..')) {
    const [from, to] = head.split('..');
    const a = fromIsoDay(from);
    const b = fromIsoDay(to);
    if (!a || !b) return { ...fallback, compare };
    return customPeriod(a, b, compare);
  }
  if (isPresetId(head) && head !== 'custom') return { preset: head, compare };
  return { ...fallback, compare };
}

export function samePeriod(a: Period, b: Period): boolean {
  return formatPeriodParam(a) === formatPeriodParam(b);
}
