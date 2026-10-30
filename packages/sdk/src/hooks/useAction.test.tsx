import '../ui/testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { NotisProvider } from '../provider';
import { createQueryClient } from '../queryCache';
import type { NotisRuntime } from '../runtime';
import type { SpaceActionOptions } from '../space';
import { useActionQuery } from './useAction';

test('useActionQuery passes fresh through to the read and keeps its answer apart', async () => {
  const calls: SpaceActionOptions[] = [];
  const runtime = {
    resource: { kind: 'space', id: 's1', revision: 1 },
    space: { id: 's1', revision: 1, cacheScope: 'test', actions: { read: { id: 'read', inputSchema: {}, readOnly: true } } },
    context: { params: {}, locale: 'en' },
    callAction: async (_id: string, _inputs: Record<string, unknown>, options: SpaceActionOptions) => {
      calls.push(options);
      return options.fresh ? 'current' : 'cached';
    },
    queryClient: createQueryClient(),
  } as unknown as NotisRuntime;
  const seen: Record<string, unknown> = {};
  function Probe() {
    seen.cached = useActionQuery<string>('read', { a: 1 }).data;
    seen.fresh = useActionQuery<string>('read', { a: 1 }, { readOnly: true, fresh: true }).data;
    return null;
  }
  document.body.innerHTML = '<div id="app"></div>';
  const root = createRoot(document.getElementById('app')!);
  await act(async () => { root.render(<NotisProvider runtime={runtime}><Probe /></NotisProvider>); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  assert.deepEqual(seen, { cached: 'cached', fresh: 'current' });
  assert.deepEqual(calls.map(options => options.fresh ?? false).sort(), [false, true]);
  assert.ok(calls.every(options => options.readOnly === true && options.dedupe === true));
  await act(async () => { root.unmount(); });
});
