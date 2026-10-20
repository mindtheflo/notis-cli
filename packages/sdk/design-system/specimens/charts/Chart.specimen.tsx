import * as React from 'react';
import { defineSpecimen, type SpecimenLang } from '../../specimen';
import { Chart, type ChartSeries } from '../../../src/ui/index';
import {
  CHANNEL_LABELS,
  HOURLY_MESSAGES,
  LONG_LABELS,
  answerRows,
  askRows,
  channelRows,
  metricOf,
  periodFormat,
  periodRows,
  rangeOf,
  recentChannelRows,
  seriesRows,
  zeroRows,
} from '../../fixtures/charts/metrics';
import { Pad, WeeklyChart } from '../../fixtures/charts/parts';
import { hoverPlot, revealTable } from '../../fixtures/charts/interact';

const CHANNELS: ChartSeries[] = [
  { key: 'web', label: CHANNEL_LABELS.web },
  { key: 'whatsapp', label: CHANNEL_LABELS.whatsapp },
  { key: 'slack', label: CHANNEL_LABELS.slack },
];

const ANSWERS: ChartSeries[] = [
  { key: 'fast', label: LONG_LABELS.fast },
  { key: 'followUp', label: LONG_LABELS.followUp },
];

const MESSAGES_BY_HOUR = { en: 'Messages by hour', fr: 'Messages par heure' };
const MESSAGES_BY_CHANNEL = { en: 'Messages by channel', fr: 'Messages par canal' };
const HOW_ANSWERED = { en: 'How messages were answered', fr: 'Comment les messages ont reçu une réponse' };
const WHAT_ASKED = { en: 'What people asked for', fr: 'Ce que les gens ont demandé' };

/** "1.2k" after a bar, the exact count in the tooltip and the table. */
function shortCount(value: number, lang: SpecimenLang): string {
  return value >= 1000 ? new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
    : new Intl.NumberFormat(lang).format(value);
}

function Asks({ lang, stacked = false }: { lang: SpecimenLang; stacked?: boolean }) {
  return (
    <Chart kind="bar" horizontal stacked={stacked} data={askRows(lang)} series={CHANNELS} title={WHAT_ASKED}
      labelFormat={(v) => shortCount(v, lang)} locale={lang} />
  );
}

/** Sign-ups over the last 30 days against the 30 days before: today's bar is still filling. */
function Signups({ lang, height = 200 }: { lang: SpecimenLang; height?: number }) {
  const metric = metricOf('signups');
  return (
    <Chart kind="bar" data={periodRows(metric, lang, rangeOf('last30'), 'prev')} compare="prev"
      title={metric.label} height={height} locale={lang} />
  );
}

function Channels({ lang, kind = 'line' }: { lang: SpecimenLang; kind?: 'line' | 'bar' }) {
  return (
    <Chart kind={kind} data={kind === 'bar' ? recentChannelRows(lang) : channelRows(lang)} series={CHANNELS}
      title={MESSAGES_BY_CHANNEL} height={220} locale={lang} />
  );
}

export const specimen = defineSpecimen({
  id: 'chart',
  name: 'Chart',
  group: 'charts',
  from: '@notis/sdk/ui',
  covers: ['Chart'],
  summary: 'One period series as bars, a line or an area, with the comparison dashed, a legend, tooltips and a hidden data table.',
  states: [
    {
      id: 'weekly-switch',
      label: 'Twelve weeks with a metric picker and a chart type switch (deck composition a)',
      render: ({ lang, width }) => <WeeklyChart lang={lang} width={width} />,
    },
    {
      id: 'bars-live',
      label: 'Bars against the previous period; today is still filling, drawn full colour',
      render: ({ lang }) => <Pad><Signups lang={lang} /></Pad>,
    },
    {
      id: 'line-year',
      label: 'Line over 90 days by week against the same weeks last year, in thousands',
      render: ({ lang }) => {
        const metric = metricOf('messages');
        return (
          <Pad>
            <Chart kind="line" data={periodRows(metric, lang, rangeOf('last90'), 'year')} compare="year"
              format={periodFormat(metric)} title={metric.label} locale={lang} />
          </Pad>
        );
      },
    },
    {
      id: 'area-reader',
      label: 'Area at 180 px with no comparison, as a reader page shows it (deck composition d)',
      render: ({ lang }) => {
        const metric = metricOf('active');
        return (
          <Pad>
            <Chart kind="area" data={periodRows(metric, lang, rangeOf('last30'), 'none')} title={metric.label}
              height={180} locale={lang} />
          </Pad>
        );
      },
    },
    {
      id: 'series',
      label: 'Three series as lines, one per channel',
      render: ({ lang }) => <Pad><Channels lang={lang} /></Pad>,
    },
    {
      id: 'series-bars',
      label: 'Three series as bars over two weeks (only a single series dims past bars)',
      render: ({ lang }) => <Pad><Channels lang={lang} kind="bar" /></Pad>,
    },
    {
      id: 'today-hours',
      label: 'Today by hour against yesterday: the hours to come are empty',
      render: ({ lang }) => (
        <Pad>
          <Chart kind="bar" data={seriesRows(HOURLY_MESSAGES, lang, 'today', 'prev')} compare="prev"
            title={MESSAGES_BY_HOUR} locale={lang} />
        </Pad>
      ),
    },
    {
      id: 'long-labels',
      label: 'Series with long names: the legend wraps',
      render: ({ lang }) => (
        <Pad>
          <Chart kind="area" data={answerRows(lang)} series={ANSWERS} title={HOW_ANSWERED} locale={lang} />
        </Pad>
      ),
    },
    {
      id: 'horizontal',
      label: 'Horizontal bars by category, three channels side by side: names wrap to two lines, short values after the bars',
      render: ({ lang }) => <Pad><Asks lang={lang} /></Pad>,
    },
    {
      id: 'horizontal-stacked-narrow',
      label: 'Narrow (390): stacked horizontal bars, the axis keeps 40% at most and cuts what still does not fit',
      width: 390,
      render: ({ lang }) => <Pad><Asks lang={lang} stacked /></Pad>,
    },
    {
      id: 'empty-period',
      label: 'Empty: nothing recorded in the period, every bin at zero',
      render: ({ lang }) => (
        <Pad>
          <Chart kind="bar" data={zeroRows(lang)} compare="prev" title={metricOf('paid').label} locale={lang} />
        </Pad>
      ),
    },
    {
      id: 'no-rows',
      label: 'Empty: no rows at all',
      render: ({ lang }) => <Pad><Chart kind="line" data={[]} title={metricOf('spaces').label} locale={lang} /></Pad>,
    },
    {
      id: 'tooltip',
      label: 'Hover on a bar: it lights up and the tooltip names the day and both values',
      height: 320,
      render: ({ lang }) => <Pad><Signups lang={lang} /></Pad>,
      interact: (root) => hoverPlot(root, { at: 0.62 }),
    },
    {
      id: 'tooltip-series',
      label: 'Hover on a line chart with three series',
      height: 340,
      render: ({ lang }) => <Pad><Channels lang={lang} /></Pad>,
      interact: (root) => hoverPlot(root, { at: 0.44 }),
    },
    {
      id: 'narrow',
      label: 'Narrow (390): fewer axis labels, the legend under the plot',
      width: 390,
      render: ({ lang }) => <Pad><Signups lang={lang} /></Pad>,
    },
    {
      id: 'data-table',
      label: 'The hidden data table view Markdown reads, drawn in full under the chart',
      render: ({ lang }) => (
        <Pad className="grid gap-4">
          <Signups lang={lang} />
          <div data-chart-table-out="" className="max-w-[40rem]" />
        </Pad>
      ),
      interact: (root) => revealTable(root),
    },
  ],
});
