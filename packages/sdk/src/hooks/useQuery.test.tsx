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
