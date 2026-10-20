import * as React from 'react';
import { defineSpecimen, type SpecimenLang } from '../../specimen';
import { RenderChartData, formatNumber } from '../../../src/ui/index';
import { CHANNEL_LABELS, channelShare } from '../../fixtures/charts/metrics';
import { Pad } from '../../fixtures/charts/parts';
import { revealTable } from '../../fixtures/charts/interact';

const WORDS = {
  title: { en: 'Messages by channel, last 30 days', fr: 'Messages par canal, 30 derniers jours' },
  channel: { en: 'Channel', fr: 'Canal' },
  messages: { en: 'Messages', fr: 'Messages' },
  share: { en: 'Share', fr: 'Part' },
  runsTitle: { en: 'Automation runs this week', fr: 'Exécutions des automatisations cette semaine' },
  automation: { en: 'Automation', fr: 'Automatisation' },
  runs: { en: 'Runs', fr: 'Exécutions' },
  paused: { en: 'Paused', fr: 'En pause' },
  lastError: { en: 'Last error', fr: 'Dernière erreur' },
  readsThis: { en: 'What view Markdown reads:', fr: 'Ce que lit la vue Markdown :' },
  nothing: { en: 'Nothing recorded in the last 30 days.', fr: 'Rien d’enregistré sur les 30 derniers jours.' },
} as const;

const COLORS = { web: 'hsl(var(--chart-1))', whatsapp: 'hsl(var(--chart-2))', slack: 'hsl(var(--chart-3))' };

function shareTable(lang: SpecimenLang) {
  const shares = channelShare(lang);
  const sum = shares.reduce((total, row) => total + row.value, 0);
  return shares.map((row) => ({
    ...row,
    label: CHANNEL_LABELS[row.key][lang],
    share: formatNumber(row.value / sum, lang, { style: 'percent', maximumFractionDigits: 0 }),
  }));
}

/** A Space's own chart (bars drawn as plain boxes), its numbers kept for view Markdown by RenderChartData. */
function ShareBars({ lang, reveal = false }: { lang: SpecimenLang; reveal?: boolean }) {
  const rows = shareTable(lang);
  const max = Math.max(...rows.map((row) => row.value));
  return (
    <Pad className="grid max-w-[40rem] gap-5">
      <RenderChartData
        title={WORDS.title[lang]}
        columns={[WORDS.channel[lang], WORDS.messages[lang], WORDS.share[lang]]}
        rows={rows.map((row) => [row.label, formatNumber(row.value, lang), row.share])}
      >
        <div className="grid gap-3" role="img" aria-label={WORDS.title[lang]}>
          <span className="text-sm font-medium">{WORDS.title[lang]}</span>
          {rows.map((row) => (
            <div key={row.key} className="grid grid-cols-[6rem_1fr_3rem] items-center gap-3 text-sm">
              <span className="truncate text-muted-foreground">{row.label}</span>
              <span className="h-3 rounded-sm" style={{ width: `${(row.value / max) * 100}%`, background: COLORS[row.key] }} />
              <span className="text-right tabular-nums">{row.share}</span>
            </div>
          ))}
        </div>
      </RenderChartData>
      {reveal && (
        <div className="grid gap-2">
          <span className="text-xs text-muted-foreground">{WORDS.readsThis[lang]}</span>
          <div data-chart-table-out="" />
        </div>
      )}
    </Pad>
  );
}

export const specimen = defineSpecimen({
  id: 'render-chart-data',
  name: 'RenderChartData',
  group: 'charts',
  from: '@notis/sdk/ui',
  covers: ['RenderChartData'],
  summary: 'Keeps the numbers of a hand-drawn chart in a hidden table, so view Markdown reads them without a second visible table.',
  states: [
    {
      id: 'as-drawn',
      label: 'As a reader sees it: only the chart, the table stays hidden',
      render: ({ lang }) => <ShareBars lang={lang} />,
    },
    {
      id: 'revealed',
      label: 'The hidden table drawn under the chart: the numbers view Markdown reads',
      render: ({ lang }) => <ShareBars lang={lang} reveal />,
      interact: (root) => revealTable(root),
    },
    {
      id: 'mixed-values',
      label: 'Booleans and missing values: written as true or false, and empty',
      render: ({ lang }) => (
        <Pad className="grid max-w-[40rem] gap-2">
          <RenderChartData
            title={WORDS.runsTitle[lang]}
            columns={[WORDS.automation[lang], WORDS.runs[lang], WORDS.paused[lang], WORDS.lastError[lang]]}
            rows={[
              [lang === 'fr' ? 'Résumé du matin' : 'Morning briefing', 7, false, null],
              [lang === 'fr' ? 'Relance des factures' : 'Invoice follow-up', 3, false, lang === 'fr' ? 'Gmail déconnecté' : 'Gmail disconnected'],
              [lang === 'fr' ? 'Veille concurrents' : 'Competitor watch', 0, true, null],
            ]}
          />
          <span className="text-xs text-muted-foreground">{WORDS.readsThis[lang]}</span>
          <div data-chart-table-out="" />
        </Pad>
      ),
      interact: (root) => revealTable(root),
    },
    {
      id: 'empty',
      label: 'Empty: no rows, the table holds its header alone',
      render: ({ lang }) => (
        <Pad className="grid max-w-[40rem] gap-2">
          <RenderChartData title={WORDS.title[lang]} columns={[WORDS.channel[lang], WORDS.messages[lang]]} rows={[]}>
            <span className="text-sm text-muted-foreground">{WORDS.nothing[lang]}</span>
          </RenderChartData>
          <span className="pt-3 text-xs text-muted-foreground">{WORDS.readsThis[lang]}</span>
          <div data-chart-table-out="" />
        </Pad>
      ),
      interact: (root) => revealTable(root),
    },
    {
      id: 'narrow',
      label: 'Narrow (390), table revealed',
      width: 390,
      render: ({ lang }) => <ShareBars lang={lang} reveal />,
      interact: (root) => revealTable(root),
    },
  ],
});
