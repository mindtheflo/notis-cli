import { useState, type ReactNode } from 'react';
import { defineSpecimen } from '../../specimen';
import { SegmentedControl, type SegmentedOption } from '../../../src/ui/index';
import { SHELL_WORDS, w, type Words } from '../../../src/words/index';
import { AUTOMATION_FILTERS } from '../../fixtures/blocks/blocks';

type Period = 'day' | 'week' | 'month';
type Peek = 'side' | 'center' | 'full';
type Filter = (typeof AUTOMATION_FILTERS)[number]['value'];

const PERIOD_LABEL = w('Period', 'Période');
const PERIOD: readonly SegmentedOption<Period>[] = [
  { value: 'day', label: w('Day', 'Jour') },
  { value: 'week', label: w('Week', 'Semaine') },
  { value: 'month', label: w('Month', 'Mois') },
];

const PEEK_LABEL = w('Open records as', 'Ouvrir les fiches en');
const PEEK: readonly SegmentedOption<Peek>[] = [
  { value: 'side', label: SHELL_WORDS.sidePeek, icon: 'sidebar-simple' },
  { value: 'center', label: SHELL_WORDS.centerPeek, icon: 'square-center' },
  { value: 'full', label: SHELL_WORDS.fullPage, icon: 'corners-out' },
];

const FILTER_LABEL = w('Automation filters', 'Filtres des automatisations');
const FILTERS: readonly SegmentedOption<Filter>[] = AUTOMATION_FILTERS.map(({ value, label, count }) => ({ value, label, count }));

const LONG_LABEL = w('Show', 'Afficher');
const LONG: readonly SegmentedOption<'mine' | 'shared' | 'everyone'>[] = [
  { value: 'mine', label: w('Only mine', 'Uniquement les miennes') },
  { value: 'shared', label: w('Shared with me', 'Partagées avec moi') },
  { value: 'everyone', label: w('Whole team', 'Toute l’équipe') },
];

/** A control the reviewer can press. */
function Live<V extends string>({ options, start, label }: { options: readonly SegmentedOption<V>[]; start: V; label: Words }) {
  const [value, setValue] = useState<V>(start);
  return <SegmentedControl<V> options={options} value={value} onChange={setValue} label={label} />;
}

function Rows({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[max-content_1fr] items-center gap-x-6 gap-y-4">{children}</div>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-xs text-muted-foreground">{children}</code>;
}

export const specimen = defineSpecimen({
  id: 'segmented-control',
  name: 'SegmentedControl',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['SegmentedControl'],
  summary: 'One choice out of a few, always visible: a period, a layout, a list filter.',
  states: [
    {
      id: 'default',
      label: 'The period of a chart (press to choose)',
      render: () => (
        <Rows>
          <Code>value=&quot;week&quot;</Code>
          <div><Live options={PERIOD} start="week" label={PERIOD_LABEL} /></div>
        </Rows>
      ),
    },
    {
      id: 'icons',
      label: 'With icons: how a record opens',
      render: () => (
        <Rows>
          <Code>icon</Code>
          <div><Live options={PEEK} start="side" label={PEEK_LABEL} /></div>
        </Rows>
      ),
    },
    {
      id: 'counts',
      label: 'With counts: the automation filters',
      render: () => (
        <Rows>
          <Code>count</Code>
          <div><Live options={FILTERS} start="active" label={FILTER_LABEL} /></div>
        </Rows>
      ),
    },
    {
      id: 'disabled-option',
      label: 'A disabled option',
      render: () => (
        <Rows>
          <Code>disabled</Code>
          <div>
            <Live options={PERIOD.map((option) => (option.value === 'month' ? { ...option, disabled: true } : option))}
              start="day" label={PERIOD_LABEL} />
          </div>
        </Rows>
      ),
    },
    {
      id: 'long-text',
      label: 'Long French options',
      render: () => (
        <Rows>
          <Code>label</Code>
          <div><Live options={LONG} start="shared" label={LONG_LABEL} /></div>
        </Rows>
      ),
    },
    {
      id: 'narrow',
      label: 'Narrow (390px): the toolbar scrolls sideways and keeps the chosen option in view',
      width: 390,
      render: () => (
        <div className="flex flex-col gap-4">
          <div className="overflow-x-auto"><Live options={FILTERS} start="failed" label={FILTER_LABEL} /></div>
          <div className="overflow-x-auto"><Live options={LONG} start="everyone" label={LONG_LABEL} /></div>
        </div>
      ),
    },
  ],
});
