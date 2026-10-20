import { useState, type ReactNode } from 'react';
import { defineSpecimen } from '../../specimen';
import { ToggleGroup, type ButtonSize, type SegmentedOption } from '../../../src/ui/index';
import { STANDARD_ACTIONS, w, type Words } from '../../../src/words/index';

type Series = 'runs' | 'failures' | 'credits';
type Inbox = 'starred' | 'unread' | 'waiting';
type Owner = 'mine' | 'shared' | 'curated';

const SERIES_LABEL = w('Series', 'Séries');
const SERIES: readonly SegmentedOption<Series>[] = [
  { value: 'runs', label: w('Runs', 'Exécutions') },
  { value: 'failures', label: w('Failures', 'Échecs') },
  { value: 'credits', label: w('Credits', 'Crédits') },
];

const INBOX_LABEL = w('Show only', 'Afficher seulement');
const INBOX: readonly SegmentedOption<Inbox>[] = [
  { value: 'starred', label: w('Starred', 'Favoris'), icon: STANDARD_ACTIONS.star.icon, count: 3 },
  { value: 'unread', label: w('Unread', 'Non lus'), icon: 'envelope-simple', count: 12 },
  { value: 'waiting', label: STANDARD_ACTIONS.waiting.label, icon: 'hourglass', count: 2 },
];

const OWNER_LABEL = w('Skill sources', 'Sources des compétences');
const OWNER: readonly SegmentedOption<Owner>[] = [
  { value: 'mine', label: w('Personal skills', 'Compétences personnelles') },
  { value: 'shared', label: w('Shared from Spaces', 'Partagées depuis les Spaces') },
  { value: 'curated', label: w('Curated by Notis', 'Sélectionnées par Notis') },
];

/** A group the reviewer can press; the caller keeps the last series on, as a chart does. */
function Live<V extends string>({ options, start, label, size, keepOne }: {
  options: readonly SegmentedOption<V>[]; start: readonly V[]; label: Words; size?: ButtonSize; keepOne?: boolean;
}) {
  const [value, setValue] = useState<readonly V[]>(start);
  return (
    <ToggleGroup options={options} value={value} label={label} size={size}
      onChange={(next) => { if (!keepOne || next.length > 0) setValue(next); }} />
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[max-content_1fr] items-center gap-x-6 gap-y-4">{children}</div>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-xs text-muted-foreground">{children}</code>;
}

export const specimen = defineSpecimen({
  id: 'toggle-group',
  name: 'ToggleGroup',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['ToggleGroup'],
  summary: 'Several toggles, any number on: chart series or list filters.',
  states: [
    {
      id: 'some-on',
      label: 'Chart series: two of three on (the last one stays on)',
      render: () => (
        <Rows>
          <Code>value=[runs, credits]</Code>
          <div><Live options={SERIES} start={['runs', 'credits']} label={SERIES_LABEL} keepOne /></div>
        </Rows>
      ),
    },
    {
      id: 'none-all',
      label: 'None on and all on',
      render: () => (
        <Rows>
          <Code>value=[]</Code>
          <div><Live options={INBOX} start={[]} label={INBOX_LABEL} /></div>
          <Code>value=[all]</Code>
          <div><Live options={INBOX} start={['starred', 'unread', 'waiting']} label={INBOX_LABEL} /></div>
        </Rows>
      ),
    },
    {
      id: 'icons-counts',
      label: 'Inbox filters with icons and counts',
      render: () => (
        <Rows>
          <Code>icon count</Code>
          <div><Live options={INBOX} start={['unread']} label={INBOX_LABEL} /></div>
        </Rows>
      ),
    },
    {
      id: 'disabled',
      label: 'A disabled option, off and on',
      render: () => (
        <Rows>
          <Code>disabled</Code>
          <div>
            <Live options={SERIES.map((option) => (option.value === 'failures' ? { ...option, disabled: true } : option))}
              start={['runs']} label={SERIES_LABEL} />
          </div>
          <Code>disabled, on</Code>
          <div>
            <Live options={SERIES.map((option) => (option.value === 'credits' ? { ...option, disabled: true } : option))}
              start={['runs', 'credits']} label={SERIES_LABEL} />
          </div>
        </Rows>
      ),
    },
    {
      id: 'sizes',
      label: 'Sizes',
      render: () => (
        <Rows>
          {(['sm', 'md', 'lg'] as const).map((size) => [
            <Code key={`${size}-code`}>{`size="${size}"`}</Code>,
            <div key={size}><Live options={SERIES} start={['runs']} label={SERIES_LABEL} size={size} keepOne /></div>,
          ])}
        </Rows>
      ),
    },
    {
      id: 'long-text',
      label: 'Long French options wrap onto a second line',
      width: 390,
      render: () => (
        <div>
          <Live options={OWNER} start={['mine', 'curated']} label={OWNER_LABEL} />
        </div>
      ),
    },
  ],
});
