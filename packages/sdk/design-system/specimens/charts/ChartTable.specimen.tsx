import * as React from 'react';
import { defineSpecimen, type SpecimenLang } from '../../specimen';
import { ChartTable, type StatMetric } from '../../../src/ui/index';
import { WEEKLY_METRICS, YEAR_AGO, costStats, edgeStats, weeklyStat } from '../../fixtures/charts/metrics';
import { Bleed, LAST_30, MetricsPage, PAGE_WORDS, periodStats } from '../../fixtures/charts/parts';
import { focusAbout, focusFrom } from '../../fixtures/charts/interact';

const LAST_30_YEAR = { preset: 'last30', compare: 'year' } as const;
const LAST_30_NONE = { preset: 'last30', compare: 'none' } as const;
const LAST_90_YEAR = { preset: 'last90', compare: 'year' } as const;

const COSTS = { en: 'Costs and errors', fr: 'Coûts et erreurs' };

/** A table whose rows pick the metric, as the chart page uses it. */
function Pickable({ lang, metrics, initial = 'signups' }: { lang: SpecimenLang; metrics: StatMetric[]; initial?: string }) {
  const [active, setActive] = React.useState(initial);
  return (
    <ChartTable metrics={metrics} title={PAGE_WORDS.metrics} activeId={active}
      onSelect={(metric) => setActive(metric.id ?? active)} locale={lang} />
  );
}

export const specimen = defineSpecimen({
  id: 'chart-table',
  name: 'ChartTable',
  group: 'charts',
  from: '@notis/sdk/ui',
  covers: ['ChartTable'],
  summary: 'The metrics of a chart page as a table under the chart: trend, value, previous value and change; a row picks the metric.',
  states: [
    {
      id: 'page',
      label: 'The chart page Flo picked (deck composition b): figures, the chart, then every metric in the table',
      render: ({ lang }) => <MetricsPage lang={lang} />,
    },
    {
      id: 'page-year-line',
      label: 'The same page over 90 days against last year, as a line, messages picked, with about buttons',
      render: ({ lang }) => <MetricsPage lang={lang} initial={LAST_90_YEAR} kind="line" active="messages" about />,
    },
    {
      id: 'page-narrow',
      label: 'The chart page at 390: two columns of figures, the trend column hidden',
      width: 390,
      render: ({ lang }) => <MetricsPage lang={lang} />,
    },
    {
      id: 'pickable',
      label: 'Rows pick the metric the chart draws: the picked row is highlighted',
      render: ({ lang }) => <Bleed><Pickable lang={lang} metrics={periodStats(lang, LAST_30)} initial="active" /></Bleed>,
    },
    {
      id: 'row-focus',
      label: 'A row focused from the keyboard',
      render: ({ lang }) => <Bleed><Pickable lang={lang} metrics={periodStats(lang, LAST_30)} /></Bleed>,
      interact: (root) => focusFrom(root, '.nui-ctable-pick', 2).then(() => undefined),
    },
    {
      id: 'read-only',
      label: 'Read only: no row picks anything, no highlight',
      render: ({ lang }) => <Bleed><ChartTable metrics={periodStats(lang, LAST_30)} locale={lang} /></Bleed>,
    },
    {
      id: 'compare-year',
      label: 'Against the same 30 days last year',
      render: ({ lang }) => (
        <Bleed><ChartTable metrics={periodStats(lang, LAST_30_YEAR)} compare="year" locale={lang} /></Bleed>
      ),
    },
    {
      id: 'compare-none',
      label: 'No comparison: the Previous and Change columns are gone',
      render: ({ lang }) => (
        <Bleed><ChartTable metrics={periodStats(lang, LAST_30_NONE)} compare="none" locale={lang} /></Bleed>
      ),
    },
    {
      id: 'weekly',
      label: 'This week against the same week last year, twelve weeks as the trend',
      render: ({ lang }) => (
        <Bleed>
          <ChartTable metrics={WEEKLY_METRICS.map((metric) => weeklyStat(metric, { previous: YEAR_AGO[metric.key] }))}
            compare="year" locale={lang} />
        </Bleed>
      ),
    },
    {
      id: 'about',
      label: 'An about button after each name',
      render: ({ lang }) => (
        <Bleed><Pickable lang={lang} metrics={periodStats(lang, LAST_30, true)} /></Bleed>
      ),
    },
    {
      id: 'about-open',
      label: 'About focused from the keyboard: its tooltip opens above the row and does not pick it',
      height: 280,
      render: ({ lang }) => (
        <Bleed className="pt-12"><Pickable lang={lang} metrics={periodStats(lang, LAST_30, true).slice(0, 3)} /></Bleed>
      ),
      interact: (root) => focusAbout(root, 1),
    },
    {
      id: 'lower-is-better',
      label: 'Lower is better, with no trend: a fall reads green, the trend column stays empty',
      render: ({ lang }) => <Bleed><ChartTable metrics={costStats()} title={COSTS} locale={lang} /></Bleed>,
    },
    {
      id: 'edge-cases',
      label: 'Long names, a previous value of zero (no change shown) and an unchanged figure',
      render: ({ lang }) => <Bleed><ChartTable metrics={edgeStats()} locale={lang} /></Bleed>,
    },
    {
      id: 'tablet',
      label: 'At 768: the trend column is hidden',
      width: 768,
      render: ({ lang }) => <Bleed><Pickable lang={lang} metrics={periodStats(lang, LAST_30)} /></Bleed>,
    },
    {
      id: 'narrow',
      label: 'Narrow (390): long French names wrap, the numbers stay on one line',
      width: 390,
      render: ({ lang }) => <Bleed><Pickable lang={lang} metrics={periodStats(lang, LAST_30)} /></Bleed>,
    },
    {
      id: 'empty',
      label: 'Empty: the header alone (no empty or loading state of its own)',
      render: ({ lang }) => <Bleed><ChartTable metrics={[]} locale={lang} /></Bleed>,
    },
  ],
});
