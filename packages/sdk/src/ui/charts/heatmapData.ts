/**
 * Calendar heatmap math (CalendarHeatmap): the days of a range bucketed into week columns, the values summed per day,
 * and each value's colour level. Pure: date-fns and Intl only, no React. Days are keyed by their local ISO day
 * (`2026-06-15`), built with calendar arithmetic, so a daylight saving change never skips or repeats a day.
 */

import { addDays, startOfDay, startOfMonth, subMonths } from 'date-fns';
import type { Locale } from '../../words/types';
import { dayKey, toDay, type DateInput } from '../calendar/calendarMath';
import { dateFormat, formatDay } from '../period/dateFormat';

/** One day of the heatmap: its value (the sum of its rows), or null when no row falls on it. */
export interface HeatmapDay {
  date: Date;
  /** The local ISO day, `2026-06-15`. */
  key: string;
  value: number | null;
  /** The data rows of that day, in data order. */
  rows: readonly object[];
}

/** One week column: seven slots from the week's first day; a slot outside the range is null (not drawn). */
export interface HeatmapWeek {
  start: Date;
  days: readonly (HeatmapDay | null)[];
}

export interface HeatmapRange {
  from: Date;
  to: Date;
}

/**
 * The days a heatmap covers: `to` defaults to today, `from` to the first of the month eleven months before `to` (the
 * toolkit's "Last 12 months"). Swapped when given backwards.
 */
export function heatmapRange(from: DateInput, to: DateInput, today: Date): HeatmapRange {
  const end = toDay(to) ?? startOfDay(today);
  const start = toDay(from) ?? startOfMonth(subMonths(end, 11));
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

/** A finite number, or a string that reads as one ("3", as a number property can arrive), as Chart reads values. */
function toNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Sums the rows per local day. A row counts when its `dateKey` field is a day (a Date, an ISO day or time, a
 * timestamp) and its `valueKey` field a finite number (or a string reading as one); with `valueKey` null every dated row counts 1, so a list of
 * entries gives how many fell on each day.
 */
export function bucketDays(data: readonly object[], dateKey: string, valueKey: string | null):
  Map<string, { value: number; rows: object[] }> {
  const out = new Map<string, { value: number; rows: object[] }>();
  for (const row of data) {
    const record = row as Record<string, unknown>;
    const day = toDay(record[dateKey] as DateInput);
    if (!day) continue;
    const raw = valueKey === null ? 1 : toNumber(record[valueKey]);
    if (raw === null) continue;
    const key = dayKey(day);
    const slot = out.get(key);
    if (slot) { slot.value += raw; slot.rows.push(row); } else out.set(key, { value: raw, rows: [row] });
  }
  return out;
}

/**
 * The week columns of a range: each starts on `weekStartsOn` (0 Sunday to 6 Saturday; Monday by default) and holds
 * seven slots. Days before `from` and after `to` are null.
 */
export function heatmapWeeks(range: HeatmapRange, byDay: ReadonlyMap<string, { value: number; rows: readonly object[] }>,
  weekStartsOn = 1): HeatmapWeek[] {
  const lead = (range.from.getDay() - weekStartsOn + 7) % 7;
  const fromKey = dayKey(range.from);
  const toKey = dayKey(range.to);
  const weeks: HeatmapWeek[] = [];
  for (let start = addDays(range.from, -lead); dayKey(start) <= toKey; start = addDays(start, 7)) {
    const days = Array.from({ length: 7 }, (_, i): HeatmapDay | null => {
      const date = addDays(start, i);
      const key = dayKey(date);
      if (key < fromKey || key > toKey) return null;
      const slot = byDay.get(key);
      return { date, key, value: slot ? slot.value : null, rows: slot ? slot.rows : [] };
    });
    weeks.push({ start, days });
  }
  return weeks;
}

export type HeatmapScaleKind = 'sequential' | 'diverging';

export interface HeatmapScale {
  kind: HeatmapScaleKind;
  /** Colour steps, the empty one included (2 to 9). */
  levels: number;
  lo: number;
  hi: number;
  mid: number;
  /** A `domain` was given: every value is placed on it, zero and below included. */
  fixed: boolean;
}

export interface HeatmapScaleOptions {
  kind?: HeatmapScaleKind;
  levels?: number;
  domain?: readonly [number, number];
  midpoint?: number;
}

/** The scale of a set of values: by default from 0 to the largest value (sequential) or around 0 (diverging). */
export function heatmapScale(values: readonly number[], options: HeatmapScaleOptions = {}): HeatmapScale {
  const kind = options.kind ?? 'sequential';
  const levels = Math.min(9, Math.max(2, Math.round(Number.isFinite(options.levels) ? options.levels! : 5)));
  const domain = options.domain && Number.isFinite(options.domain[0]) && Number.isFinite(options.domain[1])
    ? [Math.min(options.domain[0], options.domain[1]), Math.max(options.domain[0], options.domain[1])] as const : null;
  const finite = values.filter((v) => Number.isFinite(v));
  if (kind === 'diverging') {
    const mid = Number.isFinite(options.midpoint) ? options.midpoint! : domain ? (domain[0] + domain[1]) / 2 : 0;
    const span = domain ? Math.max(domain[1] - mid, mid - domain[0])
      : finite.reduce((m, v) => Math.max(m, Math.abs(v - mid)), 0);
    return { kind, levels, lo: mid - span, hi: mid + span, mid, fixed: !!domain };
  }
  const lo = domain ? domain[0] : 0;
  const hi = domain ? domain[1] : finite.reduce((m, v) => Math.max(m, v), 0);
  return { kind, levels, lo, hi, mid: lo, fixed: !!domain };
}

/**
 * The colour level of a value. Sequential: 0 (the empty colour) to `levels - 1`; a value at or below zero is 0 unless a
 * domain is fixed, the largest value is the top level, and equal values all take it. Diverging: from `-(levels - 1)`
 * (furthest below the midpoint) to `levels - 1` (furthest above), 0 at the midpoint. No value (null) is 0.
 */
export function heatmapLevel(value: number | null, scale: HeatmapScale): number {
  if (value === null || !Number.isFinite(value)) return 0;
  const steps = scale.levels - 1;
  const step = (share: number) => Math.max(1, Math.min(steps, Math.ceil(share * steps - 1e-9)));
  if (scale.kind === 'diverging') {
    const offset = value - scale.mid;
    const span = scale.hi - scale.mid;
    if (offset === 0 || span <= 0) return 0;
    return Math.sign(offset) * step(Math.min(1, Math.abs(offset) / span));
  }
  if (!scale.fixed && value <= 0) return 0;
  if (scale.hi <= scale.lo) return steps;
  return step(Math.min(1, Math.max(0, (value - scale.lo) / (scale.hi - scale.lo))));
}

/** The fill opacity of a level: a quarter for the first step up to full for the top one. */
export function heatmapAlpha(level: number, levels: number): number {
  const steps = levels - 1;
  const n = Math.abs(level);
  if (n === 0) return 0;
  if (steps <= 1) return 1;
  return Math.round((0.25 + (0.75 * (n - 1)) / (steps - 1)) * 1000) / 1000;
}

/** The month labels over the columns: a label where the first drawn day of a column starts a new month. */
export function heatmapMonths(weeks: readonly HeatmapWeek[]): Array<{ column: number; month: Date }> {
  const out: Array<{ column: number; month: Date }> = [];
  let previous = -1;
  weeks.forEach((week, column) => {
    const first = week.days.find((d): d is HeatmapDay => d !== null);
    if (!first) return;
    const month = first.date.getFullYear() * 12 + first.date.getMonth();
    if (month === previous) return;
    previous = month;
    out.push({ column, month: new Date(first.date.getFullYear(), first.date.getMonth(), 1) });
  });
  // A first label squeezed against the next one (a range starting late in a month) gives way.
  if (out.length > 1 && out[1]!.column - out[0]!.column < 3) out.shift();
  // A label in the last column would run past the grid's end: it gives way too.
  if (out.length > 1 && out[out.length - 1]!.column >= weeks.length - 1) out.pop();
  return out;
}

/** A day as a cell names it: "Mon, Jun 15" / "lun. 15 juin" (French writes the first "1er"), with the year when asked. */
export function heatmapDayLabel(date: Date, locale: Locale, withYear = false): string {
  const options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
  if (withYear) options.year = 'numeric';
  return formatDay(dateFormat(locale, options), date, locale);
}
