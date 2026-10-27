/**
 * Login follows the account's release channel.
 *
 * Every Notis account belongs to one release channel (`stable` | `nightly`),
 * and each channel has its own API. After a login, the CLI asks the API it just
 * authorized against which channel the account uses (`GET /release_channel`).
 * When that API serves the other channel, the CLI signs the profile in again
 * against the account's own API; the profile then pins `release_channel`, and
 * the next run re-executes the matching npm build (resolveChannelSwitch).
 *
 * An explicit route always wins: `--api-base`, `NOTIS_API_BASE`, a `./dev.sh`
 * worktree and any loopback API skip all of this, exactly as before.
 */

import { CliError, EXIT_CODES } from './errors.js';
import { quoteShellArgument } from './auth-recovery.js';
import { cliCommandForChannel, normalizeReleaseChannel } from './channel.js';
import { updateConfig } from './profiles.js';

const CHANNEL_LABELS = { stable: 'Stable', nightly: 'Nightly' };
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const RELEASE_CHANNEL_TIMEOUT_MS = 10_000;

export function releaseChannelLabel(channel) {
  return CHANNEL_LABELS[channel] || channel;
}

function isLoopbackApiBase(apiBase) {
  try {
    return LOOPBACK_HOSTS.has(new URL(apiBase).hostname);
  } catch {
    return false;
  }
}

/**
 * The API origin a channel answer may send the CLI to. Only an https Notis
 * host qualifies: a login is about to hand this origin a fresh grant.
 */
export function trustedApiOrigin(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    const notisHost = url.hostname === 'notis.ai' || url.hostname.endsWith('.notis.ai');
    return url.protocol === 'https:' && notisHost && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

/** True when this invocation routes by the account rather than explicitly. */
export function followsAccountReleaseChannel(runtime = {}, env = process.env) {
  if (runtime.requestedApiBase || env.NOTIS_API_BASE) return false;
  if (runtime.worktreeRuntime || runtime.credentialKind !== 'oauth' || !runtime.jwt) return false;
  return Boolean(runtime.apiBase) && !isLoopbackApiBase(runtime.apiBase);
}

/**
 * Normalizes a `/release_channel` answer, or a `release_channel_mismatch`
 * error body, which carries the same fields.
 */
export function parseReleaseChannelAnswer(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const releaseChannel = normalizeReleaseChannel(payload.release_channel);
  if (!releaseChannel) return null;
  const deploymentChannel = normalizeReleaseChannel(payload.deployment_channel);
  const origins = payload.origins && typeof payload.origins === 'object' ? payload.origins : {};
  return {
    releaseChannel,
    deploymentChannel,
    match: !deploymentChannel || payload.match === true || deploymentChannel === releaseChannel,
    apiOrigin: trustedApiOrigin(origins.api),
  };
}

/**
 * Asks the API which channel the signed-in account uses. Any failure (an API
 * that predates the endpoint, a network error) answers null: the login that
 * just succeeded stands, and the 403 a mismatched API returns later explains
 * the way out.
 */
export async function fetchAccountReleaseChannel(runtime, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${String(runtime.apiBase).replace(/\/+$/, '')}/release_channel`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${runtime.jwt}`,
        ...(runtime.cliVersion ? { 'X-Notis-CLI-Version': runtime.cliVersion } : {}),
      },
      signal: AbortSignal.timeout(RELEASE_CHANNEL_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseReleaseChannelAnswer(await response.json());
  } catch {
    return null;
  }
}

function persistReleaseChannel(runtime, releaseChannel) {
  const config = updateConfig((latest) => {
    const profile = latest.profiles[runtime.profileName];
    if (profile) profile.release_channel = releaseChannel;
    return latest;
  });
  runtime.channel = releaseChannel;
  return config.profiles[runtime.profileName];
}

/**
 * Checks a finished login against the account's channel and, on a mismatch,
 * signs in again against the account's API.
 *
 * `result` is what loginWithOAuth returned; anything without a profile (a
 * pending browser hand-off) is returned untouched. `login` is loginWithOAuth,
 * injected so this module does not import the OAuth machinery.
 */
export async function followAccountReleaseChannel(runtime, result, {
  login,
  options = {},
  output,
  fetchImpl = fetch,
  env = process.env,
  followed = false,
} = {}) {
  if (!result?.profile || !followsAccountReleaseChannel(runtime, env)) return result;
  const answer = await fetchAccountReleaseChannel(runtime, fetchImpl);
  // No answer, or a development API with no channel: nothing to follow.
  if (!answer?.deploymentChannel) return result;
  if (answer.match) {
    return { ...result, profile: persistReleaseChannel(runtime, answer.releaseChannel) || result.profile };
  }
  const label = releaseChannelLabel(answer.releaseChannel);
  if (followed || !answer.apiOrigin || answer.apiOrigin === runtime.apiBase) {
    // Following once more would loop; say so instead of failing the login.
    output?.notice?.(
      `Your account uses the ${label} channel, but this sign-in could not move there. `
      + `Run: ${releaseChannelLoginCommand(runtime, answer)}`,
    );
    return result;
  }
  output?.notice?.(`Your account uses the ${label} channel, signing you in there.`);
  runtime.apiBase = answer.apiOrigin;
  // A code or a stored credential belongs to the login that just finished.
  const { code: _code, reusePersistedCredential: _reuse, ...nextOptions } = options;
  const next = await login(runtime, nextOptions, output);
  if (!next?.profile) return next;
  return followAccountReleaseChannel(runtime, next, {
    login, options: nextOptions, output, fetchImpl, env, followed: true,
  });
}

/** The exact command that signs this profile in on the account's channel. */
export function releaseChannelLoginCommand(runtime = {}, answer = {}) {
  return [
    cliCommandForChannel(answer.releaseChannel),
    ...(runtime.profileName && runtime.profileName !== 'default'
      ? [`--profile ${quoteShellArgument(runtime.profileName)}`]
      : []),
    ...(answer.apiOrigin ? [`--api-base ${quoteShellArgument(answer.apiOrigin)}`] : []),
    'login',
  ].join(' ');
}

/**
 * The error for an API that refuses this account because it serves the other
 * release channel (`403 {"error": "release_channel_mismatch", ...}`).
 */
export function releaseChannelMismatchError(payload, runtime = {}) {
  const answer = parseReleaseChannelAnswer(payload) || {};
  const label = releaseChannelLabel(answer.releaseChannel);
  const message = (typeof payload?.message === 'string' && payload.message)
    || (answer.releaseChannel
      ? `Your account uses the ${label} channel, which this Notis API does not serve.`
      : 'Your account uses another Notis release channel than this API serves.');
  const command = releaseChannelLoginCommand(runtime, answer);
  return new CliError({
    code: 'release_channel_mismatch',
    message: `${message} Sign in again with: ${command}`,
    exitCode: EXIT_CODES.auth,
    details: payload || {},
    hints: [{ command, reason: `Sign this profile in on the ${label || 'right'} channel` }],
  });
}
