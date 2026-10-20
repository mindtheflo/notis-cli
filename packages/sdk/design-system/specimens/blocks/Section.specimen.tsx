import { useState } from 'react';
import { defineSpecimen, type SpecimenLang } from '../../specimen';
import {
  Button,
  Chart,
  ChartTable,
  FieldList,
  FieldRow,
  FieldText,
  PeriodPicker,
  Section,
  StatRow,
  Tooltip,
  formatDateRange,
  periodRanges,
  type ChartKind,
  type Period,
} from '../../../src/ui/index';
import { w, type Words } from '../../../src/words/index';
import { Bleed, KindSwitch, LAST_30, MetricsPage, PAGE_WORDS, periodStats } from '../../fixtures/charts/parts';
import { NOW, metricOf, periodFormat, periodRows } from '../../fixtures/charts/metrics';

const WORDS = {
  newMetric: w('New metric', 'Nouvel indicateur'),
  viewOptions: w('View options', 'Options d’affichage'),
  settings: w('Automation settings', 'Réglages de l’automatisation'),
  name: w('Name', 'Nom'),
  nameValue: w('Morning briefing', 'Point du matin'),
  schedule: w('Schedule', 'Planification'),
  scheduleValue: w('Every weekday at 8:00', 'Chaque jour de semaine à 8 h 00'),
  scheduleHint: w('In your time zone, Europe/Paris.', 'Dans ton fuseau horaire, Europe/Paris.'),
  prompt: w('Prompt', 'Consigne'),
  promptValue: w('Summarise my unread email and today’s meetings.', 'Résume mes e-mails non lus et les réunions du jour.'),
} satisfies Record<string, Words>;

/** The "+" and view menu buttons a data Section pins at the end of its head row. */
function HeadActions({ t }: { t: (words: Words) => string }) {
  return (
    <>
      <Tooltip label={WORDS.newMetric} keys="n">
        <Button variant="ghost" size="sm" icon="plus" aria-label={t(WORDS.newMetric)} />
      </Tooltip>
      <Tooltip label={WORDS.viewOptions}>
        <Button variant="ghost" size="sm" icon="dots-three" aria-label={t(WORDS.viewOptions)} />
      </Tooltip>
    </>
  );
}

/** bar: the period bar at the top of a page. */
function BarSection({ lang }: { lang: SpecimenLang }) {
  const [period, setPeriod] = useState<Period>(LAST_30);
  return (
    <Bleed>
      <Section kind="bar"><PeriodPicker value={period} onChange={setPeriod} locale={lang} /></Section>
    </Bleed>
  );
}

/** stats: four key figures across the full width. */
function StatsSection({ lang }: { lang: SpecimenLang }) {
  return (
    <Bleed>
      <Section kind="stats">
        <StatRow metrics={periodStats(lang, LAST_30).slice(0, 4)} compare={LAST_30.compare} locale={lang} />
      </Section>
    </Bleed>
  );
}

/** chart: a chart under its head (title, the date range as meta, the type switch as tabs). */
function ChartSection({ lang }: { lang: SpecimenLang }) {
  const [kind, setKind] = useState<ChartKind>('bar');
  const metric = metricOf('signups');
  const { range } = periodRanges(LAST_30, NOW);
  return (
    <Bleed>
      <Section kind="chart" title={metric.label} meta={formatDateRange(range, lang)}
        tabs={<KindSwitch value={kind} onChange={setKind} />}>
        <Chart kind={kind} data={periodRows(metric, lang, range, LAST_30.compare)} compare={LAST_30.compare}
          format={periodFormat(metric)} title={metric.label} height={200} locale={lang} />
      </Section>
    </Bleed>
  );
}

/** data: a table under its head (title, count and the end actions); its edge cells carry the 24px inset. */
function DataSection({ lang, t }: { lang: SpecimenLang; t: (words: Words) => string }) {
  const stats = periodStats(lang, LAST_30);
  const [active, setActive] = useState('signups');
  return (
    <Bleed>
      <Section kind="data" title={PAGE_WORDS.metrics} count={stats.length} actions={<HeadActions t={t} />}>
        <ChartTable metrics={stats} compare={LAST_30.compare} title={PAGE_WORDS.metrics} activeId={active}
          onSelect={(picked) => setActive(picked.id ?? active)} locale={lang} />
      </Section>
    </Bleed>
  );
}

/** form: fields across the full width, each capping its own width. */
function FormSection({ t }: { t: (words: Words) => string }) {
  const [name, setName] = useState(t(WORDS.nameValue));
  const [schedule, setSchedule] = useState(t(WORDS.scheduleValue));
  const [prompt, setPrompt] = useState(t(WORDS.promptValue));
  return (
    <Bleed>
      <Section kind="form" title={WORDS.settings}>
        <FieldList>
          <FieldRow label={WORDS.name}><FieldText value={name} onChange={setName} label={WORDS.name} /></FieldRow>
          <FieldRow label={WORDS.schedule} hint={t(WORDS.scheduleHint)}>
            <FieldText value={schedule} onChange={setSchedule} label={WORDS.schedule} />
          </FieldRow>
          <FieldRow label={WORDS.prompt}><FieldText value={prompt} onChange={setPrompt} label={WORDS.prompt} /></FieldRow>
        </FieldList>
      </Section>
    </Bleed>
  );
}

export const specimen = defineSpecimen({
  id: 'section',
  name: 'Section',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['Section'],
  summary: 'A full-width page section with no border, ring, background or radius; its kind (bar, stats, chart, data, form) sets the spacing.',
  states: [
    { id: 'bar', label: 'bar: the period bar (px 24, pt 12)', render: ({ lang }) => <BarSection lang={lang} /> },
    { id: 'stats', label: 'stats: a full-width StatRow strip', render: ({ lang }) => <StatsSection lang={lang} /> },
    {
      id: 'chart',
      label: 'chart: title, the range as meta and the type switch as tabs, then the chart (pt 32)',
      render: ({ lang }) => <ChartSection lang={lang} />,
    },
    {
      id: 'data',
      label: 'data: title, count and the end actions, then a table (pt 40)',
      render: ({ lang, t }) => <DataSection lang={lang} t={t} />,
    },
    { id: 'form', label: 'form: fields under a title (px 24, pt 24)', render: ({ t }) => <FormSection t={t} /> },
    {
      id: 'page',
      label: 'A page of Sections: bar, stats, chart, then data (the stats strip is ruled above and below after a bar)',
      render: ({ lang }) => <MetricsPage lang={lang} />,
    },
    {
      id: 'page-phone',
      label: 'The same page at phone width',
      width: 390,
      render: ({ lang }) => <MetricsPage lang={lang} />,
    },
    {
      id: 'dark',
      label: 'Dark theme: data and form Sections',
      theme: 'dark',
      render: ({ lang, t }) => (
        <div className="flex flex-col">
          <DataSection lang={lang} t={t} />
          <FormSection t={t} />
        </div>
      ),
    },
  ],
});
