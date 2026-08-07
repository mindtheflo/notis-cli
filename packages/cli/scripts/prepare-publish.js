import { appendFileSync } from 'node:fs';

import {
  applyVersion,
  computePublishVersion,
  computePrereleasePublishVersion,
  fetchLatestRegistryVersion,
  readPackageManifest,
} from './release-utils.js';

const args = new Set(process.argv.slice(2));
const shouldApply = args.has('--apply');
const releaseChannel = process.env.NPM_RELEASE_CHANNEL || 'stable';
const publishTag = releaseChannel === 'beta' ? 'beta' : 'latest';

const manifest = readPackageManifest();
const latestRegistryVersion = publishTag === 'latest' ? fetchLatestRegistryVersion(manifest.name) : null;
const nextVersion =
  publishTag === 'beta'
    ? computePrereleasePublishVersion({
        packageVersion: manifest.version,
        prereleaseTag: 'beta',
        runNumber: process.env.GITHUB_RUN_NUMBER,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      })
    : computePublishVersion({
        packageVersion: manifest.version,
        latestRegistryVersion,
      });

if (shouldApply) {
  applyVersion(nextVersion);
}

const payload = {
  packageName: manifest.name,
  packageVersion: manifest.version,
  latestRegistryVersion,
  nextVersion,
  publishTag,
  releaseChannel,
  applied: shouldApply,
};

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `package_name=${payload.packageName}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `package_version=${payload.packageVersion}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `latest_registry_version=${payload.latestRegistryVersion || ''}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `next_version=${payload.nextVersion}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `publish_tag=${payload.publishTag}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `release_channel=${payload.releaseChannel}\n`);
}

console.log(JSON.stringify(payload, null, 2));
