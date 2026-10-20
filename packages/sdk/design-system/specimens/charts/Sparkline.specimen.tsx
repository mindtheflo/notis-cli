import * as React from 'react';
import { defineSpecimen, type SpecimenCopy, type SpecimenLang } from '../../specimen';
import { Sparkline } from '../../../src/ui/index';
import { WEEKLY_METRICS, thousands } from '../../fixtures/charts/metrics';
import { Pad } from '../../fixtures/charts/parts';

const SHAPES: Array<{ id: string; label: SpecimenCopy; values: number[] }> = [
  { id: 'rising', label: { en: 'Rising', fr: 'En hausse' }, values: [12, 14, 13, 17, 19, 18, 22, 25, 24, 28, 31, 34] },
  { id: 'falling', label: { en: 'Falling', fr: 'En baisse' }, values: [34, 31, 32, 27, 25, 26, 21, 19, 20, 16, 14, 12] },
  { id: 'flat', label: { en: 'Flat', fr: 'Stable' }, values: [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20] },
  { id: 'spike', label: { en: 'One spike', fr: 'Un pic' }, values: [4, 5, 4, 6, 5, 48, 6, 5, 4, 5, 6, 5] },
  { id: 'weekends', label: { en: 'Weekend dips', fr: 'Creux du week-end' }, values: [30, 32, 31, 29, 27, 12, 10, 31, 33, 32, 30, 28, 13, 11] },
  { id: 'two', label: { en: 'Two points', fr: 'Deux points' }, values: [8, 13] },
  { id: 'single', label: { en: 'One point', fr: 'Un seul point' }, values: [17] },
  { id: 'zeros', label: { en: 'All zero', fr: 'Que des zéros' }, values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'negative', label: { en: 'Below zero (clamped)', fr: 'Sous zéro (ramené à zéro)' }, values: [6, 3, -2, -5, 1, 4, 8, 5, -1, 3, 7, 9] },
  { id: 'gaps', label: { en: 'Missing values (read as zero)', fr: 'Valeurs manquantes (lues comme zéro)' }, values: [9, 11, Number.NaN, 12, 14, Number.NaN, 15, 17, 16, 19, 18, 21] },
  { id: 'empty', label: { en: 'No values', fr: 'Aucune valeur' }, values: [] },
];

const SIZES = [
  { width: 72, height: 24, note: { en: '72 × 24, the default', fr: '72 × 24, par défaut' } },
  { width: 140, height: 32, note: { en: '140 × 32', fr: '140 × 32' } },
  { width: 240, height: 48, note: { en: '240 × 48', fr: '240 × 48' } },
  { width: 320, height: 72, note: { en: '320 × 72', fr: '320 × 72' } },
];

const LAST_12 = { en: 'Last 12 weeks', fr: '12 dernières semaines' };

function latest(values: readonly number[], lang: SpecimenLang, inThousands?: boolean): string {
  const value = values[values.length - 1]!;
  return inThousands ? thousands(value, lang) : new Intl.NumberFormat(lang).format(value);
}

export const specimen = defineSpecimen({
  id: 'sparkline',
  name: 'Sparkline',
  group: 'charts',
  from: '@notis/sdk/ui',
  covers: ['Sparkline'],
  summary: 'A small trend line with a soft area under it, drawn in the first chart colour; decorative, hidden from screen readers.',
  states: [
    {
      id: 'metrics',
      label: 'Twelve weeks of each product metric, next to its latest figure',
      render: ({ lang }) => (
        <Pad className="grid gap-x-10 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {WEEKLY_METRICS.map((metric) => (
            <div key={metric.key} className="flex items-center justify-between gap-4">
              <div className="grid min-w-0">
                <span className="truncate text-xs text-muted-foreground">{metric.label[lang]}</span>
                <span className="text-lg font-semibold tabular-nums">{latest(metric.series, lang, metric.inThousands)}</span>
              </div>
              <Sparkline values={metric.series} width={140} height={32} />
            </div>
          ))}
          <span className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">{LAST_12[lang]}</span>
        </Pad>
      ),
    },
    {
      id: 'shapes',
      label: 'Shapes, including the edge cases: one point, all zero, below zero, missing values and no values',
      render: ({ lang }) => (
        <Pad className="grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          {SHAPES.map((shape) => (
            <div key={shape.id} className="grid gap-2">
              <span className="text-xs text-muted-foreground">{shape.label[lang]}</span>
              <Sparkline values={shape.values} width={140} height={32} />
            </div>
          ))}
        </Pad>
      ),
    },
    {
      id: 'sizes',
      label: 'Sizes: the default, the table trend and larger',
      render: ({ lang }) => (
        <Pad className="flex flex-wrap items-end gap-10">
          {SIZES.map((size) => (
            <div key={size.width} className="grid gap-2">
              <Sparkline values={WEEKLY_METRICS[1]!.series} width={size.width} height={size.height} />
              <span className="text-xs tabular-nums text-muted-foreground">{size.note[lang]}</span>
            </div>
          ))}
        </Pad>
      ),
    },
    {
      id: 'narrow',
      label: 'Narrow (390)',
      width: 390,
      render: ({ lang }) => (
        <Pad className="grid gap-5">
          {WEEKLY_METRICS.slice(0, 4).map((metric) => (
            <div key={metric.key} className="flex items-center justify-between gap-4">
              <div className="grid min-w-0">
                <span className="truncate text-xs text-muted-foreground">{metric.label[lang]}</span>
                <span className="text-lg font-semibold tabular-nums">{latest(metric.series, lang, metric.inThousands)}</span>
              </div>
              <Sparkline values={metric.series} />
            </div>
          ))}
        </Pad>
      ),
    },
  ],
});
