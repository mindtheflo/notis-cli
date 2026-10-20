import { useState, type ReactNode } from 'react';
import { defineSpecimen } from '../../specimen';
import { Button, Notice } from '../../../src/ui/index';
import { STANDARD_ACTIONS, w, type Words } from '../../../src/words/index';

const TONES: ReadonlyArray<{ tone: 'default' | 'info' | 'success' | 'warning' | 'danger'; text: Words }> = [
  { tone: 'default', text: w('Tip: press ? to see every shortcut on this page.', 'Astuce : appuie sur ? pour voir tous les raccourcis de cette page.') },
  { tone: 'info', text: w('Notis checks this inbox every 5 minutes.', 'Notis vérifie cette boîte de réception toutes les 5 minutes.') },
  { tone: 'success', text: w('Gmail is connected. New email shows up within a minute.', 'Gmail est connecté. Les nouveaux e-mails arrivent en moins d’une minute.') },
  { tone: 'warning', text: w('This automation is paused. It will not run until you enable it.', 'Cette automatisation est en pause. Elle ne tournera pas tant que tu ne l’as pas activée.') },
  { tone: 'danger', text: w('Could not load your automations.', 'Impossible de charger tes automatisations.') },
];

const PAUSED = TONES[3]!.text;
const ENABLED = w('This automation is on again. Its next run is tomorrow at 08:00.', 'Cette automatisation est de nouveau active. Sa prochaine exécution est demain à 08:00.');
const LOAD_FAILED = w(
  'Could not load your automations. Check your connection, then try again.',
  'Impossible de charger tes automatisations. Vérifie ta connexion, puis réessaie.',
);
const SLACK_EXPIRED = w(
  'Slack signed you out on 12 June, so the Daily standup automation cannot post.',
  'Slack t’a déconnecté le 12 juin, donc l’automatisation Point quotidien ne peut plus publier.',
);

function Stack({ children }: { children: ReactNode }) {
  return <div className="flex max-w-2xl flex-col gap-3">{children}</div>;
}

/** The paused callout of the Automations page: Enable turns it into a success notice. */
function PausedCallout() {
  const [on, setOn] = useState(false);
  if (on) return <Notice tone="success">{ENABLED}</Notice>;
  return (
    <Notice tone="warning"
      action={<Button size="sm" icon={STANDARD_ACTIONS.enable.icon} onClick={() => setOn(true)}>{STANDARD_ACTIONS.enable.label}</Button>}>
      {PAUSED}
    </Notice>
  );
}

/** An error notice that counts the presses on Try again, so the reviewer sees onRetry fire. */
function RetryNotice({ t }: { t: (copy: { en: string; fr: string }) => string }) {
  const [tries, setTries] = useState(0);
  return (
    <Notice tone="danger" onRetry={() => setTries(tries + 1)}>
      {t(LOAD_FAILED)}
      {tries > 0 && (
        <span className="block text-xs opacity-80">
          {t({ en: `Try again pressed ${tries} times`, fr: `Réessayer appuyé ${tries} fois` })}
        </span>
      )}
    </Notice>
  );
}

export const specimen = defineSpecimen({
  id: 'notice',
  name: 'Notice',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['Notice'],
  summary: 'A message in the page: a tip, a warning, a success, or an error with Try again.',
  states: [
    {
      id: 'tones',
      label: 'Tones',
      render: () => <Stack>{TONES.map(({ tone, text }) => <Notice key={tone} tone={tone}>{text}</Notice>)}</Stack>,
    },
    {
      id: 'retry',
      label: 'Error with Try again (onRetry)',
      render: ({ t }) => <Stack><RetryNotice t={t} /></Stack>,
    },
    {
      id: 'action',
      label: 'The paused automation callout with Enable (click it)',
      render: () => <Stack><PausedCallout /></Stack>,
    },
    {
      id: 'action-and-retry',
      label: 'An action and Try again together',
      render: () => (
        <Stack>
          <Notice tone="danger" onRetry={() => undefined}
            action={<Button size="sm" variant="ghost">{w('Reconnect Slack', 'Reconnecter Slack')}</Button>}>
            {SLACK_EXPIRED}
          </Notice>
        </Stack>
      ),
    },
    {
      id: 'narrow',
      label: 'Narrow (390px): long French text wraps beside the buttons',
      width: 390,
      render: () => (
        <div className="flex flex-col gap-3">
          <Notice tone="danger" onRetry={() => undefined}>{LOAD_FAILED}</Notice>
          <PausedCallout />
        </div>
      ),
    },
  ],
});
