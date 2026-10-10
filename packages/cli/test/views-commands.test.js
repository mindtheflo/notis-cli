import assert from 'node:assert/strict';
import test from 'node:test';
import { viewsCommandSpecs } from '../src/command-specs/views.js';

function context(options) {
  return { spec: viewsCommandSpecs[0], options, runtime: { credentialKind: 'env', profileName: 'views-test',
    jwt: 'fixture-not-a-real-credential', apiBase: 'https://fixture.invalid', timeoutMs: 1000, cliVersion: 'fixture' },
  output: { emitSuccess: value => value } };
}

test('view find is a protocol-pinned read and preserves resolver links and params', async t => {
  const response = { views: [{ url: 'https://app.notis.ai/tasks/task-abc?status=inbox', params: { status: 'inbox' } }], views_total: 1 };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls.push({ url, ...request, body: JSON.parse(request.body) });
    return new Response(JSON.stringify(response));
  });
  const result = await viewsCommandSpecs[0].handler(context({ query: 'Inbox' }));
  assert.equal(calls[0].url, 'https://fixture.invalid/portal_spaces/find-views');
  assert.equal(calls[0].headers['X-Notis-Spaces-Protocol'], '1');
  assert.deepEqual(calls[0].body, { query: 'Inbox' });
  assert.deepEqual(result.data, response);
  assert.equal(result.meta.mutating, false);
});

test('ambiguous or empty lookup fails before making a request', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not call'); });
  for (const options of [{}, { query: ' ' }, { query: 'tasks', url: 'https://app.notis.ai/tasks' }]) {
    await assert.rejects(viewsCommandSpecs[0].handler(context(options)), /Choose exactly one/);
  }
  assert.equal(fetch.mock.callCount(), 0);
});
