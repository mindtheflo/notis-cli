import { useState, type ReactNode } from 'react';
import { defineSpecimen } from '../../specimen';
import { NativeSelect, type NativeSelectOption } from '../../../src/ui/index';
import { w, type Words } from '../../../src/words/index';

type Sort = 'last-run' | 'next-run' | 'name' | 'created';
type Period = 'day' | 'week' | 'month';

const SORT_LABEL = w('Sort by', 'Trier par');
const SORT: readonly NativeSelectOption<Sort>[] = [
  { value: 'last-run', label: w('Last run', 'Dernière exécution') },
  { value: 'next-run', label: w('Next run', 'Prochaine exécution') },
  { value: 'name', label: w('Name', 'Nom') },
  { value: 'created', label: w('Date created', 'Date de création') },
];

const PERIOD_LABEL = w('Period', 'Période');
const PERIOD: readonly NativeSelectOption<Period>[] = [
  { value: 'day', label: w('Day', 'Jour') },
  { value: 'week', label: w('Week', 'Semaine') },
  { value: 'month', label: w('Month', 'Mois') },
];

const LONG: readonly NativeSelectOption<'updated' | 'owner'>[] = [
  { value: 'updated', label: w('Recently updated', 'Mises à jour les plus récentes') },
  { value: 'owner', label: w('Owner', 'Personne responsable') },
];

/** A select the reviewer can change. */
function LiveSelect<V extends string>({ options, start, label, disabled }: {
  options: readonly NativeSelectOption<V>[]; start: V; label: Words; disabled?: boolean;
}) {
  const [value, setValue] = useState<V>(start);
  return <NativeSelect<V> options={options} value={value} onChange={setValue} label={label} disabled={disabled} />;
}

function Rows({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[max-content_1fr] items-center gap-x-6 gap-y-4">{children}</div>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-xs text-muted-foreground">{children}</code>;
}

export const specimen = defineSpecimen({
  id: 'native-select',
  name: 'NativeSelect',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['NativeSelect'],
  summary: 'The platform select, styled flat: the right control on phones and in narrow toolbars.',
  states: [
    {
      id: 'default',
      label: 'Sort order of the Automations list, with a disabled option',
      render: () => (
        <Rows>
          <Code>value=&quot;last-run&quot;</Code>
          <div><LiveSelect options={SORT.map((option) => option.value === 'next-run' ? { ...option, disabled: true } : option)}
            start="last-run" label={SORT_LABEL} /></div>
          <Code>value=&quot;name&quot;</Code>
          <div><LiveSelect options={SORT} start="name" label={SORT_LABEL} /></div>
        </Rows>
      ),
    },
    {
      id: 'disabled',
      label: 'Disabled',
      render: () => (
        <Rows>
          <Code>disabled</Code>
          <div><LiveSelect options={SORT} start="last-run" label={SORT_LABEL} disabled /></div>
        </Rows>
      ),
    },
    {
      id: 'narrow-toolbar',
      label: 'Narrow (390px): replaces the period control in a page toolbar',
      width: 390,
      render: ({ t }) => (
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-medium">{t({ en: 'Runs', fr: 'Exécutions' })}</span>
          <div className="flex items-center gap-2">
            <LiveSelect options={PERIOD} start="week" label={PERIOD_LABEL} />
            <LiveSelect options={SORT} start="last-run" label={SORT_LABEL} />
          </div>
        </div>
      ),
    },
    {
      id: 'long-text',
      label: 'Long French options: the select grows to its longest option',
      render: () => (
        <Rows>
          <Code>value=&quot;updated&quot;</Code>
          <div><LiveSelect options={LONG} start="updated" label={SORT_LABEL} /></div>
        </Rows>
      ),
    },
  ],
});
