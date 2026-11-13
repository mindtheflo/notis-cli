// CLI-038: OAuth grants recorded on api-beta.notis.ai, the retired name of the
// nightly API. Nightly checks issuer and audience against its current names
// (mcp-nightly, api-nightly/cli), so a grant minted for the old names is spent,
// while one minted for the current names and recorded on api-beta lives on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  credentialIsExpired,
  getProfile,
  listProfiles,
  loadConfig,
  oauthGrantIsDead,
  oauthGrantOnRetiredAddress,
  resolveRuntimeProfile,
} from '../src/runtime/profiles.js';
import { ensureFreshOAuthCredential, logoutOAuth, refreshOAuthCredential } from '../src/runtime/oauth.js';
import { reportCliCommand } from '../src/runtime/telemetry.js';
import { cliCommandForChannel } from '../src/runtime/channel.js';
import { runAutomaticSkillSync } from '../src/skill-sync-worker.js';

const execFileAsync = promisify(execFile);
const future = 4102444800;

function makeJwt(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'at+jwt' })}.${encode({ sub: 'oauth-user', exp: future, ...claims })}.sig`;
}

// A grant minted while nightly's public origins were api-beta.notis.ai.
const retiredGrant = {
  api_base: 'https://api-beta.notis.ai',
  release_channel: 'nightly',
  oauth_access_token: makeJwt({ aud: 'https://api-beta.notis.ai/cli' }),
  oauth_refresh_token: 'beta-refresh-token',
  oauth_access_expires_at: future,
  oauth_refresh_expires_at: future,
  oauth_client_id: 'notis_cli',
  oauth_issuer: 'https://api-beta.notis.ai',
  oauth_api_base: 'https://api-beta.notis.ai',
  oauth_resource: 'https://api-beta.notis.ai/cli',
  oauth_user_id: 'oauth-user',
};

// A grant minted for the current names, signed in through api-beta.
const liveGrantOnRetiredAddress = {
  api_base: 'https://api-beta.notis.ai',
  release_channel: 'nightly',
  oauth_access_token: makeJwt({ aud: 'https://api-nightly.notis.ai/cli' }),
  oauth_refresh_token: 'nightly-refresh-token',
  oauth_access_expires_at: 1,
  oauth_refresh_expires_at: future,
  oauth_client_id: 'notis_cli',
  oauth_issuer: 'https://mcp-nightly.notis.ai',
  oauth_api_base: 'https://api-beta.notis.ai',
  oauth_resource: 'https://api-nightly.notis.ai/cli',
  oauth_user_id: 'oauth-user',
};

function withConfig(t, profiles) {
  const home = mkdtempSync(join(tmpdir(), 'notis-cli-retired-address-'));
  mkdirSync(join(home, '.notis'), { recursive: true });
  const configFile = join(home, '.notis', 'config.json');
  writeFileSync(configFile, JSON.stringify({ current_profile: 'default', profiles }));
  const previous = {
    NOTIS_CLI_CONFIG_FILE: process.env.NOTIS_CLI_CONFIG_FILE,
    NOTIS_API_BASE: process.env.NOTIS_API_BASE,
    NOTIS_JWT: process.env.NOTIS_JWT,
    NOTIS_TEST_DISABLE_WORKTREE_ROUTING: process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING,
    NODE_ENV: process.env.NODE_ENV,
  };
  process.env.NOTIS_CLI_CONFIG_FILE = configFile;
  process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING = '1';
  process.env.NODE_ENV = 'test';
  delete process.env.NOTIS_API_BASE;
  delete process.env.NOTIS_JWT;
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  return { home, configFile };
}

test('a grant minted for the retired api-beta names is spent: signed out, stable route, nothing sent', async (t) => {
  // The issuer, the resource or, with neither recorded, the token's audience
  // names the retired host.
  const variants = {
    default: retiredGrant,
    issuer: { ...retiredGrant, oauth_resource: 'https://api-nightly.notis.ai/cli' },
    audience: { ...retiredGrant, oauth_resource: undefined, oauth_issuer: 'https://mcp-nightly.notis.ai' },
  };
  withConfig(t, variants);
  for (const name of Object.keys(variants)) {
    const profile = getProfile(loadConfig(), name);
    assert.equal(oauthGrantOnRetiredAddress(profile), true, name);
    assert.equal(oauthGrantIsDead(profile), true, name);
    // Its access token has years left and is still spent.
    assert.equal(credentialIsExpired({ credentialKind: 'oauth' }, profile), true, name);
    const runtime = resolveRuntimeProfile({ profile: name }, { requireAuth: true });
    assert.equal(runtime.apiBase, 'https://api.notis.ai', name);
    assert.equal(runtime.channel, 'stable', name);
  }
  const listed = listProfiles(loadConfig());
  assert.deepEqual(listed.map(entry => [entry.name, entry.authenticated, entry.api_base]), [
    ['default', false, 'https://api.notis.ai'],
    ['issuer', false, 'https://api.notis.ai'],
    ['audience', false, 'https://api.notis.ai'],
  ]);

  // The refresh says the address is gone and gives the exact login command,
  // without sending the token anywhere.
  const sent = [];
  const fetchImpl = async (url) => {
    sent.push(String(url));
    throw new Error('nothing may be sent with a retired grant');
  };
  const runtime = resolveRuntimeProfile({}, { requireAuth: true });
  // Another explicit API does not hide the retired-address error behind a mismatch.
  const elsewhere = resolveRuntimeProfile({ apiBase: 'https://api.notis.ai' }, { requireAuth: true });
  await assert.rejects(ensureFreshOAuthCredential(elsewhere, fetchImpl), { code: 'oauth_grant_retired_address' });
  for (const attempt of [
    () => ensureFreshOAuthCredential(runtime, fetchImpl),
    () => refreshOAuthCredential(runtime, fetchImpl),
  ]) {
    await assert.rejects(attempt(), (error) => {
      assert.equal(error.code, 'oauth_grant_retired_address');
      assert.match(error.message, /api-beta\.notis\.ai/);
      // The stable build: the login that follows starts on stable (CLI-035).
      const login = `${cliCommandForChannel('stable')} login`;
      assert.equal(error.hints[0].command, login);
      assert.ok(error.message.endsWith(`Sign in again: ${login}`), error.message);
      return true;
    });
  }

  // Telemetry of a local command does not carry it either.
  assert.equal(await reportCliCommand({
    spec: { backend_call: { type: 'local' } },
    runtime: { ...runtime, cliVersion: 'test' },
    result: {},
    durationMs: 1,
    fetchImpl,
  }), false);

  // Logout forgets it without asking the retired issuer to revoke it.
  await logoutOAuth(runtime, {}, fetchImpl);
  assert.equal(getProfile(loadConfig(), 'default').oauth_refresh_token, undefined);
  assert.deepEqual(sent, []);
});

test('a command with a retired grant sends no request, even with a live access token', async (t) => {
  const { home, configFile } = withConfig(t, { default: retiredGrant });
  const transportModule = new URL('../src/runtime/transport.js', import.meta.url).href;
  const profilesModule = new URL('../src/runtime/profiles.js', import.meta.url).href;
  const script = `
    import { httpRequest } from ${JSON.stringify(transportModule)};
    import { resolveRuntimeProfile } from ${JSON.stringify(profilesModule)};
    const sent = [];
    globalThis.fetch = async (url) => { sent.push(String(url)); throw new Error('sent'); };
    const runtime = resolveRuntimeProfile({}, { requireAuth: true });
    let code = 'sent';
    try {
      await httpRequest({ runtime: { ...runtime, cliVersion: 'test' }, method: 'GET', path: '/probe' });
    } catch (error) {
      code = error.code;
    }
    process.stdout.write(JSON.stringify({ code, sent }));
  `;
  const result = await execFileAsync(
    process.execPath,
    ['--input-type=module', '-e', script],
    {
      cwd: home,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        NODE_ENV: 'test',
        NOTIS_CLI_CONFIG_FILE: configFile,
        NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1',
      },
      encoding: 'utf-8',
    },
  );
  assert.deepEqual(JSON.parse(result.stdout), { code: 'oauth_grant_retired_address', sent: [] });
});

test('a live grant recorded on api-beta routes and refreshes on the current nightly names', async (t) => {
  withConfig(t, { default: liveGrantOnRetiredAddress });
  const profile = getProfile(loadConfig(), 'default');
  assert.equal(oauthGrantOnRetiredAddress(profile), false);
  const runtime = resolveRuntimeProfile({}, { requireAuth: true });
  assert.equal(runtime.apiBase, 'https://api-nightly.notis.ai');
  assert.equal(runtime.oauthApiBase, 'https://api-nightly.notis.ai');
  assert.equal(runtime.channel, 'nightly');
  assert.equal(listProfiles(loadConfig())[0].api_base, 'https://api-nightly.notis.ai');

  const requests = [];
  await refreshOAuthCredential(runtime, async (url, init) => {
    requests.push({ url: String(url), resource: new URLSearchParams(String(init.body)).get('resource') });
    return new Response(JSON.stringify({
      access_token: makeJwt({ aud: 'https://api-nightly.notis.ai/cli' }),
      refresh_token: 'rotated-refresh-token',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_expires_in: 7200,
      scope: 'notis:read',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  // The token request goes to the issuer that minted the grant, for the
  // resource the grant was minted for.
  assert.deepEqual(requests, [{
    url: 'https://mcp-nightly.notis.ai/oauth/token',
    resource: 'https://api-nightly.notis.ai/cli',
  }]);
  // An explicit --api-base on the retired name is the same API, not another target.
  const explicit = resolveRuntimeProfile({ apiBase: 'https://api-beta.notis.ai' }, { requireAuth: true });
  assert.equal(explicit.credentialKind, 'oauth');
  const stored = JSON.parse(readFileSync(process.env.NOTIS_CLI_CONFIG_FILE, 'utf-8')).profiles.default;
  assert.equal(stored.api_base, 'https://api-nightly.notis.ai');
  assert.equal(stored.oauth_api_base, 'https://api-nightly.notis.ai');
  assert.equal(stored.oauth_resource, 'https://api-nightly.notis.ai/cli');
  assert.equal(stored.oauth_issuer, 'https://mcp-nightly.notis.ai');
  assert.equal(runtime.apiBase, 'https://api-nightly.notis.ai');
});

test('background skill sync installed on api-beta keeps running on the nightly API', async () => {
  const synced = [];
  const result = await runAutomaticSkillSync(
    { profile: 'nightly', apiBase: 'https://api-beta.notis.ai', userId: 'owner' },
    {
      resolveRuntime: () => ({
        profileName: 'nightly',
        apiBase: 'https://api-nightly.notis.ai',
        oauthApiBase: 'https://api-nightly.notis.ai',
        oauthUserId: 'owner',
        credentialKind: 'oauth',
        jwt: 'fresh',
      }),
      refresh: async () => {},
      settings: async () => ({ user_id: 'owner', sync_enabled: true }),
      lock: async fn => fn(),
      sync: async (url) => { synced.push(url); return {}; },
      currentProfile: () => 'nightly',
    },
  );
  assert.equal(result.status, 'synced');
  assert.deepEqual(synced, ['https://api-nightly.notis.ai']);
});
