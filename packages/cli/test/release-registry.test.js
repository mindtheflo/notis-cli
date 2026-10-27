import test from 'node:test';
import assert from 'node:assert/strict';
import { compareReleaseVersions, matchesRelease, readRegistry, publishAndReconcile } from '../scripts/release-registry.js';

const identity = { sourceSha: 'a'.repeat(40), channel: 'nightly' };
const receipt = { version: '0.2.0-nightly.1000.1', notisRelease: identity, dist: { integrity: 'sha512-exact-bytes' } };
const options = { packageName: '@notis_ai/cli', version: receipt.version, tag: 'nightly', ...identity,
  tarball: '/tmp/package.tgz', integrity: receipt.dist.integrity };

test('registry gitHead must agree with custom source identity whenever present', () => {
  assert.equal(matchesRelease({ ...receipt, gitHead: identity.sourceSha }, identity.sourceSha, identity.channel), true);
  assert.equal(matchesRelease({ ...receipt, gitHead: 'f'.repeat(40) }, identity.sourceSha, identity.channel), false);
});

test('release ordering compares numeric prerelease parts and stable precedence', () => {
  assert.ok(compareReleaseVersions('0.2.0-nightly.1000.1', '0.2.0-nightly.999.8') > 0);
  assert.ok(compareReleaseVersions('0.2.0-nightly.1000.1', '0.3.0-nightly.1.1') < 0);
  assert.ok(compareReleaseVersions('0.2.0', '0.2.0-nightly.1000.1') > 0);
  assert.equal(compareReleaseVersions('0.2.0-nightly.1000.1', '0.2.0-nightly.1000.1'), 0);
});

test('registry failures cannot be mistaken for an unpublished package', () => {
  assert.throws(() => readRegistry('pkg', 'nightly', { run: () => ({ status: 1, stdout: '{"error":{"code":"E503"}}' }) }), /lookup failed/);
  assert.equal(readRegistry('pkg', 'nightly', { run: () => ({ status: 1, stdout: '{"error":{"code":"E404"}}' }) }), null);
});

test('source identity deduplicates only the matching channel and commit', () => {
  assert.ok(matchesRelease(receipt, identity.sourceSha, 'nightly'));
  assert.equal(matchesRelease(receipt, 'b'.repeat(40), 'nightly'), false);
  assert.equal(matchesRelease(receipt, identity.sourceSha, 'stable'), false);
});

test('ambiguous publish success is reconciled once without replay', async () => {
  let calls = 0;
  const reads = [null, receipt, receipt];
  const result = await publishAndReconcile({ ...options, read: () => reads.shift(),
    run: () => { calls++; return { status: 1 }; }, sleep: async () => {} });
  assert.equal(result.verified, true);
  assert.equal(calls, 1);
});

test('already published exact bytes are read back without another publish', async () => {
  const result = await publishAndReconcile({ ...options, read: () => receipt,
    run: () => assert.fail('Must not publish an existing version') });
  assert.equal(result.verified, true);
});

test('uncertain or conflicting receipt is held, never replayed', async () => {
  for (const candidate of [null, { ...receipt, dist: { integrity: 'different' } },
    { ...receipt, notisRelease: { ...identity, sourceSha: 'b'.repeat(40) } }]) {
    let calls = 0;
    const reads = [null, candidate, receipt];
    await assert.rejects(() => publishAndReconcile({ ...options, read: () => reads.shift(),
      run: () => { calls++; return { status: 1 }; }, sleep: async () => {}, reconcileDelaysMs: [] }), /not verified/);
    assert.equal(calls, 1);
  }
});

test('a published version with a different dist-tag is not declared delivered', async () => {
  const reads = [receipt, { ...receipt, version: '0.2.0-nightly.999.1' }];
  await assert.rejects(() => publishAndReconcile({ ...options, read: () => reads.shift(),
    run: () => assert.fail('No republish') }), /not verified/);
});

test('a delayed npm receipt is polled without a second publish', async () => {
  let publishes = 0;
  let reads = 0;
  const result = await publishAndReconcile({ ...options,
    read: () => {
      reads += 1;
      return reads < 4 ? null : receipt;
    },
    run: () => { publishes += 1; return { status: 1 }; },
    sleep: async () => {}, reconcileDelaysMs: [1, 1],
  });
  assert.equal(result.verified, true);
  assert.equal(publishes, 1);
  assert.equal(reads, 5);
});

test('legacy GitHub receipts reconcile across the CI migration', () => {
  assert.ok(matchesRelease({ version: '0.2.0-nightly.999.2', gitHead: identity.sourceSha }, identity.sourceSha, 'nightly'));
  assert.ok(matchesRelease({ version: '0.2.4', gitHead: identity.sourceSha }, identity.sourceSha, 'stable'));
  assert.equal(matchesRelease({ version: '0.2.4', gitHead: identity.sourceSha }, identity.sourceSha, 'nightly'), false);
});

test('publication history prevents a second version after a lost dist-tag outcome', async () => {
  const { findPublishedRelease, readReleaseHistory } = await import('../scripts/release-registry.js');
  const history = { versions: { [receipt.version]: receipt }, 'dist-tags': { nightly: receipt.version } };
  assert.equal(findPublishedRelease(history, identity.sourceSha, 'nightly'), receipt);
  assert.equal(findPublishedRelease(history, 'b'.repeat(40), 'nightly'), null);
  assert.throws(() => findPublishedRelease({ ...history, 'dist-tags': { nightly: 'another-version' } }, identity.sourceSha, 'nightly'), /do not republish/);
  await assert.rejects(readReleaseHistory('pkg', { fetcher: async () => ({ ok: false, status: 503 }) }), /unavailable/);
});
