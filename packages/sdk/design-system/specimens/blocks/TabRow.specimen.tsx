import { useState, type ReactNode } from 'react';
import { defineSpecimen } from '../../specimen';
import { Button, EmptyState, TabRow, Tooltip, tabPanelProps, type TabRowItem, type TabRowProps } from '../../../src/ui/index';
import { w, type Words } from '../../../src/words/index';
import { AUTOMATION_FILTERS, AUTOMATIONS, SKILL_FILTERS } from '../../fixtures/blocks/blocks';
import { clickIn, settle, waitForMenu } from '../../fixtures/lists/interact';

const AUTOMATION_ITEMS: readonly TabRowItem[] = AUTOMATION_FILTERS.map(({ value, label, count }) => ({ id: value, label, count }));
const SKILL_ITEMS: readonly TabRowItem[] = SKILL_FILTERS.map(({ value, label, count }) => ({ id: value, label, count }));

const PANES: readonly TabRowItem[] = [
  { id: 'overview', label: w('Overview', 'Vue d’ensemble'), icon: 'circle-half' },
  { id: 'runs', label: w('Runs', 'Exécutions'), icon: 'clock-countdown', count: 134 },
  { id: 'settings', label: w('Settings', 'Réglages'), icon: 'toggle-right' },
];

const LONG_ITEMS: readonly TabRowItem[] = [
  { id: 'shared', label: w('Shared with the team', 'Partagées avec toute l’équipe'), count: 7 },
  { id: 'drafts', label: w('Drafts waiting for review', 'Brouillons en attente de relecture'), count: 2 },
  { id: 'scheduled', label: w('Scheduled for next week', 'Planifiées pour la semaine prochaine'), count: 11 },
  { id: 'archived', label: w('Archived last month', 'Archivées le mois dernier'), count: 0 },
];

const WORDS = {
  automations: w('Automations', 'Automatisations'),
  skills: w('Skills', 'Compétences'),
  newAutomation: w('New automation', 'Nouvelle automatisation'),
  viewOptions: w('View options', 'Options d’affichage'),
  noSettings: w('No settings yet', 'Aucun réglage pour l’instant'),
} satisfies Record<string, Words>;

/** A row the reviewer can press: the choice moves with each press. */
function Live({ items, start, panel, ...rest }: Omit<TabRowProps, 'value' | 'onChange' | 'items'> & {
  items: readonly TabRowItem[]; start: string; panel?: (value: string) => ReactNode;
}) {
  const [value, setValue] = useState(start);
  return (
    <div className="flex flex-col">
      <TabRow items={items} value={value} onChange={setValue} {...rest} />
      {panel?.(value)}
    </div>
  );
}

/** The "+" create button and the view menu button, as a list pins them at the row's end. */
function EndTools({ t }: { t: (words: Words) => string }) {
  return (
    <>
      <Tooltip label={WORDS.newAutomation} keys="n">
        <Button variant="ghost" size="sm" icon="plus" aria-label={t(WORDS.newAutomation)} />
      </Tooltip>
      <Tooltip label={WORDS.viewOptions}>
        <Button variant="ghost" size="sm" icon="dots-three" aria-label={t(WORDS.viewOptions)} />
      </Tooltip>
    </>
  );
}

/** A section title placed before the pills (`lead`). */
function Lead({ words, t }: { words: Words; t: (words: Words) => string }) {
  return <h2 className="m-0 shrink-0 pl-2 pr-1 text-sm font-semibold">{t(words)}</h2>;
}

/** What each pane of an automation shows, controlled by the pills (role tabs, with `id`). */
function Pane({ value, t }: { value: string; t: (words: Words) => string }) {
  const briefing = AUTOMATIONS[0]!;
  return (
    <div {...tabPanelProps('book-tabrow', value)} className="px-4 pt-4 text-sm">
      {value === 'settings'
        ? <EmptyState icon="toggle-right" title={WORDS.noSettings} />
        : <span className="text-muted-foreground">{t(briefing.schedule)}</span>}
    </div>
  );
}

const frame = 'rounded-lg bg-background';

export const specimen = defineSpecimen({
  id: 'tab-row',
  name: 'TabRow',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['TabRow'],
  summary: 'One 44px line of pills: views (tabs) or a filter, with counts, a lead and an end slot; it never wraps.',
  states: [
    {
      id: 'filter',
      label: 'Filter role with counts: the Automations page (a radiogroup)',
      render: () => <div className={frame}><Live role="filter" items={AUTOMATION_ITEMS} start="all" /></div>,
    },
    {
      id: 'tabs',
      label: 'Tabs role with icons and a count, controlling the panel below',
      render: ({ t }) => (
        <div className={frame}>
          <Live role="tabs" id="book-tabrow" items={PANES} start="runs" panel={(value) => <Pane value={value} t={t} />} />
        </div>
      ),
    },
    {
      id: 'lead-end',
      label: 'A title as the lead, then the pills, then "+" and the view menu in the end slot',
      render: ({ t }) => (
        <div className={frame}>
          <Live role="filter" items={AUTOMATION_ITEMS} start="active" lead={<Lead words={WORDS.automations} t={t} />}
            end={<EndTools t={t} />} />
        </div>
      ),
    },
    {
      id: 'max-visible',
      label: 'maxVisible 3: the other skill filters go into More',
      render: () => <div className={frame}><Live role="filter" items={SKILL_ITEMS} start="all" maxVisible={3} /></div>,
    },
    {
      id: 'more-open',
      label: 'The More menu open, with each hidden filter and its count',
      height: 420,
      render: () => <div className={frame}><Live role="filter" items={SKILL_ITEMS} start="all" maxVisible={3} /></div>,
      interact: async (root) => {
        await clickIn(root, '.nui-tabrow-more');
        await waitForMenu(root);
        await settle(4);
      },
    },
    {
      id: 'more-active',
      label: 'A filter picked from More stays shown in the row',
      render: () => <div className={frame}><Live role="filter" items={SKILL_ITEMS} start="community" maxVisible={3} /></div>,
    },
    {
      id: 'overflow',
      label: 'Long pills at phone width: the ones the row has no room for fold into More, never cut or wrapped',
      width: 390,
      render: ({ t }) => (
        <div className={frame}>
          <Live role="filter" items={LONG_ITEMS} start="shared" end={<EndTools t={t} />} />
        </div>
      ),
    },
    {
      id: 'overflow-folded',
      label: 'Phone width with the last filter active: it keeps its place, the cut ones are in More',
      width: 390,
      render: ({ t }) => (
        <div className={frame}>
          <Live role="filter" items={LONG_ITEMS} start="archived" end={<EndTools t={t} />} />
        </div>
      ),
    },
    {
      id: 'page-inset',
      label: 'Page inset (20px each side), with a lead and the end slot',
      width: 768,
      render: ({ t }) => (
        <div className={frame}>
          <Live role="tabs" inset="page" items={PANES} start="overview" lead={<Lead words={WORDS.automations} t={t} />}
            end={<EndTools t={t} />} />
        </div>
      ),
    },
    {
      id: 'disabled',
      label: 'A disabled pill and a zero count',
      render: () => (
        <div className={frame}>
          <Live role="filter" items={SKILL_ITEMS.map((item) => (item.id === 'archived' ? { ...item, disabled: true } : item))}
            start="all" label={WORDS.skills} />
        </div>
      ),
    },
    {
      id: 'dark',
      label: 'Dark theme: lead, pills, More and the end slot',
      theme: 'dark',
      render: ({ t }) => (
        <div className={frame}>
          <Live role="filter" items={SKILL_ITEMS} start="personal" maxVisible={4} lead={<Lead words={WORDS.skills} t={t} />}
            end={<EndTools t={t} />} />
        </div>
      ),
    },
  ],
});
