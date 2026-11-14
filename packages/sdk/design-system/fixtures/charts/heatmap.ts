/**
 * Calendar heatmap fixtures: a year of journal entries, workouts and moods, dated back from the book's fixed clock
 * (2026-06-15, a Monday). Every value comes from the fixed literals below; nothing is random.
 */
import { FIXED_NOW } from '../../specimen';

const NOW = new Date(FIXED_NOW);
const TODAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());

function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day `back` days before today, as an ISO day. */
function daysAgo(back: number): string {
  return isoDay(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - back));
}

/** A fixed pattern of entries a day, read in a loop: quiet stretches, busy weeks, a few gaps. */
const ENTRIES = [2, 0, 1, 3, 4, 1, 0, 2, 5, 3, 0, 0, 1, 2, 6, 4, 2, 1, 0, 3, 2, 1, 7, 2, 0, 1, 1, 3, 4, 2, 0];
/** Moods from 1 (bad) to 5 (good), read in a loop. */
const MOODS = [3, 4, 4, 2, 3, 5, 4, 3, 1, 2, 3, 4, 5, 5, 4, 3, 3, 2, 2, 3, 4, 4, 3, 5, 4, 2, 1, 3, 4];

export interface HeatRow {
  date: string;
  value: number;
}

/** Journal entries a day over the last 350 days; days with none have no row, one in nine is a day off. */
export const JOURNAL_ENTRIES: HeatRow[] = Array.from({ length: 350 }, (_, back) => ({
  date: daysAgo(back),
  value: back % 9 === 4 ? -1 : ENTRIES[back % ENTRIES.length]!,
})).filter((row) => row.value > 0).reverse();

/** One row per workout over the last 200 days (count them with `valueKey={null}`): weekdays mostly, some doubles. */
export const WORKOUTS: Array<{ date: string; kind: string }> = Array.from({ length: 200 }, (_, back) => back)
  .flatMap((back) => {
    const day = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - back);
    const weekday = day.getDay();
    if (weekday === 0 || back % 11 === 3) return [];
    const kinds = weekday === 6 ? ['run', 'stretch'] : back % 3 === 0 ? ['gym'] : ['run'];
    return kinds.map((kind) => ({ date: isoDay(day), kind }));
  })
  .reverse();

/** A mood from 1 to 5 most days of the last 180; some days have no check-in. */
export const MOODS_BY_DAY: HeatRow[] = Array.from({ length: 180 }, (_, back) => ({
  date: daysAgo(back),
  value: back % 7 === 5 ? 0 : MOODS[back % MOODS.length]!,
})).filter((row) => row.value > 0).reverse();

/** The first of the month six months back, for the shorter heatmaps. */
export const SIX_MONTHS_FROM = isoDay(new Date(TODAY.getFullYear(), TODAY.getMonth() - 5, 1));
