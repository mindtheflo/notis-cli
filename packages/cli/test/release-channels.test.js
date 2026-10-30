import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SUPPORTED_CHANNELS, resolveSelectedChannels } = require('../scripts/release-channels.cjs');

test('an "all" run evaluates every supported channel (the frozen-stable regression)', () => {
  // The bug: nightly `all` runs narrowed to the ref branch (always beta), so
  // `production`/stable was never evaluated and npm `latest` froze at 0.2.2.
  const selected = resolveSelectedChannels('all');
  assert.deepEqual(selected, SUPPORTED_CHANNELS);
  assert.ok(selected.includes('production'), 'stable channel must always be evaluated for "all"');
});

test('a missing/empty channel input defaults to "all" (evaluates every channel)', () => {
  assert.deepEqual(resolveSelectedChannels(undefined), SUPPORTED_CHANNELS);
  assert.deepEqual(resolveSelectedChannels(''), SUPPORTED_CHANNELS);
});

test('an explicit channel input is honored exactly', () => {
  assert.deepEqual(resolveSelectedChannels('production'), ['production']);
  assert.deepEqual(resolveSelectedChannels('beta'), ['beta']);
});

test('an unsupported channel throws instead of silently publishing nothing', () => {
  assert.throws(() => resolveSelectedChannels('canary'), /Unsupported channel: canary/);
});

test('resolveSelectedChannels does not depend on any ref/branch input', () => {
  // Guard the root cause directly: the only required parameter is the channel
  // input (supportedChannels has a default, so .length is 1). No ref/branch is
  // taken, so a future edit can't reintroduce ref-branch narrowing without
  // changing this contract and failing the tests above.
  assert.equal(resolveSelectedChannels.length, 1);
});

const {
  BRANCH_RELEASES, PACKAGE_CHANNELS, RETIRED_DIST_TAG, branchForChannel, channelForBranch, distTagForChannel,
  gitBranchesForChannel, isPackageChannel, prereleaseIdForChannel, releaseKeyForBranch, versionMatchesChannel,
} = require('../scripts/release-channels.cjs');

test('one table maps each source branch to its package channel and npm tag', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(BRANCH_RELEASES)), {
    beta: { channel: 'nightly', distTag: 'nightly', branches: ['nightly', 'beta'] },
    production: { channel: 'stable', distTag: 'latest', branches: ['stable', 'production'] },
  });
  assert.deepEqual([...SUPPORTED_CHANNELS], ['beta', 'production']);
  assert.deepEqual([...PACKAGE_CHANNELS], ['nightly', 'stable']);
  assert.equal(channelForBranch('beta'), 'nightly');
  assert.equal(channelForBranch('production'), 'stable');
  assert.equal(branchForChannel('nightly'), 'beta');
  assert.equal(branchForChannel('stable'), 'production');
  assert.equal(distTagForChannel('nightly'), 'nightly');
  assert.equal(distTagForChannel('stable'), 'latest');
  for (const unknown of ['beta', 'production', 'latest', 'constructor', '']) {
    assert.equal(isPackageChannel(unknown), false, unknown);
    assert.throws(() => distTagForChannel(unknown), /Unsupported release channel/);
  }
  assert.throws(() => channelForBranch('main'), /Unsupported channel/);
  assert.throws(() => channelForBranch('constructor'), /Unsupported channel/);
});

test('the renamed branches and their old names release the same channel', () => {
  // The branches were renamed on 2026-10-27; the release key (the CI
  // environment and finalizer channel) kept its old name.
  assert.equal(channelForBranch('nightly'), 'nightly');
  assert.equal(channelForBranch('stable'), 'stable');
  assert.equal(releaseKeyForBranch('nightly'), 'beta');
  assert.equal(releaseKeyForBranch('beta'), 'beta');
  assert.equal(releaseKeyForBranch('stable'), 'production');
  assert.equal(releaseKeyForBranch('production'), 'production');
  assert.throws(() => releaseKeyForBranch('latest'), /Unsupported channel/);
  assert.deepEqual(gitBranchesForChannel('beta'), ['nightly', 'beta']);
  assert.deepEqual(gitBranchesForChannel('production'), ['stable', 'production']);
  assert.deepEqual(resolveSelectedChannels('stable'), ['production']);
  assert.deepEqual(resolveSelectedChannels('nightly'), ['beta']);
});

test('nightly releases are -nightly. prereleases; stable releases are plain semver; beta is retired', () => {
  assert.equal(prereleaseIdForChannel('nightly'), 'nightly');
  assert.equal(prereleaseIdForChannel('stable'), null);
  assert.equal(versionMatchesChannel('0.2.0-nightly.17.1', 'nightly'), true);
  assert.equal(versionMatchesChannel('0.2.0-beta.17.1', 'nightly'), false);
  assert.equal(versionMatchesChannel('0.2.23', 'nightly'), false);
  assert.equal(versionMatchesChannel('0.2.23', 'stable'), true);
  assert.equal(versionMatchesChannel('0.2.0-nightly.17.1', 'stable'), false);
  assert.equal(RETIRED_DIST_TAG, 'beta');
  assert.ok(!Object.values(BRANCH_RELEASES).some(release => release.distTag === RETIRED_DIST_TAG));
});

test('the published CLI resolves the same channel -> npm tag mapping as the publisher', async () => {
  const { RELEASE_CHANNELS, packageTagForChannel } = await import('../src/runtime/channel.js');
  assert.deepEqual([...RELEASE_CHANNELS].sort(), [...PACKAGE_CHANNELS].sort());
  for (const channel of PACKAGE_CHANNELS) assert.equal(packageTagForChannel(channel), distTagForChannel(channel));
});
