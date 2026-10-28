import assert from 'node:assert/strict';
import test from 'node:test';

import { createQueryClient } from './queryCache';

function gate<T>() {
  let open!: (value: T) => void;
  let fail!: (error: Error) => void;
  const promise = new Promise<T>((resolve, reject) => { open = resolve; fail = reject; });
  return { promise, open, fail };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a read of every page shows its first page while the rest loads', async () => {
  const client = createQueryClient();
  const rest = gate<string[]>();
  const done = client.fetch<string[]>('k', async (publish) => {
    publish?.(['a']);
    return rest.promise;
  });
  await tick();
  const first = client.getSnapshot<string[]>('k');
  assert.deepEqual(first.data, ['a']);
  assert.equal(first.hasData, true);
  assert.equal(first.isFetching, true, 'still loading the other pages');
  rest.open(['a', 'b']);
  await done;
  const all = client.getSnapshot<string[]>('k');
  assert.deepEqual(all.data, ['a', 'b']);
  assert.equal(all.isFetching, false);
});

test('a reread never shrinks the rows already shown to its first page', async () => {
  const client = createQueryClient();
  await client.fetch<string[]>('k', async () => ['a', 'b', 'c']);
  client.invalidate('k');
  const rest = gate<string[]>();
  const done = client.fetch<string[]>('k', async (publish) => { publish?.(['a']); return rest.promise; });
  await tick();
  assert.deepEqual(client.getSnapshot<string[]>('k').data, ['a', 'b', 'c']);
  rest.open(['a', 'b', 'c', 'd']);
  await done;
  assert.deepEqual(client.getSnapshot<string[]>('k').data, ['a', 'b', 'c', 'd']);
});

test('a read that fails after its first page shows only the error, never a partial answer', async () => {
  const client = createQueryClient();
  const rest = gate<string[]>();
  const done = client.fetch<string[]>('k', async (publish) => { publish?.(['a']); return rest.promise; });
  await tick();
  rest.fail(new Error('down'));
  await assert.rejects(done);
  const failed = client.getSnapshot<string[]>('k');
  assert.equal(failed.hasData, false);
  assert.equal(failed.data, undefined);
  assert.equal(failed.error?.message, 'down');
});

test('a part published after the read answered is ignored', async () => {
  const client = createQueryClient();
  let late: ((rows: string[]) => void) | undefined;
  await client.fetch<string[]>('k', async (publish) => { late = publish; return ['a', 'b']; });
  late?.(['x']);
  assert.deepEqual(client.getSnapshot<string[]>('k').data, ['a', 'b']);
});

test('an answer kept from an earlier visit shows at once and is read again on first use', async () => {
  const answers: Array<[string, unknown]> = [];
  const client = createQueryClient({ seed: new Map([['k', { data: ['kept'] }]]), onAnswer: (key, data) => { answers.push([key, data]); } });
  const kept = client.getSnapshot<string[]>('k');
  assert.deepEqual(kept.data, ['kept']);
  assert.equal(kept.hasData, true);
  const fresh = gate<string[]>();
  const done = client.fetch<string[]>('k', () => fresh.promise, { staleTimeMs: 60_000 });
  assert.deepEqual(client.getSnapshot<string[]>('k').data, ['kept'], 'shown while it is read again');
  fresh.open(['new']);
  await done;
  assert.deepEqual(client.getSnapshot<string[]>('k').data, ['new']);
  assert.deepEqual(answers, [['k', ['new']]], 'the new answer is handed to the host to keep');
});

test('a kept answer whose read is refused is taken away, never shown with the error', async () => {
  const failures: string[] = [];
  const client = createQueryClient({ seed: new Map([['k', { data: ['kept'] }]]), onFailure: (key) => { failures.push(key); } });
  await assert.rejects(client.fetch('k', async () => { throw new Error('refused'); }));
  const after = client.getSnapshot<string[]>('k');
  assert.equal(after.hasData, false);
  assert.equal(after.data, undefined);
  assert.equal(after.error?.message, 'refused');
  assert.deepEqual(failures, ['k']);
});
