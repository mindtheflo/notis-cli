import '../ui/testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { NotisProvider } from '../provider';
import type { NotisRuntime } from '../runtime';
import { useNotisNavigation } from './useNotisNavigation';
import { writeViewParams } from './useViewParams';

type Navigation = ReturnType<typeof useNotisNavigation>;

function runtimeFor(navigate: NotisRuntime['navigate']): NotisRuntime {
  return {
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: 'test', actions: {} },
    context: { params: {}, locale: 'en' },
    callAction: async () => undefined,
    ...(navigate ? { navigate } : {}),
  } as unknown as NotisRuntime;
}

async function navigationFor(navigate: NotisRuntime['navigate']): Promise<Navigation> {
  const runtime = runtimeFor(navigate);
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

test('toRoute and toApp report a host refusal instead of leaving an unhandled rejection', async () => {
  const warnings: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    const refused = await navigationFor(async () => { throw new Error('This Space context is no longer active.'); });
    const route = refused.toRoute('/notes', { resourceId: 'r1' });
    const app = refused.toApp();
    // The caller that awaits still sees the refusal; one that does not is never an unhandled rejection.
    await assert.rejects(route, /no longer active/);
    await assert.rejects(app, /no longer active/);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(unhandled, []);
    assert.deepEqual(warnings.map((args) => args[1]), ['This Space context is no longer active.', 'This Space context is no longer active.']);
    const throwing = await navigationFor((() => { throw new Error('Closed before the call.'); }) as NotisRuntime['navigate']);
    await assert.rejects(throwing.toApp(), /Closed before/);
    const taken: unknown[] = [];
    const accepted = await navigationFor((payload) => { taken.push(payload); });
    await accepted.toRoute('/notes');
    assert.deepEqual(taken, [{ kind: 'route', path: '/notes', resourceId: null }]);
  } finally {
    console.warn = warn;
    process.off('unhandledRejection', onUnhandled);
  }
});

test('toSpace, toNamedSpace and setParams settle a host refusal like toRoute and toApp: warned, seen by an awaiting caller, never unhandled (health:2026-11-06:space-navigation)', async () => {
  const message = 'This Space context is no longer active.';
  const warnings: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    // The host refuses by throwing (an older Portal) or by answering a typed refusal (the current one).
    const hosts: Array<[string, NotisRuntime['navigate']]> = [
      ['thrown', async () => { throw new Error(message); }],
      ['typed', async () => ({ refused: 'context_inactive' as const, message })],
    ];
    for (const [kind, navigate] of hosts) {
      warnings.length = 0;
      const refused = await navigationFor(navigate);
      const space = refused.toSpace('s2', { recordKey: 'r1' });
      const named = refused.toNamedSpace('history');
      const params = writeViewParams(runtimeFor(navigate), { tab: 'open' });
      await assert.rejects(space, /no longer active/, kind);
      await assert.rejects(named, /no longer active/, kind);
      await assert.rejects(params, /no longer active/, kind);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(unhandled, [], kind);
      assert.deepEqual(warnings.map((args) => args[1]), [message, message, message], kind);
    }
    // A typed refusal of a route or app navigation is the same refusal.
    warnings.length = 0;
    const typed = await navigationFor(async () => ({ refused: 'context_inactive' as const, message }));
    await assert.rejects(typed.toRoute('/notes'), /no longer active/);
    await assert.rejects(typed.toApp(), /no longer active/);
    assert.deepEqual(warnings.map((args) => args[1]), [message, message]);
    // A host that takes the navigation still settles without a word.
    const taken: unknown[] = [];
    const accepted = await navigationFor((payload) => { taken.push(payload); });
    await accepted.toSpace('s2');
    await writeViewParams(runtimeFor((payload) => { taken.push(payload); }), { tab: 'open' });
    assert.deepEqual(taken, [{ kind: 'space', spaceId: 's2', documentId: null }, { kind: 'view-params', params: { tab: 'open' } }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(unhandled, []);
  } finally {
    console.warn = warn;
    process.off('unhandledRejection', onUnhandled);
  }
});
