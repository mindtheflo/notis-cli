import assert from 'node:assert/strict';
import test from 'node:test';

import {
  barGeometry,
  inView,
  itemSpan,
  layoutTimeline,
  packRows,
  timelineMinWidth,
  timelineTicks,
  timelineTodayCursor,
  timelineWindow,
  trackHeight,
} from './timelineMath';

// Thursday 15 October 2026.
const TODAY = new Date(2026, 9, 15);

test('each zoom shows its window around today and steps by its own size', () => {
  assert.deepEqual(timelineWindow('week'), { zoom: 'week', from: -7, span: 35, px: 40 });
  assert.deepEqual(timelineWindow('month'), { zoom: 'month', from: -14, span: 98, px: 14 });
  assert.deepEqual(timelineWindow('quarter'), { zoom: 'quarter', from: -30, span: 210, px: 6 });
  assert.equal(timelineWindow('week', 1).from, 0);
  assert.equal(timelineWindow('month', -1).from, -42);
  assert.equal(timelineWindow('quarter', 2).from, 152);
  assert.equal(timelineMinWidth(timelineWindow('month')), 'calc(9rem + 1372px)');
});

test('spans count days from today, the end day included', () => {
  assert.deepEqual(itemSpan('2026-10-15', '2026-10-15', TODAY), { s: 0, e: 1 });
  assert.deepEqual(itemSpan('2026-10-10', '2026-10-20', TODAY), { s: -5, e: 6 });
  assert.deepEqual(itemSpan('2026-10-20', null, TODAY), { s: 5, e: 6 });
  assert.deepEqual(itemSpan('2026-10-20', '2026-10-01', TODAY), { s: 5, e: 6 }, 'an end before the start is one day');
  assert.equal(itemSpan(null, '2026-10-01', TODAY), null);
});

test('slivers at the window edges are left out; short bars inside show', () => {
  const win = timelineWindow('month');
  assert.equal(inView({ s: -20, e: -11 }, win), false, 'three visible days at the left edge');
  assert.equal(inView({ s: -20, e: -10 }, win), true, 'four visible days');
  assert.equal(inView({ s: 3, e: 4 }, win), true, 'a one-day item wholly inside');
  assert.equal(inView({ s: 200, e: 210 }, win), false);
});

test('bars pack into the first row whose last bar ended before they start', () => {
  const bar = (id: string, s: number, e: number) => ({ id, span: { s, e } });
  const { bars, rows } = packRows([bar('c', 10, 20), bar('a', 0, 10), bar('b', 5, 12), bar('d', 12, 15), bar('e', 10, 11)]);
  assert.deepEqual(bars.map((b) => `${b.id}:${b.row}`), ['a:0', 'b:1', 'c:0', 'e:2', 'd:1']);
  assert.equal(rows, 3);
  assert.equal(trackHeight(rows), 3 * 36 + 12);
  assert.equal(packRows([]).rows, 1);
});

test('bar geometry: percent of the window, cut edges, row offsets', () => {
  const win = timelineWindow('month');
  assert.deepEqual(barGeometry({ s: -14, e: 0 }, win, 0), { left: 0, width: 14.286, top: 6, cutLeft: false, cutRight: false });
  assert.deepEqual(barGeometry({ s: -30, e: 0 }, win, 2), { left: 0, width: 14.286, top: 78, cutLeft: true, cutRight: false });
  const right = barGeometry({ s: 70, e: 120 }, win, 1);
  assert.equal(right.cutRight, true);
  assert.equal(right.left + right.width, 100);
});

test('ticks: Mondays, or the first of each month in the quarter view; none under the Today chip', () => {
  const week = timelineTicks(timelineWindow('week'), TODAY, 'en');
  assert.deepEqual(week.map((t) => t.label), ['Oct 12', 'Oct 19', 'Oct 26', 'Nov 2', 'Nov 9']);
  assert.ok(week.every((t) => t.date.getDay() === 1));
  assert.equal(week.find((t) => t.label === 'Oct 12')?.showLabel, true, '3 days of 35 is past the gap');
  const quarter = timelineTicks(timelineWindow('quarter'), TODAY, 'fr');
  assert.deepEqual(quarter.map((t) => t.label), ['Oct.', 'Nov.', 'Déc.', 'Janv.', 'Févr.', 'Mars', 'Avr.']);
  assert.equal(quarter[0]!.showLabel, true);
  const month = timelineTicks(timelineWindow('month'), new Date(2026, 9, 13), 'en');
  assert.equal(month.find((t) => t.day === -1)?.showLabel, false, 'a Monday next to today hides its label');
});

test('layout: lanes in order, packed bars, reading order and the T target', () => {
  const items = [
    { id: 'x', lane: 'b', s: '2026-10-10', e: '2026-10-25' },
    { id: 'y', lane: 'a', s: '2026-10-20', e: '2026-11-05' },
    { id: 'z', lane: 'a', s: '2026-10-01', e: '2026-10-12' },
    { id: 'w', lane: 'a', s: '2027-06-01', e: '2027-06-10' },
    { id: 'v', lane: 'a', s: null, e: null },
  ];
  const out = layoutTimeline({
    items, getId: (i) => i.id, getStart: (i) => i.s, getEnd: (i) => i.e, today: TODAY,
    lane: (i) => ({ id: i.lane, label: i.lane.toUpperCase() }),
    lanes: [{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }],
    win: timelineWindow('month'),
  });
  assert.deepEqual(out.lanes.map((l) => `${l.id}:${l.count}`), ['a:2', 'c:0', 'b:1']);
  assert.deepEqual(out.order, ['z', 'y', 'x']);
  assert.deepEqual(out.undated.map((i) => i.id), ['v']);
  assert.equal(timelineTodayCursor(out.lanes), 'x', 'x runs today');
  const later = layoutTimeline({ ...{ items: items.slice(1, 3), getId: (i: typeof items[number]) => i.id },
    getStart: (i) => i.s, getEnd: (i) => i.e, today: TODAY, lane: (i) => ({ id: i.lane, label: i.lane }),
    win: timelineWindow('month') });
  assert.equal(timelineTodayCursor(later.lanes), 'y', 'nothing runs today: the next bar to start');
  assert.equal(timelineTodayCursor([]), null);
});
