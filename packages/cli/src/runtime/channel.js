/**
 * Which published CLI build a profile should run.
 *
 * The npm tag has to be chosen before the CLI starts, and the CLI only learns
 * which Notis it talks to after it reads the profile — so a single documented
 * install command can never be right for both environments on its own. Login
 * asks the account which release channel it belongs to (`GET /release_channel`),
 * the answer is pinned on the profile as `release_channel`, and every later run
 * re-executes the matching build. `@notis_ai/cli@latest` therefore stays the
 * one command worth documenting, including for nightly accounts.
 */

export const RELEASE_CHANNELS = ['stable', 'nightly'];
// Keep equal to the dist-tags in scripts/release-channels.cjs (a test checks).
const CHANNEL_TAGS = { stable: 'latest', nightly: 'nightly' };
// Live API hosts and the channel each one serves.
const API_HOST_CHANNELS = {
  'api.notis.ai': 'stable',
  'api-beta.notis.ai': 'nightly',
  'api-nightly.notis.ai': 'nightly',
};
export const CLI_PACKAGE_NAME = '@notis_ai/cli';
// Set on the child so a build that disagrees about its own channel — a bad
// version string, a half-published tag — cannot bounce the process forever.
// Builds from before the nightly channel wrote `1` and resolved channels from
// the old profile fields, so a child that sees `1` may correct them once more.
export const CHANNEL_SWITCH_ENV = 'NOTIS_CLI_CHANNEL_SWITCHED';
export const CHANNEL_SWITCHED = '2';
const LEGACY_CHANNEL_SWITCHED = '1';
export const CHANNEL_DISABLE_ENV = 'NOTIS_CLI_AUTO_CHANNEL';

export function isReleaseChannel(value) {
  return RELEASE_CHANNELS.includes(value);
}

/**
 * A channel name as any Notis component may still spell it. `beta` is what
 * deployments, profiles and builds called the nightly channel before it was
 * renamed, so it reads as nightly; anything else unknown is dropped.
 */
export function normalizeReleaseChannel(value) {
  if (value === 'beta') return 'nightly';
  return isReleaseChannel(value) ? value : null;
}

export function channelFromApiBase(apiBase) {
  if (typeof apiBase !== 'string' || !apiBase) return null;
  try {
    return API_HOST_CHANNELS[new URL(apiBase).hostname] || null;
  } catch {
    // A malformed endpoint says nothing about the channel.
    return null;
  }
}

export function packageTagForChannel(channel) {
  return CHANNEL_TAGS[channel] || CHANNEL_TAGS.stable;
}

export function cliCommandForChannel(channel) {
  return `npx --package ${CLI_PACKAGE_NAME}@${packageTagForChannel(channel)} -- notis`;
}

/**
 * The channel of the build that is currently running.
 *
 * The publish pipeline stamps nightly releases as prereleases
 * (`0.2.0-nightly.129.1`, `0.2.0-beta.129.1` before the rename) and stable
 * releases as plain semver (`0.2.10`), so the manifest version is the only
 * channel marker that cannot drift from what npm actually served.
 */
export function channelFromVersion(version) {
  return String(version || '').includes('-') ? 'nightly' : 'stable';
}

/**
 * The channel a stored profile's fields pin it to, or null.
 *
 * This CLI writes only `release_channel`. Notis Desktop and older CLIs wrote a
 * `beta` flag and a `channel` pin (`stable` | `beta`) instead; normalization
 * drops those on every write, so when one is present it was written after this
 * CLI last touched the profile and is the fresher answer. Desktop always sets
 * `beta` from the API it just authorized, which makes it the most reliable.
 */
export function pinnedReleaseChannel(profile = {}) {
  if (profile.beta === true) return 'nightly';
  if (profile.beta === false) return 'stable';
  return normalizeReleaseChannel(profile.channel)
    || normalizeReleaseChannel(profile.release_channel);
}

/**
 * The channel a profile belongs to: its pin, else the live API it talks to.
 * The host fallback lets a profile authorized before channels existed resolve
 * without a second login.
 */
export function channelFromProfile(profile = {}) {
  const pinned = pinnedReleaseChannel(profile);
  if (pinned) return pinned;
  for (const candidate of [profile.oauth_api_base, profile.api_base]) {
    const channel = channelFromApiBase(candidate);
    if (channel) return channel;
  }
  return null;
}

/**
 * A profile served by `./dev.sh` runs the CLI from that worktree on purpose.
 * Re-executing it into a published build would swap both the code under test
 * and the credential the worktree minted.
 */
export function isDevManagedProfile(profile = {}) {
  if (profile.dev_access_token || profile.dev_workspace_root) {
    return true;
  }
  if (typeof profile.api_base !== 'string' || !profile.api_base) {
    return false;
  }
  try {
    const { hostname } = new URL(profile.api_base);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

/**
 * A checkout run through `node bin/notis.js` is someone testing this source
 * tree. Only an installed copy — one that npm placed under node_modules — may
 * hand its invocation to a different published build.
 */
export function isInstalledPackage(moduleDirectory) {
  return String(moduleDirectory || '').split(/[\\/]/).includes('node_modules');
}

/**
 * Decide whether this process should hand over to another published build.
 *
 * Returns the reason in every case: the caller reports it under `--verbose`
 * and the tests assert on it, so a switch that silently does not happen is
 * still explainable.
 */
export function resolveChannelSwitch({
  runningVersion,
  profile = {},
  moduleDirectory = '',
  env = process.env,
  platform = process.platform,
} = {}) {
  const runningChannel = channelFromVersion(runningVersion);
  const targetChannel = channelFromProfile(profile);
  const stay = (reason) => ({ switch: false, reason, runningChannel, targetChannel });

  // A pre-nightly build may have handed over on its own reading of the
  // profile (`1`); that hop may be corrected once, never more.
  if (env[CHANNEL_SWITCH_ENV] && env[CHANNEL_SWITCH_ENV] !== LEGACY_CHANNEL_SWITCHED) {
    return stay('already_switched');
  }
  if (env[CHANNEL_DISABLE_ENV] === '0') return stay('disabled');
  if (!targetChannel) return stay('profile_channel_unknown');
  if (targetChannel === runningChannel) return stay('channel_matches');
  if (isDevManagedProfile(profile)) return stay('dev_managed_profile');
  if (!isInstalledPackage(moduleDirectory)) return stay('source_checkout');

  return {
    switch: true,
    reason: 'channel_mismatch',
    runningChannel,
    targetChannel,
    command: platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['--yes', '--package', `${CLI_PACKAGE_NAME}@${packageTagForChannel(targetChannel)}`, '--', 'notis'],
  };
}
