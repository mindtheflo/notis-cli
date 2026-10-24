import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMAND_SPECS, GROUP_SUMMARIES } from '../src/command-specs/index.js';
import { unifiedDiffSummary, versionName } from '../src/command-specs/version-history.js';

const DIFF = { unified_diff: '--- a/notes.md\n+++ b/notes.md\n@@ -1 +1 @@\n-old\n+new\n', additions: 1, deletions: 1, file_count: 1,
  files: [{ path: 'notes.md', status: 'modified', additions: 1, deletions: 1, lines: [] }] };

function context(path, options = {}, args = {}) {
  const spec = COMMAND_SPECS.find(value => value.command_path.join(' ') === path);
  assert.ok(spec, path);
  return { spec, options, args, globalOptions: {}, runtime: { credentialKind: 'env', profileName: 'versions-unit-only',
    jwt: 'fixture-not-a-real-credential', apiBase: 'https://fixture.invalid', timeoutMs: 1000, cliVersion: 'fixture' },
    output: { emitSuccess: value => value } };
}

function recordFetch(t, payload = { ok: true }) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls.push({ url, method: request.method, body: request.body ? JSON.parse(request.body) : undefined });
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  return calls;
}

async function run(path, options, args) {
  const ctx = context(path, options, args);
  return ctx.spec.handler(ctx);
}

test('version history commands are registered beside the existing Space history commands', () => {
  const paths = COMMAND_SPECS.map(spec => spec.command_path.join(' '));
  for (const path of ['spaces history list', 'spaces history restore', 'spaces history read', 'spaces history diff',
    'spaces history name', 'spaces history delete', 'documents versions list', 'documents versions read',
    'documents versions diff', 'documents versions restore', 'documents versions name', 'documents versions delete',
    'documents bin list', 'documents bin restore', 'documents bin remove']) {
    assert.ok(paths.includes(path), path);
  }
  assert.ok(GROUP_SUMMARIES.documents);
});

test('Space history read, name and delete send exact requests', async t => {
  const calls = recordFetch(t);
  await run('spaces history read', { revision: '4', path: 'views/main.tsx' }, { spaceId: 'space-1' });
  await run('spaces history name', { revision: '4', name: 'Launch' }, { spaceId: 'space-1' });
  await run('spaces history name', { revision: '4', clear: true }, { spaceId: 'space-1' });
  await run('spaces history delete', { revision: '4', yes: true }, { spaceId: 'space-1' });
  assert.deepEqual(calls, [
    { url: 'https://fixture.invalid/portal_spaces/history-read?space_id=space-1&revision=4&path=views%2Fmain.tsx', method: 'GET', body: undefined },
    { url: 'https://fixture.invalid/portal_spaces/history-name', method: 'POST', body: { space_id: 'space-1', revision: 4, name: 'Launch' } },
    { url: 'https://fixture.invalid/portal_spaces/history-name', method: 'POST', body: { space_id: 'space-1', revision: 4, name: null } },
    { url: 'https://fixture.invalid/portal_spaces/history-delete', method: 'POST', body: { space_id: 'space-1', revision: 4 } },
  ]);
});

test('Space history diff defaults to current and prints the unified diff', async t => {
  const calls = recordFetch(t, DIFF);
  const result = await run('spaces history diff', { from: '2' }, { spaceId: 'space-1' });
  assert.equal(calls[0].url, 'https://fixture.invalid/portal_spaces/history-diff?space_id=space-1&from=2&to=current');
  assert.equal(result.humanSummary, `${DIFF.unified_diff.trimEnd()}\n\n1 file changed, +1 -1`);
  assert.deepEqual(result.data, DIFF);
  assert.equal(result.meta.mutating, false);
  await run('spaces history diff', { from: '2', to: '3', path: 'views' }, { spaceId: 'space-1' });
  assert.equal(calls[1].url, 'https://fixture.invalid/portal_spaces/history-diff?space_id=space-1&from=2&to=3&path=views');
});

test('Space history refuses bad revisions, missing names and unconfirmed deletes before any request', async t => {
  const calls = recordFetch(t);
  const bad = [
    ['spaces history read', { revision: 'two' }],
    ['spaces history read', {}],
    ['spaces history diff', { from: '-1' }],
    ['spaces history diff', { from: '1', to: 'latest' }],
    ['spaces history name', { revision: '4' }],
    ['spaces history name', { revision: '4', name: 'x', clear: true }],
    ['spaces history name', { revision: '4', name: '  ' }],
    ['spaces history delete', { revision: '4' }],
  ];
  for (const [path, options] of bad) {
    await assert.rejects(async () => run(path, options, { spaceId: 'space-1' }), path);
  }
  await assert.rejects(async () => run('spaces history delete', { revision: '4' }, { spaceId: 'space-1' }), /only do it when the user asked/i);
  assert.equal(calls.length, 0);
});

test('document version commands send exact requests', async t => {
  const calls = recordFetch(t);
  const args = { documentId: 'doc-1' };
  await run('documents versions list', { before: 'v-9', limit: '20' }, args);
  await run('documents versions read', { versionId: 'v-2' }, args);
  await run('documents versions restore', { versionId: 'v-2', requestId: 'undo-1' }, args);
  await run('documents versions name', { versionId: 'v-2', name: 'Final draft' }, args);
  await run('documents versions name', { versionId: 'v-2', clear: true }, args);
  await run('documents versions delete', { versionId: 'v-2', yes: true }, args);
  assert.deepEqual(calls, [
    { url: 'https://fixture.invalid/portal_documents/versions?document_id=doc-1&before=v-9&limit=20', method: 'GET', body: undefined },
    { url: 'https://fixture.invalid/portal_documents/versions/read?document_id=doc-1&version_id=v-2', method: 'GET', body: undefined },
    { url: 'https://fixture.invalid/portal_documents/versions/restore', method: 'POST', body: { document_id: 'doc-1', version_id: 'v-2', request_id: 'undo-1' } },
    { url: 'https://fixture.invalid/portal_documents/versions/name', method: 'POST', body: { document_id: 'doc-1', version_id: 'v-2', name: 'Final draft' } },
    { url: 'https://fixture.invalid/portal_documents/versions/name', method: 'POST', body: { document_id: 'doc-1', version_id: 'v-2', name: null } },
    { url: 'https://fixture.invalid/portal_documents/versions/delete', method: 'POST', body: { document_id: 'doc-1', version_id: 'v-2' } },
  ]);
});

test('document diff defaults to current, prints the unified diff and keeps the full payload for --json', async t => {
  const calls = recordFetch(t, DIFF);
  const result = await run('documents versions diff', { from: 'v-1' }, { documentId: 'doc-1' });
  assert.equal(calls[0].url, 'https://fixture.invalid/portal_documents/versions/diff?document_id=doc-1&from=v-1&to=current');
  assert.match(result.humanSummary, /^--- a\/notes\.md\n/);
  assert.match(result.humanSummary, /1 file changed, \+1 -1$/);
  assert.deepEqual(result.data, DIFF);
});

test('documents Bin commands send exact requests and permanent removal needs --yes', async t => {
  const calls = recordFetch(t);
  await run('documents bin list', {}, {});
  await run('documents bin restore', {}, { documentId: 'doc-1' });
  await assert.rejects(async () => run('documents bin remove', {}, { documentId: 'doc-1' }), /only do it when the user asked/i);
  await run('documents bin remove', { yes: true }, { documentId: 'doc-1' });
  assert.deepEqual(calls, [
    { url: 'https://fixture.invalid/portal_documents/bin', method: 'GET', body: undefined },
    { url: 'https://fixture.invalid/portal_documents/bin/restore', method: 'POST', body: { document_id: 'doc-1' } },
    { url: 'https://fixture.invalid/portal_documents/bin/remove', method: 'POST', body: { document_id: 'doc-1' } },
  ]);
});

test('document version commands refuse missing inputs before any request', async t => {
  const calls = recordFetch(t);
  const args = { documentId: 'doc-1' };
  const bad = [
    ['documents versions list', { limit: '0' }],
    ['documents versions list', { limit: '500' }],
    ['documents versions read', {}],
    ['documents versions diff', {}],
    ['documents versions restore', { versionId: 'v-2' }],
    ['documents versions name', { versionId: 'v-2' }],
    ['documents versions delete', { versionId: 'v-2' }],
  ];
  for (const [path, options] of bad) {
    await assert.rejects(async () => run(path, options, args), path);
  }
  assert.equal(calls.length, 0);
});

test('diff summary handles empty and cut-short comparisons; names need exactly one choice', () => {
  assert.equal(unifiedDiffSummary({ unified_diff: '', additions: 0, deletions: 0, files: [] }), 'No changes. 0 files changed, +0 -0');
  assert.match(unifiedDiffSummary({ ...DIFF, truncated: true }), /cut short/);
  assert.equal(versionName({ name: 'A' }), 'A');
  assert.equal(versionName({ clear: true }), null);
  assert.throws(() => versionName({}));
});
