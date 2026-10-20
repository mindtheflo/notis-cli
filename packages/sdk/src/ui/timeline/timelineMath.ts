/**
 * TimelineView math (toolkit spec 2.11, deck round 5 "timeline"). Pure: date-fns only, no React.
 *
 * Days are counted from today (0 is today). Each zoom shows a fixed window around today and a fixed number of pixels
 * per day, so the roadmap scrolls sideways instead of squeezing titles. Bars of a lane are packed in rows: a bar takes
 * the first row whose last bar ended before it starts.
 */

import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';
import type { Locale } from '../../words/types';
import { dateFormat, formatShortDay, upFirst } from '../period/dateFormat';
import { toDay, type DateInput } from '../calendar/calendarMath';

export type TimelineZoom = 'week' | 'month' | 'quarter';

export const TIMELINE_ZOOMS: readonly TimelineZoom[] = Object.freeze(['week', 'month', 'quarter'] as TimelineZoom[]);

/** Window of each zoom: first day (from today), days shown, pixels per day. */
export const TIMELINE_ZOOM: Readonly<Record<TimelineZoom, { from: number; span: number; px: number }>> = Object.freeze({
  week: { from: -7, span: 35, px: 40 },
  month: { from: -14, span: 98, px: 14 },
  quarter: { from: -30, span: 210, px: 6 },
});

/** How far `[` and `]` move the window, in days. */
export const TIMELINE_STEP: Readonly<Record<TimelineZoom, number>> = Object.freeze({ week: 7, month: 28, quarter: 91 });

export const TIMELINE_ROW_H = 36;
export const TIMELINE_BAR_TOP = 6;
export const TIMELINE_TRACK_PAD = 12;
/** A bar cut by the window edge needs this many visible days to carry its title; thinner slivers are left out. */
export const TIMELINE_MIN_VISIBLE_DAYS = 4;
/** A tick label this close to today (share of the window) hides behind the Today chip. */
export const TIMELINE_TODAY_GAP = 0.045;

export interface TimelineWindow {
  zoom: TimelineZoom;
  /** First day shown, in days from today. */
  from: number;
  span: number;
  px: number;
}

export function timelineWindow(zoom: TimelineZoom, offset = 0): TimelineWindow {
  const z = TIMELINE_ZOOM[zoom];
  return { zoom, from: z.from + offset * TIMELINE_STEP[zoom], span: z.span, px: z.px };
}

/** `min-width` of the timeline: the lane labels (9rem) plus the days. */
export function timelineMinWidth(win: TimelineWindow): string {
  return `calc(9rem + ${win.span * win.px}px)`;
}

/** Days from today to a day. */
export function dayIndex(date: Date, today: Date): number {
  return differenceInCalendarDays(startOfDay(date), startOfDay(today));
}

/** Start day and end day (exclusive) from today. No end, or an end before the start, gives one day. */
export interface DaySpan {
  s: number;
  e: number;
}

export function itemSpan(start: DateInput, end: DateInput, today: Date): DaySpan | null {
  const a = toDay(start);
  if (!a) return null;
  const b = toDay(end);
  const s = dayIndex(a, today);
  const last = b ? dayIndex(b, today) : s;
  return { s, e: Math.max(s, last) + 1 };
}

export function barVisibleDays(span: DaySpan, win: TimelineWindow): number {
  return Math.min(span.e, win.from + win.span) - Math.max(span.s, win.from);
}

/**
 * The bar shows when it is wholly inside the window, or when its visible part is at least four days (the deck's
 * rule for slivers at the edges).
 */
export function inView(span: DaySpan, win: TimelineWindow): boolean {
  const visible = barVisibleDays(span, win);
  if (visible <= 0) return false;
  return visible >= Math.min(TIMELINE_MIN_VISIBLE_DAYS, span.e - span.s);
}

/** Packs bars into rows, sorted by start (stable). */
export function packRows<B extends { span: DaySpan }>(bars: readonly B[]): { bars: Array<B & { row: number }>; rows: number } {
  const ends: number[] = [];
  const sorted = bars.map((bar, i) => ({ bar, i })).sort((x, y) => x.bar.span.s - y.bar.span.s || x.i - y.i);
  const out = sorted.map(({ bar }) => {
    const lastDay = bar.span.e - 1;
    let row = ends.findIndex((end) => end < bar.span.s);
    if (row < 0) { row = ends.length; ends.push(lastDay); } else ends[row] = lastDay;
    return { ...bar, row };
  });
  return { bars: out, rows: Math.max(1, ends.length) };
}

export interface BarGeometry {
  /** Percent of the track. */
  left: number;
  width: number;
  top: number;
  cutLeft: boolean;
  cutRight: boolean;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export function barGeometry(span: DaySpan, win: TimelineWindow, row: number): BarGeometry {
  const a = Math.max(span.s, win.from);
  const b = Math.min(span.e, win.from + win.span);
  return {
    left: round(((a - win.from) / win.span) * 100),
    width: round((Math.max(0, b - a) / win.span) * 100),
    top: row * TIMELINE_ROW_H + TIMELINE_BAR_TOP,
    cutLeft: span.s < win.from,
    cutRight: span.e > win.from + win.span,
  };
}

export function trackHeight(rows: number): number {
  return Math.max(1, rows) * TIMELINE_ROW_H + TIMELINE_TRACK_PAD;
}

/** Percent of the track for a day from today. */
export function dayPercent(day: number, win: TimelineWindow): number {
  return round(((day - win.from) / win.span) * 100);
}

export function todayInWindow(win: TimelineWindow): boolean {
  return win.from <= 0 && 0 < win.from + win.span;
}

export interface TimelineTick {
  /** Days from today. */
  day: number;
  date: Date;
  label: string;
  percent: number;
  /** False when the label would sit under the Today chip (the grid line still draws). */
  showLabel: boolean;
}

/** Quarter: the first of each month ("Nov" / "Nov."). Week and month: every Monday ("Oct 19" / "19 oct."). */
export function timelineTicks(win: TimelineWindow, today: Date, locale: Locale): TimelineTick[] {
  const out: TimelineTick[] = [];
  const monthFmt = dateFormat(locale, { month: 'short' });
  for (let d = win.from; d < win.from + win.span; d++) {
    const date = addDays(startOfDay(today), d);
    const hit = win.zoom === 'quarter' ? date.getDate() === 1 : date.getDay() === 1;
    if (!hit) continue;
    out.push({
      day: d,
      date,
      label: win.zoom === 'quarter' ? upFirst(monthFmt.format(date)) : formatShortDay(date, locale),
      percent: dayPercent(d, win),
      showLabel: !todayInWindow(win) || Math.abs(d / win.span) > TIMELINE_TODAY_GAP,
    });
  }
  return out;
}

export interface TimelineLaneInfo {
  id: string;
  label: string;
}

export interface LaidBar<T> {
  item: T;
  id: string;
  span: DaySpan;
  row: number;
  geometry: BarGeometry;
}

export interface LaidLane<T> extends TimelineLaneInfo {
  bars: Array<LaidBar<T>>;
  rows: number;
  height: number;
  /** Items of the lane in the window. */
  count: number;
}

export interface TimelineLayoutInput<T> {
  items: readonly T[];
  getId: (item: T) => string;
  getStart: (item: T) => DateInput;
  getEnd: (item: T) => DateInput;
  lane: (item: T) => TimelineLaneInfo;
  /** Lane order; lanes not listed follow in the order they first appear. Lanes listed here show even when empty. */
  lanes?: readonly TimelineLaneInfo[];
  win: TimelineWindow;
  today: Date;
}

/** Lanes with packed bars, plus `order`: the bar ids lane by lane, by start (what J and K walk). */
export function layoutTimeline<T>(input: TimelineLayoutInput<T>): { lanes: Array<LaidLane<T>>; order: string[]; undated: T[] } {
  const groups = new Map<string, { info: TimelineLaneInfo; bars: Array<{ item: T; id: string; span: DaySpan }> }>();
  for (const info of input.lanes ?? []) groups.set(info.id, { info, bars: [] });
  const undated: T[] = [];
  for (const item of input.items) {
    const span = itemSpan(input.getStart(item), input.getEnd(item), input.today);
    if (!span) { undated.push(item); continue; }
    if (!inView(span, input.win)) continue;
    const info = input.lane(item);
    let group = groups.get(info.id);
    if (!group) { group = { info, bars: [] }; groups.set(info.id, group); }
    group.bars.push({ item, id: input.getId(item), span });
  }
  const lanes: Array<LaidLane<T>> = [];
  const order: string[] = [];
  for (const { info, bars } of groups.values()) {
    const packed = packRows(bars);
    const laid = packed.bars.map((bar) => ({ ...bar, geometry: barGeometry(bar.span, input.win, bar.row) }));
    for (const bar of laid) order.push(bar.id);
    lanes.push({ ...info, bars: laid, rows: packed.rows, height: trackHeight(packed.rows), count: laid.length });
  }
  return { lanes, order, undated };
}

/**
 * Where T puts the cursor once the window is back on today: the first bar (in reading order) running today, else the
 * bar starting soonest after today, else the last bar.
 */
export function timelineTodayCursor<T>(lanes: ReadonlyArray<LaidLane<T>>): string | null {
  const bars = lanes.flatMap((lane) => lane.bars);
  const running = bars.find((b) => b.span.s <= 0 && 0 < b.span.e);
  if (running) return running.id;
  const after = bars.filter((b) => b.span.s > 0).sort((a, b) => a.span.s - b.span.s)[0];
  return after?.id ?? bars[bars.length - 1]?.id ?? null;
}
