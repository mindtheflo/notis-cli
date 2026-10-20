import { useState, type ReactNode } from 'react';
import { defineSpecimen } from '../../specimen';
import { EmptyState, Notice, Tabs, type TabItem } from '../../../src/ui/index';
import { w, type Words } from '../../../src/words/index';
import { AUTOMATION_FILTERS, AUTOMATIONS, SKILL_FILTERS } from '../../fixtures/blocks/blocks';

type AutomationFilter = (typeof AUTOMATION_FILTERS)[number]['value'];
type SkillFilter = (typeof SKILL_FILTERS)[number]['value'];
type Pane = 'overview' | 'runs' | 'settings';

const AUTOMATION_LABEL = w('Automation filters', 'Filtres des automatisations');
const AUTOMATION_TABS: readonly TabItem<AutomationFilter>[] = AUTOMATION_FILTERS.map(({ value, label, count }) => ({ value, label, count }));

const SKILL_LABEL = w('Skill filters', 'Filtres des compétences');
const SKILL_TABS: readonly TabItem<SkillFilter>[] = SKILL_FILTERS.map(({ value, label, count }) => ({ value, label, count }));

const PANE_LABEL = w('Automation', 'Automatisation');
const PANES: readonly TabItem<Pane>[] = [
  { value: 'overview', label: w('Overview', 'Vue d’ensemble'), icon: 'circle-half' },
  { value: 'runs', label: w('Runs', 'Exécutions'), icon: 'clock-countdown', count: 134 },
  { value: 'settings', label: w('Settings', 'Réglages'), icon: 'toggle-right' },
];

const LONG_TABS: readonly TabItem<'shared' | 'archived' | 'drafts'>[] = [
  { value: 'shared', label: w('Shared with the team', 'Partagées avec toute l’équipe'), count: 7 },
  { value: 'drafts', label: w('Drafts waiting for review', 'Brouillons en attente de relecture'), count: 2 },
  { value: 'archived', label: w('Archived last month', 'Archivées le mois dernier'), count: 0 },
];

/** A strip the reviewer can press; the first strip of a state owns [ and ]. */
function Live<V extends string>({ tabs, start, label, keys = true, children }: {
  tabs: readonly TabItem<V>[]; start: V; label: Words; keys?: boolean; children?: (value: V) => ReactNode;
}) {
  const [value, setValue] = useState<V>(start);
  return (
    <Tabs tabs={tabs} value={value} onChange={setValue} label={label} keys={keys} panelClassName="pt-4">
      {children ? children(value) : undefined}
    </Tabs>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>;
}

/** The content of each pane of an automation record. */
function PaneContent({ pane, t }: { pane: Pane; t: (copy: { en: string; fr: string }) => string }) {
  const briefing = AUTOMATIONS[0]!;
  if (pane === 'overview') {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t(briefing.name)}</span>
        <span className="text-muted-foreground">{t(briefing.schedule)}</span>
      </div>
    );
  }
  if (pane === 'runs') {
    return (
      <Notice tone="danger" onRetry={() => undefined}>
        {w('Could not load the runs of this automation.', 'Impossible de charger les exécutions de cette automatisation.')}
      </Notice>
    );
  }
  return <EmptyState icon="toggle-right" title={w('No settings yet', 'Aucun réglage pour l’instant')} />;
}

export const specimen = defineSpecimen({
  id: 'tabs',
  name: 'Tabs',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['Tabs'],
  summary: 'A strip of views over the content below it, with counts; [ and ] switch views from anywhere on the page.',
  states: [
    {
      id: 'counts',
      label: 'The Automations page filters with counts (press, or use [ and ])',
      render: () => <Page><Live tabs={AUTOMATION_TABS} start="all" label={AUTOMATION_LABEL} /></Page>,
    },
    {
      id: 'icons',
      label: 'With icons and a count',
      render: () => <Page><Live tabs={PANES} start="runs" label={PANE_LABEL} /></Page>,
    },
    {
      id: 'disabled',
      label: 'A disabled tab and a zero count',
      render: () => (
        <Page>
          <Live tabs={SKILL_TABS.map((tab) => (tab.value === 'archived' ? { ...tab, disabled: true } : tab))}
            start="personal" label={SKILL_LABEL} />
        </Page>
      ),
    },
    {
      id: 'with-panel',
      label: 'With the panel below the strip (press Runs and Settings)',
      render: ({ t }) => (
        <Page>
          <Live tabs={PANES} start="overview" label={PANE_LABEL}>{(pane) => <PaneContent pane={pane} t={t} />}</Live>
        </Page>
      ),
    },
    {
      id: 'panel-error',
      label: 'The panel failed to load: an error with Try again under the strip',
      render: ({ t }) => (
        <Page>
          <Live tabs={PANES} start="runs" label={PANE_LABEL}>{(pane) => <PaneContent pane={pane} t={t} />}</Live>
        </Page>
      ),
    },
    {
      id: 'panel-empty',
      label: 'An empty panel under the strip',
      render: ({ t }) => (
        <Page>
          <Live tabs={PANES} start="settings" label={PANE_LABEL}>{(pane) => <PaneContent pane={pane} t={t} />}</Live>
        </Page>
      ),
    },
    {
      id: 'two-strips',
      label: 'A page strip and a nested strip: only the first owns [ and ] (keys={false})',
      render: ({ t }) => (
        <Page>
          <Live tabs={PANES} start="runs" label={PANE_LABEL}>
            {() => (
              <div className="flex flex-col gap-3">
                <Live tabs={AUTOMATION_TABS} start="failed" label={AUTOMATION_LABEL} keys={false} />
                <span className="text-sm text-muted-foreground">
                  {t({ en: '2 failed runs this week', fr: '2 exécutions en échec cette semaine' })}
                </span>
              </div>
            )}
          </Live>
        </Page>
      ),
    },
    {
      id: 'narrow',
      label: 'Narrow (390px): the strip scrolls sideways and keeps the active tab in view',
      width: 390,
      render: () => (
        <div><Live tabs={SKILL_TABS} start="community" label={SKILL_LABEL} /></div>
      ),
    },
    {
      id: 'long-text',
      label: 'Long French tab labels',
      render: () => (
        <Page><Live tabs={LONG_TABS} start="drafts" label={w('Skills', 'Compétences')} /></Page>
      ),
    },
  ],
});
