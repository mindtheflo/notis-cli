import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareRange,
  customPeriod,
  dayCount,
  formatPeriodParam,
  parsePeriodParam,
  periodRanges,
  presetRange,
  samePeriod,
  toIsoDay,
  type PresetId,
} from './periods';
import {
  dayNumberLabel, formatDateRange, formatDayHeading, formatDelta, formatLongDay, formatMonthYear, weekdayNames,
} from './dateFormat';

// Thursday 15 October 2026, mid-afternoon.
const NOW = new Date(2026, 9, 15, 15, 30);

const iso = (range: { from: Date; to: Date } | null) => (range ? `${toIsoDay(range.from)}..${toIsoDay(range.to)}` : null);

test('presets cover whole local days ending today', () => {
  const cases: Array<[PresetId, string]> = [
    ['today', '2026-10-15..2026-10-15'],
    ['yesterday', '2026-10-14..2026-10-14'],
    ['last7', '2026-10-09..2026-10-15'],
    ['last30', '2026-09-16..2026-10-15'],
    ['last90', '2026-07-18..2026-10-15'],
    ['thisMonth', '2026-10-01..2026-10-15'],
    ['lastMonth', '2026-09-01..2026-09-30'],
    ['thisQuarter', '2026-10-01..2026-10-15'],
    ['thisYear', '2026-01-01..2026-10-15'],
  ];
  for (const [preset, expected] of cases) assert.equal(iso(presetRange(preset, NOW)), expected, preset);
  const today = presetRange('today', NOW);
  assert.equal(today.from.getHours(), 0);
  assert.equal(today.to.getHours(), 23);
  assert.equal(dayCount(presetRange('last30', NOW)), 30);
});

test('a custom range must be in order and end today or earlier', () => {
  assert.equal(iso(presetRange('custom', NOW, { from: '2026-02-01', to: '2026-02-28' })), '2026-02-01..2026-02-28');
  assert.equal(iso(presetRange('custom', NOW, { from: '2026-03-01', to: '2026-02-01' })), '2026-09-16..2026-10-15');
  assert.equal(iso(presetRange('custom', NOW, { from: '2026-10-01', to: '2026-10-20' })), '2026-09-16..2026-10-15');
  assert.equal(iso(presetRange('custom', NOW, { from: 'nope', to: '2026-10-01' })), '2026-09-16..2026-10-15');
});

test('comparison ranges: the days just before, or the same days a year back', () => {
  const last7 = presetRange('last7', NOW);
  assert.equal(iso(compareRange(last7, 'prev')), '2026-10-02..2026-10-08');
  assert.equal(iso(compareRange(last7, 'year')), '2025-10-09..2025-10-15');
  assert.equal(compareRange(last7, 'none'), null);
  const leap = { from: new Date(2028, 1, 29), to: new Date(2028, 1, 29, 23, 59) };
  assert.equal(iso(compareRange(leap, 'year')), '2027-02-28..2027-02-28');
  const ranges = periodRanges({ preset: 'thisMonth', compare: 'prev' }, NOW);
  assert.equal(iso(ranges.compareRange), '2026-09-16..2026-09-30');
});

test('the URL value round-trips and leaves out the default comparison', () => {
  assert.equal(formatPeriodParam({ preset: 'last30', compare: 'prev' }), 'last30');
  assert.equal(formatPeriodParam({ preset: 'last30', compare: 'year' }), 'last30~year');
  const custom = customPeriod(new Date(2026, 0, 31), new Date(2026, 0, 1), 'none');
  assert.deepEqual(custom, { preset: 'custom', compare: 'none', from: '2026-01-01', to: '2026-01-31' });
  assert.equal(formatPeriodParam(custom), '2026-01-01..2026-01-31~none');
  assert.deepEqual(parsePeriodParam('2026-01-01..2026-01-31~none'), custom);
  assert.deepEqual(parsePeriodParam('last7~year'), { preset: 'last7', compare: 'year' });
  assert.deepEqual(parsePeriodParam('garbage'), { preset: 'last30', compare: 'prev' });
  assert.deepEqual(parsePeriodParam(null, { preset: 'thisYear', compare: 'none' }), { preset: 'thisYear', compare: 'none' });
  assert.deepEqual(parsePeriodParam('custom'), { preset: 'last30', compare: 'prev' });
  assert.ok(samePeriod({ preset: 'last7', compare: 'prev' }, parsePeriodParam('last7')));
});

test('dates and day names localize to English and French', () => {
  assert.equal(formatMonthYear(new Date(2026, 9, 1), 'en'), 'October 2026');
  assert.equal(formatMonthYear(new Date(2026, 9, 1), 'fr'), 'Octobre 2026');
  assert.deepEqual(weekdayNames('en').slice(0, 2), ['Mon', 'Tue']);
  assert.deepEqual(weekdayNames('fr').slice(0, 2), ['Lun', 'Mar']);
  assert.equal(dayNumberLabel(new Date(2026, 10, 1), 'en'), 'Nov 1');
  assert.equal(dayNumberLabel(new Date(2026, 10, 1), 'fr'), '1er nov.');
  assert.equal(dayNumberLabel(new Date(2026, 10, 2), 'fr'), '2');
  const range = { from: new Date(2026, 9, 1), to: new Date(2026, 9, 15) };
  assert.match(formatDateRange(range, 'en'), /Oct 1/);
  assert.match(formatDateRange(range, 'fr'), /1er/);
});

test('ranges join with words, never a dash (C2); long days and day heads in English and French (B11)', async () => {
  const across = { from: new Date(2026, 4, 17), to: new Date(2026, 5, 15) };
  assert.equal(formatDateRange(across, 'en'), 'May 17 to Jun 15, 2026');
  assert.equal(formatDateRange(across, 'fr'), '17 mai au 15 juin 2026');
  assert.doesNotMatch(formatDateRange(across, 'en') + formatDateRange(across, 'fr'), /[\u2013\u2014-]/);
  assert.equal(formatLongDay(new Date(2026, 0, 5), 'en'), 'Monday, January 5, 2026');
  assert.equal(formatLongDay(new Date(2026, 0, 5), 'fr'), 'Lundi 5 janvier 2026');
  assert.equal(formatDayHeading(new Date(2026, 9, 19), 'en', 2026), 'Monday, October 19');
  assert.equal(formatDayHeading(new Date(2026, 9, 19), 'fr', 2026), 'Lundi 19 octobre');
  assert.match(formatDayHeading(new Date(2027, 0, 1), 'en', 2026), /2027/);
  assert.deepEqual(weekdayNames('fr', 'narrow'), ['L', 'M', 'M', 'J', 'V', 'S', 'D']);
  const ui = await import('../index');
  assert.equal(ui.formatLongDay, formatLongDay, '@notis/sdk/ui exports formatLongDay');
  assert.equal(ui.formatDayHeading, formatDayHeading);
});

test('@notis/sdk/ui exports intlLocale, the Intl locale for a toolkit locale', async () => {
  const ui = await import('../index');
  assert.equal(ui.intlLocale('fr'), 'fr-FR');
  assert.equal(ui.intlLocale('en'), 'en-US');
});

test('deltas carry a sign, a tone and the French narrow space', () => {
  assert.deepEqual(formatDelta(120, 100, 'en'), { text: '+20%', tone: 'good', up: true, percent: 20 });
  assert.equal(formatDelta(90, 100, 'en')?.text, '−10%');
  assert.equal(formatDelta(90, 100, 'en', false)?.tone, 'good');
  assert.equal(formatDelta(105, 100, 'fr')?.text, '+5 %');
  assert.equal(formatDelta(5, 0, 'en'), null);
});
