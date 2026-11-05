import type { ReactNode } from 'react';
import { defineSpecimen } from '../../specimen';
import { CloudComputerFrame } from '../../../src/ui/index';
import type { CloudComputerServiceStatus, UseCloudComputerServiceResult } from '../../../src/index';
import { w } from '../../../src/words/index';

const SERVER_FAILURE = w('npm run edit exited with code 1 before it listened on its port.',
  'npm run edit s’est arrêté avec le code 1 avant d’écouter sur son port.');

/** A service hook answer, as `useCloudComputerService('editor')` gives it. The design book has no gate. */
function service(status: CloudComputerServiceStatus, more: Partial<UseCloudComputerServiceResult> = {}): UseCloudComputerServiceResult {
  return {
    id: 'editor', status, lease: null, restoring: false, error: null, waitSeconds: 90,
    price: { hourly_usd: 0.14, size: 'standard' },
    url: () => null, fetch: () => Promise.reject(new Error('No gate in the design book.')), mediaUrl: () => null,
    media: () => Promise.reject(new Error('No gate in the design book.')),
    frameCode: () => Promise.reject(new Error('No gate in the design book.')),
    approvalRequired: false, allow: () => Promise.resolve(),
    retry: () => undefined,
    ...more,
  };
}

function Box({ children }: { children: ReactNode }) {
  return <div style={{ height: 320 }}>{children}</div>;
}

export const specimen = defineSpecimen({
  id: 'cloud-computer-frame',
  name: 'CloudComputerFrame',
  group: 'blocks',
  from: '@notis/sdk/ui',
  covers: ['CloudComputerFrame'],
  summary: 'A Space service shown in a frame, signed in to the Cloud Computer gate with a one-time code. Until the service is ready it shows CloudComputerWaking; once open it fills its box.',
  states: [
    {
      id: 'starting',
      label: 'Starting: the waking state, price behind the info button',
      render: () => <Box><CloudComputerFrame service={service('starting')} /></Box>,
    },
    {
      id: 'failed',
      label: 'Failed to start: what went wrong and Try again',
      render: ({ t }) => <Box><CloudComputerFrame service={service('failed', { error: new Error(t(SERVER_FAILURE)) })} /></Box>,
    },
    {
      id: 'unavailable',
      label: 'A host without the Cloud Computer (a Site, a link, the design book)',
      render: () => <Box><CloudComputerFrame service="editor" /></Box>,
    },
    {
      id: 'narrow',
      label: 'Narrow (390px)',
      width: 390,
      render: () => <Box><CloudComputerFrame service={service('starting')} /></Box>,
    },
  ],
});
