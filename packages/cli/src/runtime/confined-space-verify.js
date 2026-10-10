/**
 * Credential-free canonical verification of one accepted confined build
 * (server/lib/confined_effects/space_build.py).
 *
 *   node confined-space-verify.js <verify-request.json>
 *
 * Runs outside the build sandbox so Chromium keeps its own sandbox
 * (chromiumSandbox: true in the shared renderer pool). The request carries the
 * capabilities returned by backend source verification and the accepted build's
 * exact source and artifact digests; anything else refuses before rendering.
 * Rendering uses only the declared offline fixtures at 390 and 1440 (no live
 * data, no deployment, no Store publication).
 */
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { appFilesDigest } from './app-platform.js';
import { prepareSpaceRelease } from './space-platform.js';
import { verifySpaceRelease } from './space-verification.js';

export async function runConfinedVerification(request, { verify = verifySpaceRelease } = {}) {
  if (!request || typeof request.projectDir !== 'string' || typeof request.key !== 'string'
    || typeof request.sourceDigest !== 'string' || typeof request.artifactDigest !== 'string'
    || !request.capabilities || typeof request.capabilities !== 'object') {
    throw new Error('The verification request names one accepted build and its capabilities.');
  }
  const release = await prepareSpaceRelease(request.projectDir, request.key);
  try {
    const sourceDigest = appFilesDigest(release.sourceFiles), artifactDigest = appFilesDigest(release.files);
    if (sourceDigest !== request.sourceDigest || artifactDigest !== request.artifactDigest) {
      return { status: 'failed', error: 'build_changed', source_digest: sourceDigest, artifact_digest: artifactDigest };
    }
    const diagnostic = await verify(release, { capabilities: request.capabilities, timeoutMs: 45_000 });
    return { status: diagnostic.status === 'passed' ? 'verified' : 'failed', diagnostic };
  } finally { release.close(); }
}

async function main(argv) {
  const request = JSON.parse(readFileSync(argv[2], 'utf8'));
  try {
    const result = await runConfinedVerification(request);
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = result.status === 'verified' ? 0 : 3;
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: 'failed', error: String(error?.message || error).slice(0, 32 * 1024) }) + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await main(process.argv);
