import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  credentialIsExpired,
  ensureProfile,
  normalizeConfig,
  resolveRuntimeProfile,
  saveConfig,
  updateConfig,
} from '../src/runtime/profiles.js';
import {
  browserOpenCommand,
  createLoopbackReceiver,
  discoverCliOAuth,
  loginWithOAuth,
  refreshOAuthCredential,
} from '../src/runtime/oauth.js';
import { OutputManager } from '../src/runtime/output.js';
import { activeRuntimeUserId } from '../src/command-specs/meta.js';

const future = 4102444800;
const execFileAsync = promisify(execFile);

// This file exercises direct config writers as well as spawned CLI processes.
// Give the entire test process a scratch config before any test runs so a
// missed per-case override can never rewrite the developer's real
// ~/.notis/config.json.
const suiteConfigHome = mkdtempSync(join(tmpdir(), 'notis-cli-oauth-suite-'));
const suiteConfigFile = join(suiteConfigHome, 'config.json');
const configFileBeforeSuite = process.env.NOTIS_CLI_CONFIG_FILE;
process.env.NOTIS_CLI_CONFIG_FILE = suiteConfigFile;
test.after(() => {
  if (configFileBeforeSuite === undefined) delete process.env.NOTIS_CLI_CONFIG_FILE;
  else process.env.NOTIS_CLI_CONFIG_FILE = configFileBeforeSuite;
});

// The config path is process-global now that every profile lives in one file,
// so a test that writes to a scratch config has to scope the env var itself.
function withConfigFile(configFile, run) {
  const previous = process.env.NOTIS_CLI_CONFIG_FILE;
  process.env.NOTIS_CLI_CONFIG_FILE = configFile;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.NOTIS_CLI_CONFIG_FILE;
    else process.env.NOTIS_CLI_CONFIG_FILE = previous;
  }
}

function makeJwt(sub = 'oauth-user', exp = future) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'at+jwt' })}.${encode({ sub, exp })}.sig`;
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf-8'),
      }));
    });
    req.once('error', reject);
    req.end();
  });
}

test('table output can emit the authorization URL before login waits', () => {
  assert.equal(typeof OutputManager.prototype.note, 'function');
});

test('OAuth profile fields survive normalization in profile and legacy config shapes', () => {
  const fields = {
    oauth_access_token: makeJwt(),
    oauth_refresh_token: 'refresh-token',
    oauth_access_expires_at: future,
    oauth_refresh_expires_at: future + 3600,
    oauth_client_id: 'notis_cli',
    oauth_issuer: 'https://api.notis.ai',
    oauth_api_base: 'https://api.notis.ai',
    oauth_resource: 'https://api.notis.ai/cli',
    oauth_scopes: ['notis:read', 'notis:apps'],
    oauth_user_id: 'oauth-user',
  };

  const profiled = normalizeConfig({
    current_profile: 'default',
    profiles: { default: fields },
  }).profiles.default;
  const legacy = normalizeConfig(fields).profiles.default;
  for (const [key, value] of Object.entries(fields)) {
    assert.deepEqual(profiled[key], value);
    assert.deepEqual(legacy[key], value);
  }
});

test('credential expiry is kind-specific and fails closed when expiry is missing', () => {
  assert.equal(credentialIsExpired(
    { credentialKind: 'oauth' },
    { oauth_access_expires_at: future },
  ), false);
  assert.equal(credentialIsExpired({ credentialKind: 'oauth' }, {}), true);
  assert.equal(credentialIsExpired(
    { credentialKind: 'worktree', jwt: makeJwt() },
    {},
  ), false);
  assert.equal(credentialIsExpired(
    { credentialKind: 'worktree', jwt: 'opaque-without-expiry' },
    {},
  ), true);
  // A credential shape this CLI does not know how to renew must never be
  // treated as live just because it happens to carry a future `exp`.
  assert.equal(credentialIsExpired({ jwt: makeJwt() }, {}), true);
  assert.equal(credentialIsExpired(
    { credentialKind: 'env', jwt: makeJwt() },
    { oauth_access_expires_at: 1 },
  ), false);
  assert.equal(credentialIsExpired(
    { credentialKind: 'env', jwt: makeJwt('env-user', 1) },
    { oauth_access_expires_at: future },
  ), true);
});

test('active runtime identity follows the credential actually selected', () => {
  assert.equal(activeRuntimeUserId({
    credentialKind: 'worktree',
    jwt: makeJwt('dev-user'),
    oauthUserId: 'stale-oauth-user',
  }), 'dev-user');
  assert.equal(activeRuntimeUserId({
    credentialKind: 'oauth',
    jwt: makeJwt('oauth-token-user'),
    oauthUserId: 'oauth-user',
  }), 'oauth-user');
});

test('Windows browser opening does not pass OAuth query parameters through cmd.exe', () => {
  const url = 'https://api.example.com/oauth/authorize?client_id=notis_cli&state=abc';
  assert.deepEqual(browserOpenCommand(url, 'win32'), {
    command: 'rundll32.exe',
    args: ['url.dll,FileProtocolHandler', url],
  });
});

test('runtime selection follows the active profile and its own OAuth grant', () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-cli-precedence-'));
  const configFile = join(home, 'config.json');
  mkdirSync(home, { recursive: true });
  const writeConfig = (profiles, currentProfile = 'default') => writeFileSync(
    configFile,
    JSON.stringify({ current_profile: currentProfile, profiles }),
  );
  const previousConfig = process.env.NOTIS_CLI_CONFIG_FILE;
  const previousDisableRouting = process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousJwt = process.env.NOTIS_JWT;
  const previousProfile = process.env.NOTIS_PROFILE;
  process.env.NOTIS_CLI_CONFIG_FILE = configFile;
  process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING = '1';
  process.env.NODE_ENV = 'test';
  delete process.env.NOTIS_JWT;
  delete process.env.NOTIS_PROFILE;
  try {
    // A credential Notis Desktop left behind is inert: the profile reads as
    // signed out rather than authenticating with a token nothing renews.
    writeConfig({ default: { jwt: makeJwt('desktop-user'), access_expires_at: future } });
    assert.throws(
      () => resolveRuntimeProfile({}, { requireAuth: true }),
      (error) => error?.code === 'auth_missing',
    );

    writeConfig({
      default: {
        oauth_access_token: makeJwt('oauth-user'),
        oauth_access_expires_at: future,
        oauth_api_base: 'https://api.notis.ai',
        oauth_resource: 'https://api.notis.ai/cli',
        oauth_user_id: 'oauth-user',
      },
    });
    const oauth = resolveRuntimeProfile({}, { requireAuth: true });
    assert.equal(oauth.credentialKind, 'oauth');
    assert.equal(oauth.oauthUserId, 'oauth-user');
    assert.equal(oauth.apiBase, 'https://api.notis.ai');
    assert.equal(oauth.oauthResource, 'https://api.notis.ai/cli');
    let mismatch;
    assert.throws(
      () => resolveRuntimeProfile(
        { apiBase: 'https://api-beta.notis.ai' },
        { requireAuth: true },
      ),
      (error) => {
        mismatch = error;
        return error?.code === 'oauth_api_target_mismatch';
      },
    );
    assert.match(mismatch.hints[0].command, / login$/);
    assert.doesNotMatch(mismatch.hints[0].command, /--force/);

    // Switching the active profile picks up the other account's grant and its
    // endpoint together, and leaves the first account's credential in place.
    writeConfig({
      default: {
        oauth_access_token: makeJwt('oauth-user'),
        oauth_access_expires_at: future,
        oauth_api_base: 'https://api.notis.ai',
        oauth_user_id: 'oauth-user',
      },
      beta: {
        oauth_access_token: makeJwt('beta-user'),
        oauth_access_expires_at: future,
        oauth_api_base: 'https://api-beta.notis.ai',
        oauth_user_id: 'beta-user',
      },
    }, 'beta');
    const active = resolveRuntimeProfile({}, { requireAuth: true });
    assert.equal(active.profileName, 'beta');
    assert.equal(active.profileSource, 'current');
    assert.equal(active.apiBase, 'https://api-beta.notis.ai');
    assert.equal(active.oauthUserId, 'beta-user');

    const explicit = resolveRuntimeProfile({ profile: 'default' }, { requireAuth: true });
    assert.equal(explicit.profileName, 'default');
    assert.equal(explicit.profileSource, 'explicit');
    assert.equal(explicit.oauthUserId, 'oauth-user');

    // A lapsed access token still resolves so transport can refresh it.
    writeConfig({
      default: {
        oauth_access_token: makeJwt('oauth-user', 1),
        oauth_access_expires_at: 1,
        oauth_refresh_token: 'refresh-token',
        oauth_user_id: 'oauth-user',
      },
    });
    const refreshableOauth = resolveRuntimeProfile({}, { requireAuth: true });
    assert.equal(refreshableOauth.credentialKind, 'oauth');
    assert.equal(refreshableOauth.oauthRefreshToken, 'refresh-token');
  } finally {
    if (previousConfig === undefined) delete process.env.NOTIS_CLI_CONFIG_FILE;
    else process.env.NOTIS_CLI_CONFIG_FILE = previousConfig;
    if (previousDisableRouting === undefined) delete process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING;
    else process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING = previousDisableRouting;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousJwt === undefined) delete process.env.NOTIS_JWT;
    else process.env.NOTIS_JWT = previousJwt;
    if (previousProfile === undefined) delete process.env.NOTIS_PROFILE;
    else process.env.NOTIS_PROFILE = previousProfile;
  }
});

test('OAuth refresh routes to the grant it belongs to, not the profile api_base', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-cli-oauth-environment-'));
  const configFile = join(home, 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'default',
    profiles: {
      default: {
        api_base: 'https://api-beta.notis.ai',
        oauth_access_token: makeJwt('oauth-user', 1),
        oauth_refresh_token: 'refresh-token',
        oauth_access_expires_at: 1,
        oauth_refresh_expires_at: future,
        oauth_client_id: 'notis_cli',
        oauth_issuer: 'https://mcp.notis.ai',
        oauth_api_base: 'https://api.notis.ai',
        oauth_resource: 'https://api.notis.ai/cli',
        oauth_scopes: ['notis:read'],
        oauth_user_id: 'oauth-user',
      },
    },
  }));
  const previousConfig = process.env.NOTIS_CLI_CONFIG_FILE;
  process.env.NOTIS_CLI_CONFIG_FILE = configFile;
  const runtime = {
    apiBase: 'https://api-beta.notis.ai',
    profileName: 'default',
    credentialKind: 'oauth',
    oauthAccessToken: makeJwt('oauth-user', 1),
  };
  try {
    const refreshed = await refreshOAuthCredential(runtime, async (url, init) => {
      assert.equal(url, 'https://mcp.notis.ai/oauth/token');
      assert.equal(init.body.get('resource'), 'https://api.notis.ai/cli');
      return new Response(JSON.stringify({
        access_token: makeJwt('oauth-user'),
        refresh_token: 'rotated-refresh-token',
        expires_in: 3600,
        refresh_expires_in: 7200,
        scope: 'notis:read',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    assert.equal(refreshed, true);
    assert.equal(runtime.apiBase, 'https://api.notis.ai');
    assert.equal(runtime.oauthResource, 'https://api.notis.ai/cli');
    const stored = JSON.parse(readFileSync(configFile, 'utf-8')).profiles.default;
    // The refreshed grant is the authority on the endpoint: a profile is one
    // account on one API, and this token is only accepted by that one.
    assert.equal(stored.api_base, 'https://api.notis.ai');
    assert.equal(stored.oauth_api_base, 'https://api.notis.ai');
    assert.equal(stored.oauth_resource, 'https://api.notis.ai/cli');
  } finally {
    if (previousConfig === undefined) delete process.env.NOTIS_CLI_CONFIG_FILE;
    else process.env.NOTIS_CLI_CONFIG_FILE = previousConfig;
  }
});

test('OAuth refresh refuses an explicit API target owned by another grant', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-cli-oauth-target-'));
  const configFile = join(home, 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'default',
    profiles: {
      default: {
        oauth_access_token: makeJwt('oauth-user', 1),
        oauth_refresh_token: 'refresh-token',
        oauth_access_expires_at: 1,
        oauth_refresh_expires_at: future,
        oauth_client_id: 'notis_cli',
        oauth_issuer: 'https://mcp.notis.ai',
        oauth_api_base: 'https://api.notis.ai',
        oauth_resource: 'https://api.notis.ai/cli',
        oauth_scopes: ['notis:read'],
        oauth_user_id: 'oauth-user',
      },
    },
  }));
  const previousConfig = process.env.NOTIS_CLI_CONFIG_FILE;
  process.env.NOTIS_CLI_CONFIG_FILE = configFile;
  let fetchCalls = 0;
  try {
    await assert.rejects(
      refreshOAuthCredential({
        apiBase: 'https://api-beta.notis.ai',
        requestedApiBase: 'https://api-beta.notis.ai',
        profileName: 'default',
        credentialKind: 'oauth',
        oauthAccessToken: makeJwt('oauth-user', 1),
      }, async () => {
        fetchCalls += 1;
        return new Response('{}');
      }),
      (error) => error?.code === 'oauth_api_target_mismatch',
    );
    assert.equal(fetchCalls, 0);
  } finally {
    if (previousConfig === undefined) delete process.env.NOTIS_CLI_CONFIG_FILE;
    else process.env.NOTIS_CLI_CONFIG_FILE = previousConfig;
  }
});

test('OAuth refresh errors keep recovery commands on the failed named profile', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-cli-oauth-recovery-profile-'));
  const configFile = join(home, 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'default',
    profiles: {
      default: {},
      work: {
        oauth_access_token: makeJwt('oauth-user', 1),
        oauth_refresh_token: 'refresh-token',
        oauth_access_expires_at: 1,
        oauth_refresh_expires_at: future,
        oauth_client_id: 'notis_cli',
        oauth_issuer: 'https://mcp.notis.ai',
        oauth_api_base: 'https://api.notis.ai',
        oauth_resource: 'https://api.notis.ai/cli',
        oauth_scopes: ['notis:read'],
        oauth_user_id: 'oauth-user',
      },
    },
  }));
  const previousConfig = process.env.NOTIS_CLI_CONFIG_FILE;
  process.env.NOTIS_CLI_CONFIG_FILE = configFile;
  try {
    await assert.rejects(
      refreshOAuthCredential({
        apiBase: 'https://api.notis.ai',
        profileName: 'work',
        credentialKind: 'oauth',
        oauthAccessToken: makeJwt('oauth-user', 1),
      }, async () => new Response(JSON.stringify({ error: 'temporarily_unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })),
      (error) => {
        assert.equal(error.code, 'temporarily_unavailable');
        assert.equal(
          error.hints[0].command,
          "npx --package @notis_ai/cli@latest -- notis login --profile 'work'",
        );
        assert.equal(
          error.hints[2].command,
          "npx --package @notis_ai/cli@latest -- notis doctor --profile 'work'",
        );
        return true;
      },
    );
  } finally {
    if (previousConfig === undefined) delete process.env.NOTIS_CLI_CONFIG_FILE;
    else process.env.NOTIS_CLI_CONFIG_FILE = previousConfig;
  }
});

// A worktree profile is authenticated by the running ./dev.sh. Authorizing a
// browser grant over it would swap a scoped test identity for a real account
// and silently point local testing at the wrong user.
test('login refuses to authorize over a dev.sh-managed profile', async () => {
  await assert.rejects(
    loginWithOAuth({
      credentialKind: 'worktree',
      jwt: makeJwt('dev-user'),
      config: normalizeConfig({}),
      profileName: 'dev-worktree',
      apiBase: 'http://localhost:4311',
    }, {}, null, async () => {
      throw new Error('discovery must not run');
    }),
    (error) => error?.code === 'oauth_profile_is_dev_managed',
  );
});

test('login refuses to redeem a pending code into a dev.sh-managed profile', async () => {
  let exchangeAttempted = false;
  await assert.rejects(
    loginWithOAuth({
      credentialKind: 'worktree',
      jwt: makeJwt('dev-user'),
      config: normalizeConfig({}),
      profileName: 'dev-worktree',
      apiBase: 'http://localhost:4311',
    }, { code: 'authorization-code' }, null, async () => {
      exchangeAttempted = true;
      throw new Error('code exchange must not run');
    }),
    (error) => error?.code === 'oauth_profile_is_dev_managed',
  );
  assert.equal(exchangeAttempted, false);
});

// Adding a second account must not require signing the first one out, so an
// already-authorized profile is no reason to skip a login for another one.
test('login authorizes a named profile even when another profile is signed in', async () => {
  let discoveryAttempted = false;
  await assert.rejects(
    loginWithOAuth({
      credentialKind: 'oauth',
      jwt: makeJwt('oauth-user'),
      config: normalizeConfig({
        current_profile: 'default',
        profiles: {
          default: { oauth_access_token: makeJwt('oauth-user'), oauth_access_expires_at: future },
          work: {},
        },
      }),
      profileName: 'work',
      apiBase: 'https://api.example.com',
    }, {}, null, async () => {
      discoveryAttempted = true;
      throw new Error('forced OAuth discovery');
    }),
    /forced OAuth discovery/,
  );
  assert.equal(discoveryAttempted, true);
});

test('loopback receiver validates Host and state, sends no-referrer HTML, and consumes once', async () => {
  const receiver = await createLoopbackReceiver({
    state: 'expected-state',
    timeoutMs: 5000,
    portalOrigin: 'https://portal.notis.test',
  });
  try {
    const foreignHost = await httpGet(
      `${receiver.redirectUri}?code=bad&state=expected-state`,
      { Host: 'attacker.example' },
    );
    assert.equal(foreignHost.status, 400);

    const codePromise = receiver.waitForCode();
    const acceptedPromise = httpGet(`${receiver.redirectUri}?code=oauth-code&state=expected-state`);
    assert.equal(await codePromise, 'oauth-code');
    const beforeCompletion = await Promise.race([
      acceptedPromise.then(() => 'responded'),
      new Promise((resolvePromise) => setTimeout(() => resolvePromise('pending'), 20)),
    ]);
    assert.equal(beforeCompletion, 'pending');
    receiver.complete();
    const accepted = await acceptedPromise;
    assert.equal(accepted.status, 302);
    assert.equal(accepted.headers['referrer-policy'], 'no-referrer');
    assert.equal(accepted.headers['x-frame-options'], 'DENY');
    assert.equal(accepted.headers.location, 'https://portal.notis.test/cli-connected');
    assert.match(accepted.body, /name="referrer" content="no-referrer"/);
    assert.match(accepted.body, /Notis CLI is connected/);
    assert.match(accepted.body, /Sync agent skills/);
    assert.match(accepted.body, /Control your computer/);
    assert.match(accepted.body, /Connect local MCP/);
    assert.match(accepted.body, /Approve local actions/);
    assert.match(accepted.body, /Download Notis Desktop/);
    assert.match(accepted.body, /Open Web App/);
    assert.match(accepted.body, /Quick login to Notis Desktop/);
    assert.match(
      accepted.body,
      /https:\/\/portal\.notis\.test\/desktop-quick-login\?redirect=%2Fmanage/,
    );
    assert.doesNotMatch(accepted.body, /oauth-code|expected-state/);
    const repeated = await httpGet(`${receiver.redirectUri}?code=again&state=expected-state`);
    assert.equal(repeated.status, 410);
  } finally {
    await receiver.close();
  }
});

test('loopback receiver closes while a browser holds a speculative connection', async () => {
  const receiver = await createLoopbackReceiver({
    state: 'expected-state',
    timeoutMs: 5000,
    portalOrigin: 'https://portal.notis.test',
  });
  // Chrome opens a spare connection alongside the callback navigation and never
  // sends a request on it. Node treats it as an active connection, so a
  // `server.close()` that waits for it would hang a login that already worked.
  const speculative = createConnection({ port: receiver.port, host: '127.0.0.1' });
  await once(speculative, 'connect');
  try {
    const codePromise = receiver.waitForCode();
    const responsePromise = httpGet(`${receiver.redirectUri}?code=oauth-code&state=expected-state`);
    assert.equal(await codePromise, 'oauth-code');
    receiver.complete();
    assert.equal((await responsePromise).status, 302);

    const startedAt = Date.now();
    await Promise.race([
      receiver.close(),
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('close() waited on the speculative connection')), 4000)
          .unref?.();
      }),
    ]);
    assert.ok(Date.now() - startedAt < 4000);
  } finally {
    speculative.destroy();
  }
});

test('loopback receiver never claims connection when token exchange cannot finish', async () => {
  const receiver = await createLoopbackReceiver({
    state: 'expected-state',
    timeoutMs: 5000,
    portalOrigin: 'https://portal.notis.test',
  });
  try {
    const codePromise = receiver.waitForCode();
    const responsePromise = httpGet(
      `${receiver.redirectUri}?code=oauth-code&state=expected-state`,
    );
    assert.equal(await codePromise, 'oauth-code');
    receiver.fail();
    const response = await responsePromise;
    assert.equal(response.status, 400);
    assert.equal(response.headers.location, undefined);
    assert.doesNotMatch(response.body, /Notis CLI is connected|terminal is ready/);
    assert.match(response.body, /could not finish signing in/i);
  } finally {
    await receiver.close();
  }
});

test('loopback receiver rejects a state mismatch', async () => {
  const receiver = await createLoopbackReceiver({ state: 'expected-state', timeoutMs: 5000 });
  try {
    const resultPromise = receiver.waitForCode();
    const rejection = assert.rejects(
      resultPromise,
      (error) => error?.code === 'oauth_state_mismatch',
    );
    const response = await httpGet(`${receiver.redirectUri}?code=oauth-code&state=wrong-state`);
    assert.equal(response.status, 400);
    await rejection;
  } finally {
    await receiver.close();
  }
});

test('CLI discovery consumes the dedicated protected-resource metadata', async () => {
  const calls = [];
  const metadata = await discoverCliOAuth('https://api.notis.ai', async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/.well-known/oauth-protected-resource/cli')) {
      return new Response(JSON.stringify({
        resource: 'https://api.notis.ai',
        authorization_servers: ['https://api.notis.ai'],
        notis_cli_client_id: 'notis_cli',
        notis_cli_copy_paste_redirect_uri: 'https://app.notis.ai/cli-setup/code/bootstrap',
      }));
    }
    return new Response(JSON.stringify({
      authorization_endpoint: 'https://api.notis.ai/oauth/authorize',
      token_endpoint: 'https://api.notis.ai/oauth/token',
      revocation_endpoint: 'https://api.notis.ai/oauth/revoke',
    }));
  });

  assert.equal(metadata.resource, 'https://api.notis.ai');
  assert.equal(metadata.clientId, 'notis_cli');
  assert.equal(metadata.copyPasteRedirectUri, 'https://app.notis.ai/cli-setup/code/bootstrap');
  assert.deepEqual(calls, [
    'https://api.notis.ai/.well-known/oauth-protected-resource/cli',
    'https://api.notis.ai/.well-known/oauth-authorization-server',
  ]);
});

test('agent login emits an authorization URL and exits without waiting for input', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/.well-known/oauth-protected-resource/cli')) {
      return new Response(JSON.stringify({
        resource: 'https://api.notis.ai',
        authorization_servers: ['https://api.notis.ai'],
        notis_cli_client_id: 'notis_cli',
        notis_cli_copy_paste_redirect_uri: 'https://app.notis.ai/cli-setup/code/bootstrap',
      }));
    }
    return new Response(JSON.stringify({
      authorization_endpoint: 'https://api.notis.ai/oauth/authorize',
      token_endpoint: 'https://api.notis.ai/oauth/token',
      revocation_endpoint: 'https://api.notis.ai/oauth/revoke',
    }));
  };
  const result = await loginWithOAuth({
    agentMode: true,
    apiBase: 'https://api.notis.ai',
    profileName: 'default',
    config: normalizeConfig({}),
    config_file: join(mkdtempSync(join(tmpdir(), 'notis-oauth-')), 'config.json'),
  }, {}, null, fetchImpl);

  const authorizeUrl = new URL(result.agentAuthorization.authorize_url);
  assert.equal(authorizeUrl.searchParams.get('client_id'), 'notis_cli');
  assert.equal(authorizeUrl.searchParams.get('resource'), 'https://api.notis.ai');
  assert.equal(authorizeUrl.searchParams.get('redirect_uri'), 'https://app.notis.ai/cli-setup/code/bootstrap');
  assert.equal(authorizeUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.deepEqual(
    authorizeUrl.searchParams.get('scope').split(' '),
    ['notis:read', 'notis:write', 'notis:connections', 'notis:apps'],
  );
});

test('JSON login also emits an authorization URL without opening or waiting', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/.well-known/oauth-protected-resource/cli')) {
      return new Response(JSON.stringify({
        resource: 'https://api.notis.ai/cli',
        authorization_servers: ['https://mcp.notis.ai'],
        notis_cli_client_id: 'notis_cli',
        notis_cli_copy_paste_redirect_uri: 'https://app.notis.ai/cli-setup/code/bootstrap',
      }));
    }
    return new Response(JSON.stringify({
      authorization_endpoint: 'https://mcp.notis.ai/oauth/authorize',
      token_endpoint: 'https://mcp.notis.ai/oauth/token',
      revocation_endpoint: 'https://mcp.notis.ai/oauth/revoke',
    }));
  };
  const result = await loginWithOAuth({
    agentMode: false,
    outputMode: 'json',
    apiBase: 'https://api.notis.ai',
    profileName: 'default',
    config: normalizeConfig({}),
    config_file: join(mkdtempSync(join(tmpdir(), 'notis-oauth-')), 'config.json'),
  }, {}, null, fetchImpl);

  assert.match(result.agentAuthorization.authorize_url, /^https:\/\/mcp\.notis\.ai\/oauth\/authorize/);
});

test('interactive loopback login closes its listener after timeout', async () => {
  let authorizeUrl = null;
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/.well-known/oauth-protected-resource/cli')) {
      return new Response(JSON.stringify({
        resource: 'https://api.notis.ai/cli',
        authorization_servers: ['https://mcp.notis.ai'],
        notis_cli_client_id: 'notis_cli',
        notis_cli_copy_paste_redirect_uri: 'https://app.notis.ai/cli-setup/code/bootstrap',
      }));
    }
    return new Response(JSON.stringify({
      authorization_endpoint: 'https://mcp.notis.ai/oauth/authorize',
      token_endpoint: 'https://mcp.notis.ai/oauth/token',
      revocation_endpoint: 'https://mcp.notis.ai/oauth/revoke',
    }));
  };

  await assert.rejects(
    loginWithOAuth({
      agentMode: false,
      outputMode: 'table',
      apiBase: 'https://api.notis.ai',
      profileName: 'default',
      config: normalizeConfig({}),
    }, {
      browser: false,
      printUrl: true,
      timeoutMs: 20,
    }, {
      note(message) {
        authorizeUrl = message.replace(/^Authorize Notis CLI: /, '');
      },
    }, fetchImpl),
    (error) => error?.code === 'oauth_timeout',
  );
  const redirectUri = new URL(authorizeUrl).searchParams.get('redirect_uri');
  await assert.rejects(httpGet(redirectUri));
});

test('concurrent CLI processes serialize refresh and reuse the rotated credential', async () => {
  let tokenCalls = 0;
  const server = createServer(async (req, res) => {
    if (req.url === '/.well-known/oauth-protected-resource/cli') {
      const origin = `http://127.0.0.1:${server.address().port}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        resource: origin,
        authorization_servers: [origin],
        notis_cli_client_id: 'notis_cli',
        notis_cli_copy_paste_redirect_uri: 'https://app.notis.ai/cli-setup/code/bootstrap',
      }));
      return;
    }
    if (req.url === '/.well-known/oauth-authorization-server') {
      const origin = `http://127.0.0.1:${server.address().port}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        revocation_endpoint: `${origin}/oauth/revoke`,
      }));
      return;
    }
    if (req.url === '/oauth/token' && req.method === 'POST') {
      tokenCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 75));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        access_token: makeJwt('oauth-user'),
        refresh_token: 'rotated-refresh-token',
        expires_in: 3600,
        refresh_expires_in: 7200,
        scope: 'notis:read notis:write notis:connections notis:apps',
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const home = mkdtempSync(join(tmpdir(), 'notis-cli-refresh-lock-'));
  const configDir = join(home, '.notis');
  mkdirSync(configDir, { recursive: true });
  const origin = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    current_profile: 'default',
    profiles: {
      default: {
        api_base: origin,
        oauth_access_token: 'expired-access-token',
        oauth_refresh_token: 'refresh-token',
        oauth_access_expires_at: 1,
        oauth_refresh_expires_at: future,
        oauth_client_id: 'notis_cli',
        oauth_issuer: origin,
        oauth_scopes: ['notis:read'],
        oauth_user_id: 'oauth-user',
      },
    },
  }));

  const oauthModule = new URL('../src/runtime/oauth.js', import.meta.url).href;
  const script = `
    import { refreshOAuthCredential } from ${JSON.stringify(oauthModule)};
    const runtime = {
      apiBase: ${JSON.stringify(origin)},
      profileName: 'default',
      credentialKind: 'oauth',
      oauthAccessToken: 'expired-access-token',
      oauthRefreshToken: 'refresh-token',
    };
    const refreshed = await refreshOAuthCredential(runtime);
    process.stdout.write(JSON.stringify({ refreshed, token: runtime.oauthAccessToken }));
  `;
  try {
    const options = {
      cwd: home,
      env: { PATH: process.env.PATH, HOME: home, NODE_ENV: 'test' },
      encoding: 'utf-8',
    };
    const [first, second] = await Promise.all([
      execFileAsync(process.execPath, ['--input-type=module', '-e', script], options),
      execFileAsync(process.execPath, ['--input-type=module', '-e', script], options),
    ]);
    assert.equal(JSON.parse(first.stdout).refreshed, true);
    assert.equal(JSON.parse(second.stdout).refreshed, true);
    assert.equal(tokenCalls, 1);
    const stored = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'));
    assert.equal(stored.profiles.default.oauth_refresh_token, 'rotated-refresh-token');
    assert.equal(stored.profiles.default.oauth_access_token, makeJwt('oauth-user'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an OAuth 401 refreshes the rotating pair and retries exactly once', async () => {
  let protectedCalls = 0;
  let tokenCalls = 0;
  const freshToken = makeJwt('oauth-user');
  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (req.url === '/.well-known/oauth-protected-resource/cli') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        resource: origin,
        authorization_servers: [origin],
        notis_cli_client_id: 'notis_cli',
        notis_cli_copy_paste_redirect_uri: 'https://app.notis.ai/cli-setup/code/bootstrap',
      }));
      return;
    }
    if (req.url === '/.well-known/oauth-authorization-server') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        revocation_endpoint: `${origin}/oauth/revoke`,
      }));
      return;
    }
    if (req.url === '/oauth/token' && req.method === 'POST') {
      tokenCalls += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        access_token: freshToken,
        refresh_token: 'rotated-refresh-token',
        expires_in: 3600,
        refresh_expires_in: 7200,
        scope: 'notis:read',
      }));
      return;
    }
    if (req.url === '/probe') {
      protectedCalls += 1;
      const authorized = req.headers.authorization === `Bearer ${freshToken}`;
      res.writeHead(authorized ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(authorized ? { ok: true } : { error: 'expired' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const home = mkdtempSync(join(tmpdir(), 'notis-cli-401-refresh-'));
  const configDir = join(home, '.notis');
  mkdirSync(configDir, { recursive: true });
  const origin = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    current_profile: 'default',
    profiles: {
      default: {
        api_base: origin,
        oauth_access_token: 'server-rejected-access-token',
        oauth_refresh_token: 'refresh-token',
        oauth_access_expires_at: future,
        oauth_refresh_expires_at: future,
        oauth_client_id: 'notis_cli',
        oauth_issuer: origin,
        oauth_scopes: ['notis:read'],
        oauth_user_id: 'oauth-user',
      },
    },
  }));

  const transportModule = new URL('../src/runtime/transport.js', import.meta.url).href;
  const script = `
    import { httpRequest } from ${JSON.stringify(transportModule)};
    const runtime = {
      apiBase: ${JSON.stringify(origin)},
      profileName: 'default',
      jwt: 'server-rejected-access-token',
      credentialKind: 'oauth',
      credentialSource: 'oauth',
      oauthAccessToken: 'server-rejected-access-token',
      oauthRefreshToken: 'refresh-token',
      oauthAccessExpiresAt: ${future},
      timeoutMs: 5000,
      cliVersion: 'test',
    };
    const result = await httpRequest({
      runtime,
      method: 'GET',
      path: '/probe',
      requireAuth: true,
    });
    process.stdout.write(JSON.stringify({ payload: result.payload, token: runtime.jwt }));
  `;
  try {
    const result = await execFileAsync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        cwd: home,
        env: { PATH: process.env.PATH, HOME: home, NODE_ENV: 'test' },
        encoding: 'utf-8',
      },
    );
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.payload, { ok: true });
    assert.equal(payload.token, freshToken);
    assert.equal(protectedCalls, 2);
    assert.equal(tokenCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('OAuth config writes are atomic and leave one complete JSON file', () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-cli-atomic-'));
  const configFile = join(home, 'config.json');
  const normalized = normalizeConfig({
    oauth_access_token: makeJwt(),
    oauth_refresh_token: 'refresh-token',
    oauth_access_expires_at: future,
  });
  withConfigFile(configFile, () => saveConfig(normalized));

  assert.deepEqual(
    normalizeConfig(JSON.parse(readFileSync(configFile, 'utf-8'))),
    normalized,
  );
});

// Authorizing one profile rewrites the shared config every other profile lives
// in. Losing a sibling's credential to that write is the exact failure the
// profile model exists to prevent.
test('authorizing one profile leaves every other profile signed in', () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-cli-config-merge-'));
  const configFile = join(home, 'config.json');
  withConfigFile(configFile, () => {
    saveConfig(normalizeConfig({
      current_profile: 'default',
      profiles: {
        default: { oauth_access_token: makeJwt('first-user'), oauth_access_expires_at: future },
        dev: { dev_access_token: makeJwt('dev-user'), api_base: 'http://localhost:4311' },
      },
    }));

    updateConfig((config) => {
      const next = ensureProfile(config, 'work');
      next.profiles.work.oauth_access_token = makeJwt('second-user');
      next.profiles.work.oauth_access_expires_at = future;
      return next;
    });
  });

  const saved = JSON.parse(readFileSync(configFile, 'utf8'));
  assert.equal(saved.profiles.default.oauth_access_token, makeJwt('first-user'));
  assert.equal(saved.profiles.dev.dev_access_token, makeJwt('dev-user'));
  assert.equal(saved.profiles.work.oauth_access_token, makeJwt('second-user'));
});

// A non-TTY login cannot block on a terminal, so the process that builds the
// authorize URL exits before the browser hand-off completes. The PKCE verifier
// has to survive that exit or the code the user is handed is unusable.
test('a non-interactive login can be completed later with the browser code', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-')), 'config.json');
  const tokenCalls = [];
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/.well-known/oauth-protected-resource/cli')) {
      return new Response(JSON.stringify({
        resource: 'https://api.notis.ai/cli',
        authorization_servers: ['https://api.notis.ai'],
        notis_cli_client_id: 'notis_cli',
        notis_cli_copy_paste_redirect_uri: 'https://app.notis.ai/cli-setup/code/bootstrap',
      }));
    }
    if (String(url).endsWith('/oauth/token')) {
      tokenCalls.push(new URLSearchParams(init.body));
      return new Response(JSON.stringify({
        access_token: makeJwt('oauth-user'),
        refresh_token: 'refresh-token',
        expires_in: 900,
        scope: 'notis:read notis:write',
      }));
    }
    return new Response(JSON.stringify({
      authorization_endpoint: 'https://api.notis.ai/oauth/authorize',
      token_endpoint: 'https://api.notis.ai/oauth/token',
      revocation_endpoint: 'https://api.notis.ai/oauth/revoke',
    }));
  };

  const started = await loginWithOAuth({
    agentMode: true,
    apiBase: 'https://api.notis.ai',
    profileName: 'default',
    config: normalizeConfig({}),
    config_file: configFile,
  }, {}, null, fetchImpl);
  const challenge = new URL(started.agentAuthorization.authorize_url)
    .searchParams.get('code_challenge');
  assert.equal(
    started.agentAuthorization.redeem_command,
    "npx --package @notis_ai/cli@latest -- notis --profile 'default' login --code <code>",
  );

  // A separate invocation, exactly as the user would run it after authorizing.
  const redeemed = await loginWithOAuth({
    agentMode: true,
    apiBase: 'https://api.notis.ai',
    profileName: 'default',
    config: normalizeConfig({}),
    config_file: configFile,
  }, { code: 'browser-code' }, null, fetchImpl);

  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].get('code'), 'browser-code');
  assert.equal(tokenCalls[0].get('redirect_uri'), 'https://app.notis.ai/cli-setup/code/bootstrap');
  assert.equal(
    createHash('sha256').update(tokenCalls[0].get('code_verifier')).digest('base64url'),
    challenge,
  );
  assert.equal(redeemed.profile.oauth_user_id, 'oauth-user');

  // The single-use verifier must not survive a successful exchange.
  await assert.rejects(
    loginWithOAuth({
      agentMode: true,
      apiBase: 'https://api.notis.ai',
      profileName: 'default',
      config: normalizeConfig({}),
      config_file: configFile,
    }, { code: 'browser-code' }, null, fetchImpl),
    (error) => error?.code === 'oauth_pending_login_missing',
  );
});

test('retrying a pending non-interactive login reuses its PKCE authorization', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-retry-')), 'config.json');
  const tokenCalls = [];
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/.well-known/oauth-protected-resource/cli')) {
      return new Response(JSON.stringify({
        resource: 'https://api.notis.ai/cli',
        authorization_servers: ['https://api.notis.ai'],
        notis_cli_client_id: 'notis_cli',
        notis_cli_copy_paste_redirect_uri: 'https://app.notis.ai/cli-setup/code/bootstrap',
      }));
    }
    if (String(url).endsWith('/oauth/token')) {
      tokenCalls.push(new URLSearchParams(init.body));
      return new Response(JSON.stringify({
        access_token: makeJwt('oauth-user'),
        refresh_token: 'refresh-token',
        expires_in: 900,
        scope: 'notis:read notis:write',
      }));
    }
    return new Response(JSON.stringify({
      authorization_endpoint: 'https://api.notis.ai/oauth/authorize',
      token_endpoint: 'https://api.notis.ai/oauth/token',
      revocation_endpoint: 'https://api.notis.ai/oauth/revoke',
    }));
  };
  const runtime = () => ({
    agentMode: true,
    apiBase: 'https://api.notis.ai',
    profileName: 'default',
    config: normalizeConfig({}),
    config_file: configFile,
  });

  const first = await loginWithOAuth(runtime(), {}, null, fetchImpl);
  const retried = await loginWithOAuth(runtime(), {}, null, fetchImpl);
  assert.equal(retried.agentAuthorization.authorize_url, first.agentAuthorization.authorize_url);
  assert.ok(retried.agentAuthorization.expires_in <= first.agentAuthorization.expires_in);

  await loginWithOAuth(runtime(), { code: 'first-browser-code' }, null, fetchImpl);
  const originalChallenge = new URL(first.agentAuthorization.authorize_url)
    .searchParams.get('code_challenge');
  assert.equal(tokenCalls.length, 1);
  assert.equal(
    createHash('sha256').update(tokenCalls[0].get('code_verifier')).digest('base64url'),
    originalChallenge,
  );
});

test('pending non-interactive logins remain isolated by profile', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-')), 'config.json');
  const challenges = new Map();
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/.well-known/oauth-protected-resource/cli')) {
      return new Response(JSON.stringify({
        resource: 'https://api.notis.ai/cli',
        authorization_servers: ['https://api.notis.ai'],
        notis_cli_client_id: 'notis_cli',
        notis_cli_copy_paste_redirect_uri: 'https://app.notis.ai/cli-setup/code/bootstrap',
      }));
    }
    if (String(url).endsWith('/oauth/token')) {
      const body = new URLSearchParams(init.body);
      challenges.set(
        body.get('code'),
        createHash('sha256').update(body.get('code_verifier')).digest('base64url'),
      );
      return new Response(JSON.stringify({
        access_token: makeJwt(body.get('code')),
        refresh_token: `refresh-${body.get('code')}`,
        expires_in: 900,
        scope: 'notis:read notis:write',
      }));
    }
    return new Response(JSON.stringify({
      authorization_endpoint: 'https://api.notis.ai/oauth/authorize',
      token_endpoint: 'https://api.notis.ai/oauth/token',
      revocation_endpoint: 'https://api.notis.ai/oauth/revoke',
    }));
  };
  const runtime = (profileName) => ({
    agentMode: true,
    apiBase: 'https://api.notis.ai',
    profileName,
    config: normalizeConfig({}),
    config_file: configFile,
  });

  const first = await loginWithOAuth(runtime('first'), {}, null, fetchImpl);
  const second = await loginWithOAuth(runtime('second'), {}, null, fetchImpl);
  assert.match(first.agentAuthorization.redeem_command, /--profile 'first'/);
  assert.match(second.agentAuthorization.redeem_command, /--profile 'second'/);

  await loginWithOAuth(runtime('first'), { code: 'first-code' }, null, fetchImpl);
  await loginWithOAuth(runtime('second'), { code: 'second-code' }, null, fetchImpl);

  assert.equal(
    challenges.get('first-code'),
    new URL(first.agentAuthorization.authorize_url).searchParams.get('code_challenge'),
  );
  assert.equal(
    challenges.get('second-code'),
    new URL(second.agentAuthorization.authorize_url).searchParams.get('code_challenge'),
  );
});
