import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecordStore, recordTag } from '../scripts/github-immutable-record.js';

const identity = { sourceSha: 'a'.repeat(40), channel: 'beta' };
const kind = 'handoff';
const tagSha = 'b'.repeat(40);
const raceSha = 'c'.repeat(40);
const record = { schema: 1, ...identity, releaseId: 11,
  assets: { tarball: { id: 23, sha256: 'd'.repeat(64) }, plan: { id: 24, sha256: 'e'.repeat(64) } } };
const response = (status, value) => ({ status, ok: status >= 200 && status < 300, json: async () => value });
const lostBody = () => ({ status: 200, ok: true, json: async () => { throw new Error('connection reset'); } });

function api(options = {}) {
  const state = { existing: null, refSha: tagSha, targetSha: identity.sourceSha,
    referenceType: 'tag', annotation: null, sleeps: [], flakyReadback: 0, lateReadback: 0, ...options };
  const calls = [];
  const fetcher = async (url, request) => {
    assert.equal(new URL(url).hostname, 'api.github.com');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers['X-GitHub-Api-Version'], '2026-03-10');
    const path = url.split('/git')[1];
    calls.push([request.method, path, request.body ? JSON.parse(request.body) : undefined]);
    if (request.method === 'GET' && path.startsWith('/ref/tags/')) {
      if (state.unavailableReadback && state.created) return response(503, {});
      if (state.forbiddenReadback && state.created) return response(403, {});
      if (state.flakyReadback && state.created) { state.flakyReadback -= 1; return response(503, {}); }
      if (state.lateReadback && state.created) { state.lateReadback -= 1; return response(404, {}); }
      if (state.lostRefBody && state.created) { state.lostRefBody -= 1; return lostBody(); }
      return state.existing ? response(200, { ref: `refs/tags/${recordTag(kind, identity)}`,
        object: { type: state.referenceType, sha: state.refSha } }) : response(404, {});
    }
    if (request.method === 'GET' && path.startsWith('/tags/')) {
      if (state.lostTagBody && state.created) { state.lostTagBody -= 1; return lostBody(); }
      return response(200, { sha: state.refSha, tag: recordTag(kind, identity),
        object: { type: 'commit', sha: state.targetSha },
        message: state.annotation ?? JSON.stringify(state.existing) });
    }
    if (request.method === 'POST' && path === '/tags') {
      const body = JSON.parse(request.body);
      assert.equal(body.tag, recordTag(kind, identity));
      assert.equal(body.type, 'commit');
      assert.equal(body.object, identity.sourceSha);
      state.pending = JSON.parse(body.message);
      return response(201, { sha: tagSha });
    }
    if (request.method === 'POST' && path === '/refs') {
      assert.deepEqual(JSON.parse(request.body), { ref: `refs/tags/${recordTag(kind, identity)}`, sha: tagSha });
      state.created = true;
      if (state.competingRecord) {
        state.existing = state.competingRecord;
        state.refSha = raceSha;
        return response(422, {});
      }
      if (!state.rejectCreate) state.existing = state.pending;
      if (state.loseCreate) throw new Error('lost response with private credential');
      return response(state.rejectCreate ? 422 : 201, {});
    }
    assert.fail(`Unexpected request ${request.method} ${path}`);
  };
  const sleep = async (ms) => { state.sleeps.push(ms); };
  return { store: createRecordStore({ repository: 'mindtheflo/notis', token: 'test-token', fetcher, sleep }), state, calls };
}

test('record namespaces separate real reservations, live/preview handoffs and dispatch attempts', () => {
  assert.equal(recordTag('handoff', identity), `notis-cli-handoff/beta/${identity.sourceSha}`);
  assert.equal(recordTag('preview-intent', identity), `notis-cli-preview/beta/${identity.sourceSha}`);
  assert.equal(recordTag('preview-handoff', identity), `notis-cli-preview-handoff/beta/${identity.sourceSha}`);
  assert.equal(recordTag('dispatch', identity), `notis-cli-dispatch/beta/${identity.sourceSha}`);
  assert.equal(recordTag('preview-dispatch', identity), `notis-cli-preview-dispatch/beta/${identity.sourceSha}`);
  for (const invalid of [{ sourceSha: 'branch', channel: 'beta' }, { ...identity, channel: 'production' }]) {
    assert.throws(() => recordTag(kind, invalid), /identity/);
  }
  assert.throws(() => recordTag('unknown', identity), /identity/);
});

test('atomic annotated-tag creation pins exact source and reads back the same immutable ref', async () => {
  const { store, calls } = api();
  assert.deepEqual(await store.putIfAbsent(kind, identity, record), {
    tag: recordTag(kind, identity), refSha: tagSha, record, created: true,
  });
  assert.equal(calls.filter(([method]) => method === 'POST').length, 2);
  assert.ok(calls.every(([method]) => !['PATCH', 'PUT', 'DELETE'].includes(method)));
});

test('lost create-ref response reconciles the authoritative ref without replaying its creation', async () => {
  const { store, calls } = api({ loseCreate: true });
  assert.equal((await store.putIfAbsent(kind, identity, record)).created, true);
  assert.equal(calls.filter(([method, path]) => method === 'POST' && path === '/refs').length, 1);
});

test('missing or unavailable readback never becomes an acknowledged handoff', async () => {
  for (const changes of [{ loseCreate: true, rejectCreate: true }, { unavailableReadback: true }]) {
    const { store, state, calls } = api(changes);
    await assert.rejects(store.putIfAbsent(kind, identity, record));
    assert.equal(calls.filter(([method, path]) => method === 'POST' && path === '/refs').length, 1);
    assert.deepEqual(state.sleeps, [1_000, 2_000, 4_000]);
  }
});

test('a briefly unavailable or not yet indexed readback is read again, never written again', async () => {
  for (const changes of [{ flakyReadback: 2 }, { lateReadback: 1 }, { loseCreate: true, flakyReadback: 3 },
    { lostRefBody: 1 }, { lostTagBody: 1 }]) {
    const { store, state, calls } = api(changes);
    const result = await store.putIfAbsent(kind, identity, record);
    assert.equal(result.created, true);
    assert.deepEqual(result.record, record);
    assert.equal(calls.filter(([method]) => method === 'POST').length, 2);
    assert.ok(state.sleeps.length > 0 && state.sleeps.length <= 3);
  }
});

test('a definitive readback error is not retried', async () => {
  const { store, state } = api({ forbiddenReadback: true });
  await assert.rejects(store.putIfAbsent(kind, identity, record), /HTTP 403/);
  assert.deepEqual(state.sleeps, []);
});

test('changed reference, lightweight tag and changed commit target fail exact-head reads', async () => {
  const changedRef = api({ existing: record, refSha: raceSha });
  await assert.rejects(changedRef.store.read(kind, identity, tagSha), /reference mismatch/);
  assert.equal(changedRef.calls.length, 1);
  const changedTarget = api({ existing: record, targetSha: 'd'.repeat(40) });
  await assert.rejects(changedTarget.store.read(kind, identity, tagSha), /source mismatch/);
  const lightweight = api({ existing: record, referenceType: 'commit' });
  await assert.rejects(lightweight.store.read(kind, identity), /reference mismatch/);
});

test('malformed or wrong-source annotation does not satisfy an immutable record', async () => {
  for (const annotation of ['not-json', JSON.stringify({ ...record, sourceSha: 'd'.repeat(40) }),
    JSON.stringify({ ...record, channel: 'stable' }), JSON.stringify({ ...record, schema: 2 })]) {
    await assert.rejects(api({ existing: record, annotation }).store.read(kind, identity));
  }
});

test('an existing conflicting record is returned unchanged for caller comparison, never overwritten', async () => {
  const conflict = { ...record, releaseId: 99 };
  const { store, calls } = api({ existing: conflict });
  const result = await store.putIfAbsent(kind, identity, record);
  assert.equal(result.created, false);
  assert.deepEqual(result.record, conflict);
  assert.notDeepEqual(result.record, record);
  assert.ok(calls.every(([method]) => method === 'GET'));
});

test('a competing atomic writer wins unchanged and the caller must compare its full record', async () => {
  const conflict = { ...record, assets: { ...record.assets, tarball: { id: 999, sha256: 'f'.repeat(64) } } };
  const { store, calls } = api({ competingRecord: conflict });
  const result = await store.putIfAbsent(kind, identity, record);
  assert.equal(result.refSha, raceSha);
  assert.equal(result.created, false);
  assert.deepEqual(result.record, conflict);
  assert.equal(calls.filter(([method, path]) => method === 'POST' && path === '/refs').length, 1);
  assert.ok(calls.every(([method]) => !['PATCH', 'PUT', 'DELETE'].includes(method)));
});

test('invalid record identity fails before any GitHub request', async () => {
  const { store, calls } = api();
  await assert.rejects(store.putIfAbsent(kind, identity, { ...record, channel: 'stable' }), /identity/);
  assert.equal(calls.length, 0);
});
