import { gzipSync } from 'node:zlib';
import { createArtifactManifest, PACKAGE_NAME } from '../scripts/release-artifact.js';

export const sourceSha = 'a'.repeat(40);
export const version = '0.2.0-beta.123.1';
export const builder = { provider: 'depot', repository: 'mindtheflo/notis',
  workflow: '.depot/workflows/publish-cli-package.yml', orchestrationSha: 'b'.repeat(40),
  runId: 'run_123', jobId: 'build-1', event: 'api', smoke: 'native-exact-tarball' };

export function tarEntry(name, data, type = '0') {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write('0000644\0', 100, 8);
  header.write('0000000\0', 108, 8);
  header.write('0000000\0', 116, 8);
  header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124, 12);
  header.write('00000000000\0', 136, 12);
  header.fill(32, 148, 156);
  header.write(type, 156, 1);
  header.write('ustar\0', 257, 6);
  header.write('00', 263, 2);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}

export function tarball(manifest, others = []) {
  return gzipSync(Buffer.concat([tarEntry('package/package.json', JSON.stringify(manifest)),
    ...others, Buffer.alloc(1024)]));
}

export function validBundle(readOnly = true, overrides = {}) {
  const channel = overrides.channel || 'beta';
  const nextVersion = channel === 'beta' ? version : '0.2.1';
  const plan = { packageName: PACKAGE_NAME, sourceSha, releaseChannel: channel,
    nextVersion, publishTag: channel === 'beta' ? 'beta' : 'latest', intentReserved: !readOnly,
    intent: { schema: 1, packageName: PACKAGE_NAME, sourceSha, channel, version: nextVersion },
    ...overrides.plan };
  const packageManifest = { name: PACKAGE_NAME, version: nextVersion,
    gitHead: sourceSha, notisRelease: { sourceSha, channel }, ...overrides.packageManifest };
  const archive = tarball(packageManifest);
  const planBytes = Buffer.from(JSON.stringify(plan));
  const manifest = createArtifactManifest({ tarball: archive, planBytes,
    builder: { ...builder, ...overrides.builder }, readOnly });
  return { tarball: archive, planBytes, manifest, plan, packageManifest };
}
