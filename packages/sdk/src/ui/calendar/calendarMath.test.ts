import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agendaDays,
  bucketByDay,
  dayKey,
  monthGrid,
  navOrder,
  offsetStep,
  settleCursor,
  shownChips,
  stepDay,
  toDay,
  todayCursor,
  viewStart,
  visibleDays,
  weekStart,
} from './calendarMath';

// Thursday 15 October 2026.
const TODAY = new Date(2026, 9, 15);

interface Item { id: string; date?: string | null; end?: string }

const ITEMS: Item[] = [
  { id: 'a', date: '2026-10-02' },
  { id: 'b', date: '2026-10-15' },
  { id: 'c', date: '2026-10-15' },
  { id: 'd', date: '2026-10-20', end: '2026-10-22' },
  { id: 'e', date: '2026-10-28' },
  { id: 'f', date: null },
];
const getId = (item: Item) => item.id;
const { byDay, none } = bucketByDay(ITEMS, (i) => i.date, (i) => i.end);
const order = (view: 'month' | 'week' | 'agenda', offset = 0, expandedDay: string | null = null) => navOrder({
  view, days: visibleDays(view, offset, TODAY), byDay, none, getId, expandedDay, today: TODAY,
});

test('ISO days are local days; invalid input gives null', () => {
  assert.equal(dayKey(toDay('2026-10-15')!), '2026-10-15');
  assert.equal(toDay('2026-02-30'), null);
  assert.equal(toDay('not a date'), null);
  assert.equal(toDay(null), null);
  assert.equal(dayKey(weekStart(TODAY)), '2026-10-12');
});

test('month grids are whole weeks starting Monday', () => {
  const grid = monthGrid(TODAY);
  assert.equal(grid.rows, 5);
  assert.equal(dayKey(grid.days[0]!), '2026-09-28');
  assert.equal(dayKey(grid.days[34]!), '2026-11-01');
  assert.equal(dayKey(viewStart('month', 1, TODAY)), '2026-11-01');
  assert.equal(dayKey(viewStart('week', -1, TODAY)), '2026-10-05');
  assert.equal(visibleDays('agenda', 0, TODAY).length, 21);
  assert.equal(offsetStep('agenda'), 3);
  assert.equal(offsetStep('month'), 1);
});

test('items bucket by day; multi-day items cover each day; undated go to the tray', () => {
  assert.deepEqual(byDay.get('2026-10-15')!.map(getId), ['b', 'c']);
  assert.deepEqual(['2026-10-20', '2026-10-21', '2026-10-22'].map((k) => byDay.get(k)!.map(getId)), [['d'], ['d'], ['d']]);
  assert.deepEqual(none.map(getId), ['f']);
});

test('a month cell shows three chips, or two plus "+N more"', () => {
  assert.deepEqual(shownChips([1, 2, 3], false), { shown: [1, 2, 3], more: 0 });
  assert.deepEqual(shownChips([1, 2, 3, 4], false), { shown: [1, 2], more: 2 });
  assert.deepEqual(shownChips([1, 2, 3, 4], true), { shown: [1, 2, 3, 4], more: 0 });
});

test('navigation order walks day by day, counts a multi-day item once, then the tray', () => {
  assert.deepEqual(order('month').map((e) => e.id), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(order('week').map((e) => e.id), ['b', 'c', 'f']);
  assert.deepEqual(order('agenda').map((e) => `${e.id}@${e.day}`), ['b@2026-10-15', 'c@2026-10-15', 'd@2026-10-20', 'e@2026-10-28', 'f@null']);
  const busy = bucketByDay([1, 2, 3, 4].map((n) => ({ id: `x${n}`, date: '2026-10-15' })), (i) => i.date);
  const hidden = navOrder({ view: 'month', days: visibleDays('month', 0, TODAY), byDay: busy.byDay, getId: (i) => i.id, today: TODAY });
  assert.deepEqual(hidden.map((e) => e.id), ['x1', 'x2']);
  const opened = navOrder({ view: 'month', days: visibleDays('month', 0, TODAY), byDay: busy.byDay, getId: (i) => i.id,
    expandedDay: '2026-10-15', today: TODAY });
  assert.equal(opened.length, 4);
});

test('the agenda prints days with items and today', () => {
  const days = agendaDays(visibleDays('agenda', 0, TODAY), byDay, TODAY).map(dayKey);
  assert.deepEqual(days, ['2026-10-15', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-28']);
});

test('T puts the cursor on today, else the next item, else the last one', () => {
  assert.equal(todayCursor(order('month'), TODAY), 'b');
  const later = bucketByDay([{ id: 'n', date: '2026-10-19' }, { id: 'o', date: '2026-10-01' }], (i) => i.date);
  const o = navOrder({ view: 'month', days: visibleDays('month', 0, TODAY), byDay: later.byDay, getId, today: TODAY });
  assert.equal(todayCursor(o, TODAY), 'n');
  const past = bucketByDay([{ id: 'p', date: '2026-10-01' }, { id: 'q', date: '2026-10-03' }], (i) => i.date);
  const po = navOrder({ view: 'month', days: visibleDays('month', 0, TODAY), byDay: past.byDay, getId, today: TODAY });
  assert.equal(todayCursor(po, TODAY), 'q');
  assert.equal(todayCursor([{ id: 'tray', day: null }], TODAY), null);
});

test('the left and right arrows jump to the first item of the previous or next day with items', () => {
  const o = order('month');
  assert.equal(stepDay(o, 'b', 1), 'd');
  assert.equal(stepDay(o, 'c', 1), 'd');
  assert.equal(stepDay(o, 'b', -1), 'a');
  assert.equal(stepDay(o, 'e', 1), 'e', 'clamped at the last day');
  assert.equal(stepDay(o, 'a', -1), 'a', 'clamped at the first day');
  assert.equal(stepDay(o, null, 1), 'a');
  assert.equal(stepDay(o, null, -1), 'e');
  assert.equal(stepDay(o, 'f', 1), 'a', 'from the tray, right starts at the first day');
  assert.equal(stepDay([], 'a', 1), null);
});

test('a step keeps the cursor when it is still shown, else the first item', () => {
  const next = order('month', 1);
  assert.equal(settleCursor(next, 'b'), 'e', 'November starts on 26 October: e is the first item left');
  assert.equal(settleCursor(order('month'), 'c'), 'c');
  assert.equal(settleCursor([], 'c'), null);
});
