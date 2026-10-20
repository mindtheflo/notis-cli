/**
 * Locale-aware dates and numbers for the period, calendar, timeline and chart pieces. Pure: Intl only.
 * `en` formats as en-US (the Portal's English), `fr` as fr-FR.
 */

import { NNBSP, type Locale } from '../../words/types';
import type { DateRange } from './periods';

/** The `Intl` locale tag for a toolkit locale (fr-FR or en-US), for Space code that formats with `Intl` itself. */
export function intlLocale(locale: Locale): string {
  return locale === 'fr' ? 'fr-FR' : 'en-US';
}

const cache = new Map<string, Intl.DateTimeFormat>();

/** A cached `Intl.DateTimeFormat` for a toolkit locale and options. */
export function dateFormat(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let fmt = cache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(intlLocale(locale), options);
    cache.set(key, fmt);
  }
  return fmt;
}

/** The text with its first letter upper case ("lundi" reads "Lundi"). */
export function upFirst(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** French writes the first of the month "1er": every day part that reads "1" becomes "1er". */
function joinFrenchParts(parts: Intl.DateTimeFormatPart[]): string {
  return parts.map((part) => (part.type === 'day' && part.value === '1' ? '1er' : part.value)).join('');
}

function formatDay(fmt: Intl.DateTimeFormat, date: Date, locale: Locale): string {
  return locale === 'fr' ? joinFrenchParts(fmt.formatToParts(date)) : fmt.format(date);
}

const RANGE_OPTIONS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };

/** The word between the two days of a range: never a dash. */
const RANGE_JOIN: Record<Locale, string> = { en: ' to ', fr: ' au ' };

/**
 * A date range in words, never a dash: "May 17 to Jun 15, 2026" / "17 mai au 15 juin 2026". A month or year both days
 * share shows once ("Oct 1 to 15, 2026" / "1er au 15 oct. 2026"). One day reads as that day.
 */
export function formatDateRange(range: DateRange, locale: Locale, options: Intl.DateTimeFormatOptions = RANGE_OPTIONS): string {
  const fmt = dateFormat(locale, options);
  if (sameDay(range.from, range.to)) return formatDay(fmt, range.from, locale);
  const join = RANGE_JOIN[locale];
  const text = (parts: Intl.DateTimeFormatPart[]) => (locale === 'fr' ? joinFrenchParts(parts) : parts.map((p) => p.value).join(''));
  try {
    // Intl marks each part as the start day's, the end day's or shared; the shared separator between them gives way
    // to the word.
    const parts = fmt.formatRangeToParts(range.from, range.to);
    const lastStart = parts.map((p) => p.source).lastIndexOf('startRange');
    const firstEnd = parts.findIndex((p) => p.source === 'endRange');
    if (lastStart >= 0 && firstEnd > lastStart) {
      return `${text(parts.slice(0, lastStart + 1))}${join}${text(parts.slice(firstEnd))}`;
    }
  } catch {
    // No range formatting here: both days in full below.
  }
  return `${formatDay(fmt, range.from, locale)}${join}${formatDay(fmt, range.to, locale)}`;
}

/** One day, long: "Monday, January 5, 2026" / "Lundi 5 janvier 2026". */
export function formatLongDay(date: Date, locale: Locale): string {
  return upFirst(formatDay(dateFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), date, locale));
}

/**
 * A day heading (the agenda, meeting days): "Monday, October 19" / "Lundi 19 octobre", with the year when it is not
 * `thisYear` ("Friday, January 1, 2027").
 */
export function formatDayHeading(date: Date, locale: Locale, thisYear: number = new Date().getFullYear()): string {
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
  if (date.getFullYear() !== thisYear) options.year = 'numeric';
  return upFirst(formatDay(dateFormat(locale, options), date, locale));
}

/** One day, short: "Jan 5" / "5 janv.". */
export function formatShortDay(date: Date, locale: Locale): string {
  return formatDay(dateFormat(locale, { day: 'numeric', month: 'short' }), date, locale);
}

/** "January 2026" / "Janvier 2026". */
export function formatMonthYear(date: Date, locale: Locale): string {
  return upFirst(dateFormat(locale, { month: 'long', year: 'numeric' }).format(date));
}

/** Seven weekday names starting Monday. `narrow` for the day picker, `short` for grids. */
export function weekdayNames(locale: Locale, width: 'narrow' | 'short' | 'long' = 'short'): string[] {
  const fmt = dateFormat(locale, { weekday: width });
  // 5 January 2026 is a Monday.
  return Array.from({ length: 7 }, (_, i) => {
    const name = fmt.format(new Date(2026, 0, 5 + i));
    return width === 'short' ? upFirst(name.replace(/\.$/, '')) : upFirst(name);
  });
}

/** The number in a month cell: the first of a month carries the month name ("Feb 1" / "1er févr."). */
export function dayNumberLabel(date: Date, locale: Locale, short = false): string {
  if (date.getDate() !== 1 || short) return String(date.getDate());
  return locale === 'fr'
    ? `1er ${dateFormat(locale, { month: 'short' }).format(date)}`
    : dateFormat(locale, { month: 'short', day: 'numeric' }).format(date);
}

/** A number in the locale ("1,020" / "1 020"). */
export function formatNumber(value: number, locale: Locale, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

/** A plain value: one decimal under 10 when it has one, whole numbers above. */
export function formatValue(value: number, locale: Locale): string {
  const rounded = Math.abs(value) < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return formatNumber(rounded, locale, { maximumFractionDigits: Math.abs(value) < 10 && rounded % 1 ? 1 : 0 });
}

export type DeltaTone = 'good' | 'destructive';

export interface Delta {
  /** "+12%" / "−3,4 %". */
  text: string;
  tone: DeltaTone;
  up: boolean;
  /** The change in percent, signed. */
  percent: number;
}

/**
 * The change from `previous` to `current`. Null when there is nothing to compare with (no previous value or zero).
 * `higherIsBetter: false` turns a rise red (costs, errors).
 */
export function formatDelta(
  current: number,
  previous: number | null | undefined,
  locale: Locale,
  higherIsBetter = true,
): Delta | null {
  if (previous == null || previous === 0 || !Number.isFinite(previous) || !Number.isFinite(current)) return null;
  const percent = ((current - previous) / Math.abs(previous)) * 100;
  const abs = Math.abs(percent);
  const num = formatNumber(abs, locale, { maximumFractionDigits: abs < 10 ? 1 : 0 });
  const up = percent >= 0;
  const sign = up ? '+' : '−';
  return {
    text: `${sign}${num}${locale === 'fr' ? `${NNBSP}%` : '%'}`,
    tone: up === higherIsBetter ? 'good' : 'destructive',
    up,
    percent,
  };
}
