import '../ui/testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { NotisProvider } from '../provider';
import type { NotisRuntime } from '../runtime';
import { guardSpaceRuntime, type SpaceConnection, type SpaceConnectionsTransport } from '../space';
import { useConnection, type UseConnectionResult } from './useConnection';

function runtimeWith(connections: SpaceConnectionsTransport | undefined, more: Partial<NotisRuntime> = {}): NotisRuntime {
  return {
    resource: { kind: 'space', id: 'space-a', revision: 2 },
    space: { id: 'space-a', revision: 2, cacheScope: 'scope', actions: {}, bindings: {}, cloudComputer: 'shell' },
    app: { id: 'space-a', name: 'A' }, route: { slug: 'view', path: '/', name: 'View' }, databases: [], context: { locale: 'en' },
    callTool: async () => { throw new Error('no'); }, listTools: async () => { throw new Error('no'); },
    request: async () => { throw new Error('no'); }, callAction: async <T,>() => ({}) as T,
    spaceConnections: connections, ...more,
  } as unknown as NotisRuntime;
}

async function flush() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); }

async function mount(runtime: NotisRuntime, render: () => React.ReactNode): Promise<Root> {
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  await act(async () => { root.render(<NotisProvider runtime={runtime}>{render()}</NotisProvider>); await flush(); });
  return root;
}

const github = (more: Partial<SpaceConnection> = {}): SpaceConnection =>
  ({ toolkit: 'github', available: true, connected: false, account: null, status: null, ...more });

test('useConnection reads the viewer\'s own account and connects it from a click', async () => {
  let connected = false;
  const calls: string[] = [];
  const transport: SpaceConnectionsTransport = {
    read: async toolkit => { calls.push(`read:${toolkit}`); return connected ? github({ connected: true, account: 'octo-cat', status: 'ACTIVE' }) : github(); },
    connect: toolkit => { calls.push(`connect:${toolkit}`); connected = true; return Promise.resolve(github({ connected: true, account: 'octo-cat' })); },
  };
  let seen: UseConnectionResult | undefined;
  function Probe() { seen = useConnection('GitHub'); return null; }
  const root = await mount(runtimeWith(transport), () => <Probe />);
  assert.equal(seen!.available, true);
  assert.equal(seen!.connected, false);
  let answer: boolean | undefined;
  await act(async () => { answer = await seen!.connect(); await flush(); });
  assert.equal(answer, true);
  assert.equal(seen!.connected, true);
  assert.equal(seen!.account, 'octo-cat');
  assert.deepEqual(calls.slice(0, 2), ['read:github', 'connect:github']);
  await act(async () => { root.unmount(); await flush(); });
});

test('useConnection answers unavailable on hosts without connected apps (Sites, links, verification)', async () => {
  let seen: UseConnectionResult | undefined;
  function Probe() { seen = useConnection('github'); return null; }
  const root = await mount(runtimeWith(undefined), () => <Probe />);
  assert.deepEqual({ available: seen!.available, connected: seen!.connected, account: seen!.account }, { available: false, connected: false, account: null });
  await assert.rejects(seen!.connect(), /Connect this app from the Space in Notis/);
  await act(async () => { root.unmount(); await flush(); });
});

test('View as the public never reaches the editor\'s connected apps', () => {
  const transport: SpaceConnectionsTransport = { read: async () => github(), connect: async () => github() };
  const guarded = guardSpaceRuntime(runtimeWith(transport, { space: { id: 'space-a', revision: 2, cacheScope: 'scope', actions: {},
    bindings: {}, viewAs: 'public' } as NotisRuntime['space'] }));
  assert.equal(guarded!.spaceConnections, undefined);
  assert.ok(guardSpaceRuntime(runtimeWith(transport))!.spaceConnections);
});
