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

export interface FormatDurationOptions {
  /** How many units at most, biggest first: 1, 2 (default) or 3. */
  units?: 1 | 2 | 3;
  /** The smallest unit shown. Default 'second'; 'minute' rounds to the minute (see formatDuration). */
  smallest?: 'second' | 'minute';
}

const NBSP = ' ';
const DURATION_UNITS = [
  { ms: 86_400_000, en: 'd', fr: 'j' },
  { ms: 3_600_000, en: 'h', fr: 'h' },
  { ms: 60_000, en: 'min', fr: 'min' },
  { ms: 1_000, en: 's', fr: 's' },
] as const;

/** The toolkit locale of a locale tag: 'fr', 'fr-FR' or 'fr-CA' read French, anything else English. */
function durationLocale(locale: Locale | string): Locale {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

/**
 * A length of time in its biggest units: "4 d 5 h", "1 h 31 min", "7 min", "45 s" / "4 j 5 h", "1 h 31 min". A
 * no-break space joins each number to its unit; numbers use the locale's grouping ("1,234 d"). The last unit shown
 * is rounded to the nearest, and a unit that rounds to zero is left out ("2 h", not "2 h 0 min"). A negative,
 * NaN or infinite value reads "-". With `smallest: 'minute'`, zero reads "0 min" and anything above zero that rounds
 * to under a minute reads "< 1 min" (never "0 min" for time that did pass); with seconds, zero reads "0 s".
 */
export function formatDuration(ms: number, locale: Locale | string, opts: FormatDurationOptions = {}): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '-';
  const lang = durationLocale(locale);
  const count = opts.units === 1 || opts.units === 3 ? opts.units : 2;
  const smallest = opts.smallest === 'minute' ? 2 : 3;
  const part = (value: number, unit: number) => `${formatNumber(value, lang)}${NBSP}${DURATION_UNITS[unit]![lang]}`;
  const lead = (total: number) => DURATION_UNITS.findIndex((unit) => total >= unit.ms);
  // Round to the smallest unit first, find the biggest unit, then round to the last unit shown. Rounding can carry
  // into a bigger unit (59 min 50 s in one unit reads "1 h"), so the lead is found again after it.
  let rounded = Math.round(ms / DURATION_UNITS[smallest]!.ms) * DURATION_UNITS[smallest]!.ms;
  if (rounded === 0) return ms > 0 && smallest === 2 ? `<${NBSP}${part(1, 2)}` : part(0, smallest);
  let first = lead(rounded);
  let last = Math.min(smallest, first + count - 1);
  rounded = Math.round(ms / DURATION_UNITS[last]!.ms) * DURATION_UNITS[last]!.ms;
  if (lead(rounded) !== first) {
    first = lead(rounded);
    last = Math.min(smallest, first + count - 1);
  }
  const parts: string[] = [];
  let rest = rounded;
  for (let unit = first; unit <= last; unit += 1) {
    const size = DURATION_UNITS[unit]!.ms;
    const value = Math.floor(rest / size);
    rest -= value * size;
    if (value > 0) parts.push(part(value, unit));
  }
  return parts.join(' ');
}
