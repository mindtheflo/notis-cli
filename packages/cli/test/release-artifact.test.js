import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { verifyArtifact, validatePlan, packageFromTarball,
  sha256, integrity, ARTIFACT_NAMES } from '../scripts/release-artifact.js';
import { sourceSha, tarEntry as entry, tarball, validBundle } from '../test-support/release-artifact-fixture.js';

const fixture = (overrides = {}) => validBundle(overrides.readOnly ?? false, overrides);

test('artifact requires exact native smoke provenance, npm destination and packed gitHead', () => {
  for (const builder of [{ smoke: undefined }, { smoke: 'not-tested' }, { event: 'pull_request' }, { event: undefined }]) {
    assert.throws(() => fixture({ builder }), /provenance/);
  }
  // A merge or a release (whose called publisher reports the caller's push) builds the CLI.
  for (const event of ['push', 'workflow_call', 'workflow_dispatch', 'api']) fixture({ builder: { event } });
  assert.throws(() => fixture({ packageManifest: { gitHead: 'f'.repeat(40) } }), /identity/);
  assert.throws(() => fixture({ packageManifest: { publishConfig: { registry: 'https://wrong.invalid' } } }), /registry/);
});

test('valid nightly and production-channel artifacts bind plan, exact source, package and tarball hashes', () => {
  for (const channel of ['nightly', 'stable']) {
    const artifact = fixture({ channel });
    const result = verifyArtifact({ ...artifact, expected: { sourceSha, channel,
      version: artifact.plan.nextVersion, readOnly: false } });
    assert.deepEqual(result.plan, artifact.plan);
    assert.deepEqual(result.packageManifest, artifact.packageManifest);
    assert.equal(artifact.manifest.tarball.sha256, sha256(artifact.tarball));
    assert.equal(artifact.manifest.tarball.integrity, integrity(artifact.tarball));
    assert.equal(artifact.manifest.plan.name, ARTIFACT_NAMES.plan);
  }
});

test('read-only packaging may be unreserved but live packaging cannot', () => {
  const preview = fixture({ readOnly: true, plan: { intentReserved: false } });
  assert.equal(verifyArtifact(preview).plan.intentReserved, false);
  assert.throws(() => fixture({ readOnly: false, plan: { intentReserved: false } }), /reservation/);
  assert.throws(() => verifyArtifact({ ...preview, expected: { readOnly: false } }), /readOnly mismatch/);
});

test('tampered tarball or plan bytes cannot pass the immutable checksums', () => {
  const artifact = fixture();
  const tamperedArchive = Buffer.from(artifact.tarball);
  tamperedArchive[tamperedArchive.length - 1] ^= 1;
  assert.throws(() => verifyArtifact({ ...artifact, tarball: tamperedArchive }), /checksum/);
  const planBytes = Buffer.from(JSON.stringify({ ...artifact.plan, publishTag: 'latest' }));
  assert.throws(() => verifyArtifact({ ...artifact, planBytes }), /checksum/);
  const manifest = structuredClone(artifact.manifest);
  manifest.tarball.integrity = integrity(Buffer.from('other'));
  assert.throws(() => verifyArtifact({ ...artifact, manifest }), /checksum/);
});

test('changed source, channel, version or read-only identity fails the caller expectation', () => {
  const artifact = fixture();
  for (const expected of [{ sourceSha: 'c'.repeat(40) }, { channel: 'stable' },
    { version: '0.2.0-nightly.999.1' }, { readOnly: true }]) {
    assert.throws(() => verifyArtifact({ ...artifact, expected }), /mismatch/);
  }
});

test('recomputed outer hashes cannot conceal a changed package identity', () => {
  const artifact = fixture();
  for (const changes of [{ name: 'another-package' }, { version: '0.2.0-nightly.999.1' },
    { notisRelease: { sourceSha: 'c'.repeat(40), channel: 'nightly' } },
    { notisRelease: { sourceSha, channel: 'stable' } }, { notisRelease: undefined }]) {
    const archive = tarball({ ...artifact.packageManifest, ...changes });
    const manifest = structuredClone(artifact.manifest);
    manifest.tarball = { ...manifest.tarball, size: archive.length,
      sha256: sha256(archive), integrity: integrity(archive) };
    assert.throws(() => verifyArtifact({ ...artifact, tarball: archive, manifest }), /package identity/);
  }
});

test('plan identity binds reserved intent, version, source, channel and npm dist-tag', () => {
  const { plan } = fixture();
  for (const changes of [{ packageName: 'another' }, { sourceSha: 'c'.repeat(40) },
    { releaseChannel: 'stable' }, { nextVersion: '0.2.0-nightly.999.1' }, { publishTag: 'latest' },
    { intent: { ...plan.intent, channel: 'stable' } }, { intentReserved: false }]) {
    assert.throws(() => validatePlan({ ...plan, ...changes }, { sourceSha, channel: 'nightly', requireReserved: true }));
  }
});

test('builder provenance cannot switch provider, repository, workflow or use malformed source/run/job IDs', () => {
  for (const changes of [{ provider: 'github' }, { repository: 'other/repo' },
    { workflow: '.github/workflows/other.yml' }, { orchestrationSha: 'not-a-sha' },
    { runId: 'run with spaces' }, { runId: '' }, { jobId: '' },
    { jobId: true }, { jobId: { id: 'job' } }, { jobId: 'job/invalid' }]) {
    assert.throws(() => fixture({ builder: changes }), /provenance/, JSON.stringify(changes));
  }
});

test('invalid gzip, missing manifest and malformed manifest JSON fail without extraction', () => {
  assert.throws(() => packageFromTarball(Buffer.from('not gzip')));
  assert.throws(() => packageFromTarball(gzipSync(Buffer.alloc(1024))), /no manifest/);
  assert.throws(() => packageFromTarball(gzipSync(Buffer.concat([
    entry('package/package.json', 'not json'), Buffer.alloc(1024),
  ]))));
});

test('unsafe paths, duplicate manifests and symlink manifests are rejected', () => {
  const { packageManifest } = fixture();
  const json = JSON.stringify(packageManifest);
  for (const bad of [entry('../outside', 'x'), entry('/absolute', 'x')]) {
    assert.throws(() => packageFromTarball(tarball(packageManifest, [bad])), /Unsafe/);
  }
  assert.throws(() => packageFromTarball(tarball(packageManifest, [entry('package/package.json', json)])), /duplicate/);
  assert.throws(() => packageFromTarball(gzipSync(Buffer.concat([
    entry('package/package.json', json, '2'), Buffer.alloc(1024),
  ]))), /manifest entry/);
});

test('truncated entry bodies and malformed octal sizes fail', () => {
  const content = entry('package/package.json', 'x'.repeat(1000));
  assert.throws(() => packageFromTarball(gzipSync(content.subarray(0, 600))), /truncated/);
  const malformed = Buffer.from(content);
  malformed.write('not-an-octal', 124, 12);
  assert.throws(() => packageFromTarball(gzipSync(malformed)), /size|checksum/);
});

test('corrupted tar headers cannot pass simply because gzip and package JSON are valid', () => {
  const { packageManifest } = fixture();
  const corrupted = entry('package/package.json', JSON.stringify(packageManifest));
  corrupted[100] ^= 1; // Mode byte changes, but the stored tar checksum does not.
  assert.throws(() => packageFromTarball(gzipSync(Buffer.concat([corrupted, Buffer.alloc(1024)]))), /checksum/i);
});
