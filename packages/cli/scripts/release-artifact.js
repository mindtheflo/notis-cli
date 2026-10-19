import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { validateIntent } from './release-intent.js';

export const PACKAGE_NAME = '@notis_ai/cli';
export const ARTIFACT_NAMES = { tarball: 'notis-cli.tgz', plan: 'release-plan.json', manifest: 'handoff-manifest.json' };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const integrity = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

// Inspect the one package manifest without extracting or executing archive content.
export function packageFromTarball(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 });
  let manifest;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, size) => header.subarray(start, start + size).toString('utf8').replace(/\0.*$/s, '');
    const checksum = field(148, 8).trim();
    const calculated = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (!/^[0-7]+$/.test(checksum) || Number.parseInt(checksum, 8) !== calculated) throw new Error('Invalid tar header checksum');
    const sizeText = field(124, 12).trim();
    if (!/^[0-7]+$/.test(sizeText)) throw new Error('Invalid tar entry size');
    const size = Number.parseInt(sizeText, 8);
    const prefix = field(345, 155);
    const name = `${prefix ? `${prefix}/` : ''}${field(0, 100)}`;
    if (name.startsWith('/') || name.split('/').includes('..') || offset + 512 + size > tar.length) {
      throw new Error('Unsafe or truncated package archive');
    }
    if (name === 'package/package.json') {
      if (manifest || ![0, 48].includes(header[156]) || size > 1024 * 1024) throw new Error('Invalid duplicate/package manifest entry');
      manifest = JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString('utf8'));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!manifest) throw new Error('Package archive has no manifest');
  return manifest;
}

export function validatePlan(plan, { sourceSha, channel, requireReserved = false } = {}) {
  const identity = { packageName: PACKAGE_NAME, sourceSha: sourceSha || plan.sourceSha,
    channel: channel || plan.releaseChannel };
  validateIntent(plan.intent, identity);
  if (plan.packageName !== PACKAGE_NAME || plan.sourceSha !== identity.sourceSha
      || plan.releaseChannel !== identity.channel || plan.nextVersion !== plan.intent.version
      || plan.publishTag !== (identity.channel === 'beta' ? 'beta' : 'latest')
      || (requireReserved && plan.intentReserved !== true)) throw new Error('Release plan identity/reservation mismatch');
  return plan;
}

export function createArtifactManifest({ tarball, planBytes, builder, readOnly }) {
  const plan = validatePlan(JSON.parse(planBytes), { requireReserved: !readOnly });
  const manifest = { schema: 1, packageName: PACKAGE_NAME, sourceSha: plan.sourceSha,
    channel: plan.releaseChannel, version: plan.nextVersion, readOnly,
    tarball: { name: ARTIFACT_NAMES.tarball, size: tarball.length, sha256: sha256(tarball), integrity: integrity(tarball) },
    plan: { name: ARTIFACT_NAMES.plan, size: planBytes.length, sha256: sha256(planBytes) }, builder };
  verifyArtifact({ manifest, tarball, planBytes });
  return manifest;
}

export function verifyArtifact({ manifest, tarball, planBytes, expected = {} }) {
  if (manifest?.schema !== 1 || manifest.packageName !== PACKAGE_NAME || typeof manifest.readOnly !== 'boolean'
      || !/^[0-9a-f]{40}$/.test(manifest.sourceSha || '') || !['beta', 'stable'].includes(manifest.channel)) {
    throw new Error('Invalid immutable package manifest');
  }
  for (const key of ['sourceSha', 'channel', 'version', 'readOnly']) {
    if (expected[key] !== undefined && manifest[key] !== expected[key]) throw new Error(`Handoff ${key} mismatch`);
  }
  if (manifest.tarball?.name !== ARTIFACT_NAMES.tarball || manifest.plan?.name !== ARTIFACT_NAMES.plan
      || manifest.tarball.size !== tarball.length || manifest.plan.size !== planBytes.length
      || manifest.tarball.sha256 !== sha256(tarball) || manifest.tarball.integrity !== integrity(tarball)
      || manifest.plan.sha256 !== sha256(planBytes)) throw new Error('Package/plan artifact checksum mismatch');
  const plan = validatePlan(JSON.parse(planBytes), { sourceSha: manifest.sourceSha, channel: manifest.channel,
    requireReserved: !manifest.readOnly });
  const packageManifest = packageFromTarball(tarball);
  if (packageManifest.name !== PACKAGE_NAME || packageManifest.version !== manifest.version
      || plan.nextVersion !== manifest.version || packageManifest.notisRelease?.sourceSha !== manifest.sourceSha
      || packageManifest.notisRelease?.channel !== manifest.channel
      || packageManifest.gitHead !== manifest.sourceSha) throw new Error('Tarball package identity mismatch');
  if (packageManifest.publishConfig?.registry && packageManifest.publishConfig.registry !== 'https://registry.npmjs.org/'
      && packageManifest.publishConfig.registry !== 'https://registry.npmjs.org') throw new Error('Package publishConfig must not redirect the npm registry');
  if (Object.keys(packageManifest.publishConfig || {}).some(key => !['registry', 'access'].includes(key))) {
    throw new Error('Unsupported publishConfig override of trusted finalizer options');
  }
  const builder = manifest.builder;
  if (builder?.provider !== 'depot' || builder.repository !== 'mindtheflo/notis'
      || builder.workflow !== '.depot/workflows/publish-cli-package.yml'
      || !/^[0-9a-f]{40}$/.test(builder.orchestrationSha || '')
      || !/^[A-Za-z0-9_-]+$/.test(builder.runId || '') || typeof builder.jobId !== 'string'
      || !/^[A-Za-z0-9_. -]+$/.test(builder.jobId) || builder.smoke !== 'native-exact-tarball'
      // push: a merge, or a release calling the publisher with its own event.
      || !['api', 'push', 'schedule', 'workflow_call', 'workflow_dispatch'].includes(builder.event)) {
    throw new Error('Invalid Depot build provenance');
  }
  return { plan, packageManifest };
}
