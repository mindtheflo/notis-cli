// Days are local: run in a zone with daylight saving so a skipped or repeated day would show.
process.env.TZ = 'Europe/Paris';

import { dom } from '../testDom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { CalendarHeatmap, type CalendarHeatmapDay } from './CalendarHeatmap';
import {
  bucketDays, heatmapAlpha, heatmapLevel, heatmapMonths, heatmapRange, heatmapScale, heatmapWeeks,
} from './heatmapData';

const doc = dom.window.document;
let root: Root | null = null;

async function mount(node: ReactNode) {
  if (root) await act(async () => { root!.unmount(); });
  doc.body.innerHTML = '<div id="app"></div>';
  root = createRoot(doc.getElementById('app')!);
  await act(async () => { root!.render(node); });
}

const q = <E extends Element = HTMLElement>(selector: string) => doc.querySelector<E>(selector as never) as E | null;
const cell = (key: string) => q(`[data-nav-id="${key}"]`);

async function key(target: Element, name: string) {
  await act(async () => {
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  });
}

/** 2026-06-15 is a Monday. */
const TODAY = new Date(2026, 5, 15, 9, 30);
const keys = (days: readonly ({ key: string } | null)[]) => days.map((d) => d?.key ?? null);

test('heatmap weeks: Monday columns, days outside the range are not drawn, Sunday start on request', () => {
  // Wednesday 3 June to Wednesday 17 June 2026.
  const range = { from: new Date(2026, 5, 3), to: new Date(2026, 5, 17) };
  const weeks = heatmapWeeks(range, new Map());
  assert.equal(weeks.length, 3);
  assert.deepEqual(keys(weeks[0]!.days), [null, null, '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07']);
  assert.deepEqual(keys(weeks[2]!.days), ['2026-06-15', '2026-06-16', '2026-06-17', null, null, null, null],
    'the days after the last one are not drawn');

  const sunday = heatmapWeeks(range, new Map(), 0);
  assert.equal(sunday[0]!.start.getDay(), 0, 'a Sunday start begins each column on Sunday');
  assert.deepEqual(keys(sunday[0]!.days), [null, null, null, '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06']);

  const one = heatmapWeeks({ from: new Date(2026, 5, 15), to: new Date(2026, 5, 15) }, new Map());
  assert.deepEqual(keys(one[0]!.days), ['2026-06-15', null, null, null, null, null, null], 'one day is one column');
});

test('heatmap weeks: daylight saving changes never skip or repeat a day', () => {
  const weeks = heatmapWeeks({ from: new Date(2026, 2, 1), to: new Date(2026, 10, 30) }, new Map());
  const all = weeks.flatMap((w) => w.days.filter((d) => d !== null).map((d) => d!.key));
  assert.equal(all.length, 275, 'March 1 to November 30 is 275 days');
  assert.equal(new Set(all).size, all.length, 'no day twice');
  assert.ok(all.includes('2026-03-29') && all.includes('2026-03-30') && all.includes('2026-10-25') && all.includes('2026-10-26'));
  for (const week of weeks) assert.equal(week.start.getDay(), 1, 'every column starts on a Monday');
});

test('heatmap range: the last 12 months by default, swapped when backwards, ISO days read as local days', () => {
  const range = heatmapRange(undefined, undefined, TODAY);
  assert.equal(range.from.toDateString(), new Date(2025, 6, 1).toDateString(), 'the first of the month 11 months back');
  assert.equal(range.to.toDateString(), new Date(2026, 5, 15).toDateString(), 'ends today');
  const back = heatmapRange('2026-06-10', '2026-06-01', TODAY);
  assert.equal(back.from.getDate(), 1);
  assert.equal(back.to.getDate(), 10);
});

test('heatmap days: rows add up per local day; a null valueKey counts rows; rows without a number are skipped', () => {
  const rows = [
    { date: '2026-06-15', value: 2 },
    { date: new Date(2026, 5, 15, 22, 0), value: 3 },
    { date: '2026-06-14T10:00:00', value: 1 },
    { date: '2026-06-13', value: Number.NaN },
    { date: 'not a day', value: 4 },
    { date: '2026-06-12' },
  ];
  const sums = bucketDays(rows, 'date', 'value');
  assert.equal(sums.get('2026-06-15')?.value, 5);
  assert.equal(sums.get('2026-06-15')?.rows.length, 2);
  assert.equal(sums.get('2026-06-14')?.value, 1);
  assert.equal(sums.has('2026-06-13'), false);
  assert.equal(sums.has('2026-06-12'), false);
  const counts = bucketDays(rows, 'date', null);
  assert.equal(counts.get('2026-06-15')?.value, 2);
  assert.equal(counts.get('2026-06-12')?.value, 1, 'a dated row with no value still counts');
});

test('heatmap levels: empty and zero draw empty, the largest is the top level, equal values all take it', () => {
  const scale = heatmapScale([0, 1, 2, 5, 8]);
  assert.equal(scale.levels, 5);
  assert.equal(heatmapLevel(null, scale), 0, 'no data');
  assert.equal(heatmapLevel(0, scale), 0, 'zero');
  assert.equal(heatmapLevel(-3, scale), 0, 'below zero on a sequential scale');
  assert.equal(heatmapLevel(0.1, scale), 1, 'any positive value takes a colour');
  assert.equal(heatmapLevel(4, scale), 2);
  assert.equal(heatmapLevel(8, scale), 4, 'the largest');
  const flat = heatmapScale([3, 3, 3]);
  assert.equal(heatmapLevel(3, flat), 4, 'equal values all take the top level');
  assert.equal(heatmapLevel(0, heatmapScale([])), 0, 'no values at all');

  const mood = heatmapScale([1, 5], { domain: [1, 5] });
  assert.equal(heatmapLevel(1, mood), 1, 'with a domain, its minimum still takes a colour');
  assert.equal(heatmapLevel(5, mood), 4);
  assert.equal(heatmapLevel(9, mood), 4, 'past the domain holds at the top');

  const three = heatmapScale([10], { levels: 3 });
  assert.equal(heatmapLevel(4, three), 1);
  assert.equal(heatmapLevel(6, three), 2);

  const diverging = heatmapScale([-4, -1, 0, 2, 4], { kind: 'diverging' });
  assert.equal(heatmapLevel(0, diverging), 0, 'the midpoint is neutral');
  assert.equal(heatmapLevel(4, diverging), 4);
  assert.equal(heatmapLevel(-4, diverging), -4);
  assert.equal(heatmapLevel(-1, diverging), -1);
  const around3 = heatmapScale([1, 5], { kind: 'diverging', domain: [1, 5] });
  assert.equal(around3.mid, 3, 'a domain centres the midpoint');
  assert.equal(heatmapLevel(5, around3), 4);
  assert.equal(heatmapLevel(1, around3), -4);

  assert.deepEqual([1, 2, 3, 4].map((l) => heatmapAlpha(l, 5)), [0.25, 0.5, 0.75, 1]);
  assert.equal(heatmapAlpha(0, 5), 0);
});

test('heatmap months: a label where a column starts a new month; a squeezed first label gives way', () => {
  const weeks = heatmapWeeks({ from: new Date(2026, 3, 29), to: new Date(2026, 6, 10) }, new Map());
  const months = heatmapMonths(weeks).map((m) => m.month.getMonth());
  assert.deepEqual(months, [4, 5], 'April (one column) gives way to May; July, in the last column, would run past the end');
  const later = heatmapWeeks({ from: new Date(2026, 3, 29), to: new Date(2026, 6, 20) }, new Map());
  assert.deepEqual(heatmapMonths(later).map((m) => m.month.getMonth()), [4, 5, 6], 'July with room after it keeps its label');
});

test('heatmap days: a number property arriving as a string still counts', () => {
  const byDay = bucketDays([{ date: '2026-06-15', value: '3' }, { date: '2026-06-15', value: 2 }, { date: '2026-06-16', value: 'n/a' },
    { date: '2026-06-17', value: '' }], 'date', 'value');
  assert.deepEqual([...byDay].map(([key, slot]) => [key, slot.value]), [['2026-06-15', 5]]);
});

const DATA = [
  { date: '2026-06-15', value: 3 },
  { date: '2026-06-08', value: 1 },
  { date: '2026-06-09', value: 0 },
  { date: '2025-11-04', value: 2 },
];

test('CalendarHeatmap: each cell names its value and day in EN and FR, with the year for an earlier year', async () => {
  await mount(<CalendarHeatmap data={DATA} today={TODAY} locale="en"
    format={(v) => `${v} ${v === 1 ? 'entry' : 'entries'}`} />);
  const grid = q('[role="grid"]')!;
  assert.equal(grid.getAttribute('aria-label'), 'Activity by day');
  assert.equal(cell('2026-06-15')?.getAttribute('aria-label'), '3 entries on Mon, Jun 15');
  assert.equal(cell('2026-06-08')?.getAttribute('aria-label'), '1 entry on Mon, Jun 8');
  assert.equal(cell('2026-06-09')?.getAttribute('aria-label'), '0 entries on Tue, Jun 9', 'zero is data');
  assert.equal(cell('2026-06-10')?.getAttribute('aria-label'), 'No data on Wed, Jun 10');
  assert.equal(cell('2025-11-04')?.getAttribute('aria-label'), '2 entries on Tue, Nov 4, 2025');
  assert.equal(cell('2026-06-16'), null, 'tomorrow is not drawn');
  assert.equal(cell('2025-06-30'), null, 'nor the day before the range');
  assert.equal(cell('2025-07-01')?.getAttribute('aria-label'), 'No data on Tue, Jul 1, 2025', 'the range starts July 1');
  assert.equal(cell('2026-06-15')?.getAttribute('data-level'), '4');
  assert.equal(cell('2026-06-09')?.hasAttribute('data-level'), false, 'zero draws empty');
  assert.equal(cell('2026-06-10')?.hasAttribute('data-empty'), true);
  assert.equal(doc.querySelectorAll('[role="row"]').length, 7);
  const wd = [...doc.querySelectorAll('.nui-heat-wd')].map((el) => el.textContent);
  assert.deepEqual(wd, ['M', '', 'W', '', 'F', '', ''], 'Monday, Wednesday and Friday are named');
  const table = q('table[data-notis-render="chart-data"]')!;
  assert.equal(table.getAttribute('aria-label'), 'Activity by day');
  assert.deepEqual([...table.querySelectorAll('tbody tr')].map((tr) => tr.textContent),
    ['Tue, Nov 4, 20252 entries', 'Mon, Jun 81 entry', 'Tue, Jun 90 entries', 'Mon, Jun 153 entries'],
    'the days with data, in order, in the cells\' words');

  await mount(<CalendarHeatmap data={DATA} today={TODAY} locale="fr" />);
  assert.equal(q('[role="grid"]')!.getAttribute('aria-label'), 'Activité par jour');
  assert.equal(cell('2026-06-15')?.getAttribute('aria-label'), '3 le lun. 15 juin');
  assert.equal(cell('2026-06-10')?.getAttribute('aria-label'), 'Aucune donnée le mer. 10 juin');
  assert.equal(cell('2026-06-01')?.getAttribute('aria-label'), 'Aucune donnée le lun. 1er juin', 'French writes the first "1er"');
  assert.deepEqual([...doc.querySelectorAll('.nui-heat-wd')].map((el) => el.textContent), ['L', '', 'M', '', 'V', '', '']);
  assert.deepEqual([...doc.querySelectorAll('.nui-heat-legend > span:not(.nui-heat-cell)')].map((el) => el.textContent),
    ['Moins', 'Plus']);
});

test('CalendarHeatmap: a range wholly in a past year names its year, and each cell gives its week column', async () => {
  await mount(<CalendarHeatmap data={[{ date: '2024-06-12', value: 2 }]} from="2024-06-03" to="2024-06-30" today={TODAY} locale="en" />);
  assert.equal(cell('2024-06-12')?.getAttribute('aria-label'), '2 on Wed, Jun 12, 2024');
  assert.equal(cell('2024-06-03')?.getAttribute('aria-colindex'), '1');
  assert.equal(cell('2024-06-12')?.getAttribute('aria-colindex'), '2', 'June 12 sits in the second week, whatever the row');
  assert.equal(cell('2024-06-30')?.getAttribute('aria-colindex'), '4');
});

test('CalendarHeatmap: one cell in the tab order; arrows move a day or a week, Home and End go to the ends', async () => {
  await mount(<CalendarHeatmap data={DATA} today={TODAY} from="2026-05-01" locale="en" />);
  const tabbable = [...doc.querySelectorAll('[data-nav-id][tabindex="0"]')];
  assert.equal(tabbable.length, 1);
  assert.equal(tabbable[0]!.getAttribute('data-nav-id'), '2026-06-15', 'the latest day with data');
  const grid = q('[role="grid"]')!;
  await act(async () => { (cell('2026-06-15') as HTMLElement).focus(); });

  const at = () => (doc.activeElement as HTMLElement).getAttribute('data-nav-id');
  await key(doc.activeElement!, 'ArrowLeft');
  assert.equal(at(), '2026-06-08', 'left is the week before');
  await key(doc.activeElement!, 'ArrowUp');
  assert.equal(at(), '2026-06-07', 'up is the day before');
  await key(doc.activeElement!, 'ArrowDown');
  await key(doc.activeElement!, 'ArrowDown');
  assert.equal(at(), '2026-06-09', 'down is the next day');
  await key(doc.activeElement!, 'ArrowRight');
  assert.equal(at(), '2026-06-09', 'no week after it in the range: it stays');
  await key(doc.activeElement!, 'Home');
  assert.equal(at(), '2026-05-01');
  await key(doc.activeElement!, 'ArrowLeft');
  assert.equal(at(), '2026-05-01', 'nothing before the first day');
  await key(doc.activeElement!, 'End');
  assert.equal(at(), '2026-06-15');
  assert.equal(doc.querySelectorAll('[data-nav-id][tabindex="0"]').length, 1, 'still one tab stop');
  assert.ok(grid.contains(doc.activeElement));
});

test('CalendarHeatmap: cells are buttons only with onSelect, and a press gives the day', async () => {
  await mount(<CalendarHeatmap data={DATA} today={TODAY} locale="en" />);
  assert.equal(doc.querySelectorAll('button').length, 0, 'no onSelect, no buttons');
  assert.equal(cell('2026-06-15')?.getAttribute('role'), 'gridcell');

  const picked: CalendarHeatmapDay[] = [];
  await mount(<CalendarHeatmap data={DATA} today={TODAY} locale="en" onSelect={(day) => picked.push(day)} />);
  const button = cell('2026-06-15')!;
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.getAttribute('type'), 'button');
  assert.equal(button.parentElement?.getAttribute('role'), 'gridcell');
  await act(async () => { button.click(); });
  assert.equal(picked.length, 1);
  assert.equal(picked[0]!.key, '2026-06-15');
  assert.equal(picked[0]!.value, 3);
  assert.deepEqual(picked[0]!.rows, [DATA[0]]);
  await act(async () => { (cell('2026-06-10') as HTMLElement).click(); });
  assert.equal(picked[1]!.value, null, 'an empty day can be picked too');
});

test('CalendarHeatmap: keyboard focus and hover open a tooltip with the cell\'s own words', async () => {
  // jsdom does not track the input modality: a focused element matches :focus-visible here, as after a key press.
  const proto = dom.window.Element.prototype;
  const matches = proto.matches;
  Object.defineProperty(proto, 'matches', {
    configurable: true,
    value(this: Element, selector: string): boolean {
      if (selector === ':focus-visible') return dom.window.document.activeElement === this;
      return matches.call(this, selector);
    },
  });
  try {
    await mount(<CalendarHeatmap data={DATA} today={TODAY} locale="fr" />);
    const target = cell('2026-06-08') as HTMLElement;
    await act(async () => { target.focus(); });
    const tip = q('[role="tooltip"]');
    assert.equal(tip?.textContent, '1 le lun. 8 juin');
    assert.equal(tip?.textContent, target.getAttribute('aria-label'), 'the tooltip says what the cell is named');
    assert.equal(target.getAttribute('aria-describedby'), tip?.id);
    assert.equal(doc.activeElement, target, 'the tooltip never takes focus');
    await act(async () => { target.blur(); });
    assert.equal(q('[role="tooltip"]'), null);

    const other = cell('2026-06-10') as HTMLElement;
    const hover = new dom.window.MouseEvent('pointerover', { bubbles: true });
    Object.defineProperty(hover, 'pointerType', { value: 'mouse' });
    await act(async () => { other.dispatchEvent(hover); await new Promise((r) => setTimeout(r, 520)); });
    assert.equal(q('[role="tooltip"]')?.textContent, other.getAttribute('aria-label'));
  } finally {
    Object.defineProperty(proto, 'matches', { configurable: true, writable: true, value: matches });
  }
});

test('CalendarHeatmap: tones and the diverging scale set the colour; empty data still draws the grid', async () => {
  await mount(<CalendarHeatmap data={DATA} today={TODAY} tone="success" />);
  assert.equal(q('.nui-heat')?.getAttribute('data-tone'), 'success');
  await mount(<CalendarHeatmap data={[{ date: '2026-06-15', value: -2 }, { date: '2026-06-14', value: 2 },
    { date: '2026-06-13', value: 0 }]} today={TODAY} scale="diverging" />);
  assert.equal(q('.nui-heat')?.getAttribute('data-scale'), 'diverging');
  assert.equal(cell('2026-06-15')?.getAttribute('data-side'), 'down');
  assert.equal(cell('2026-06-14')?.hasAttribute('data-side'), false);
  assert.equal(cell('2026-06-13')?.hasAttribute('data-neutral'), true, 'the midpoint differs from no data');
  assert.equal(cell('2026-06-12')?.hasAttribute('data-neutral'), false);
  assert.equal(doc.querySelectorAll('.nui-heat-swatch').length, 9, 'four steps each side and the neutral one');
  await mount(<CalendarHeatmap data={[]} today={TODAY} legend={false} />);
  assert.equal(doc.querySelectorAll('[data-nav-id]').length, 350, 'July 1 2025 to June 15 2026');
  assert.equal(doc.querySelectorAll('[data-level]').length, 0);
  assert.equal(q('.nui-heat-legend'), null);
  assert.equal(doc.querySelectorAll('[data-nav-id][tabindex="0"]').length, 1, 'today takes the tab stop');
  assert.equal(q('[tabindex="0"]')?.getAttribute('data-nav-id'), '2026-06-15');
});

const css = readFileSync(new URL('../toolkit.css', import.meta.url), 'utf8');

test('CalendarHeatmap CSS: its own section, a focused day grows and an empty one fills in (no ring), it scrolls inside itself', () => {
  const at = css.indexOf('/* == section: calendar heatmap (charts) == */');
  assert.ok(at > 0);
  const section = css.slice(at);
  assert.match(section, /\.nui-heat-cell:focus-visible \{[^}]*transform: scale\(1\.25\)/);
  assert.match(section, /\.nui-heat-cell:not\(\[data-level\]\):not\(\[data-neutral\]\):not\(\[data-out\]\):focus-visible \{ background: /);
  assert.doesNotMatch(section, /:focus[^{}]*\{[^}]*(box-shadow|outline:(?!\s*none))/, 'focus draws no ring or outline');
  assert.match(section, /\.nui-heat-scroll \{ overflow-x: auto;/);
  assert.match(section, /container-type: inline-size/);
  assert.match(section, /prefers-reduced-motion/);
  assert.doesNotMatch(section, /border-(left|right|top|bottom)\s*:/, 'no border on one side only');
  assert.doesNotMatch(section, /outline: (?!none)/, 'no focus ring');
});
