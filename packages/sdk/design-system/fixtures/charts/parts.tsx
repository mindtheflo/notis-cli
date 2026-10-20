/**
 * Pieces the chart specimens share: the deck's chart page (layouts r5, composition b, the one Flo picked), the
 * twelve-week chart of composition a, the chart type switch and an about button. Composed from the toolkit only.
 */
// The classic JSX transform (tsx outside the package tsconfig) needs React in scope.
import * as React from 'react';
import type { ReactNode } from 'react';
import type { SpecimenLang } from '../../specimen';
import {
  Button,
  Chart,
  ChartTable,
  PeriodPicker,
  Section,
  SegmentedControl,
  StatRow,
  Tooltip,
  formatDateRange,
  periodRanges,
  type ChartKind,
  type Period,
  type StatMetric,
} from '../../../src/ui/index';
import { w, type Words } from '../../../src/words/index';
import {
  NOW,
  WEEKLY_METRICS,
  metricOf,
  periodFormat,
  periodRows,
  periodStat,
  thousands,
  weeklyRows,
  type WeeklyMetric,
} from './metrics';

/** The deck's words for the chart page (layouts r5). */
export const PAGE_WORDS = {
  metrics: w('Metrics', 'Indicateurs'),
  chartType: w('Chart type', 'Type de graphique'),
  metric: w('Metric', 'Indicateur'),
  last12: w('Last 12 weeks', '12 dernières semaines'),
  bar: w('Bars', 'Barres'),
  line: w('Line', 'Courbe'),
  area: w('Area', 'Domaine'),
  about: w('About {m}', 'À propos de {m}'),
} as const;

export const LAST_30: Period = { preset: 'last30', compare: 'prev' };

const pickWords = (words: Words, lang: SpecimenLang) => words[lang];

/**
 * Layout values written as inline styles: the book compiles Tailwind over `src/` and `specimens/` only, so a class
 * used nowhere but in a fixture would not exist in the book.
 */
const BLEED = { marginInline: -24 } as const;

/** A state's body. The frame already pads every state by 24 px, the inset of a Space page, so this adds none. */
export function Pad({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

/** Bleeds a table to the page edges, as a Space page lays one out: its cells carry the 24 px inset themselves. */
export function Bleed({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className} style={BLEED}>{children}</div>;
}

const KIND_OPTIONS = [
  { value: 'bar', label: PAGE_WORDS.bar },
  { value: 'line', label: PAGE_WORDS.line },
  { value: 'area', label: PAGE_WORDS.area },
] as const;

/** Bars, Line, Area: the deck's chart type switch. */
export function KindSwitch({ value, onChange }: { value: ChartKind; onChange: (kind: ChartKind) => void }) {
  return <SegmentedControl options={KIND_OPTIONS} value={value} onChange={onChange} label={PAGE_WORDS.chartType} />;
}

function InfoGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"
      aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.3" />
      <path d="M8 7.3v3.9" strokeLinecap="round" />
      <circle cx="8" cy="4.9" r=".75" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** What a figure counts: a quiet info button whose tooltip holds the definition (a Space's own about). */
export function About({ metric, lang }: { metric: WeeklyMetric; lang: SpecimenLang }) {
  const name = pickWords(metric.label, lang);
  return (
    <Tooltip label={metric.definition}>
      <Button variant="ghost" size="sm" icon={<InfoGlyph />} data-about=""
        aria-label={pickWords(PAGE_WORDS.about, lang).replace('{m}', name)} />
    </Tooltip>
  );
}

/** Each metric over the period, with an about when asked. */
export function periodStats(lang: SpecimenLang, period: Period, about = false): StatMetric[] {
  const { range } = periodRanges(period, NOW);
  return WEEKLY_METRICS.map((metric) => periodStat(metric, lang, range, period.compare,
    about ? { about: <About metric={metric} lang={lang} /> } : {}));
}

/**
 * The chart page Flo picked (deck layouts r5, composition b), built from Sections (the page title lives in the top
 * bar): the period bar, four key figures, the chart of the picked metric with its range and the type switch, then
 * every metric in a table that picks it.
 */
export function MetricsPage({ lang, initial = LAST_30, kind: initialKind = 'bar', active: initialActive = 'signups', about = false }: {
  lang: SpecimenLang;
  initial?: Period;
  kind?: ChartKind;
  active?: string;
  about?: boolean;
}) {
  const [period, setPeriod] = React.useState<Period>(initial);
  const [kind, setKind] = React.useState<ChartKind>(initialKind);
  const [active, setActive] = React.useState(initialActive);
  const { range } = periodRanges(period, NOW);
  const metric = metricOf(active);
  const stats = periodStats(lang, period, about);
  return (
    <div className="w-full pb-4" style={{ ...BLEED, maxWidth: '72rem' }}>
      <Section kind="bar">
        <PeriodPicker value={period} onChange={setPeriod} locale={lang} />
      </Section>
      <Section kind="stats">
        <StatRow metrics={stats.slice(0, 4)} compare={period.compare} locale={lang} />
      </Section>
      <Section kind="chart" title={metric.label} meta={formatDateRange(range, lang)}
        tabs={<KindSwitch value={kind} onChange={setKind} />}>
        <Chart kind={kind} data={periodRows(metric, lang, range, period.compare)} compare={period.compare}
          format={periodFormat(metric)} title={metric.label} height={200} locale={lang} />
      </Section>
      <Section kind="data" title={PAGE_WORDS.metrics}>
        <ChartTable metrics={stats} compare={period.compare} title={PAGE_WORDS.metrics} activeId={active}
          onSelect={(picked) => setActive(picked.id ?? active)} locale={lang} />
      </Section>
    </div>
  );
}

/**
 * The deck's composition a: a metric picker and the type switch, the latest week's figure, then one chart over the
 * twelve complete weeks (280 px, 200 on a phone).
 */
export function WeeklyChart({ lang, width, kind: initialKind = 'bar', metric: initialMetric = 'signups' }: {
  lang: SpecimenLang;
  width: number;
  kind?: ChartKind;
  metric?: string;
}) {
  const [kind, setKind] = React.useState<ChartKind>(initialKind);
  const [key, setKey] = React.useState(initialMetric);
  const metric = metricOf(key);
  const format = metric.inThousands ? thousands : undefined;
  const latest = metric.series[metric.series.length - 1]!;
  const options = WEEKLY_METRICS.map((m) => ({ value: m.key, label: m.label }));
  return (
    <div className="w-full" style={{ ...BLEED, maxWidth: '64rem' }}>
      <Section kind="bar">
        <SegmentedControl options={options} value={key} onChange={setKey} label={PAGE_WORDS.metric} />
        <div className="ml-auto shrink-0"><KindSwitch value={kind} onChange={setKind} /></div>
      </Section>
      <Section kind="chart" title={metric.label} meta={PAGE_WORDS.last12}>
        <div>
          <span className="font-semibold tabular-nums" style={{ fontSize: '1.875rem', lineHeight: '2.25rem' }}>
            {format ? format(latest, lang) : new Intl.NumberFormat(lang).format(latest)}
          </span>
          <div className="pt-4">
            <Chart kind={kind} data={weeklyRows(metric, lang)} format={format} title={metric.label}
              height={width <= 640 ? 200 : 280} locale={lang} />
          </div>
        </div>
      </Section>
    </div>
  );
}
