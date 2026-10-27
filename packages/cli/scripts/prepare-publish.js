import { appendFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { applyVersion, computePublishVersion, computePrereleasePublishVersion, readPackageManifest } from './release-utils.js';
import { findPublishedRelease, readReleaseHistory, validateReservedVersion } from './release-registry.js';
import { createIntentStore, intentTag, resolveReleaseIntent } from './release-intent.js';
import { createRecordStore } from './github-immutable-record.js';

import { channelForBranch, distTagForChannel, isPackageChannel, prereleaseIdForChannel } from './release-channels.cjs';

const shouldApply = process.argv.includes('--apply');
// CI names the source branch and the branch table picks the package channel;
// a local run may name the channel directly and defaults to stable.
const releaseChannel = process.env.NOTIS_RELEASE_BRANCH
  ? channelForBranch(process.env.NOTIS_RELEASE_BRANCH)
  : process.env.NPM_RELEASE_CHANNEL || 'stable';
if (!isPackageChannel(releaseChannel)) throw new Error('Unsupported release channel');
const publishTag = distTagForChannel(releaseChannel);
const prereleaseTag = prereleaseIdForChannel(releaseChannel);
const sourceSha = process.env.NOTIS_RELEASE_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw new Error('An exact source SHA is required');
if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== sourceSha) {
  throw new Error('Source SHA does not match the checkout');
}
const manifest = readPackageManifest();
const reserve = process.env.NOTIS_RESERVE_RELEASE === 'true';
const store = process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY
  ? createIntentStore({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN }) : null;
if (reserve && !shouldApply) throw new Error('A publishing reservation requires --apply');
const identity = { packageName: manifest.name, sourceSha, channel: releaseChannel };
const preview = process.env.NOTIS_HANDOFF_REHEARSAL === 'true' && !reserve && store
  ? await createRecordStore({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN }).read('preview-intent', identity)
  : null;
const history = await readReleaseHistory(manifest.name);
const latest = history.versions[history['dist-tags'][publishTag]];
const published = preview ? null : findPublishedRelease(history, sourceSha, releaseChannel);
const alreadyPublished = Boolean(published);
// Allocate once, then reserve before npm can mutate or publish anything.
// Every retry reads the same tag even if npm's receipt remains unavailable.
const releaseNumber = process.env.NOTIS_RELEASE_NUMBER || String(Date.now());
const { intent, reserved } = await resolveReleaseIntent({ identity, store,
  preview: preview?.record,
  reserve: reserve && !alreadyPublished,
  allocateVersion: () => {
    const version = alreadyPublished ? published.version : prereleaseTag
      ? computePrereleasePublishVersion({ packageVersion: manifest.version, prereleaseTag,
          releaseNumber, latestRegistryVersion: latest?.version })
      : computePublishVersion({ packageVersion: manifest.version, latestRegistryVersion: latest?.version });
    validateReservedVersion(history, { ...identity, version });
    return version;
  },
});
const nextVersion = intent.version;
if (published && published.version !== nextVersion) throw new Error('Published version conflicts with the reserved intent');
if (!preview) validateReservedVersion(history, intent);
if (shouldApply) {
  const { GITHUB_TOKEN: _token, ...npmEnv } = process.env;
  applyVersion(nextVersion, { env: npmEnv });
  const prepared = readPackageManifest();
  prepared.notisRelease = { sourceSha, channel: releaseChannel };
  prepared.gitHead = sourceSha;
  writeFileSync('package.json', `${JSON.stringify(prepared, null, 2)}\n`);
}
const payload = { packageName: manifest.name, packageVersion: manifest.version,
  latestRegistryVersion: latest?.version || null, nextVersion, publishTag, releaseChannel,
  sourceSha, alreadyPublished, applied: shouldApply,
  intent, intentReserved: reserved, intentRef: `refs/tags/${intentTag(identity)}` };
if (process.env.GITHUB_OUTPUT) {
  for (const [key, value] of Object.entries({ package_name: payload.packageName,
    package_version: payload.packageVersion, latest_registry_version: payload.latestRegistryVersion || '',
    next_version: nextVersion, publish_tag: publishTag, release_channel: releaseChannel,
    already_published: alreadyPublished })) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
writeFileSync('release-plan.json', `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify(payload, null, 2));
