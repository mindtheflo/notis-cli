import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntentStore, intentTag, resolveReleaseIntent, validateIntent } from '../scripts/release-intent.js';
import { publishAndReconcile, validateReservedVersion } from '../scripts/release-registry.js';

const identity = { packageName: '@notis_ai/cli', sourceSha: 'a'.repeat(40), channel: 'nightly' };
const intent = { schema: 1, ...identity, version: '0.2.0-nightly.1000.1' };
const tagSha = 'b'.repeat(40);
const response = (status, value) => ({ ok: status >= 200 && status < 300, status, json: async () => value });

test('existing preview version stays independent of a later live reservation', async () => {
  const forbidden = () => { throw Error('Preview must not read/allocate/reserve a real intent'); };
  const preview = { ...intent, preview: true };
  const result = await resolveReleaseIntent({ identity, preview, store: { read: forbidden, reserve: forbidden }, allocateVersion: forbidden });
  assert.deepEqual(result, { intent, reserved: false });
  await assert.rejects(() => resolveReleaseIntent({ identity, preview, reserve: true, allocateVersion: forbidden }), /cannot reserve/);
});

function api({ existing = null, lostCreateResponse = false, unavailableReadback = false, conflict = null } = {}) {
  let annotation = existing, refExists = Boolean(existing), created = false;
  const calls = [];
  const fetcher = async (url, options) => {
    const path = url.split('/git')[1];
    calls.push([options.method, path]);
    assert.equal(options.redirect, 'error');
    if (options.method === 'GET' && path.startsWith('/ref/tags/')) {
      if (unavailableReadback && created) return response(503, {});
      return refExists ? response(200, { ref: `refs/tags/${intentTag(identity)}`, object: { type: 'tag', sha: tagSha } }) : response(404, {});
    }
    if (options.method === 'GET' && path === `/tags/${tagSha}`) {
      return response(200, { tag: intentTag(identity), object: { type: 'commit', sha: identity.sourceSha }, message: JSON.stringify(annotation) });
    }
    if (options.method === 'POST' && path === '/tags') {
      const body = JSON.parse(options.body);
      assert.equal(body.object, identity.sourceSha);
      assert.equal(body.type, 'commit');
      annotation = JSON.parse(body.message);
      return response(201, { sha: tagSha });
    }
    if (options.method === 'POST' && path === '/refs') {
      assert.deepEqual(JSON.parse(options.body), { ref: `refs/tags/${intentTag(identity)}`, sha: tagSha });
      created = refExists = true;
      if (conflict) { annotation = conflict; return response(422, {}); }
      if (lostCreateResponse) throw new Error('lost response');
      return response(201, {});
    }
    assert.fail(`Unexpected request ${options.method} ${path}`);
  };
  return { store: createIntentStore({ repository: 'mindtheflo/notis', token: 'test-token', fetcher }), calls };
}

test('publishing reservation creates an annotated tag, atomically creates its ref and reads it back', async () => {
  const { store, calls } = api();
  assert.deepEqual(await store.reserve(intent), intent);
  assert.equal(calls.filter(([method]) => method === 'POST').length, 2);
  assert.ok(calls.every(([method]) => !['PATCH', 'DELETE'].includes(method)));
});

test('a lost create-ref response is reconciled without creating another reference', async () => {
  const { store, calls } = api({ lostCreateResponse: true });
  assert.deepEqual(await store.reserve(intent), intent);
  assert.equal(calls.filter(([method, path]) => method === 'POST' && path === '/refs').length, 1);
});

test('conflicting ref creation is read back and never overwritten', async () => {
  const same = api({ conflict: intent });
  assert.deepEqual(await same.store.reserve(intent), intent);
  const different = api({ conflict: { ...intent, version: '0.2.0-nightly.999.1' } });
  await assert.rejects(different.store.reserve(intent), /unconfirmed or conflicting/);
  assert.equal(different.calls.filter(([method, path]) => method === 'POST' && path === '/refs').length, 1);
});

test('unconfirmed reservation holds publication rather than allocating another version', async () => {
  const { store } = api({ unavailableReadback: true });
  await assert.rejects(store.reserve(intent), /publication held/);
});

test('read-only rehearsal reads existing intents without writes or new version allocation', async () => {
  const { store, calls } = api({ existing: intent });
  const result = await resolveReleaseIntent({ identity, store, reserve: false,
    allocateVersion: () => assert.fail('Retry must keep its reserved version') });
  assert.equal(result.intent.version, intent.version);
  assert.equal(result.reserved, true);
  assert.ok(calls.every(([method]) => method === 'GET'));
  const preview = api();
  const proposed = await resolveReleaseIntent({ identity, store: preview.store, reserve: false,
    allocateVersion: () => intent.version });
  assert.equal(proposed.reserved, false);
  assert.ok(preview.calls.every(([method]) => method === 'GET'));
});

test('full rerun preserves the exact version while npm receipt is still missing', async () => {
  const { store } = api();
  const first = await resolveReleaseIntent({ identity, store, reserve: true, allocateVersion: () => intent.version });
  await assert.rejects(() => publishAndReconcile({ ...identity, version: first.intent.version, tag: 'nightly',
    tarball: '/tmp/test.tgz', integrity: 'sha512-fixture', read: () => null, run: () => ({ status: 1 }),
    sleep: async () => {}, reconcileDelaysMs: [] }), /not verified/);
  const rerun = await resolveReleaseIntent({ identity, store, reserve: true,
    allocateVersion: () => assert.fail('No second version after ambiguous publication') });
  assert.equal(rerun.intent.version, first.intent.version);
  assert.equal(rerun.reserved, true);
});

test('intent validation rejects another package, source, channel and malformed version', () => {
  for (const changes of [{ packageName: 'another' }, { sourceSha: 'c'.repeat(40) },
    { channel: 'stable' }, { schema: 2 }, { version: 'latest' }, { version: '0.2.1' }]) {
    assert.throws(() => validateIntent({ ...intent, ...changes }, identity), /conflicts/);
  }
});

test('existing intent in registry cannot collide with another source or roll a tag backwards', () => {
  assert.throws(() => validateReservedVersion({ versions: { [intent.version]: { version: intent.version, gitHead: 'c'.repeat(40) } },
    'dist-tags': {} }, intent), /another release/);
  assert.throws(() => validateReservedVersion({ versions: {}, 'dist-tags': { nightly: '0.2.0-nightly.1001.1' } }, intent), /superseded/);
  assert.doesNotThrow(() => validateReservedVersion({ versions: {}, 'dist-tags': { nightly: '0.2.0-nightly.999.9' } }, intent));
});

test('publishing cannot fall back to an unreserved plan if authentication is missing', async () => {
  await assert.rejects(resolveReleaseIntent({ identity, reserve: true, allocateVersion: () => intent.version }), /durable/);
});

test('the publication branch head is read under its current name, then its name before the rename', async () => {
  const head = 'c'.repeat(40);
  const read = (refs) => {
    const paths = [];
    const fetcher = async (url) => {
      const name = url.split('/ref/heads/')[1];
      paths.push(name);
      return refs.includes(name)
        ? response(200, { ref: `refs/heads/${name}`, object: { type: 'commit', sha: head } })
        : response(404, { message: 'Not Found' });
    };
    return { store: createIntentStore({ repository: 'mindtheflo/notis', token: 'test-token', fetcher }), paths };
  };
  const renamed = read(['nightly']);
  assert.equal(await renamed.store.readBranchHead('beta'), head);
  assert.deepEqual(renamed.paths, ['nightly']);
  const before = read(['production']);
  assert.equal(await before.store.readBranchHead('production'), head);
  assert.deepEqual(before.paths, ['stable', 'production']);
  await assert.rejects(read([]).store.readBranchHead('beta'), /branch not found/);
  await assert.rejects(read(['nightly']).store.readBranchHead('nightly'), /Invalid publication branch/);
});
