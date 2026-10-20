import * as React from 'react';
import { defineSpecimen, type SpecimenLang } from '../../specimen';
import { StatRow, type StatMetric } from '../../../src/ui/index';
import { WEEKLY_METRICS, costStats, edgeStats, weeklyStat, YEAR_AGO } from '../../fixtures/charts/metrics';
import { LAST_30, Pad, periodStats } from '../../fixtures/charts/parts';
import { focusAbout } from '../../fixtures/charts/interact';

const LAST_30_YEAR = { preset: 'last30', compare: 'year' } as const;
const LAST_30_NONE = { preset: 'last30', compare: 'none' } as const;

/** Figures that are not numbers: a status with a hint in place of the comparison. */
function statusStats(lang: SpecimenLang): StatMetric[] {
  return [
    {
      id: 'sync',
      label: { en: 'Calendar sync', fr: 'Synchronisation du calendrier' },
      value: lang === 'fr' ? 'À jour' : 'Up to date',
      hint: { en: 'Last run at 11:20', fr: 'Dernière exécution à 11 h 20' },
    },
    {
      id: 'plan',
      label: { en: 'Plan', fr: 'Offre' },
      value: 'Pro',
      hint: { en: 'Renews on July 3', fr: 'Renouvelée le 3 juillet' },
    },
    {
      id: 'automations',
      label: { en: 'Active automations', fr: 'Automatisations actives' },
      value: 18,
      previous: 18,
      hint: { en: '3 paused', fr: '3 en pause' },
    },
  ];
}

export const specimen = defineSpecimen({
  id: 'stat-row',
  name: 'StatRow',
  group: 'charts',
  from: '@notis/sdk/ui',
  covers: ['StatRow'],
  summary: 'Key figures in a row: the label, the value, the change against the comparison and what it was before.',
  states: [
    {
      id: 'deck-four',
      label: 'Four figures over the last 30 days against the 30 days before (the deck chart page)',
      render: ({ lang }) => (
        <Pad><StatRow metrics={periodStats(lang, LAST_30).slice(0, 4)} compare="prev" locale={lang} /></Pad>
      ),
    },
    {
      id: 'compare-year',
      label: 'Against the same 30 days last year',
      render: ({ lang }) => (
        <Pad><StatRow metrics={periodStats(lang, LAST_30_YEAR).slice(0, 4)} compare="year" locale={lang} /></Pad>
      ),
    },
    {
      id: 'compare-none',
      label: 'No comparison: the value alone',
      render: ({ lang }) => (
        <Pad><StatRow metrics={periodStats(lang, LAST_30_NONE).slice(0, 4)} compare="none" locale={lang} /></Pad>
      ),
    },
    {
      id: 'six-weekly',
      label: 'Six figures of the week against the week before: the row wraps',
      render: ({ lang }) => (
        <Pad><StatRow metrics={WEEKLY_METRICS.map((metric) => weeklyStat(metric))} locale={lang} /></Pad>
      ),
    },
    {
      id: 'year-ago',
      label: 'This week against the same week last year',
      render: ({ lang }) => (
        <Pad>
          <StatRow metrics={WEEKLY_METRICS.slice(0, 4).map((metric) => weeklyStat(metric, { previous: YEAR_AGO[metric.key] }))}
            compare="year" locale={lang} />
        </Pad>
      ),
    },
    {
      id: 'lower-is-better',
      label: 'Lower is better: a fall reads green, a rise red',
      render: ({ lang }) => <Pad><StatRow metrics={costStats()} locale={lang} /></Pad>,
    },
    {
      id: 'text-and-hint',
      label: 'Text values with a hint in place of the comparison; an unchanged count',
      render: ({ lang }) => <Pad><StatRow metrics={statusStats(lang)} locale={lang} /></Pad>,
    },
    {
      id: 'edge-cases',
      label: 'Long labels, a previous value of zero (no change shown) and an unchanged figure',
      render: ({ lang }) => <Pad><StatRow metrics={edgeStats()} locale={lang} /></Pad>,
    },
    {
      id: 'about',
      label: 'An about button after each label',
      render: ({ lang }) => (
        <Pad><StatRow metrics={periodStats(lang, LAST_30, true).slice(0, 4)} locale={lang} /></Pad>
      ),
    },
    {
      id: 'about-open',
      label: 'About focused from the keyboard: its tooltip says what the figure counts',
      height: 200,
      render: ({ lang }) => (
        <Pad className="pt-12">
          <StatRow metrics={periodStats(lang, LAST_30, true).slice(0, 4)} locale={lang} />
        </Pad>
      ),
      interact: (root) => focusAbout(root, 1),
    },
    {
      id: 'one',
      label: 'One figure alone',
      render: ({ lang }) => (
        <Pad>
          <StatRow metrics={[periodStats(lang, LAST_30)[0]!]} locale={lang} />
        </Pad>
      ),
    },
    {
      id: 'narrow',
      label: 'Narrow (390): two columns',
      width: 390,
      render: ({ lang }) => (
        <Pad><StatRow metrics={periodStats(lang, LAST_30).slice(0, 4)} locale={lang} /></Pad>
      ),
    },
    {
      id: 'narrow-about',
      label: 'Narrow (390) with about buttons',
      width: 390,
      render: ({ lang }) => (
        <Pad><StatRow metrics={periodStats(lang, LAST_30, true).slice(0, 4)} locale={lang} /></Pad>
      ),
    },
    {
      id: 'empty',
      label: 'Empty: no figures, the row draws nothing (it has no empty or loading state of its own)',
      render: ({ lang }) => <Pad><StatRow metrics={[]} locale={lang} /></Pad>,
    },
  ],
});
