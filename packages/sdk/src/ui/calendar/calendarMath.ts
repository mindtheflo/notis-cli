/**
 * CalendarView math (toolkit spec 2.11, deck layouts-new.js calendar). Pure: date-fns only, no React.
 *
 * Weeks start on Monday. Month view shows whole weeks around the month; week view one week; agenda three weeks
 * from the start of the shown week, skipping empty days except today. Navigation order is the order the chips
 * appear: day by day, then the tray of items with no date.
 */

import { addDays, addMonths, differenceInCalendarDays, getDaysInMonth, isValid, startOfDay, startOfMonth } from 'date-fns';
import { toIsoDay } from '../period/periods';

export type CalendarViewKind = 'month' | 'week' | 'agenda';

export const CALENDAR_VIEWS: readonly CalendarViewKind[] = Object.freeze(['month', 'week', 'agenda'] as CalendarViewKind[]);

/** Days an agenda shows. */
export const AGENDA_DAYS = 21;
/** A month cell shows this many chips; with more, one fewer plus "+N more". */
export const MONTH_CHIPS = 3;
/** A multi-day item is drawn on at most this many days. */
export const MAX_SPAN_DAYS = 62;

export type DateInput = Date | string | number | null | undefined;

/** A local day from a Date, an ISO day ("2026-10-15", local), an ISO time or a timestamp. Invalid gives null. */
export function toDay(value: DateInput): Date | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    const day = new Date(y, m - 1, d);
    return day.getMonth() === m - 1 ? day : null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return isValid(date) ? startOfDay(date) : null;
}

export const dayKey = toIsoDay;

/** Monday of the week holding `date`. */
export function weekStart(date: Date): Date {
  const day = startOfDay(date);
  return addDays(day, -((day.getDay() + 6) % 7));
}

export function isWeekend(date: Date): boolean {
  const d = date.getDay();
  return d === 0 || d === 6;
}

/** The first day each view starts on for an offset (months for month, weeks for week and agenda) from today. */
export function viewStart(view: CalendarViewKind, offset: number, today: Date): Date {
  if (view === 'month') return startOfMonth(addMonths(startOfDay(today), offset));
  return addDays(weekStart(today), 7 * offset);
}

/** How far `[` and `]` move the offset: one month, one week, or three weeks for the agenda. */
export function offsetStep(view: CalendarViewKind): number {
  return view === 'agenda' ? 3 : 1;
}

export interface MonthGrid {
  /** First of the month. */
  month: Date;
  /** Whole weeks, Monday first: `rows * 7` days. */
  days: Date[];
  rows: number;
}

export function monthGrid(monthDate: Date): MonthGrid {
  const month = startOfMonth(monthDate);
  const lead = (month.getDay() + 6) % 7;
  const rows = Math.ceil((lead + getDaysInMonth(month)) / 7);
  const start = addDays(month, -lead);
  return { month, rows, days: Array.from({ length: rows * 7 }, (_, i) => addDays(start, i)) };
}

export function weekDays(start: Date): Date[] {
  const first = weekStart(start);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/** The days a view shows (the month view's whole weeks, the week, or the agenda's 21 days). */
export function visibleDays(view: CalendarViewKind, offset: number, today: Date): Date[] {
  const start = viewStart(view, offset, today);
  if (view === 'month') return monthGrid(start).days;
  if (view === 'week') return weekDays(start);
  return Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(start, i));
}

export interface DayBuckets<T> {
  byDay: Map<string, T[]>;
  none: T[];
}

/**
 * Items by day key. With `getEnd`, an item is drawn on each day from its date to its end (at most MAX_SPAN_DAYS);
 * an end before the start counts as one day. Order inside a day keeps the input order.
 */
export function bucketByDay<T>(items: readonly T[], getDate: (item: T) => DateInput, getEnd?: (item: T) => DateInput):
  DayBuckets<T> {
  const byDay = new Map<string, T[]>();
  const none: T[] = [];
  const push = (key: string, item: T) => {
    const list = byDay.get(key);
    if (list) list.push(item);
    else byDay.set(key, [item]);
  };
  for (const item of items) {
    const start = toDay(getDate(item));
    if (!start) { none.push(item); continue; }
    const end = getEnd ? toDay(getEnd(item)) : null;
    const span = end ? Math.min(MAX_SPAN_DAYS, Math.max(1, differenceInCalendarDays(end, start) + 1)) : 1;
    for (let i = 0; i < span; i++) push(dayKey(addDays(start, i)), item);
  }
  return { byDay, none };
}

/** The chips a month cell shows: all up to three; with more, two (unless expanded). */
export function shownChips<T>(items: readonly T[], expanded: boolean, limit = MONTH_CHIPS): { shown: T[]; more: number } {
  const shown = items.length > limit && !expanded ? items.slice(0, limit - 1) : items.slice();
  return { shown, more: items.length - shown.length };
}

/** Days of the agenda that print: those with items, and today always. */
export function agendaDays<T>(days: readonly Date[], byDay: Map<string, T[]>, today: Date): Date[] {
  const todayKey = dayKey(today);
  return days.filter((d) => (byDay.get(dayKey(d))?.length ?? 0) > 0 || dayKey(d) === todayKey);
}

export interface NavEntry {
  id: string;
  /** Day key, or null for the tray. */
  day: string | null;
}

/**
 * Chips in the order they appear (what J and K walk): day by day over the shown days, then the tray. An item
 * drawn on several days counts once, at its first day. Month cells hide what sits behind "+N more".
 */
export function navOrder<T>(options: {
  view: CalendarViewKind;
  days: readonly Date[];
  byDay: Map<string, T[]>;
  none?: readonly T[];
  getId: (item: T) => string;
  expandedDay?: string | null;
  today: Date;
}): NavEntry[] {
  const { view, byDay, getId } = options;
  const days = view === 'agenda' ? agendaDays(options.days, byDay, options.today) : options.days;
  const seen = new Set<string>();
  const out: NavEntry[] = [];
  for (const d of days) {
    const key = dayKey(d);
    const items = byDay.get(key) ?? [];
    const shown = view === 'month' ? shownChips(items, options.expandedDay === key).shown : items;
    for (const item of shown) {
      const id = getId(item);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, day: key });
    }
  }
  for (const item of options.none ?? []) {
    const id = getId(item);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, day: null });
  }
  return out;
}

/** ArrowRight and ArrowLeft: the first chip of the next (or previous) day that has chips. No cursor starts at the ends. */
export function stepDay(order: readonly NavEntry[], cursor: string | null | undefined, delta: 1 | -1): string | null {
  const dated = order.filter((e) => e.day != null);
  if (!dated.length) return null;
  const days: string[] = [];
  for (const e of dated) if (days[days.length - 1] !== e.day) days.push(e.day!);
  const current = cursor == null ? undefined : order.find((e) => e.id === cursor);
  const at = current?.day == null ? -1 : days.indexOf(current.day);
  const target = at === -1
    ? (delta > 0 ? days[0] : days[days.length - 1])
    : days[Math.max(0, Math.min(days.length - 1, at + delta))];
  return dated.find((e) => e.day === target)?.id ?? null;
}

/**
 * Where T puts the cursor once the view is back on today: the first chip of today, else the first chip after today,
 * else the last chip before it, else nothing.
 */
export function todayCursor(order: readonly NavEntry[], today: Date): string | null {
  const key = dayKey(today);
  const dated = order.filter((e) => e.day != null);
  return dated.find((e) => e.day! >= key)?.id ?? dated[dated.length - 1]?.id ?? null;
}

/** Keeps the cursor when it is still shown; else the first chip (or nothing). */
export function settleCursor(order: readonly NavEntry[], cursor: string | null | undefined): string | null {
  if (cursor != null && order.some((e) => e.id === cursor)) return cursor;
  return order[0]?.id ?? null;
}
