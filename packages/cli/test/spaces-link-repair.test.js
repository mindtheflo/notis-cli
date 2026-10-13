import assert from 'node:assert/strict';
import test from 'node:test';
import { spacesCommandSpecs } from '../src/command-specs/spaces.js';

function context(path, options = {}, args = {}) {
  const spec = spacesCommandSpecs.find(value => value.command_path.join(' ') === path);
  assert.ok(spec, path);
  return { spec, options, args, globalOptions: {}, runtime: { credentialKind: 'env', profileName: 'spaces-unit-only',
    jwt: 'fixture-not-a-real-credential', apiBase: 'https://fixture.invalid', timeoutMs: 1000, cliVersion: 'fixture' },
    output: { emitSuccess: value => value } };
}

function recordFetch(t) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    calls.push({ url, method: request.method, body: request.body ? JSON.parse(request.body) : undefined });
    return new Response('{"valid":true}');
  });
  return calls;
}

test('spaces links list reads one Space\'s links without changing anything', async t => {
  const calls = recordFetch(t);
  const ctx = context('spaces links list', {}, { spaceId: 'space-1' });
  const result = await ctx.spec.handler(ctx);
  assert.deepEqual(calls, [{ url: 'https://fixture.invalid/portal_spaces/space-links?space_id=space-1', method: 'GET', body: undefined }]);
  assert.equal(result.meta.mutating, false);
});

test('spaces links remove sends one binding, its revision and a stable request', async t => {
  const calls = recordFetch(t);
  const ctx = context('spaces links remove', { revision: '1', requestId: 'remove-dead-skill' }, { spaceId: 'space-1', bindingId: 'binding-1' });
  const result = await ctx.spec.handler(ctx);
  assert.deepEqual(calls, [{ url: 'https://fixture.invalid/portal_spaces/space-link-remove', method: 'POST',
    body: { space_id: 'space-1', binding_id: 'binding-1', binding_revision: 1, request_id: 'remove-dead-skill' } }]);
  assert.equal(result.meta.mutating, true);
  for (const options of [{ requestId: 'x' }, { revision: 'latest', requestId: 'x' }, { revision: '1' }]) {
    const refused = context('spaces links remove', options, { spaceId: 'space-1', bindingId: 'binding-1' });
    assert.throws(() => refused.spec.handler(refused), /--revision|--request-id/);
  }
  assert.equal(calls.length, 1);
});

test('spaces aliases list reads old App links by default', async t => {
  const calls = recordFetch(t);
  const ctx = context('spaces aliases list', { legacyId: 'old-app' });
  const result = await ctx.spec.handler(ctx);
  assert.deepEqual(calls, [{ url: 'https://fixture.invalid/portal_spaces/legacy-aliases?kind=app&legacy_id=old-app', method: 'GET', body: undefined }]);
  assert.equal(result.meta.mutating, false);
  const refused = context('spaces aliases list', {});
  assert.throws(() => refused.spec.handler(refused), /--legacy-id/);
});

test('spaces aliases repoint checks first on a dry run, then changes one old page link', async t => {
  const calls = recordFetch(t);
  const options = { legacyId: 'old-app', route: 'pages', space: 'overview', expectedSpace: 'binned', selectionParam: 'record',
    requestId: 'repoint-pages', dryRun: true };
  let ctx = context('spaces aliases repoint', options);
  let result = await ctx.spec.handler(ctx);
  const body = { kind: 'app', legacy_id: 'old-app', route_slug: 'pages', space_id: 'overview', request_id: 'repoint-pages',
    dry_run: true, expected_space_id: 'binned', selection_param: 'record' };
  assert.deepEqual(calls.at(-1), { url: 'https://fixture.invalid/portal_spaces/legacy-alias', method: 'POST', body });
  assert.equal(result.meta.mutating, false);
  ctx = context('spaces aliases repoint', { legacyId: 'old-app', route: 'pages', space: 'overview', requestId: 'repoint-pages' });
  result = await ctx.spec.handler(ctx);
  assert.deepEqual(calls.at(-1).body, { kind: 'app', legacy_id: 'old-app', route_slug: 'pages', space_id: 'overview',
    request_id: 'repoint-pages', dry_run: false });
  assert.equal(result.meta.mutating, true);
  for (const missing of ['legacyId', 'route', 'space', 'requestId']) {
    const refused = context('spaces aliases repoint', { ...options, [missing]: undefined });
    assert.throws(() => refused.spec.handler(refused), /--legacy-id|--route|--space|--request-id/);
  }
  assert.equal(calls.length, 2);
});
