import * as React from 'react';
import { defineSpecimen, type SpecimenLang } from '../../specimen';
import { PeriodPicker, type Period, type PresetId } from '../../../src/ui/index';
import { clickWhenReady, layerScope, settle, waitFor } from '../../fixtures/dates/interact';

/** A picker that keeps its own period, as a Space does with usePeriod. */
function Picker({ lang, initial, compare, presets }: {
  lang: SpecimenLang;
  initial: Period;
  compare?: boolean;
  presets?: readonly PresetId[];
}) {
  const [value, setValue] = React.useState<Period>(initial);
  return <PeriodPicker value={value} onChange={setValue} compare={compare} presets={presets} locale={lang} />;
}

const LAST_30: Period = { preset: 'last30', compare: 'prev' };
// A custom range a month back, compared with the same days last year (fixed clock: 15 June 2026).
const CUSTOM_MAY: Period = { preset: 'custom', compare: 'year', from: '2026-05-04', to: '2026-05-31' };
const SHORT_LIST: readonly PresetId[] = ['last7', 'last30', 'thisMonth', 'lastMonth', 'custom'];

const openRange = async (root: HTMLElement) => {
  await clickWhenReady(root, '[data-pp-open="range"]');
  await waitFor(layerScope(root), '.nui-pp-panel');
  await settle();
};

// Days of June 2026, shown in both the two-month and the one-month calendar.
const day = (iso: string) => `.nui-pp-panel td[data-day="${iso}"]:not([data-outside]) button`;

export const specimen = defineSpecimen({
  id: 'period-picker',
  name: 'PeriodPicker',
  group: 'dates',
  from: '@notis/sdk/ui',
  covers: ['PeriodPicker'],
  summary: 'Two buttons that pick the reporting period (a preset or a custom range) and what it is compared with.',
  states: [
    {
      id: 'default',
      label: 'Last 30 days against the previous period',
      render: ({ lang }) => <Picker lang={lang} initial={LAST_30} />,
    },
    {
      id: 'custom-range',
      label: 'Custom range against the same period last year',
      render: ({ lang }) => <Picker lang={lang} initial={CUSTOM_MAY} />,
    },
    {
      id: 'no-comparison',
      label: 'This quarter with no comparison',
      render: ({ lang }) => <Picker lang={lang} initial={{ preset: 'thisQuarter', compare: 'none' }} />,
    },
    {
      id: 'range-only',
      label: 'Range button only (compare off)',
      render: ({ lang }) => <Picker lang={lang} initial={{ preset: 'thisYear', compare: 'prev' }} compare={false} />,
    },
    {
      id: 'range-open',
      label: 'Range menu open: presets and two months',
      height: 600,
      render: ({ lang }) => <Picker lang={lang} initial={LAST_30} />,
      interact: openRange,
    },
    {
      id: 'range-open-narrow',
      label: 'Range menu open on a phone: one month, presets as chips',
      width: 390,
      height: 640,
      render: ({ lang }) => <Picker lang={lang} initial={LAST_30} />,
      interact: openRange,
    },
    {
      id: 'picking-last-day',
      label: 'Custom range: first day picked, waiting for the last',
      height: 600,
      render: ({ lang }) => <Picker lang={lang} initial={LAST_30} />,
      interact: async (root) => {
        await openRange(root);
        const scope = layerScope(root);
        await clickWhenReady(scope, '.nui-pp-opt[data-pp-preset="custom"]');
        await clickWhenReady(scope, day('2026-06-01'));
      },
    },
    {
      id: 'picked-range',
      label: 'Custom range picked, Apply enabled',
      height: 600,
      render: ({ lang }) => <Picker lang={lang} initial={LAST_30} />,
      interact: async (root) => {
        await openRange(root);
        const scope = layerScope(root);
        await clickWhenReady(scope, day('2026-06-01'));
        await clickWhenReady(scope, day('2026-06-12'));
      },
    },
    {
      id: 'compare-open',
      label: 'Compare menu open with the dates of each option',
      height: 300,
      render: ({ lang }) => <Picker lang={lang} initial={LAST_30} />,
      interact: async (root) => {
        await clickWhenReady(root, '[data-pp-open="cmp"]');
        await waitFor(layerScope(root), '.nui-pp-opt[data-pp-cmp]');
        await settle();
      },
    },
    {
      id: 'short-preset-list',
      label: 'A shorter preset list, open',
      height: 520,
      render: ({ lang }) => <Picker lang={lang} initial={{ preset: 'thisMonth', compare: 'prev' }} presets={SHORT_LIST} />,
      interact: openRange,
    },
  ],
});
