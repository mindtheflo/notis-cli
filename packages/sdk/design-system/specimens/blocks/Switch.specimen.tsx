import { useState, type ReactNode } from 'react';
import { defineSpecimen } from '../../specimen';
import { Switch } from '../../../src/ui/index';
import { w, type Words } from '../../../src/words/index';
import { AUTOMATIONS } from '../../fixtures/blocks/blocks';

const ENABLED = w('Enabled', 'Activée');
const AUTO_SYNC = w('Automatic sync', 'Synchronisation automatique');
const AUTO_SYNC_BODY = w(
  'Notis reads new Gmail email every 5 minutes.',
  'Notis lit les nouveaux e-mails Gmail toutes les 5 minutes.',
);
const TOOLS: ReadonlyArray<{ id: string; label: Words; on: boolean }> = [
  { id: 'read', label: w('Read email', 'Lire les e-mails'), on: true },
  { id: 'draft', label: w('Write drafts', 'Écrire des brouillons'), on: true },
  { id: 'send', label: w('Send email', 'Envoyer des e-mails'), on: false },
];
const LONG = w(
  'Ask me before Notis sends an email on my behalf',
  'Me demander avant que Notis envoie un e-mail en mon nom',
);

/** A switch the reviewer can press. */
function Live({ start, label, size, hideLabel, disabled, busy }: {
  start: boolean; label: Words; size?: 'sm' | 'md'; hideLabel?: boolean; disabled?: boolean; busy?: boolean;
}) {
  const [checked, setChecked] = useState(start);
  return <Switch checked={checked} onChange={setChecked} label={label} size={size} hideLabel={hideLabel} disabled={disabled} busy={busy} />;
}

function Rows({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[max-content_1fr] items-center gap-x-6 gap-y-4">{children}</div>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-xs text-muted-foreground">{children}</code>;
}

/** An Automations list row: the switch sits in the row without opening it. */
function AutomationRow({ index, t }: { index: number; t: (copy: { en: string; fr: string }) => string }) {
  const automation = AUTOMATIONS[index]!;
  const [enabled, setEnabled] = useState(automation.enabled);
  const [opened, setOpened] = useState(0);
  return (
    <div role="button" tabIndex={0} onClick={() => setOpened(opened + 1)}
      className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{t(automation.name)}</div>
        <div className="truncate text-xs text-muted-foreground">{t(automation.schedule)}</div>
      </div>
      {opened > 0 && <span className="text-xs text-muted-foreground">{t({ en: `Opened ${opened}`, fr: `Ouverte ${opened}` })}</span>}
      <Switch checked={enabled} onChange={setEnabled} label={automation.name} hideLabel />
    </div>
  );
}

export const specimen = defineSpecimen({
  id: 'switch',
  name: 'Switch',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['Switch'],
  summary: 'An on/off switch: small in list rows and menus, medium in settings.',
  states: [
    {
      id: 'on-off',
      label: 'Off and on, both sizes (press them)',
      render: () => (
        <Rows>
          <Code>size=&quot;sm&quot;</Code>
          <div className="flex flex-wrap gap-6"><Live start={false} label={ENABLED} /><Live start label={ENABLED} /></div>
          <Code>size=&quot;md&quot;</Code>
          <div className="flex flex-wrap gap-6">
            <Live start={false} label={ENABLED} size="md" />
            <Live start label={ENABLED} size="md" />
          </div>
          <Code>hideLabel</Code>
          <div className="flex flex-wrap gap-6"><Live start label={ENABLED} hideLabel /><Live start label={ENABLED} hideLabel size="md" /></div>
        </Rows>
      ),
    },
    {
      id: 'disabled',
      label: 'Disabled, off and on',
      render: () => (
        <Rows>
          <Code>disabled</Code>
          <div className="flex flex-wrap gap-6">
            <Live start={false} label={ENABLED} disabled />
            <Live start label={ENABLED} disabled />
            <Live start label={ENABLED} disabled size="md" />
          </div>
        </Rows>
      ),
    },
    {
      id: 'busy',
      label: 'Saving a change: busy ignores presses',
      render: () => (
        <Rows>
          <Code>busy</Code>
          <div className="flex flex-wrap gap-6">
            <Live start label={ENABLED} busy />
            <Live start={false} label={ENABLED} busy size="md" />
          </div>
        </Rows>
      ),
    },
    {
      id: 'in-row',
      label: 'In Automations list rows: pressing the switch does not open the row',
      render: ({ t }) => (
        <div className="flex max-w-xl flex-col gap-1">
          {AUTOMATIONS.map((automation, index) => <AutomationRow key={automation.id} index={index} t={t} />)}
        </div>
      ),
    },
    {
      id: 'settings',
      label: 'Settings of an integration: a medium switch, then one per tool',
      render: ({ t }) => (
        <div className="flex max-w-xl flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium">{t(AUTO_SYNC)}</div>
              <div className="text-xs text-muted-foreground">{t(AUTO_SYNC_BODY)}</div>
            </div>
            <Live start label={AUTO_SYNC} hideLabel size="md" />
          </div>
          <div className="flex flex-col gap-3">
            {TOOLS.map((tool) => <Live key={tool.id} start={tool.on} label={tool.label} />)}
          </div>
        </div>
      ),
    },
    {
      id: 'long-text',
      label: 'A long French label wraps beside the switch',
      width: 390,
      render: () => (
        <div className="flex flex-col gap-3">
          <Live start label={LONG} />
          <Live start={false} label={LONG} size="md" />
        </div>
      ),
    },
  ],
});
