import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  followAccountReleaseChannel,
  followsAccountReleaseChannel,
  parseReleaseChannelAnswer,
  trustedApiOrigin,
} from '../src/runtime/release-channel.js';
import { normalizeBackendError } from '../src/runtime/transport.js';
import { normalizeConfig } from '../src/runtime/profiles.js';

const STABLE_API = 'https://api.notis.ai';
const NIGHTLY_API = 'https://api-beta.notis.ai';
const ORIGINS = {
  nightly: { portal: 'https://beta.notis.ai', api: NIGHTLY_API, mcp: NIGHTLY_API, realtime: 'wss://n.example' },
  stable: { portal: 'https://app.notis.ai', api: STABLE_API, mcp: 'https://mcp.notis.ai', realtime: 'wss://s.example' },
};

function withConfig(profiles, run) {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-release-channel-')), 'config.json');
  writeFileSync(configFile, JSON.stringify({ current_profile: 'work', profiles }));
  const previous = process.env.NOTIS_CLI_CONFIG_FILE;
  process.env.NOTIS_CLI_CONFIG_FILE = configFile;
  const restore = () => {
    if (previous === undefined) delete process.env.NOTIS_CLI_CONFIG_FILE;
    else process.env.NOTIS_CLI_CONFIG_FILE = previous;
  };
  const read = () => JSON.parse(readFileSync(configFile, 'utf8')).profiles;
  return Promise.resolve(run(read)).finally(restore);
}

// The /release_channel answer of a deployment serving `deployment` for an
// account on `account`.
function channelApi(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), authorization: init.headers.Authorization });
    const apiBase = new URL(url).origin;
    const answer = answers[apiBase];
    if (!answer) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(answer));
  };
  return { calls, fetchImpl };
}

function answer(account, deployment) {
  return {
    release_channel: account,
    deployment_channel: deployment,
    match: account === deployment || deployment === null,
    origins: ORIGINS[account],
  };
}

function signedIn(apiBase, overrides = {}) {
  return {
    profileName: 'work',
    apiBase,
    credentialKind: 'oauth',
    jwt: `token-for-${apiBase}`,
    ...overrides,
  };
}

function recorder() {
  const notices = [];
  return { notices, output: { notice: message => notices.push(message), note() {} } };
}

test('a login that matches the account pins its release channel', async () => {
  await withConfig({ work: { api_base: STABLE_API, oauth_api_base: STABLE_API, release_channel: 'stable' } }, async (read) => {
    const api = channelApi({ [STABLE_API]: answer('stable', 'stable') });
    const runtime = signedIn(STABLE_API);
    const result = await followAccountReleaseChannel(runtime, { profile: { api_base: STABLE_API } }, {
      login: async () => assert.fail('a matching account is never signed in again'),
      fetchImpl: api.fetchImpl,
      env: {},
    });
    assert.equal(result.profile.release_channel, 'stable');
    assert.equal(read().work.release_channel, 'stable');
    assert.deepEqual(api.calls, [{ url: `${STABLE_API}/release_channel`, authorization: `Bearer token-for-${STABLE_API}` }]);
  });
});

test('a nightly account signed in on stable is told once and signed in again on its own API', async () => {
  await withConfig({ work: { api_base: STABLE_API, oauth_api_base: STABLE_API, release_channel: 'stable' } }, async (read) => {
    const api = channelApi({
      [STABLE_API]: answer('nightly', 'stable'),
      [NIGHTLY_API]: answer('nightly', 'nightly'),
    });
    const runtime = signedIn(STABLE_API);
    const { notices, output } = recorder();
    const logins = [];
    const login = async (loginRuntime, options) => {
      logins.push({ apiBase: loginRuntime.apiBase, options });
      // What loginWithOAuth leaves behind: a profile and runtime on the new API.
      loginRuntime.jwt = 'nightly-token';
      return { profile: { api_base: loginRuntime.apiBase, release_channel: 'nightly' } };
    };
    const result = await followAccountReleaseChannel(runtime, { profile: { api_base: STABLE_API } }, {
      login,
      options: { code: 'used-code', reusePersistedCredential: true, mode: 'browser' },
      output,
      fetchImpl: api.fetchImpl,
      env: {},
    });
    assert.deepEqual(notices, ['Your account uses the Nightly channel, signing you in there.']);
    // The second login targets the account's API and never replays the first
    // login's code or stored credential.
    assert.deepEqual(logins, [{ apiBase: NIGHTLY_API, options: { mode: 'browser' } }]);
    assert.equal(runtime.apiBase, NIGHTLY_API);
    assert.equal(runtime.channel, 'nightly');
    assert.equal(result.profile.release_channel, 'nightly');
    assert.equal(read().work.release_channel, 'nightly');
    assert.deepEqual(api.calls.map(call => call.url), [`${STABLE_API}/release_channel`, `${NIGHTLY_API}/release_channel`]);
    assert.equal(api.calls[1].authorization, 'Bearer nightly-token');
  });
});

test('an agent login that has to move hands back the new authorization URL', async () => {
  await withConfig({ work: {} }, async () => {
    const api = channelApi({ [NIGHTLY_API]: answer('stable', 'nightly') });
    const pending = { agentAuthorization: { authorize_url: 'https://api.notis.ai/oauth/authorize?x=1' } };
    const result = await followAccountReleaseChannel(signedIn(NIGHTLY_API), { profile: {} }, {
      login: async runtime => {
        assert.equal(runtime.apiBase, STABLE_API);
        return pending;
      },
      output: recorder().output,
      fetchImpl: api.fetchImpl,
      env: {},
    });
    assert.equal(result, pending);
  });
});

test('a second mismatch never loops; it prints the exact login command instead', async () => {
  await withConfig({ work: {} }, async () => {
    const api = channelApi({
      [STABLE_API]: answer('nightly', 'stable'),
      [NIGHTLY_API]: answer('nightly', 'stable'),
    });
    const { notices, output } = recorder();
    let logins = 0;
    await followAccountReleaseChannel(signedIn(STABLE_API, { profileName: 'work' }), { profile: {} }, {
      login: async runtime => { logins += 1; return { profile: { api_base: runtime.apiBase } }; },
      output,
      fetchImpl: api.fetchImpl,
      env: {},
    });
    assert.equal(logins, 1);
    assert.match(notices.at(-1), /could not move there\. Run: npx --package @notis_ai\/cli@nightly -- notis --profile 'work' --api-base 'https:\/\/api-beta\.notis\.ai' login$/);
  });
});

test('explicit routes, dev worktrees, loopback and old APIs keep the login unchanged', async () => {
  const api = channelApi({ [STABLE_API]: answer('nightly', 'stable') });
  const login = async () => assert.fail('a bypassed login is never redone');
  const result = { profile: { api_base: STABLE_API } };
  for (const [runtime, env] of [
    [signedIn(STABLE_API, { requestedApiBase: STABLE_API }), {}],
    [signedIn(STABLE_API), { NOTIS_API_BASE: STABLE_API }],
    [signedIn(STABLE_API, { worktreeRuntime: { profile: 'dev' } }), {}],
    [signedIn('http://127.0.0.1:4311'), {}],
    [signedIn(STABLE_API, { credentialKind: 'env' }), {}],
  ]) {
    assert.equal(followsAccountReleaseChannel(runtime, env), false);
    assert.equal(await followAccountReleaseChannel(runtime, result, { login, fetchImpl: api.fetchImpl, env }), result);
  }
  assert.equal(api.calls.length, 0);

  // A development deployment has no channel, and an API from before the
  // endpoint answers 404: the login that succeeded stands.
  for (const answers of [{ [STABLE_API]: answer('nightly', null) }, {}]) {
    const { fetchImpl } = channelApi(answers);
    assert.equal(await followAccountReleaseChannel(signedIn(STABLE_API), result, { login, fetchImpl, env: {} }), result);
  }
});

test('a channel answer may only send the CLI to an https Notis API', () => {
  assert.equal(trustedApiOrigin('https://api-nightly.notis.ai/'), 'https://api-nightly.notis.ai');
  assert.equal(trustedApiOrigin('http://api-beta.notis.ai'), null);
  assert.equal(trustedApiOrigin('https://notis.ai.evil.example'), null);
  assert.equal(trustedApiOrigin('https://user:<password>@api.notis.ai'), null);
  assert.equal(parseReleaseChannelAnswer({ ...answer('nightly', 'stable'), origins: { api: 'https://evil.example' } }).apiOrigin, null);
  // Deployments from before the rename still say beta.
  assert.equal(parseReleaseChannelAnswer({ release_channel: 'beta', deployment_channel: 'production' }).releaseChannel, 'nightly');
  assert.equal(parseReleaseChannelAnswer({ release_channel: 'canary' }), null);
});

test('a 403 release_channel_mismatch names the fix: the exact login on the account channel', () => {
  const payload = {
    error: 'release_channel_mismatch',
    release_channel: 'nightly',
    deployment_channel: 'stable',
    origins: ORIGINS.nightly,
    message: 'Your account uses Nightly. This is the Stable Notis.',
    message_fr: 'Ton compte utilise Nightly.',
  };
  const error = normalizeBackendError(403, payload, { profileName: 'work', apiBase: STABLE_API });
  const command = "npx --package @notis_ai/cli@nightly -- notis --profile 'work' --api-base 'https://api-beta.notis.ai' login";
  assert.equal(error.code, 'release_channel_mismatch');
  assert.equal(error.message, `Your account uses Nightly. This is the Stable Notis. Sign in again with: ${command}`);
  assert.deepEqual(error.hints.map(hint => hint.command), [command]);
  assert.equal(error.details.deployment_channel, 'stable');

  // The default profile and a stable account read naturally too.
  const stable = normalizeBackendError(403, {
    error: 'release_channel_mismatch', release_channel: 'stable', deployment_channel: 'nightly', origins: ORIGINS.stable,
  }, { profileName: 'default' });
  assert.equal(stable.hints[0].command, "npx --package @notis_ai/cli@latest -- notis --api-base 'https://api.notis.ai' login");
  assert.match(stable.message, /^Your account uses the Stable channel/);

  // Every other 403 keeps its meaning.
  assert.equal(normalizeBackendError(403, { error: 'forbidden' }, {}).code, 'forbidden');
});

test('profiles from older CLIs and Notis Desktop migrate to release_channel on read and write', () => {
  const { profiles } = normalizeConfig({
    profiles: {
      legacy_flag: { beta: true, api_base: NIGHTLY_API },
      legacy_pin: { channel: 'beta' },
      legacy_stable: { beta: false, channel: 'stable' },
      // Desktop re-signed a nightly profile on stable after this CLI pinned it.
      desktop_later: { release_channel: 'nightly', beta: false },
      current: { release_channel: 'nightly' },
      unknown: { release_channel: 'canary' },
    },
  });
  assert.equal(profiles.legacy_flag.release_channel, 'nightly');
  assert.equal(profiles.legacy_pin.release_channel, 'nightly');
  assert.equal(profiles.legacy_stable.release_channel, 'stable');
  assert.equal(profiles.desktop_later.release_channel, 'stable');
  assert.equal(profiles.current.release_channel, 'nightly');
  assert.equal(profiles.unknown.release_channel, undefined);
  for (const profile of Object.values(profiles)) {
    assert.equal('beta' in profile, false);
    assert.equal('channel' in profile, false);
  }
});
