import test from 'node:test';
import assert from 'node:assert/strict';
import { compareReleaseVersions, matchesRelease, readRegistry, publishAndReconcile } from '../scripts/release-registry.js';

const identity = { sourceSha: 'a'.repeat(40), channel: 'beta' };
const receipt = { version: '0.2.0-beta.1000.1', notisRelease: identity, dist: { integrity: 'sha512-exact-bytes' } };
const options = { packageName: '@notis_ai/cli', version: receipt.version, tag: 'beta', ...identity,
  tarball: '/tmp/package.tgz', integrity: receipt.dist.integrity };

test('registry gitHead must agree with custom source identity whenever present', () => {
  assert.equal(matchesRelease({ ...receipt, gitHead: identity.sourceSha }, identity.sourceSha, identity.channel), true);
  assert.equal(matchesRelease({ ...receipt, gitHead: 'f'.repeat(40) }, identity.sourceSha, identity.channel), false);
});

test('release ordering compares numeric prerelease parts and stable precedence', () => {
  assert.ok(compareReleaseVersions('0.2.0-beta.1000.1', '0.2.0-beta.999.8') > 0);
  assert.ok(compareReleaseVersions('0.2.0-beta.1000.1', '0.3.0-beta.1.1') < 0);
  assert.ok(compareReleaseVersions('0.2.0', '0.2.0-beta.1000.1') > 0);
  assert.equal(compareReleaseVersions('0.2.0-beta.1000.1', '0.2.0-beta.1000.1'), 0);
});

test('registry failures cannot be mistaken for an unpublished package', () => {
  assert.throws(() => readRegistry('pkg', 'beta', { run: () => ({ status: 1, stdout: '{"error":{"code":"E503"}}' }) }), /lookup failed/);
  assert.equal(readRegistry('pkg', 'beta', { run: () => ({ status: 1, stdout: '{"error":{"code":"E404"}}' }) }), null);
});

test('source identity deduplicates only the matching channel and commit', () => {
  assert.ok(matchesRelease(receipt, identity.sourceSha, 'beta'));
  assert.equal(matchesRelease(receipt, 'b'.repeat(40), 'beta'), false);
  assert.equal(matchesRelease(receipt, identity.sourceSha, 'stable'), false);
});

test('ambiguous publish success is reconciled once without replay', () => {
  let calls = 0;
  const reads = [null, receipt, receipt];
  const result = publishAndReconcile({ ...options, read: () => reads.shift(),
    run: () => { calls++; return { status: 1 }; } });
  assert.equal(result.verified, true);
  assert.equal(calls, 1);
});

test('already published exact bytes are read back without another publish', () => {
  const result = publishAndReconcile({ ...options, read: () => receipt,
    run: () => assert.fail('Must not publish an existing version') });
  assert.equal(result.verified, true);
});

test('uncertain or conflicting receipt is held, never replayed', () => {
  for (const candidate of [null, { ...receipt, dist: { integrity: 'different' } },
    { ...receipt, notisRelease: { ...identity, sourceSha: 'b'.repeat(40) } }]) {
    let calls = 0;
    const reads = [null, candidate, receipt];
    assert.throws(() => publishAndReconcile({ ...options, read: () => reads.shift(),
      run: () => { calls++; return { status: 1 }; } }), /not verified/);
    assert.equal(calls, 1);
  }
});

test('a published version with a different dist-tag is not declared delivered', () => {
  const reads = [receipt, { ...receipt, version: '0.2.0-beta.999.1' }];
  assert.throws(() => publishAndReconcile({ ...options, read: () => reads.shift(),
    run: () => assert.fail('No republish') }), /not verified/);
});

test('legacy GitHub receipts reconcile across the CI migration', () => {
  assert.ok(matchesRelease({ version: '0.2.0-beta.999.2', gitHead: identity.sourceSha }, identity.sourceSha, 'beta'));
  assert.ok(matchesRelease({ version: '0.2.4', gitHead: identity.sourceSha }, identity.sourceSha, 'stable'));
  assert.equal(matchesRelease({ version: '0.2.4', gitHead: identity.sourceSha }, identity.sourceSha, 'beta'), false);
});

test('publication history prevents a second version after a lost dist-tag outcome', async () => {
  const { findPublishedRelease, readReleaseHistory } = await import('../scripts/release-registry.js');
  const history = { versions: { [receipt.version]: receipt }, 'dist-tags': { beta: receipt.version } };
  assert.equal(findPublishedRelease(history, identity.sourceSha, 'beta'), receipt);
  assert.equal(findPublishedRelease(history, 'b'.repeat(40), 'beta'), null);
  assert.throws(() => findPublishedRelease({ ...history, 'dist-tags': { beta: 'another-version' } }, identity.sourceSha, 'beta'), /do not republish/);
  await assert.rejects(readReleaseHistory('pkg', { fetcher: async () => ({ ok: false, status: 503 }) }), /unavailable/);
});
