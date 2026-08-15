/**
 * Which published CLI build a profile should run.
 *
 * The npm tag has to be chosen before the CLI starts, and the CLI only learns
 * which Notis it talks to after it reads the profile — so a single documented
 * install command can never be right for both environments on its own. The
 * deployment answers the question at login (`notis_cli_channel` in the CLI
 * protected-resource metadata), the answer is pinned on the profile, and every
 * later run re-executes the matching build. `@notis_ai/cli@latest` therefore
 * stays the one command worth documenting, including for beta accounts.
 */

export const RELEASE_CHANNELS = ['stable', 'beta'];
const CHANNEL_TAGS = { stable: 'latest', beta: 'beta' };
export const CLI_PACKAGE_NAME = '@notis_ai/cli';
// Set on the child so a build that disagrees about its own channel — a bad
// version string, a half-published tag — cannot bounce the process forever.
export const CHANNEL_SWITCH_ENV = 'NOTIS_CLI_CHANNEL_SWITCHED';
export const CHANNEL_DISABLE_ENV = 'NOTIS_CLI_AUTO_CHANNEL';

export function isReleaseChannel(value) {
  return RELEASE_CHANNELS.includes(value);
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
 * The publish pipeline stamps beta releases as prereleases
 * (`0.2.0-beta.129.1`) and production releases as plain semver (`0.2.10`), so
 * the manifest version is the only channel marker that cannot drift from what
 * npm actually served.
 */
export function channelFromVersion(version) {
  return String(version || '').includes('-') ? 'beta' : 'stable';
}

/**
 * The channel a profile is pinned to.
 *
 * `channel` is written at login from the deployment's own metadata. The
 * `beta` flag and the endpoint host are the fallbacks that let a profile
 * authorized by an older CLI resolve without a second login.
 */
export function channelFromProfile(profile = {}) {
  if (isReleaseChannel(profile.channel)) {
    return profile.channel;
  }
  if (profile.beta === true) return 'beta';
  if (profile.beta === false) return 'stable';
  for (const candidate of [profile.oauth_api_base, profile.api_base]) {
    if (typeof candidate !== 'string' || !candidate) continue;
    try {
      const { hostname } = new URL(candidate);
      if (hostname === 'api-beta.notis.ai') return 'beta';
      if (hostname === 'api.notis.ai') return 'stable';
    } catch {
      // A malformed endpoint says nothing about the channel.
    }
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

  if (env[CHANNEL_SWITCH_ENV] === '1') return stay('already_switched');
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
