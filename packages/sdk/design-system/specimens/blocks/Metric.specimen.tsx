import type { ReactNode } from 'react';
import { defineSpecimen, type SpecimenLang } from '../../specimen';
import { Metric, VS_WORDS, formatDelta, formatNumber } from '../../../src/ui/index';
import { w } from '../../../src/words/index';
import { WEEK_METRICS } from '../../fixtures/blocks/blocks';

type Key = keyof typeof WEEK_METRICS;

const SINCE = w('Since 8 June', 'Depuis le 8 juin');

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-6 md:grid-cols-4">{children}</div>;
}

/** One fixture metric with its formatted value and its change against the week before. */
function WeekMetric({ id, lang, invert = false, hint }: { id: Key; lang: SpecimenLang; invert?: boolean; hint?: boolean }) {
  const metric = WEEK_METRICS[id];
  const value = formatNumber(metric.current, lang);
  const delta = formatDelta(metric.current, metric.previous, lang, !invert);
  const flat = metric.current === metric.previous;
  return (
    <Metric label={metric.label}
      value={id === 'duration' ? `${value}\u00a0s` : value}
      delta={delta ? (flat ? formatNumber(0, lang, { style: 'percent' }) : delta.text) : undefined}
      trend={!delta || flat ? 'flat' : delta.up ? 'up' : 'down'}
      invert={invert}
      hint={hint ? VS_WORDS.prev : undefined} />
  );
}

export const specimen = defineSpecimen({
  id: 'metric',
  name: 'Metric',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['Metric'],
  summary: 'One number with its label, its change against the comparison period and a hint.',
  states: [
    {
      id: 'trends',
      label: 'Up (good), down (bad), flat, and no delta',
      render: ({ lang }) => (
        <Grid>
          <WeekMetric id="runs" lang={lang} />
          <WeekMetric id="automations" lang={lang} />
          <WeekMetric id="duration" lang={lang} />
          <Metric label={w('Skills', 'Compétences')} value={formatNumber(41, lang)} />
        </Grid>
      ),
    },
    {
      id: 'invert',
      label: 'invert: a rise in credits is bad, a fall in failures is good',
      render: ({ lang }) => (
        <Grid>
          <WeekMetric id="credits" lang={lang} invert />
          <WeekMetric id="failures" lang={lang} invert />
        </Grid>
      ),
    },
    {
      id: 'hint',
      label: 'With a hint line',
      render: ({ lang }) => (
        <Grid>
          <WeekMetric id="runs" lang={lang} hint />
          <WeekMetric id="credits" lang={lang} invert hint />
          <Metric label={w('Connected apps', 'Apps connectées')} value={formatNumber(6, lang)} hint={SINCE} />
        </Grid>
      ),
    },
    {
      id: 'loading',
      label: 'Loading: a skeleton passed as the value (Metric has no loading prop)',
      render: ({ t }) => (
        <Grid>
          {(['runs', 'credits', 'failures'] as const).map((id) => (
            <Metric key={id} label={WEEK_METRICS[id].label}
              value={<span className="nui-skel my-1 h-6 w-20" role="img" aria-label={t({ en: 'Loading', fr: 'Chargement en cours' })} />} />
          ))}
        </Grid>
      ),
    },
    {
      id: 'empty',
      label: 'No data yet: zero with a hint (Metric has no empty prop)',
      render: ({ lang }) => (
        <Grid>
          <Metric label={WEEK_METRICS.runs.label} value={formatNumber(0, lang)}
            hint={w('No runs in this period', 'Aucune exécution sur cette période')} />
        </Grid>
      ),
    },
    {
      id: 'narrow',
      label: 'Narrow (390px): two columns and the longer French labels',
      width: 390,
      render: ({ lang }) => (
        <Grid>
          <WeekMetric id="runs" lang={lang} hint />
          <WeekMetric id="automations" lang={lang} hint />
          <WeekMetric id="credits" lang={lang} invert hint />
          <WeekMetric id="failures" lang={lang} invert hint />
        </Grid>
      ),
    },
  ],
});
