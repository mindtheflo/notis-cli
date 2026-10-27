// Channel selection for the CLI publish workflow, extracted from the inline
// github-script step so it is unit-testable (see test/release-channels.test.js).
//
// The frozen-`latest` incident (npm `latest` stuck at 0.2.2 for 7 weeks) was
// caused by this logic narrowing a scheduled `all` run to the workflow's ref
// branch -- and scheduled runs always execute on the default branch (beta), so
// the stable/production channel was never evaluated. Keeping the decision here,
// covered by tests, means a future edit can't silently re-freeze a channel.
//
// CommonJS (.cjs) on purpose: actions/github-script requires this file with
// require(), which must work regardless of the Node version on the runner.

// The one table that maps a source branch to the package channel it publishes
// and that channel's npm dist-tag. Every release script reads it, so renaming
// the git branches (beta -> nightly, production -> stable) is a change to the
// keys here and to the workflow inputs that name them, nothing else.
const BRANCH_RELEASES = Object.freeze({
  beta: Object.freeze({ channel: 'nightly', distTag: 'nightly' }),
  production: Object.freeze({ channel: 'stable', distTag: 'latest' }),
});

// The dist-tag every pre-nightly build published to. It no longer receives
// releases: scripts/retire-beta-dist-tag.js points it at the current stable
// version and deprecates the beta prereleases.
const RETIRED_DIST_TAG = 'beta';

const SUPPORTED_CHANNELS = Object.freeze(Object.keys(BRANCH_RELEASES));
const PACKAGE_CHANNELS = Object.freeze(Object.values(BRANCH_RELEASES).map(release => release.channel));

function isPackageChannel(channel) {
  return PACKAGE_CHANNELS.includes(channel);
}

function releaseForBranch(branch) {
  const release = Object.hasOwn(BRANCH_RELEASES, branch || '') ? BRANCH_RELEASES[branch] : null;
  if (!release) throw new Error(`Unsupported channel: ${branch}`);
  return release;
}

function channelForBranch(branch) {
  return releaseForBranch(branch).channel;
}

function branchForChannel(channel) {
  const branch = SUPPORTED_CHANNELS.find(name => BRANCH_RELEASES[name].channel === channel);
  if (!branch) throw new Error(`Unsupported release channel: ${channel}`);
  return branch;
}

function distTagForChannel(channel) {
  return BRANCH_RELEASES[branchForChannel(channel)].distTag;
}

// Stable releases are plain semver; every other channel is a prerelease named
// after itself (`0.2.0-nightly.<n>.<attempt>`).
function prereleaseIdForChannel(channel) {
  branchForChannel(channel);
  return channel === 'stable' ? null : channel;
}

// True when a version string belongs to the channel's version shape.
function versionMatchesChannel(version, channel) {
  const prerelease = prereleaseIdForChannel(channel);
  const text = String(version || '');
  return prerelease ? text.includes(`-${prerelease}.`) : !text.includes('-');
}

// Resolve the channels a run should evaluate.
//   inputChannel === 'all'  -> every supported channel (nightly + manual "all")
//   inputChannel === '<ch>' -> exactly that channel (explicit manual dispatch)
// Never key this on the ref branch: the scheduled run's ref is always the
// default branch, which is what froze the stable channel.
function resolveSelectedChannels(inputChannel, supportedChannels = SUPPORTED_CHANNELS) {
  const channel = inputChannel || 'all';
  const selected = channel === 'all' ? [...supportedChannels] : [channel];
  for (const value of selected) {
    if (!supportedChannels.includes(value)) {
      throw new Error(`Unsupported channel: ${value}`);
    }
  }
  return selected;
}

module.exports = {
  BRANCH_RELEASES,
  RETIRED_DIST_TAG,
  SUPPORTED_CHANNELS,
  PACKAGE_CHANNELS,
  isPackageChannel,
  channelForBranch,
  branchForChannel,
  distTagForChannel,
  prereleaseIdForChannel,
  versionMatchesChannel,
  resolveSelectedChannels,
};
