import { useState, type ReactNode } from 'react';
import { defineSpecimen } from '../../specimen';
import { CloudComputerWaking, EmptyState } from '../../../src/ui/index';
import type { CloudComputerServiceStatus, UseCloudComputerServiceResult } from '../../../src/index';
import { w } from '../../../src/words/index';

const READY = w('The preview is running. Its pages show here.', 'L’aperçu tourne. Ses pages s’affichent ici.');
const SERVER_FAILURE = w('npm run dev exited with code 1 before it listened on its port.',
  'npm run dev s’est arrêté avec le code 1 avant d’écouter sur son port.');

/** A service hook answer, as `useCloudComputerService('preview')` gives it. */
function service(status: CloudComputerServiceStatus, more: Partial<UseCloudComputerServiceResult> = {}): UseCloudComputerServiceResult {
  return {
    id: 'preview', status, lease: null, restoring: false, error: null, waitSeconds: 90,
    price: { hourly_usd: 0.14, size: 'standard' },
    url: () => null, fetch: () => Promise.reject(new Error('No gate in the design book.')), mediaUrl: () => null, retry: () => undefined,
    media: () => Promise.reject(new Error('No gate in the design book.')),
    frameCode: () => Promise.reject(new Error('No gate in the design book.')),
    approvalRequired: false, allow: () => Promise.resolve(),
    ...more,
  };
}

function Frame({ children }: { children: ReactNode }) {
  return <div style={{ maxWidth: 560 }}>{children}</div>;
}

/** Not allowed yet, then Allow: the reviewer sees the start (the host prompt is not in the design book). */
function AllowDemo() {
  const [allowed, setAllowed] = useState(false);
  const result = allowed ? service('starting')
    : service('failed', { approvalRequired: true, allow: async () => setAllowed(true) });
  return <CloudComputerWaking service={result}><EmptyState title={READY} /></CloudComputerWaking>;
}

/** Failed, then Try again: the reviewer sees the start again. */
function RetryDemo({ message }: { message: string }) {
  const [tries, setTries] = useState(0);
  const result = tries === 0
    ? service('failed', { error: new Error(message), retry: () => setTries(1) })
    : service('starting');
  return <CloudComputerWaking service={result} retryDelaySeconds={0}><EmptyState title={READY} /></CloudComputerWaking>;
}

export const specimen = defineSpecimen({
  id: 'cloud-computer-waking',
  name: 'CloudComputerWaking',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['CloudComputerWaking'],
  summary: 'What a page shows while a Cloud Computer service it declares starts: ready shows the page, else a spinner, Allow while the viewer has not allowed the Space, a failure with Try again, or a notice.',
  states: [
    {
      id: 'starting',
      label: 'Starting, with the price behind the info button',
      render: () => <Frame><CloudComputerWaking service={service('starting')}><EmptyState title={READY} /></CloudComputerWaking></Frame>,
    },
    {
      id: 'restoring',
      label: 'Restoring its files after a pause (can take minutes)',
      render: () => <Frame><CloudComputerWaking service={service('starting', { restoring: true })}><EmptyState title={READY} /></CloudComputerWaking></Frame>,
    },
    {
      id: 'ready',
      label: 'Ready: the children show',
      render: () => <Frame><CloudComputerWaking service={service('ready')}><EmptyState title={READY} /></CloudComputerWaking></Frame>,
    },
    {
      id: 'failed-waiting',
      label: 'Failed: the server says what went wrong, Try again counts down',
      render: ({ t }) => (
        <Frame>
          <CloudComputerWaking service={service('failed', { error: new Error(t(SERVER_FAILURE)) })} retryDelaySeconds={5}>
            <EmptyState title={READY} />
          </CloudComputerWaking>
        </Frame>
      ),
    },
    {
      id: 'failed-retry',
      label: 'Failed: Try again is offered (press it to start again)',
      render: ({ t }) => <Frame><RetryDemo message={t(SERVER_FAILURE)} /></Frame>,
    },
    {
      id: 'approval',
      label: 'Not allowed yet: Allow instead of Try again (press it to start)',
      render: () => <Frame><AllowDemo /></Frame>,
    },
    {
      id: 'approval-narrow',
      label: 'Not allowed yet, narrow (390px)',
      width: 390,
      render: () => <AllowDemo />,
    },
    {
      id: 'no-price',
      label: 'Starting, price unknown: no info button',
      render: () => (
        <Frame><CloudComputerWaking service={service('starting', { price: null })}><EmptyState title={READY} /></CloudComputerWaking></Frame>
      ),
    },
    {
      id: 'unavailable',
      label: 'A host without the Cloud Computer (a Site, a link, the design book)',
      render: () => <Frame><CloudComputerWaking service="preview"><EmptyState title={READY} /></CloudComputerWaking></Frame>,
    },
    {
      id: 'narrow',
      label: 'Narrow (390px): long French text wraps',
      width: 390,
      render: ({ t }) => (
        <CloudComputerWaking service={service('failed', { error: new Error(t(SERVER_FAILURE)) })} retryDelaySeconds={0}>
          <EmptyState title={READY} />
        </CloudComputerWaking>
      ),
    },
  ],
});
