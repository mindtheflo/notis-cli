/**
 * Chart data mapping (toolkit spec 2.11). Pure: date-fns only.
 *
 * Dated points go into bins sized for the period, the way the deck draws it: hours for one day, days up to a month,
 * weeks up to six months, then months. The comparison period is binned the same way and lined up bin by bin.
 */

import { addDays, addHours, differenceInCalendarDays, endOfDay, endOfHour, endOfMonth, startOfDay, startOfHour } from 'date-fns';
import type { Locale } from '../../words/types';
import { dateFormat, formatDateRange } from '../period/dateFormat';
import { dayCount, type DateRange } from '../period/periods';

export type BinUnit = 'hour' | 'day' | 'week' | 'month';

export interface Bin {
  from: Date;
  to: Date;
}

export interface DatedPoint {
  date: Date | string | number;
  value: number;
}

/** One row of a period chart: the bin, its value and, with a comparison, the value of the same bin before. */
export interface PeriodChartRow {
  /** ISO start of the bin, a stable key. */
  key: string;
  /** Short axis label ("Jan 5", "14", "Mar"). */
  label: string;
  /** Full bin name for tooltips ("Jan 5 to 11, 2026"). */
  range: string;
  from: Date;
  to: Date;
  value: number;
  compare: number | null;
}

export function binUnit(range: DateRange): BinUnit {
  const n = dayCount(range);
  return n <= 1 ? 'hour' : n <= 31 ? 'day' : n <= 186 ? 'week' : 'month';
}

/** The bins of a range. Weeks step seven days from the first day; the last week and month stop at the range end. */
export function buildBins(range: DateRange, unit: BinUnit = binUnit(range)): Bin[] {
  const start = startOfDay(range.from);
  const end = endOfDay(range.to);
  const out: Bin[] = [];
  if (unit === 'hour') {
    for (let h = startOfHour(start); h <= end; h = addHours(h, 1)) out.push({ from: h, to: endOfHour(h) });
    return out;
  }
  if (unit === 'day') {
    for (let d = start; d <= end; d = addDays(d, 1)) out.push({ from: d, to: endOfDay(d) });
    return out;
  }
  if (unit === 'week') {
    for (let d = start; d <= end; d = addDays(d, 7)) {
      const last = endOfDay(addDays(d, 6));
      out.push({ from: d, to: last < end ? last : end });
    }
    return out;
  }
  for (let d = start; d <= end;) {
    const last = endOfMonth(d);
    out.push({ from: d, to: last < end ? last : end });
    d = startOfDay(addDays(last, 1));
  }
  return out;
}

function toTime(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  // A bare ISO day is a local day, not UTC midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d).getTime();
  }
  return new Date(value).getTime();
}

/** Adds up (or averages, for levels such as active users) the points that fall in each bin. Empty bins are 0. */
export function aggregate(points: readonly DatedPoint[], bins: readonly Bin[], mode: 'sum' | 'avg' = 'sum'): number[] {
  const sums = bins.map(() => 0);
  const counts = bins.map(() => 0);
  if (!bins.length) return sums;
  const starts = bins.map((b) => b.from.getTime());
  const last = bins[bins.length - 1]!.to.getTime();
  for (const point of points) {
    const t = toTime(point.date);
    const v = Number(point.value);
    if (!Number.isFinite(t) || !Number.isFinite(v) || t < starts[0]! || t > last) continue;
    // Binary search for the last bin starting at or before t.
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= t) lo = mid;
      else hi = mid - 1;
    }
    sums[lo]! += v;
    counts[lo]! += 1;
  }
  return mode === 'avg' ? sums.map((s, i) => (counts[i] ? s / counts[i]! : 0)) : sums;
}

export function binLabel(bin: Bin, unit: BinUnit, locale: Locale): string {
  if (unit === 'hour') return dateFormat(locale, { hour: 'numeric' }).format(bin.from);
  if (unit === 'month') return dateFormat(locale, { month: 'short' }).format(bin.from);
  return dateFormat(locale, { day: 'numeric', month: 'short' }).format(bin.from);
}

export function binRangeLabel(bin: Bin, unit: BinUnit, locale: Locale): string {
  if (unit === 'hour') return `${binLabel(bin, unit, locale)}, ${formatDateRange({ from: bin.from, to: bin.from }, locale)}`;
  if (unit === 'day') return formatDateRange({ from: bin.from, to: bin.from }, locale);
  return formatDateRange(bin, locale);
}

export interface PeriodSeriesInput {
  points: readonly DatedPoint[];
  range: DateRange;
  /** The comparison range; its points come from `comparePoints`, or from `points` when they cover it. */
  compareRange?: DateRange | null;
  comparePoints?: readonly DatedPoint[];
  mode?: 'sum' | 'avg';
  unit?: BinUnit;
  locale: Locale;
}

/** Rows for `<Chart>`: one per bin of the period, with the comparison lined up bin by bin (cut to the same count). */
export function periodSeries(input: PeriodSeriesInput): PeriodChartRow[] {
  const unit = input.unit ?? binUnit(input.range);
  const bins = buildBins(input.range, unit);
  const values = aggregate(input.points, bins, input.mode);
  let previous: number[] = [];
  if (input.compareRange) {
    const cmpBins = buildBins(input.compareRange, unit).slice(0, bins.length);
    previous = aggregate(input.comparePoints ?? input.points, cmpBins, input.mode);
  }
  return bins.map((bin, i) => ({
    key: bin.from.toISOString(),
    label: binLabel(bin, unit, input.locale),
    range: binRangeLabel(bin, unit, input.locale),
    from: bin.from,
    to: bin.to,
    value: values[i] ?? 0,
    compare: input.compareRange ? previous[i] ?? null : null,
  }));
}

/** Sum or average of a period, for a stat next to the chart. */
export function total(points: readonly DatedPoint[], range: DateRange, mode: 'sum' | 'avg' = 'sum'): number {
  const days = buildBins(range, 'day');
  const perDay = aggregate(points, days, 'sum');
  const sum = perDay.reduce((a, b) => a + b, 0);
  return mode === 'avg' ? sum / Math.max(1, differenceInCalendarDays(range.to, range.from) + 1) : sum;
}

/** Half the widest short axis label ("15 sept.", "12 PM"), in px. */
export const AXIS_LABEL_HALF = 24;

/**
 * Room between two labelled points of a line or area chart, in px (80): an edge label anchored inward (see
 * `edgeAnchor`), a whole label wide, and the centred label next to it, half a label, keep 8px apart.
 */
export const AXIS_LABEL_ROOM = 3 * AXIS_LABEL_HALF + 8;

/**
 * Axis labels: about seven, counted back from the last bin so the newest one always shows. With `spacing`, the px
 * between neighbouring points, a narrow chart labels fewer points so no two labels meet.
 */
export function axisLabelStep(count: number, spacing?: number): number {
  const room = spacing && spacing > 0 ? Math.ceil(AXIS_LABEL_ROOM / spacing) : 1;
  return Math.max(1, Math.ceil(count / 7), room);
}

export function showAxisLabel(index: number, count: number, spacing?: number): boolean {
  return (count - 1 - index) % axisLabelStep(count, spacing) === 0;
}

/**
 * How an axis label sits on its point `x` in a line or area chart, whose first and last points lie on the plot edges
 * (`left`, `right`): a label closer to an edge than half a label starts (left) or ends (right) at its point, so it
 * never runs out of the chart. Every other label is centred.
 */
export function edgeAnchor(x: number, left: number, right: number): 'start' | 'middle' | 'end' {
  if (!(right - left > 2 * AXIS_LABEL_HALF) || !Number.isFinite(x)) return 'middle';
  if (x - left < AXIS_LABEL_HALF) return 'start';
  if (right - x < AXIS_LABEL_HALF) return 'end';
  return 'middle';
}

/** Top of the value axis: 10% above the highest value (this period or the comparison), never below 1. */
export function chartMax(values: ReadonlyArray<number | null | undefined>): number {
  let max = 1;
  for (const v of values) if (typeof v === 'number' && Number.isFinite(v) && v > max) max = v;
  return max * 1.1;
}

/** True when the period ends today, so its last bin is still filling (drawn full colour). */
export function endsToday(range: DateRange, now: Date = new Date()): boolean {
  return differenceInCalendarDays(range.to, now) === 0;
}

/**
 * Paths of a sparkline (deck: an area plus a line, 72 by 24): `line` strokes the values left to right, `area` closes
 * it down to the baseline. Values scale to the highest one (×1.1, like the chart); one value draws a flat line.
 * A missing value (null, undefined, NaN) is a gap: each point keeps its place, the line and the area break at the
 * gap, and a point alone between gaps is a dot (a zero-length segment the round line cap draws).
 */
export function sparkPaths(
  values: readonly (number | null | undefined)[],
  width = 72,
  height = 24,
): { line: string; area: string } {
  const known = values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
  const max = chartMax(known);
  if (!known.some((v) => v != null)) return { line: '', area: '' };
  const round = (v: number) => Math.round(v * 100) / 100;
  const y = (v: number) => round(height - (Math.max(0, v) / max) * height);
  const closed = (points: ReadonlyArray<readonly [number, number]>) => {
    const line = points.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join(' ');
    return { line, area: `${line} L${points[points.length - 1]![0]} ${height} L${points[0]![0]} ${height} Z` };
  };
  const n = known.length;
  if (n === 1) return closed([[0, y(known[0]!)], [width, y(known[0]!)]]);
  const runs: Array<Array<readonly [number, number]>> = [[]];
  known.forEach((v, i) => {
    if (v == null) runs.push([]);
    else runs[runs.length - 1]!.push([round((i / (n - 1)) * width), y(v)]);
  });
  const lines: string[] = [];
  const areas: string[] = [];
  for (const points of runs) {
    if (points.length === 1) lines.push(`M${points[0]![0]} ${points[0]![1]} L${points[0]![0]} ${points[0]![1]}`);
    else if (points.length > 1) {
      const path = closed(points);
      lines.push(path.line);
      areas.push(path.area);
    }
  }
  return { line: lines.join(' '), area: areas.join(' ') };
}
