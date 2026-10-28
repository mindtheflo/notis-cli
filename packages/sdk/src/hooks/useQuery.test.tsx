import '../ui/testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { NotisProvider } from '../provider';
import { createQueryClient } from '../queryCache';
import type { NotisRuntime } from '../runtime';
import { useQuery, type UseQueryResult } from './useQuery';

function runtime(): NotisRuntime {
  return {
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: 'test', actions: {} },
    context: { params: {}, locale: 'en' },
    callAction: async () => undefined,
    queryClient: createQueryClient(),
  } as unknown as NotisRuntime;
}

test('refetch resolves to the read error, or null once the read succeeds; it never rejects', async () => {
  let fail = true;
  let result: UseQueryResult<string> | null = null;
  function Probe() {
    result = useQuery(['probe'], async () => { if (fail) throw new Error('down'); return 'ok'; }, { readOnly: true });
    return null;
  }
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  await act(async () => { root.render(<NotisProvider runtime={runtime()}><Probe /></NotisProvider>); });
  let failed: Error | null = null;
  await act(async () => { failed = await result!.refetch(); });
  assert.equal(failed!.message, 'down', 'a failed read reports its error');
  fail = false;
  let ok: Error | null = new Error('unset');
  await act(async () => { ok = await result!.refetch(); });
  assert.equal(ok, null, 'a read that succeeds reports null');
  assert.equal(result!.data, 'ok');
  await act(async () => { root.unmount(); });
});

function holdReads() {
  const waiting = new Map<string, (value: string[]) => void>();
  const read = (tab: string) => () => new Promise<string[]>((resolve) => { waiting.set(tab, resolve); });
  return { waiting, read };
}

test('a list read keeps showing the last tab while the next one loads, then shows its own answer', async () => {
  const reads = holdReads();
  let result: UseQueryResult<string[]> | null = null;
  function Probe({ tab, keep }: { tab: string; keep?: boolean }) {
    result = useQuery(['list', tab], reads.read(tab), { readOnly: true, rows: { binding: 'tasks' }, keepPrevious: keep });
    return null;
  }
  const rt = runtime();
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  await act(async () => { root.render(<NotisProvider runtime={rt}><Probe tab="open" /></NotisProvider>); });
  assert.equal(result!.loading, true, 'nothing shown before the first answer');
  await act(async () => { reads.waiting.get('open')!(['a']); });
  assert.deepEqual(result!.data, ['a']);

  await act(async () => { root.render(<NotisProvider runtime={rt}><Probe tab="done" /></NotisProvider>); });
  assert.deepEqual(result!.data, ['a'], 'the last tab stays shown');
  assert.equal(result!.loading, false, 'no skeleton');
  assert.equal(result!.isPreviousData, true);
  assert.equal(result!.isFetching, true);
  await act(async () => { reads.waiting.get('done')!(['b']); });
  assert.deepEqual(result!.data, ['b']);
  assert.equal(result!.isPreviousData, false);

  // A cleared scope takes the kept answer away: nothing from it shows while the next key loads.
  await act(async () => { rt.queryClient!.clear(); });
  await act(async () => { root.render(<NotisProvider runtime={rt}><Probe tab="later" /></NotisProvider>); });
  assert.equal(result!.data, undefined);
  assert.equal(result!.loading, true);

  // A read that opts out never shows another key's answer.
  await act(async () => { reads.waiting.get('later')!(['c']); });
  await act(async () => { root.render(<NotisProvider runtime={rt}><Probe tab="other" keep={false} /></NotisProvider>); });
  assert.equal(result!.data, undefined);
  assert.equal(result!.loading, true);
  await act(async () => { root.unmount(); });
});

test('a read keyed by one record never shows the previous record while the next loads', async () => {
  const reads = holdReads();
  let result: UseQueryResult<string[]> | null = null;
  function Probe({ id }: { id: string }) {
    result = useQuery(['record', id], reads.read(id), { readOnly: true });
    return null;
  }
  const rt = runtime();
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  await act(async () => { root.render(<NotisProvider runtime={rt}><Probe id="r1" /></NotisProvider>); });
  await act(async () => { reads.waiting.get('r1')!(['one']); });
  await act(async () => { root.render(<NotisProvider runtime={rt}><Probe id="r2" /></NotisProvider>); });
  assert.equal(result!.data, undefined);
  assert.equal(result!.loading, true);
  assert.equal(result!.isPreviousData, false);
  await act(async () => { root.unmount(); });
});
