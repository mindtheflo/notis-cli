import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregate,
  axisLabelStep,
  binUnit,
  buildBins,
  AXIS_LABEL_ROOM,
  chartMax,
  edgeAnchor,
  endsToday,
  periodSeries,
  showAxisLabel,
  sparkPaths,
  total,
} from './chartData';
import { chartTableRows, type ChartSeries } from './Chart';
import { metricView, vsTail } from './StatRow';
import { presetRange, compareRange } from '../period/periods';

// Thursday 15 October 2026.
const NOW = new Date(2026, 9, 15, 15, 30);
const day = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};

test('bins follow the period length: hours, days, weeks, months', () => {
  assert.equal(binUnit(presetRange('today', NOW)), 'hour');
  assert.equal(binUnit(presetRange('last30', NOW)), 'day');
  assert.equal(binUnit(presetRange('last90', NOW)), 'week');
  assert.equal(binUnit(presetRange('thisYear', NOW)), 'month');
  assert.equal(buildBins(presetRange('today', NOW)).length, 24);
  assert.equal(buildBins(presetRange('last7', NOW)).length, 7);
  const weeks = buildBins(presetRange('last90', NOW));
  assert.equal(weeks.length, 13);
  assert.equal(weeks[12]!.to.getDate(), 15, 'the last week stops at the range end');
  const months = buildBins(presetRange('thisYear', NOW));
  assert.equal(months.length, 10);
  assert.equal(months[9]!.to.getDate(), 15);
});

test('points land in their bin; avg mode averages; out-of-range points are ignored', () => {
  const range = presetRange('last7', NOW);
  const bins = buildBins(range, 'day');
  const points = [
    { date: '2026-10-09', value: 2 },
    { date: '2026-10-09T18:00:00', value: 3 },
    { date: day('2026-10-15'), value: 4 },
    { date: '2026-10-01', value: 100 },
    { date: '2026-10-12', value: Number.NaN },
  ];
  assert.deepEqual(aggregate(points, bins), [5, 0, 0, 0, 0, 0, 4]);
  assert.deepEqual(aggregate(points, bins, 'avg'), [2.5, 0, 0, 0, 0, 0, 4]);
  assert.equal(total(points, range), 9);
  assert.equal(total(points, range, 'avg'), 9 / 7);
});

test('a period series lines the comparison up bin by bin, with localized labels', () => {
  const range = presetRange('last7', NOW);
  const cmp = compareRange(range, 'prev');
  const rows = periodSeries({
    points: [{ date: '2026-10-15', value: 7 }, { date: '2026-10-08', value: 3 }, { date: '2026-10-02', value: 1 }],
    range, compareRange: cmp, locale: 'en',
  });
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map((r) => r.value), [0, 0, 0, 0, 0, 0, 7]);
  assert.deepEqual(rows.map((r) => r.compare), [1, 0, 0, 0, 0, 0, 3], 'the previous week, Oct 2 to Oct 8');
  assert.equal(rows[6]!.label, 'Oct 15');
  const fr = periodSeries({ points: [], range, locale: 'fr' });
  assert.equal(fr[6]!.label, '15 oct.');
  assert.equal(fr[6]!.compare, null);
});

test('axis labels count back from the newest bin; the value axis tops at 110%', () => {
  assert.equal(axisLabelStep(7), 1);
  assert.equal(axisLabelStep(30), 5);
  assert.equal(showAxisLabel(29, 30), true);
  assert.equal(showAxisLabel(24, 30), true);
  assert.equal(showAxisLabel(25, 30), false);
  assert.equal(chartMax([10, null, 20]), 22);
  assert.equal(chartMax([]), 1.1);
  assert.equal(endsToday(presetRange('last7', NOW), NOW), true);
  assert.equal(endsToday(presetRange('lastMonth', NOW), NOW), false);
});

test('a narrow line chart labels fewer points, and its edge labels stay inside the plot', () => {
  // Without a width the step is the count rule alone.
  assert.equal(axisLabelStep(7, undefined), 1);
  assert.equal(axisLabelStep(30, 0), 5);
  // Wide: seven daily points 84px apart all keep their label.
  assert.equal(axisLabelStep(7, 84), 1);
  // Narrow: 53px apart, every other one.
  assert.equal(axisLabelStep(7, 53), 2);
  assert.equal(showAxisLabel(6, 7, 53), true);
  assert.equal(showAxisLabel(5, 7, 53), false);
  assert.equal(showAxisLabel(4, 7, 53), true);
  // Thirty points: the count rule (5) at 17.4px apart, the width rule (8) at 11px apart.
  assert.equal(axisLabelStep(30, 17.4), 5);
  assert.equal(axisLabelStep(30, 10.97), 8);
  for (const [count, spacing] of [[7, 53], [24, 14], [30, 10.97], [31, 40]] as const) {
    assert.ok(axisLabelStep(count, spacing) * spacing >= AXIS_LABEL_ROOM, `${count} points ${spacing}px apart`);
  }
  assert.equal(AXIS_LABEL_ROOM, 80);
  // A 300px plot from 4 to 304: the first and last points sit on its edges.
  assert.equal(edgeAnchor(4, 4, 304), 'start');
  assert.equal(edgeAnchor(22, 4, 304), 'start', 'a first label 18px in would still run out when centred');
  assert.equal(edgeAnchor(154, 4, 304), 'middle');
  assert.equal(edgeAnchor(304, 4, 304), 'end');
  assert.equal(edgeAnchor(154, 4, 40), 'middle', 'too narrow to anchor');
  assert.equal(edgeAnchor(Number.NaN, 4, 304), 'middle');
});

test('sparkline paths scale to the highest value', () => {
  assert.deepEqual(sparkPaths([]), { line: '', area: '' });
  const flat = sparkPaths([5], 72, 24);
  assert.equal(flat.line, 'M0 2.18 L72 2.18');
  const { line, area } = sparkPaths([0, 10], 72, 24);
  assert.equal(line, 'M0 24 L72 2.18');
  assert.equal(area, 'M0 24 L72 2.18 L72 24 L0 24 Z');
});

test('a sparkline breaks at a missing value instead of dropping to zero (follow-up B13)', () => {
  // Points keep their places (every 10px); null and NaN are gaps; a point alone between gaps is a dot.
  const gaps = sparkPaths([0, 10, null, 5, Number.NaN, 10], 50, 24);
  assert.equal(gaps.line, 'M0 24 L10 2.18 M30 13.09 L30 13.09 M50 2.18 L50 2.18');
  assert.equal(gaps.area, 'M0 24 L10 2.18 L10 24 L0 24 Z', 'only a run of two points or more has an area');
  assert.equal(sparkPaths([null, 4, 4], 72, 24).line, 'M36 2.18 L72 2.18', 'a leading gap keeps the first place empty');
  assert.deepEqual(sparkPaths([null, Number.NaN]), { line: '', area: '' });
});

test('chart table rows read every series and the comparison', () => {
  const series: ChartSeries[] = [{ key: 'signups', label: { en: 'Signups', fr: 'Inscriptions' } }];
  const compare: ChartSeries = { key: 'before', label: { en: 'Before', fr: 'Avant' } };
  const rows = chartTableRows(
    [{ day: 'Oct 14', signups: 12, before: 9 }, { day: 'Oct 15', signups: null, before: 4 }],
    series, compare, (row) => String((row as { day: string }).day), (v) => `${v}`,
  );
  assert.deepEqual(rows, [['Oct 14', '12', '9'], ['Oct 15', null, '4']]);
});

test('a stat shows its value, the change and the previous value in each language', () => {
  const metric = { label: { en: 'Signups', fr: 'Inscriptions' }, value: 1250, previous: 1000 };
  const en = metricView(metric, 'prev', 'en');
  assert.equal(en.label, 'Signups');
  assert.equal(en.value, '1,250');
  assert.equal(en.delta?.text, '+25%');
  assert.equal(en.sub, `1,000 ${vsTail('prev', 'en')}`);
  const fr = metricView(metric, 'prev', 'fr');
  assert.equal(fr.value, '1 250');
  assert.equal(fr.delta?.text, '+25 %');
  const none = metricView(metric, 'none', 'en');
  assert.equal(none.delta, null);
  assert.equal(none.sub, null);
  const worse = metricView({ ...metric, higherIsBetter: false }, 'prev', 'en');
  assert.equal(worse.delta?.tone, 'destructive');
});
