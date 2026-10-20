import '../ui/testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { NotisProvider } from '../provider';
import type { NotisRuntime } from '../runtime';
import { useNotisNavigation } from './useNotisNavigation';

type Navigation = ReturnType<typeof useNotisNavigation>;

async function navigationFor(navigate: NotisRuntime['navigate']): Promise<Navigation> {
  const runtime = {
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: 'test', actions: {} },
    context: { params: {}, locale: 'en' },
    callAction: async () => undefined,
    ...(navigate ? { navigate } : {}),
  } as unknown as NotisRuntime;
  let navigation!: Navigation;
  function Probe() { navigation = useNotisNavigation(); return null; }
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  await act(async () => { root.render(<NotisProvider runtime={runtime}><Probe /></NotisProvider>); });
  await act(async () => { root.unmount(); });
  return navigation;
}

test('toSpace returns the host navigation: it settles when the host has taken it and rejects when the host refuses (follow-up E4)', async () => {
  const sent: Array<Record<string, unknown>> = [];
  let finish!: () => void;
  const navigation = await navigationFor((payload) => {
    sent.push(payload);
    return new Promise<void>((resolve) => { finish = resolve; });
  });
  let settled = false;
  const opening = navigation.toSpace('s2', { recordKey: 'r1', params: { tab: 'open' }, selection: 'Title' })
    .then(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, false, 'still waiting on the host');
  assert.deepEqual(sent, [{ kind: 'space', spaceId: 's2', documentId: 'r1', params: { tab: 'open' }, selection: 'Title' }]);
  finish();
  await opening;
  assert.equal(settled, true);

  const refused = await navigationFor(async () => { throw new Error('This Space is closed.'); });
  await assert.rejects(refused.toSpace('s2'), /This Space is closed\./);

  const hostless = await navigationFor(undefined);
  await assert.rejects(hostless.toSpace('s2'), /current Notis host/);
});
