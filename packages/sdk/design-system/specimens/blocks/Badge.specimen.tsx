import type { ReactNode } from 'react';
import { defineSpecimen } from '../../specimen';
import { Badge } from '../../../src/ui/index';
import { w, type Words } from '../../../src/words/index';
import { INTEGRATIONS, INTEGRATION_STATUS } from '../../fixtures/blocks/blocks';

const TONES: ReadonlyArray<{ tone: 'default' | 'info' | 'success' | 'warning' | 'danger'; label: Words; icon: string }> = [
  { tone: 'default', label: w('Draft', 'Brouillon'), icon: 'circle-dashed' },
  { tone: 'info', label: w('Scheduled', 'Planifiée'), icon: 'clock' },
  { tone: 'success', label: w('Active', 'Active'), icon: 'check-circle-fill' },
  { tone: 'warning', label: w('Paused', 'En pause'), icon: 'pause' },
  { tone: 'danger', label: w('Failed', 'En échec'), icon: 'x-circle-fill' },
];

function Rows({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[max-content_1fr] items-center gap-x-6 gap-y-3">{children}</div>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-xs text-muted-foreground">{children}</code>;
}

export const specimen = defineSpecimen({
  id: 'badge',
  name: 'Badge',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['Badge'],
  summary: 'A short state or source label in five tones, with an optional icon.',
  states: [
    {
      id: 'tones',
      label: 'Tones, plain and with an icon',
      render: () => (
        <Rows>
          {TONES.map(({ tone, label, icon }) => [
            <Code key={`${tone}-code`}>tone=&quot;{tone}&quot;</Code>,
            <div key={tone} className="flex flex-wrap items-center gap-2">
              <Badge tone={tone}>{label}</Badge>
              <Badge tone={tone} icon={icon}>{label}</Badge>
              <Badge tone={tone} icon={icon} />
            </div>,
          ])}
        </Rows>
      ),
    },
    {
      id: 'integrations',
      label: 'Integration states as the Integrations page shows them',
      render: ({ t }) => (
        <div className="flex flex-col gap-4">
          {INTEGRATIONS.map((integration) => {
            const status = INTEGRATION_STATUS[integration.status];
            return (
              <div key={integration.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-medium">{integration.name}</span>
                <Badge tone={status.tone} icon={status.icon}>{status.label}</Badge>
                <span className="text-sm text-muted-foreground">{t(integration.detail)}</span>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-medium">Linear</span>
            <Badge tone={INTEGRATION_STATUS.off.tone} icon={INTEGRATION_STATUS.off.icon}>{INTEGRATION_STATUS.off.label}</Badge>
          </div>
        </div>
      ),
    },
    {
      id: 'content',
      label: 'Children: words, a plain string, a number and other content',
      render: () => (
        <Rows>
          <Code>words</Code>
          <div><Badge tone="info">{w('From a Space', 'Issue d’un Space')}</Badge></div>
          <Code>plain string</Code>
          <div><Badge>Gmail</Badge></div>
          <Code>number</Code>
          <div className="flex gap-2"><Badge>12</Badge><Badge tone="danger">3</Badge></div>
          <Code>node</Code>
          <div><Badge icon="star"><span className="font-mono">v2.4</span></Badge></div>
        </Rows>
      ),
    },
    {
      id: 'long-text',
      label: 'Long French words: a badge never wraps, the line around it does',
      render: () => (
        <div>
          <div className="flex max-w-[260px] flex-wrap gap-2">
            <Badge tone="danger" icon="x-circle-fill">{w('Needs sign-in', 'Reconnexion nécessaire')}</Badge>
            <Badge tone="warning" icon="clock-countdown">{w('Rate limited', 'Limite de requêtes atteinte')}</Badge>
            <Badge tone="info">{w('Shared', 'Partagée avec l’équipe')}</Badge>
          </div>
        </div>
      ),
    },
  ],
});
