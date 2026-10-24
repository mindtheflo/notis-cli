import '../ui/testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { NotisProvider } from '../provider';
import type { NotisRuntime } from '../runtime';
import { useTopBarTitleLeaf } from './useTopBarTitleLeaf';

function Probe({ label }: { label: string | null }) { useTopBarTitleLeaf(label); return null; }

function runtimeWith(setTopBarTitleLeaf?: NotisRuntime['setTopBarTitleLeaf']): NotisRuntime {
  return {
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: 'test', actions: {} },
    context: { params: {}, locale: 'en' },
    callAction: async () => undefined,
    ...(setTopBarTitleLeaf ? { setTopBarTitleLeaf } : {}),
  } as unknown as NotisRuntime;
}

test('the open record label becomes the top bar leaf, follows the record and clears on unmount', async () => {
  const sent: Array<{ label: string } | null> = [];
  const runtime = runtimeWith((leaf) => { sent.push(leaf); });
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  const render = (label: string | null) => root.render(<NotisProvider runtime={runtime}><Probe label={label} /></NotisProvider>);

  await act(async () => { render('PRO-002'); });
  assert.deepEqual(sent, [{ label: 'PRO-002' }]);
  await act(async () => { render('PRO-002'); });
  assert.equal(sent.length, 1, 'the same label is not sent again');
  await act(async () => { render('PRO-003'); });
  await act(async () => { render('  '); });
  assert.deepEqual(sent.slice(1), [null, { label: 'PRO-003' }, null]);
  await act(async () => { render('PRO-004'); });
  await act(async () => { root.unmount(); });
  assert.deepEqual(sent.slice(4), [{ label: 'PRO-004' }, null], 'unmount clears the leaf it owned');
});

test('a component with no record open never clears another component\'s leaf; the newest owner names it', async () => {
  const sent: Array<{ label: string } | null> = [];
  const runtime = runtimeWith((leaf) => { sent.push(leaf); });
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  const render = (first: string | null, second: string | null, withSecond = true) => root.render(
    <NotisProvider runtime={runtime}><Probe label={first} />{withSecond ? <Probe label={second} /> : null}</NotisProvider>);

  await act(async () => { render('PRO-002', null, false); });
  await act(async () => { render('PRO-002', null); });
  assert.deepEqual(sent, [{ label: 'PRO-002' }], 'a second component that mounts with nothing open writes nothing');
  await act(async () => { render('PRO-002', 'NOTE-7'); });
  assert.deepEqual(sent.at(-1), { label: 'NOTE-7' }, 'the newest open record names the leaf');
  await act(async () => { render('PRO-002', null); });
  assert.deepEqual(sent.at(-1), { label: 'PRO-002' }, 'closing it gives the leaf back to the first');
  await act(async () => { render('PRO-002', null, false); });
  assert.deepEqual(sent.at(-1), { label: 'PRO-002' }, 'unmounting a component that owns nothing changes nothing');
  await act(async () => { root.unmount(); });
  assert.equal(sent.at(-1), null);
});

test('a way back reaches the top bar and always calls the newest handler', async () => {
  const sent: Array<{ label: string; onBack?: () => void } | null> = [];
  const runtime = runtimeWith((leaf) => { sent.push(leaf); });
  const calls: string[] = [];
  function Closer({ label, tag }: { label: string; tag: string }) { useTopBarTitleLeaf(label, () => calls.push(tag)); return null; }
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  await act(async () => { root.render(<NotisProvider runtime={runtime}><Closer label="PRO-002" tag="first" /></NotisProvider>); });
  await act(async () => { root.render(<NotisProvider runtime={runtime}><Closer label="PRO-002" tag="second" /></NotisProvider>); });
  assert.equal(sent.length, 1, 'a new handler with the same label sends nothing new');
  sent[0]!.onBack!();
  assert.deepEqual(calls, ['second'], 'the sent way back calls the newest handler');
  await act(async () => { root.unmount(); });
  assert.equal(sent.at(-1), null);
});

test('the record key the leaf shows reaches the host, trimmed, and a new key is sent again', async () => {
  const sent: Array<{ label: string; recordKey?: string } | null> = [];
  const runtime = runtimeWith((leaf) => { sent.push(leaf); });
  function Deck({ label, recordKey }: { label: string; recordKey?: string | null }) {
    useTopBarTitleLeaf(label, undefined, { recordKey }); return null;
  }
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  const render = (recordKey?: string | null) => root.render(<NotisProvider runtime={runtime}><Deck label="Deck" recordKey={recordKey} /></NotisProvider>);
  await act(async () => { render(' d1 '); });
  assert.deepEqual(sent, [{ label: 'Deck', recordKey: 'd1' }]);
  await act(async () => { render('d1'); });
  assert.equal(sent.length, 1, 'the same key is not sent again');
  await act(async () => { render('d2'); });
  assert.deepEqual(sent.at(-1), { label: 'Deck', recordKey: 'd2' });
  await act(async () => { render('  '); });
  assert.deepEqual(sent.at(-1), { label: 'Deck' }, 'a blank key sends the leaf alone');
  await act(async () => { root.unmount(); });
  assert.equal(sent.at(-1), null);
});

test('without a host that takes a leaf, the hook does nothing', async () => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  await act(async () => { root.render(<NotisProvider runtime={runtimeWith()}><Probe label="PRO-002" /></NotisProvider>); });
  await act(async () => { root.unmount(); });
  await act(async () => { const bare = createRoot(document.getElementById('app')!); bare.render(<Probe label="PRO-002" />); bare.unmount(); });
});
