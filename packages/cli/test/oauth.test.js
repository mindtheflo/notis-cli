import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  credentialIsExpired,
  ensureProfile,
  getProfile,
  loadConfig,
  normalizeConfig,
  resolveRuntimeProfile,
  saveConfig,
  updateConfig,
} from '../src/runtime/profiles.js';
import {
  DEFAULT_CLI_OAUTH_SCOPES,
  browserOpenCommand,
  createLoopbackReceiver,
  discoverCliOAuth,
  acquireListenerGlobalLock,
  clearListenerState,
  listenerProcessIsAlive,
  listenerChildEnvironment,
  loopbackReachesTheUsersBrowser,
  loginWithOAuth,
  logoutOAuth,
  refreshOAuthCredential,
  releaseListenerGlobalLock,
  runDetachedLoginListener,
  stopPendingListener,
} from '../src/runtime/oauth.js';
import {
  authCommandSpecs,
  loginAgentAuthorizationPresentation,
  logoutHumanSummary,
} from '../src/command-specs/auth.js';
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

test('machine output can emit the authorization URL on stderr before login waits', async () => {
  assert.equal(typeof OutputManager.prototype.note, 'function');
  assert.equal(typeof OutputManager.prototype.notice, 'function');
  const outputModule = new URL('../src/runtime/output.js', import.meta.url).href;
  const result = await execFileAsync(process.execPath, [
    '--input-type=module',
    '-e',
    `import { OutputManager } from ${JSON.stringify(outputModule)}; new OutputManager({ outputMode: 'json' }).notice('Authorize Notis CLI: https://example.test');`,
  ]);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Authorize Notis CLI: https://example.test\n');
});

test('a Notis Vercel sandbox never sends the user browser to its private loopback', () => {
  assert.equal(
    loopbackReachesTheUsersBrowser(
      {},
      (path) => path === '/vercel/sandbox',
    ),
    false,
  );
});

test('unknown headless Linux hosts fail closed to the code handoff', () => {
  assert.equal(loopbackReachesTheUsersBrowser({}, () => false, 'linux'), false);
  assert.equal(
    loopbackReachesTheUsersBrowser({ CI: 'true', DISPLAY: ':0' }, () => false, 'linux'),
    false,
  );
  assert.equal(
    loopbackReachesTheUsersBrowser({ WAYLAND_DISPLAY: 'wayland-0' }, () => false, 'linux'),
    true,
  );
  assert.equal(loopbackReachesTheUsersBrowser({}, () => false, 'darwin'), true);
});

test('disabled remote-environment flags do not hide a reachable local loopback', () => {
  const disabledMarkers = {
    CI: 'false',
    GITHUB_ACTIONS: '0',
    VERCEL: 'off',
    RENDER: 'NO',
  };
  assert.equal(loopbackReachesTheUsersBrowser(disabledMarkers, () => false, 'darwin'), true);
  assert.equal(
    loopbackReachesTheUsersBrowser(
      { ...disabledMarkers, DISPLAY: ':0' },
      () => false,
      'linux',
    ),
    true,
  );
  assert.equal(loopbackReachesTheUsersBrowser({ CI: 'true' }, () => false, 'darwin'), false);
  assert.equal(loopbackReachesTheUsersBrowser({ VERCEL: '1' }, () => false, 'darwin'), false);
});

test('the global listener lock stays live through slow work and releases by owner', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-global-lock-')), 'config.json');
  await withConfigFileAsync(configFile, async () => {
    const first = await acquireListenerGlobalLock({
      staleMs: 40,
      waitMs: 500,
      heartbeatMs: 10,
    });
    let secondAcquired = false;
    const secondPromise = acquireListenerGlobalLock({
      staleMs: 40,
      waitMs: 500,
      heartbeatMs: 10,
    }).then((lock) => {
      secondAcquired = true;
      return lock;
    });
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.equal(secondAcquired, false, 'a heartbeat must prevent stealing a live lock');
    releaseListenerGlobalLock(first);
    const second = await secondPromise;
    releaseListenerGlobalLock(first);
    assert.equal(existsSync(second.lockDir), true, 'an old owner must not remove its successor');
    releaseListenerGlobalLock(second);
  });
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

test('OAuth refresh revokes a rotated grant when local persistence fails', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-cli-oauth-refresh-persist-failure-'));
  const configFile = join(home, 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'default',
    profiles: {
      default: {
        api_base: 'https://api.notis.ai',
        oauth_access_token: makeJwt('oauth-user', 1),
        oauth_refresh_token: 'old-refresh-token',
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
  const revoked = [];
  try {
    await assert.rejects(refreshOAuthCredential({
      apiBase: 'https://api.notis.ai',
      profileName: 'default',
      credentialKind: 'oauth',
      oauthAccessToken: makeJwt('oauth-user', 1),
    }, async (url, init) => {
      if (String(url).endsWith('/oauth/token')) {
        rmSync(configFile);
        mkdirSync(configFile);
        return new Response(JSON.stringify({
          access_token: makeJwt('oauth-user'),
          refresh_token: 'rotated-unpersisted-refresh',
          expires_in: 3600,
          refresh_expires_in: 7200,
          scope: 'notis:read',
        }));
      }
      if (String(url).endsWith('/oauth/revoke')) {
        revoked.push(new URLSearchParams(init.body).get('token'));
        return new Response('{}');
      }
      throw new Error(`Unexpected URL: ${url}`);
    }));
    assert.deepEqual(revoked, ['rotated-unpersisted-refresh']);
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

test('a detached callback failure gives browser-visible retry guidance', async () => {
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
    receiver.fail({ detached: true });
    const response = await responsePromise;
    assert.equal(response.status, 400);
    assert.match(response.body, /start sign in again from your agent or terminal/i);
    assert.doesNotMatch(response.body, /return to the terminal for details/i);
  } finally {
    await receiver.close();
  }
});

test('a state mismatch does not consume the legitimate loopback callback', async () => {
  const receiver = await createLoopbackReceiver({ state: 'expected-state', timeoutMs: 5000 });
  try {
    const resultPromise = receiver.waitForCode();
    const invalid = await httpGet(`${receiver.redirectUri}?code=wrong-code&state=wrong-state`);
    assert.equal(invalid.status, 400);
    const validResponse = httpGet(
      `${receiver.redirectUri}?code=oauth-code&state=expected-state`,
    );
    assert.equal(await resultPromise, 'oauth-code');
    receiver.complete();
    assert.equal((await validResponse).status, 302);
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
  }, { mode: 'code' }, null, fetchImpl);

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
  }, { mode: 'code' }, null, fetchImpl);

  assert.match(result.agentAuthorization.authorize_url, /^https:\/\/mcp\.notis\.ai\/oauth\/authorize/);
});

test('interactive loopback login closes its listener after timeout', async () => {
  let authorizeUrl = null;
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-interactive-timeout-')), 'config.json');
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
    withConfigFileAsync(configFile, () => loginWithOAuth({
        agentMode: false,
        outputMode: 'table',
        apiBase: 'https://api.notis.ai',
        profileName: 'default',
        config: normalizeConfig({}),
        config_file: configFile,
      }, {
        browser: false,
        printUrl: true,
        timeoutMs: 20,
      }, {
        note(message) {
          authorizeUrl = message.replace(/^Authorize Notis CLI: /, '');
        },
      }, fetchImpl)),
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
test('login pins the release channel the deployment advertises', async () => {
  // Hermetic: resolveConfigFile honours this env var, so the assertions below
  // never depend on (or rewrite) the developer's real ~/.notis/config.json.
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-')), 'config.json');
  const previousConfigFile = process.env.NOTIS_CLI_CONFIG_FILE;
  process.env.NOTIS_CLI_CONFIG_FILE = configFile;
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/.well-known/oauth-protected-resource/cli')) {
      return new Response(JSON.stringify({
        resource: 'https://api-beta.notis.ai/cli',
        authorization_servers: ['https://api-beta.notis.ai'],
        notis_cli_client_id: 'notis_cli',
        notis_cli_copy_paste_redirect_uri: 'https://beta.notis.ai/cli-setup/code/bootstrap',
        notis_cli_channel: 'beta',
      }));
    }
    if (String(url).endsWith('/oauth/token')) {
      return new Response(JSON.stringify({
        access_token: makeJwt('beta-user'),
        refresh_token: 'refresh-token',
        expires_in: 900,
        scope: 'notis:read notis:write',
      }));
    }
    return new Response(JSON.stringify({
      authorization_endpoint: 'https://api-beta.notis.ai/oauth/authorize',
      token_endpoint: 'https://api-beta.notis.ai/oauth/token',
      revocation_endpoint: 'https://api-beta.notis.ai/oauth/revoke',
    }));
  };

  try {
    const runtime = {
      agentMode: true,
      apiBase: 'https://api-beta.notis.ai',
      profileName: 'beta-channel-test',
      config: normalizeConfig({}),
    };
    const started = await loginWithOAuth(runtime, { mode: 'code' }, null, fetchImpl);
    // Even the command the user is told to paste back belongs to the channel
    // they just authorized against.
    assert.match(started.agentAuthorization.redeem_command, /@notis_ai\/cli@beta/);

    const redeemed = await loginWithOAuth(runtime, { code: 'browser-code' }, null, fetchImpl);
    assert.equal(redeemed.profile.channel, 'beta');
    assert.equal(
      getProfile(loadConfig(), 'beta-channel-test').channel,
      'beta',
    );
  } finally {
    if (previousConfigFile === undefined) delete process.env.NOTIS_CLI_CONFIG_FILE;
    else process.env.NOTIS_CLI_CONFIG_FILE = previousConfigFile;
  }
});

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
  }, { mode: 'code' }, null, fetchImpl);
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

test('a code redemption persistence failure revokes the issued grant and keeps the retry state', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-oauth-code-persist-failure-'));
  const configFile = join(home, 'config.json');
  const revoked = [];
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/oauth/token')) {
      return new Response(JSON.stringify({
        access_token: makeJwt('unpersisted-code-user'),
        refresh_token: 'unpersisted-code-refresh',
        expires_in: 900,
      }));
    }
    if (String(url).endsWith('/oauth/revoke')) {
      revoked.push(new URLSearchParams(init.body).get('token'));
      return new Response('{}');
    }
    return cliMetadataFetch()(url, init);
  };

  await withConfigFileAsync(configFile, async () => {
    const started = await loginWithOAuth(
      loginRuntime({ outputMode: 'json', config_file: configFile }),
      { mode: 'code' },
      null,
      fetchImpl,
    );
    const authorizeUrl = started.agentAuthorization.authorize_url;
    assert.equal(existsSync(pendingAuthorizationPath(configFile)), true);
    mkdirSync(configFile);
    await assert.rejects(
      loginWithOAuth(
        loginRuntime({ outputMode: 'json', config_file: configFile }),
        { code: 'browser-code' },
        null,
        fetchImpl,
      ),
    );
    assert.equal(existsSync(pendingAuthorizationPath(configFile)), true);
    rmSync(configFile, { recursive: true });
    const retried = await loginWithOAuth(
      loginRuntime({ outputMode: 'json', config_file: configFile }),
      { mode: 'code' },
      null,
      fetchImpl,
    );
    assert.equal(retried.agentAuthorization.authorize_url, authorizeUrl);
    const redeemed = await loginWithOAuth(
      loginRuntime({ outputMode: 'json', config_file: configFile }),
      { code: 'fresh-browser-code' },
      null,
      fetchImpl,
    );
    assert.equal(redeemed.profile.oauth_user_id, 'unpersisted-code-user');
    assert.equal(existsSync(pendingAuthorizationPath(configFile)), false);
  });
  assert.deepEqual(revoked, ['unpersisted-code-refresh']);
});

test('legacy beta metadata still prints a beta redemption command', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-legacy-channel-')), 'config.json');
  const previousConfigFile = process.env.NOTIS_CLI_CONFIG_FILE;
  process.env.NOTIS_CLI_CONFIG_FILE = configFile;
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/.well-known/oauth-protected-resource/cli')) {
      return new Response(JSON.stringify({
        resource: 'https://api-beta.notis.ai/cli',
        authorization_servers: ['https://api-beta.notis.ai'],
        notis_cli_client_id: 'notis_cli',
        notis_cli_copy_paste_redirect_uri: 'https://beta.notis.ai/cli-setup/code/bootstrap',
      }));
    }
    return new Response(JSON.stringify({
      authorization_endpoint: 'https://api-beta.notis.ai/oauth/authorize',
      token_endpoint: 'https://api-beta.notis.ai/oauth/token',
      revocation_endpoint: 'https://api-beta.notis.ai/oauth/revoke',
    }));
  };
  try {
    const started = await loginWithOAuth({
      agentMode: true,
      apiBase: 'https://api-beta.notis.ai',
      profileName: 'legacy-beta',
      config: normalizeConfig({}),
    }, { mode: 'code' }, null, fetchImpl);
    assert.match(started.agentAuthorization.redeem_command, /@notis_ai\/cli@beta/);
  } finally {
    if (previousConfigFile === undefined) delete process.env.NOTIS_CLI_CONFIG_FILE;
    else process.env.NOTIS_CLI_CONFIG_FILE = previousConfigFile;
  }
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

  const first = await loginWithOAuth(runtime(), { mode: 'code' }, null, fetchImpl);
  const retried = await loginWithOAuth(runtime(), { mode: 'code' }, null, fetchImpl);
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

  const first = await loginWithOAuth(runtime('first'), { mode: 'code' }, null, fetchImpl);
  const second = await loginWithOAuth(runtime('second'), { mode: 'code' }, null, fetchImpl);
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

function cliMetadataFetch({ withToken = false } = {}) {
  return async (url) => {
    if (withToken && String(url).endsWith('/oauth/token')) {
      return new Response(JSON.stringify({
        access_token: makeJwt('detached-demo-user'),
        refresh_token: 'refresh-token',
        expires_in: 900,
        scope: 'notis:read notis:write',
      }));
    }
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
}

function loginRuntime(overrides = {}) {
  return {
    agentMode: false,
    outputMode: 'table',
    apiBase: 'https://api.notis.ai',
    profileName: 'default',
    config: normalizeConfig({}),
    config_file: join(mkdtempSync(join(tmpdir(), 'notis-oauth-')), 'config.json'),
    // Make loopback expectations independent of the machine running the suite.
    hostEnvironment: {},
    hostPlatform: 'darwin',
    ...overrides,
  };
}

test('invalid login modes fail as usage errors before OAuth discovery', async () => {
  let requests = 0;
  await assert.rejects(
    loginWithOAuth(
      loginRuntime(),
      { mode: 'surprise' },
      null,
      async () => { requests += 1; return new Response('{}'); },
    ),
    (error) => {
      assert.equal(error.code, 'usage_error');
      assert.equal(error.exitCode, 2);
      assert.equal(error.details.mode, 'surprise');
      return true;
    },
  );
  assert.equal(requests, 0);
});

test('invalid login modes cannot bypass usage validation during code redemption', async () => {
  let requests = 0;
  await assert.rejects(
    loginWithOAuth(
      loginRuntime(),
      { code: 'opaque-code', mode: 'surprise' },
      null,
      async () => { requests += 1; return new Response('{}'); },
    ),
    (error) => error?.code === 'usage_error' && error?.exitCode === 2,
  );
  assert.equal(requests, 0);
});

for (const invalidTimeout of [0, -1, 'not-a-number', 1.5, Infinity, 2_147_484]) {
  test(`invalid timeout ${String(invalidTimeout)} fails before OAuth discovery`, async () => {
    let requests = 0;
    await assert.rejects(
      loginWithOAuth(
        loginRuntime(),
        { timeoutSeconds: invalidTimeout },
        null,
        async () => { requests += 1; return new Response('{}'); },
      ),
      (error) => error?.code === 'usage_error' && error?.exitCode === 2,
    );
    assert.equal(requests, 0);
  });
}

for (const outputMode of ['yaml', 'ndjson']) {
  test(`${outputMode} login returns through a detached listener instead of blocking`, async () => {
    const configFile = join(mkdtempSync(join(tmpdir(), `notis-oauth-${outputMode}-`)), 'config.json');
    let listenerStarted = false;
    const result = await withConfigFileAsync(configFile, () => loginWithOAuth(
      loginRuntime({ outputMode, config_file: configFile }),
      {},
      null,
      cliMetadataFetch(),
      async () => { throw new Error('machine output must not wait in-process'); },
      async () => {
        listenerStarted = true;
        return {
          pid: 4242,
          port: 51791,
          redirectUri: 'http://127.0.0.1:51791/callback',
        };
      },
    ));
    assert.equal(listenerStarted, true);
    assert.equal(result.agentAuthorization.hand_off, 'browser_callback');
  });
}

test('--mode browser is refused in agent mode rather than deadlocking on a callback', async () => {
  await assert.rejects(
    loginWithOAuth(
      loginRuntime({ agentMode: true }),
      { mode: 'browser' },
      null,
      cliMetadataFetch(),
    ),
    (error) => {
      assert.equal(error.code, 'oauth_login_mode_unavailable');
      return true;
    },
  );
});

test('--mode browser overrides the non-blocking default when stdout is only piped', async () => {
  let receiverCreated = false;
  const notices = [];
  await assert.rejects(
    loginWithOAuth(
      loginRuntime({ outputMode: 'json' }),
      { mode: 'browser', browser: false, timeoutMs: 20 },
      {
        note: () => { throw new Error('machine mode must not rely on a table-only note'); },
        notice: (message) => notices.push(message),
      },
      cliMetadataFetch(),
      async (opts) => {
        receiverCreated = true;
        return createLoopbackReceiver(opts);
      },
    ),
    (error) => {
      assert.equal(error.code, 'oauth_timeout');
      return true;
    },
  );
  assert.ok(receiverCreated, 'a piped --mode browser login must still open a loopback listener');
  assert.match(notices.join('\n'), /^Authorize Notis CLI: https:\/\/mcp\.notis\.ai/m);
});

test('--mode code uses the Portal callback even on an interactive terminal', async () => {
  let receiverCreated = false;
  const result = await loginWithOAuth(
    loginRuntime({ outputMode: 'json' }),
    { mode: 'code' },
    null,
    cliMetadataFetch(),
    async () => {
      receiverCreated = true;
      throw new Error('unreachable');
    },
  );
  assert.equal(receiverCreated, false);
  assert.equal(
    new URL(result.agentAuthorization.authorize_url).searchParams.get('redirect_uri'),
    'https://app.notis.ai/cli-setup/code/bootstrap',
  );
});

test('a login falls back to the code flow when no loopback listener can bind', async () => {
  const notes = [];
  const result = await loginWithOAuth(
    loginRuntime({ outputMode: 'json' }),
    { mode: 'browser', browser: false },
    { note: (message) => notes.push(message) },
    cliMetadataFetch(),
    async () => {
      throw new Error('EACCES: cannot bind 127.0.0.1');
    },
  );
  assert.equal(
    new URL(result.agentAuthorization.authorize_url).searchParams.get('redirect_uri'),
    'https://app.notis.ai/cli-setup/code/bootstrap',
  );
  assert.match(notes.join('\n'), /switched to the copy-paste code flow/);
});

test('an agent login hands the browser callback to a detached listener, with no code to copy', async () => {
  const calls = [];
  // Scoped config: this test persists listener state for a stub pid, and the
  // shared suite config would carry it into every later test on this profile.
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-detached-')), 'config.json');
  const result = await withConfigFileAsync(configFile, () => loginWithOAuth(
    loginRuntime({ agentMode: true, config_file: configFile }),
    {},
    null,
    cliMetadataFetch(),
    async () => { throw new Error('an agent login must not hold the listener in-process'); },
    async (runtime, payload) => {
      calls.push(payload);
      return { pid: 4242, port: 51789, redirectUri: 'http://127.0.0.1:51789/callback' };
    },
  ));

  const authorization = result.agentAuthorization;
  assert.equal(authorization.hand_off, 'browser_callback');
  assert.equal(
    new URL(authorization.authorize_url).searchParams.get('redirect_uri'),
    'http://127.0.0.1:51789/callback',
  );
  assert.equal(authorization.redeem_command, undefined);
  assert.match(authorization.confirm_command, /start$/);
  // The child must be handed the verifier for the challenge the user is sent.
  assert.equal(
    createHash('sha256').update(calls[0].verifier, 'ascii').digest('base64url'),
    new URL(authorization.authorize_url).searchParams.get('code_challenge'),
  );
});

test('an agent login keeps the local callback when inherited CI flags are disabled', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-disabled-ci-')), 'config.json');
  let listenerStarted = false;
  const result = await withConfigFileAsync(configFile, () => loginWithOAuth(
    loginRuntime({
      agentMode: true,
      config_file: configFile,
      hostEnvironment: { CI: 'false', VERCEL: '0' },
    }),
    {},
    null,
    cliMetadataFetch(),
    undefined,
    async () => {
      listenerStarted = true;
      return {
        pid: 4242,
        port: 51790,
        redirectUri: 'http://127.0.0.1:51790/callback',
      };
    },
  ));
  assert.equal(listenerStarted, true);
  assert.equal(result.agentAuthorization.hand_off, 'browser_callback');
});

test('start-style login adopts a credential persisted during discovery', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-confirm-race-')), 'config.json');
  const runtime = loginRuntime({
    agentMode: true,
    config_file: configFile,
  });
  let discoveryCalls = 0;
  let listenerSpawns = 0;
  const fetchImpl = async (url) => {
    discoveryCalls += 1;
    if (discoveryCalls === 2) {
      writeFileSync(configFile, JSON.stringify({
        current_profile: 'default',
        profiles: {
          default: {
            oauth_access_token: makeJwt('just-finished-user'),
            oauth_access_expires_at: future,
            oauth_refresh_token: 'just-finished-refresh',
            oauth_refresh_expires_at: future,
            oauth_client_id: 'notis_cli',
            oauth_issuer: 'https://mcp.notis.ai',
            oauth_api_base: 'https://api.notis.ai',
            oauth_resource: 'https://api.notis.ai/cli',
            oauth_scopes: ['notis:read'],
            oauth_user_id: 'just-finished-user',
          },
        },
      }));
    }
    return cliMetadataFetch()(url);
  };

  const result = await withConfigFileAsync(configFile, () => loginWithOAuth(
    runtime,
    { reusePersistedCredential: true },
    null,
    fetchImpl,
    undefined,
    async () => { listenerSpawns += 1; return null; },
  ));

  assert.equal(result.reusedPersistedCredential, true);
  assert.equal(runtime.oauthUserId, 'just-finished-user');
  assert.equal(runtime.jwt, makeJwt('just-finished-user'));
  assert.equal(listenerSpawns, 0);
  assert.equal(existsSync(listenerStatePath(configFile)), false);
  assert.equal(existsSync(pendingAuthorizationPath(configFile)), false);
});

test('start-style explicit browser login releases publication locks before foreground persistence', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-browser-lock-')), 'config.json');
  const login = withConfigFileAsync(configFile, () => loginWithOAuth(
    loginRuntime({ config_file: configFile }),
    { mode: 'browser', browser: false, reusePersistedCredential: true },
    null,
    cliMetadataFetch({ withToken: true }),
    async () => ({
      redirectUri: 'http://127.0.0.1:51801/callback',
      waitForCode: async () => 'foreground-code',
      complete() {},
      fail() {},
      close: async () => {},
    }),
  ));
  const result = await Promise.race([
    login,
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('foreground login self-deadlocked')), 1000).unref?.();
    }),
  ]);
  assert.equal(result.profile.oauth_user_id, 'detached-demo-user');
});

test('the detached listener is spawned without a Windows console window', () => {
  const source = readFileSync(new URL('../src/runtime/oauth.js', import.meta.url), 'utf-8');
  const spawnStart = source.indexOf('child = spawn(process.execPath, [LISTENER_SCRIPT');
  assert.ok(spawnStart >= 0);
  assert.match(source.slice(spawnStart, spawnStart + 600), /windowsHide: true/);
});

test('the detached listener child receives an allowlisted environment only', () => {
  const previous = process.env.NOTIS_CLI_CONFIG_FILE;
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-child-env-')), 'config.json');
  process.env.NOTIS_CLI_CONFIG_FILE = configFile;
  try {
    const childEnv = listenerChildEnvironment({
      PATH: '/usr/bin',
      HOME: '/safe-home',
      NOTIS_JWT: 'must-not-leak',
      OPENAI_API_KEY: 'must-not-leak',
      RANDOM_SERVICE_SECRET: 'must-not-leak',
    });
    assert.equal(childEnv.PATH, '/usr/bin');
    assert.equal(childEnv.HOME, '/safe-home');
    assert.equal(childEnv.NOTIS_CLI_CONFIG_FILE, configFile);
    assert.equal(childEnv.NOTIS_JWT, undefined);
    assert.equal(childEnv.OPENAI_API_KEY, undefined);
    assert.equal(childEnv.RANDOM_SERVICE_SECRET, undefined);
  } finally {
    if (previous === undefined) delete process.env.NOTIS_CLI_CONFIG_FILE;
    else process.env.NOTIS_CLI_CONFIG_FILE = previous;
  }
});

test('an agent login falls back to a copyable code when no listener can be detached', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-nodetach-')), 'config.json');
  const result = await withConfigFileAsync(configFile, () => loginWithOAuth(
    loginRuntime({ agentMode: true, config_file: configFile }),
    {},
    null,
    cliMetadataFetch(),
    undefined,
    async () => null,
  ));

  assert.equal(result.agentAuthorization.hand_off, 'code');
  assert.equal(
    new URL(result.agentAuthorization.authorize_url).searchParams.get('redirect_uri'),
    'https://app.notis.ai/cli-setup/code/bootstrap',
  );
  assert.match(result.agentAuthorization.redeem_command, /login --code <code>$/);
});

// A process that really looks like a listener: liveness now matches the command
// line, so a bare `node -e` sleeper is correctly no longer recognised as one.
function spawnFakeListener() {
  const dir = mkdtempSync(join(tmpdir(), 'notis-fake-listener-'));
  const script = join(dir, 'login-listener.js');
  writeFileSync(script, 'setTimeout(() => {}, 120_000);\n');
  const listenerIdentity = randomBytes(18).toString('base64url');
  const child = spawn(process.execPath, [script, listenerIdentity], { detached: true, stdio: 'ignore' });
  child.listenerIdentity = listenerIdentity;
  child.listenerScript = script;
  child.unref();
  return child;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function listenerStatePath(configFile, profileName = 'default') {
  return `${configFile}.login-listener.${createHash('sha256').update(profileName).digest('hex').slice(0, 16)}`;
}

function pendingAuthorizationPath(configFile, profileName = 'default') {
  return `${configFile}.pending-login.${createHash('sha256').update(profileName).digest('hex').slice(0, 16)}`;
}

test('login agent summaries match browser-callback and code hand-offs', () => {
  const browser = loginAgentAuthorizationPresentation({
    hand_off: 'browser_callback',
    confirm_command: 'notis start',
    authorize_url: 'https://mcp.notis.ai/oauth/authorize?state=browser',
  });
  assert.match(browser.humanSummary, /there is no code/i);
  assert.equal(browser.hints[0].command, 'notis start');
  assert.equal(
    browser.renderHuman(),
    'Authorize Notis CLI: https://mcp.notis.ai/oauth/authorize?state=browser',
  );

  const code = loginAgentAuthorizationPresentation({
    hand_off: 'code',
    redeem_command: "notis --profile 'work' login --code <code>",
    authorize_url: 'https://mcp.notis.ai/oauth/authorize?state=code',
  });
  assert.match(code.humanSummary, /ask them for the code/i);
  assert.equal(code.hints[0].command, "notis --profile 'work' login --code <code>");
  assert.equal(
    code.renderHuman(),
    'Authorize Notis CLI: https://mcp.notis.ai/oauth/authorize?state=code',
  );
});

test('logout summaries distinguish cleared OAuth state from an empty profile', () => {
  assert.match(
    logoutHumanSummary({ profiles: ['pending'] }, { allProfiles: false, profileName: 'pending' }),
    /OAuth state was cleared[\s\S]*pending authorization/,
  );
  assert.match(
    logoutHumanSummary({ profiles: [] }, { allProfiles: false, profileName: 'empty' }),
    /No OAuth credential was connected/,
  );
  assert.match(
    logoutHumanSummary({ profiles: ['pending'] }, { allProfiles: true, profileName: 'pending' }),
    /connected or pending CLI profiles/,
  );
});

test('Windows listener identity reads the Node command line instead of tasklist metadata', () => {
  const calls = [];
  const alive = listenerProcessIsAlive(4242, {
    platform: 'win32',
    signal: () => {},
    run: (command, args, options) => {
      calls.push({ command, args, options });
      return '"C:\\Program Files\\nodejs\\node.exe" C:\\notis\\login-listener.js listener-identity';
    },
    expectedIdentity: 'listener-identity',
    expectedScriptPath: 'C:\\notis\\login-listener.js',
  });
  assert.equal(alive, true);
  assert.equal(calls[0].command, 'powershell.exe');
  assert.match(calls[0].args.at(-1), /Get-CimInstance Win32_Process/);
  assert.ok(Number.isFinite(calls[0].options.timeout));
  assert.ok(calls[0].options.timeout > 0);
  assert.equal(calls[0].args.join(' ').includes('tasklist'), false);

  assert.equal(listenerProcessIsAlive(4242, {
    platform: 'win32',
    signal: () => {},
    run: () => '"C:\\Program Files\\nodejs\\node.exe" unrelated.js',
    expectedIdentity: 'listener-identity',
    expectedScriptPath: 'C:\\notis\\login-listener.js',
  }), false);
  assert.equal(listenerProcessIsAlive(4242, {
    platform: 'win32',
    signal: () => {},
    run: () => '"C:\\Program Files\\nodejs\\node.exe" C:\\other\\login-listener.js listener-identity',
    expectedIdentity: 'listener-identity',
    expectedScriptPath: 'C:\\notis\\login-listener.js',
  }), false);

  const timedOutProbes = [];
  assert.equal(listenerProcessIsAlive(4242, {
    platform: 'win32',
    signal: () => {},
    run: (command, _args, options) => {
      timedOutProbes.push({ command, timeout: options.timeout });
      const error = new Error('probe timed out');
      error.code = 'ETIMEDOUT';
      throw error;
    },
    expectedIdentity: 'listener-identity',
    expectedScriptPath: 'C:\\notis\\login-listener.js',
  }), false);
  assert.deepEqual(timedOutProbes.map(({ command }) => command), ['powershell.exe', 'pwsh.exe']);
  assert.ok(timedOutProbes.every(({ timeout }) => Number.isFinite(timeout) && timeout > 0));
});

// The config path is read from the environment at call time, and these flows
// stay in-flight across awaits, so the sync withConfigFile helper would restore
// it mid-login.
async function withConfigFileAsync(configFile, run) {
  const previous = process.env.NOTIS_CLI_CONFIG_FILE;
  process.env.NOTIS_CLI_CONFIG_FILE = configFile;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.NOTIS_CLI_CONFIG_FILE;
    else process.env.NOTIS_CLI_CONFIG_FILE = previous;
  }
}

test('re-running an agent login reuses the listener already waiting on the browser', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-reuse-')), 'config.json');
  const fake = spawnFakeListener();
  let spawns = 0;
  const spawnListener = async () => {
    spawns += 1;
    return {
      pid: fake.pid,
      port: 51790,
      redirectUri: 'http://127.0.0.1:51790/callback',
      identityToken: fake.listenerIdentity,
      scriptPath: fake.listenerScript,
    };
  };
  const login = () => loginWithOAuth(
    loginRuntime({ agentMode: true, config_file: configFile }),
    {},
    null,
    cliMetadataFetch(),
    undefined,
    spawnListener,
  );

  const { first, second } = await withConfigFileAsync(configFile, async () => {
    const one = await login();
    const two = await login();
    return { first: one, second: two };
  });

  assert.equal(spawns, 1, 'a second run must not strand another detached listener');
  assert.equal(second.agentAuthorization.authorize_url, first.agentAuthorization.authorize_url);
  assert.equal(second.agentAuthorization.hand_off, 'browser_callback');
  try { process.kill(fake.pid); } catch { /* already stopped */ }
});

test('a detached confirmation preserves a custom API target before the profile exists', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-confirm-target-')), 'config.json');
  const fake = spawnFakeListener();
  const apiBase = 'https://api.custom.test';
  let spawns = 0;
  const spawnListener = async () => {
    spawns += 1;
    return {
      pid: fake.pid,
      port: 51796,
      redirectUri: 'http://127.0.0.1:51796/callback',
      identityToken: fake.listenerIdentity,
      scriptPath: fake.listenerScript,
    };
  };

  try {
    const { first, second } = await withConfigFileAsync(configFile, async () => {
      const runtime = () => loginRuntime({
        agentMode: true,
        profileName: 'custom-target',
        apiBase,
        requestedApiBase: apiBase,
        config_file: configFile,
      });
      const one = await loginWithOAuth(
        runtime(), {}, null, cliMetadataFetch(), undefined, spawnListener,
      );
      const two = await loginWithOAuth(
        runtime(), {}, null, cliMetadataFetch(), undefined, spawnListener,
      );
      return { first: one, second: two };
    });

    assert.match(
      first.agentAuthorization.confirm_command,
      /--profile 'custom-target' --api-base 'https:\/\/api\.custom\.test' start$/,
    );
    assert.equal(second.agentAuthorization.confirm_command, first.agentAuthorization.confirm_command);
    assert.equal(second.agentAuthorization.authorize_url, first.agentAuthorization.authorize_url);
    assert.equal(spawns, 1, 'confirmation routing must reuse the original custom-target listener');
  } finally {
    try { process.kill(fake.pid); } catch { /* already stopped */ }
  }
});

test('an interactive auto retry reuses the detached listener already waiting', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-interactive-reuse-')), 'config.json');
  const fake = spawnFakeListener();
  const authorizeUrl = 'https://mcp.notis.ai/oauth/authorize?state=interactive-reuse';
  writeFileSync(listenerStatePath(configFile), JSON.stringify({
    profile: 'default',
    api_base: 'https://api.notis.ai',
    pid: fake.pid,
    port: 51796,
    authorize_url: authorizeUrl,
    issuer: 'https://mcp.notis.ai',
    resource: 'https://api.notis.ai/cli',
    client_id: 'notis_cli',
    token_endpoint: 'https://mcp.notis.ai/oauth/token',
    scopes: DEFAULT_CLI_OAUTH_SCOPES,
    identity_token: fake.listenerIdentity,
    listener_script: fake.listenerScript,
    expires_at: Math.floor(Date.now() / 1000) + 600,
  }));
  let receiverCreations = 0;

  try {
    const result = await withConfigFileAsync(configFile, () => loginWithOAuth(
      loginRuntime({ outputMode: 'table', config_file: configFile }),
      {},
      null,
      cliMetadataFetch(),
      async () => { receiverCreations += 1; throw new Error('must reuse'); },
    ));
    assert.equal(result.agentAuthorization.authorize_url, authorizeUrl);
    assert.equal(result.agentAuthorization.hand_off, 'browser_callback');
    assert.equal(receiverCreations, 0);
    assert.equal(processIsAlive(fake.pid), true);
  } finally {
    try { process.kill(fake.pid); } catch { /* already stopped */ }
  }
});

test('concurrent agent logins serialize listener creation and reuse one authorization', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-concurrent-listener-')), 'config.json');
  const fake = spawnFakeListener();
  let spawns = 0;
  const spawnListener = async () => {
    spawns += 1;
    await new Promise((resolve) => setTimeout(resolve, 40));
    return {
      pid: fake.pid,
      port: 51791,
      redirectUri: 'http://127.0.0.1:51791/callback',
      identityToken: fake.listenerIdentity,
      scriptPath: fake.listenerScript,
    };
  };
  const login = () => loginWithOAuth(
    loginRuntime({ agentMode: true, config_file: configFile }),
    {},
    null,
    cliMetadataFetch(),
    undefined,
    spawnListener,
  );

  try {
    const [first, second] = await withConfigFileAsync(
      configFile,
      () => Promise.all([login(), login()]),
    );
    assert.equal(spawns, 1);
    assert.equal(second.agentAuthorization.authorize_url, first.agentAuthorization.authorize_url);
    assert.equal(second.agentAuthorization.hand_off, 'browser_callback');
  } finally {
    try { process.kill(fake.pid); } catch { /* already stopped */ }
  }
});

test('an explicit code login retires a concurrently publishing detached listener', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-mixed-mode-')), 'config.json');
  const fake = spawnFakeListener();
  let spawnStarted;
  const started = new Promise((resolve) => { spawnStarted = resolve; });
  let releaseSpawn;
  const released = new Promise((resolve) => { releaseSpawn = resolve; });
  const automatic = () => loginWithOAuth(
    loginRuntime({ agentMode: true, config_file: configFile }),
    {},
    null,
    cliMetadataFetch(),
    undefined,
    async () => {
      spawnStarted();
      await released;
      return {
        pid: fake.pid,
        port: 51793,
        redirectUri: 'http://127.0.0.1:51793/callback',
        identityToken: fake.listenerIdentity,
        scriptPath: fake.listenerScript,
      };
    },
  );
  const code = () => loginWithOAuth(
    loginRuntime({ agentMode: true, config_file: configFile }),
    { mode: 'code' },
    null,
    cliMetadataFetch(),
  );

  try {
    const result = await withConfigFileAsync(configFile, async () => {
      const automaticResult = automatic();
      await started;
      let codeSettled = false;
      const codeResult = code().finally(() => { codeSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(codeSettled, false, 'code mode must wait for listener publication');
      releaseSpawn();
      return Promise.all([automaticResult, codeResult]);
    });
    assert.equal(result[0].agentAuthorization.hand_off, 'browser_callback');
    assert.equal(result[1].agentAuthorization.hand_off, 'code');
    assert.equal(existsSync(listenerStatePath(configFile)), false);
    assert.equal(existsSync(pendingAuthorizationPath(configFile)), true);
    for (let attempt = 0; attempt < 50 && processIsAlive(fake.pid); attempt += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 20); });
    }
    assert.equal(processIsAlive(fake.pid), false);
  } finally {
    try { process.kill(fake.pid); } catch { /* already stopped */ }
  }
});

test('an interactive code login serializes with detached listener publication', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-interactive-code-race-')), 'config.json');
  const fake = spawnFakeListener();
  let spawnStarted;
  const started = new Promise((resolve) => { spawnStarted = resolve; });
  let releaseSpawn;
  const released = new Promise((resolve) => { releaseSpawn = resolve; });
  const automatic = () => loginWithOAuth(
    loginRuntime({ agentMode: true, config_file: configFile }),
    {},
    null,
    cliMetadataFetch(),
    undefined,
    async () => {
      spawnStarted();
      await released;
      return {
        pid: fake.pid,
        port: 51795,
        redirectUri: 'http://127.0.0.1:51795/callback',
        identityToken: fake.listenerIdentity,
        scriptPath: fake.listenerScript,
      };
    },
  );
  const interactiveCode = () => loginWithOAuth(
    loginRuntime({ outputMode: 'table', config_file: configFile }),
    { mode: 'code' },
    { notice() {} },
    cliMetadataFetch({ withToken: true }),
    undefined,
    undefined,
    async () => 'interactive-code',
  );

  try {
    const result = await withConfigFileAsync(configFile, async () => {
      const automaticResult = automatic();
      await started;
      let interactiveSettled = false;
      const codeResult = interactiveCode().finally(() => { interactiveSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(interactiveSettled, false, 'interactive code mode must wait for publication');
      releaseSpawn();
      return Promise.all([automaticResult, codeResult]);
    });
    assert.equal(result[0].agentAuthorization.hand_off, 'browser_callback');
    assert.equal(result[1].profile.oauth_user_id, 'detached-demo-user');
    assert.equal(existsSync(listenerStatePath(configFile)), false);
    assert.equal(existsSync(pendingAuthorizationPath(configFile)), false);
    for (let attempt = 0; attempt < 50 && processIsAlive(fake.pid); attempt += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 20); });
    }
    assert.equal(processIsAlive(fake.pid), false);
  } finally {
    releaseSpawn?.();
    try { process.kill(fake.pid); } catch { /* already stopped */ }
  }
});

test('Windows listener cancellation uses the durable state channel', () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-windows-cancel-')), 'config.json');
  const fake = spawnFakeListener();
  writeFileSync(listenerStatePath(configFile), JSON.stringify({
    profile: 'default',
    api_base: 'https://api.notis.ai',
    pid: fake.pid,
    identity_token: fake.listenerIdentity,
    listener_script: fake.listenerScript,
    port: 51794,
    authorize_url: 'https://mcp.notis.ai/oauth/authorize?state=windows-cancel',
    expires_at: Math.floor(Date.now() / 1000) + 600,
  }));
  let signals = 0;
  try {
    withConfigFile(configFile, () => stopPendingListener(
      { profileName: 'default', apiBase: 'https://api.notis.ai' },
      { platform: 'win32', signal: () => { signals += 1; } },
    ));
    assert.equal(signals, 0);
    assert.equal(JSON.parse(readFileSync(listenerStatePath(configFile), 'utf-8')).cancelled, true);
    assert.equal(processIsAlive(fake.pid), true);
  } finally {
    try { process.kill(fake.pid); } catch { /* already stopped */ }
  }
});

test('switching API environments stops the previous profile listener before replacement', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-api-switch-')), 'config.json');
  const oldListener = spawnFakeListener();
  const replacement = spawnFakeListener();
  writeFileSync(listenerStatePath(configFile), JSON.stringify({
    profile: 'default',
    api_base: 'https://api-beta.notis.ai',
    pid: oldListener.pid,
    identity_token: oldListener.listenerIdentity,
    listener_script: oldListener.listenerScript,
    port: 51792,
    authorize_url: 'https://mcp.notis.ai/oauth/authorize?state=old',
    issuer: 'https://mcp.notis.ai',
    resource: 'https://api-beta.notis.ai/cli',
    client_id: 'notis_cli',
    token_endpoint: 'https://mcp.notis.ai/oauth/token',
    scopes: DEFAULT_CLI_OAUTH_SCOPES,
    expires_at: Math.floor(Date.now() / 1000) + 600,
  }));

  try {
    await withConfigFileAsync(configFile, () => loginWithOAuth(
      loginRuntime({ agentMode: true, apiBase: 'https://api.notis.ai', config_file: configFile }),
      {},
      null,
      cliMetadataFetch(),
      undefined,
      async () => ({
        pid: replacement.pid,
        port: 51793,
        redirectUri: 'http://127.0.0.1:51793/callback',
        identityToken: replacement.listenerIdentity,
        scriptPath: replacement.listenerScript,
      }),
    ));

    for (let attempt = 0; attempt < 50 && processIsAlive(oldListener.pid); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(processIsAlive(oldListener.pid), false);
    const state = JSON.parse(readFileSync(listenerStatePath(configFile), 'utf-8'));
    assert.equal(state.api_base, 'https://api.notis.ai');
    assert.equal(state.pid, replacement.pid);
  } finally {
    try { process.kill(oldListener.pid); } catch { /* already stopped */ }
    try { process.kill(replacement.pid); } catch { /* already stopped */ }
  }
});

test('the detached listener persists the credential the browser returns', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-oauth-listener-'));
  const configFile = join(home, 'config.json');
  const payloadFile = join(home, 'payload.json');
  const tokenCalls = [];
  const fetchImpl = async (url, init) => {
    tokenCalls.push(new URLSearchParams(init.body));
    return new Response(JSON.stringify({
      access_token: makeJwt('listener-user'),
      refresh_token: 'refresh-token',
      expires_in: 900,
      scope: 'notis:read notis:write',
    }));
  };

  const state = 'listener-state';
  writeFileSync(payloadFile, JSON.stringify({
    profile: 'default',
    api_base: 'https://api.notis.ai',
    verifier: 'listener-verifier',
    state,
    scopes: ['notis:read'],
    timeout_ms: 10_000,
    portal_origin: 'https://app.notis.ai',
    metadata: {
      issuer: 'https://mcp.notis.ai',
      resource: 'https://api.notis.ai/cli',
      clientId: 'notis_cli',
      tokenEndpoint: 'https://mcp.notis.ai/oauth/token',
      apiBase: 'https://api.notis.ai',
    },
  }));

  // The child reports its port to its parent over IPC. Standing in as the
  // parent is what lets this test drive the callback the browser would make.
  const originalSend = process.send;
  const bound = new Promise((resolve) => {
    process.send = (message) => resolve(Number(message?.port));
  });

  const exit = await withConfigFileAsync(configFile, async () => {
    try {
      const finished = runDetachedLoginListener(payloadFile, fetchImpl);
      const port = await bound;
      writeFileSync(listenerStatePath(configFile), JSON.stringify({
        profile: 'default',
        api_base: 'https://api.notis.ai',
        pid: process.pid,
        port,
        authorize_url: 'https://mcp.notis.ai/oauth/authorize?state=listener-state',
        expires_at: Math.floor(Date.now() / 1000) + 600,
      }));
      const callback = await httpGet(
        `http://127.0.0.1:${port}/callback?code=browser-code&state=${state}`,
      );
      assert.equal(callback.status, 302);
      return await finished;
    } finally {
      process.send = originalSend;
    }
  });

  assert.equal(exit, 0);
  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].get('code'), 'browser-code');
  assert.equal(tokenCalls[0].get('code_verifier'), 'listener-verifier');
  assert.equal(tokenCalls[0].get('redirect_uri'), 'http://127.0.0.1:51789/callback'.replace('51789', String(await bound)));

  // The whole point of detaching: the credential is on disk without anyone
  // pasting a code back into a terminal.
  const saved = JSON.parse(readFileSync(configFile, 'utf-8'));
  assert.equal(saved.profiles.default.oauth_user_id, 'listener-user');
  // The verifier must not outlive the exchange it authorized.
  assert.equal(existsSync(payloadFile), false);
});

test('a detached post-exchange persistence failure revokes the issued grant', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-oauth-listener-persist-failure-'));
  const configFile = join(home, 'config.json');
  const payloadFile = join(home, 'payload.json');
  const state = 'persist-failure-state';
  // A directory at the config path lets listener sidecars work but makes the
  // final atomic config rename fail after the token endpoint has responded.
  mkdirSync(configFile);
  writeFileSync(payloadFile, JSON.stringify({
    profile: 'default',
    api_base: 'https://api.notis.ai',
    verifier: 'persist-failure-verifier',
    state,
    scopes: ['notis:read'],
    timeout_ms: 10_000,
    portal_origin: 'https://app.notis.ai',
    metadata: {
      issuer: 'https://mcp.notis.ai',
      resource: 'https://api.notis.ai/cli',
      clientId: 'notis_cli',
      tokenEndpoint: 'https://mcp.notis.ai/oauth/token',
      revocationEndpoint: 'https://mcp.notis.ai/oauth/revoke',
      apiBase: 'https://api.notis.ai',
    },
  }));
  const revoked = [];
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/oauth/token')) {
      return new Response(JSON.stringify({
        access_token: makeJwt('unpersisted-detached-user'),
        refresh_token: 'unpersisted-detached-refresh',
        expires_in: 900,
      }));
    }
    if (String(url).endsWith('/oauth/revoke')) {
      revoked.push(new URLSearchParams(init.body).get('token'));
      return new Response('{}');
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const originalSend = process.send;
  const bound = new Promise((resolve) => {
    process.send = (message) => resolve(Number(message?.port));
  });
  try {
    const exit = await withConfigFileAsync(configFile, async () => {
      const finished = runDetachedLoginListener(payloadFile, fetchImpl);
      const port = await bound;
      writeFileSync(listenerStatePath(configFile), JSON.stringify({
        profile: 'default',
        api_base: 'https://api.notis.ai',
        pid: process.pid,
        port,
        authorize_url: `https://mcp.notis.ai/oauth/authorize?state=${state}`,
        expires_at: Math.floor(Date.now() / 1000) + 600,
      }));
      const callback = await httpGet(
        `http://127.0.0.1:${port}/callback?code=browser-code&state=${state}`,
      );
      assert.equal(callback.status, 400);
      return finished;
    });
    assert.equal(exit, 1);
    assert.deepEqual(revoked, ['unpersisted-detached-refresh']);
  } finally {
    process.send = originalSend;
  }
});

test('detached persistence cannot cross an all-profile logout snapshot', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-oauth-listener-global-lock-'));
  const configFile = join(home, 'config.json');
  const payloadFile = join(home, 'payload.json');
  const profileName = 'new-detached-profile';
  const state = 'global-lock-state';
  writeFileSync(payloadFile, JSON.stringify({
    profile: profileName,
    api_base: 'https://api.notis.ai',
    verifier: 'global-lock-verifier',
    state,
    scopes: ['notis:read'],
    timeout_ms: 10_000,
    portal_origin: 'https://app.notis.ai',
    metadata: {
      issuer: 'https://mcp.notis.ai',
      resource: 'https://api.notis.ai/cli',
      clientId: 'notis_cli',
      tokenEndpoint: 'https://mcp.notis.ai/oauth/token',
      apiBase: 'https://api.notis.ai',
    },
  }));

  const originalSend = process.send;
  const bound = new Promise((resolve) => {
    process.send = (message) => resolve(Number(message?.port));
  });
  let exchangeStarted = false;

  await withConfigFileAsync(configFile, async () => {
    let globalLock = null;
    try {
      const finished = runDetachedLoginListener(payloadFile, async () => {
        exchangeStarted = true;
        return new Response(JSON.stringify({
          access_token: makeJwt('globally-serialized-user'),
          refresh_token: 'globally-serialized-refresh',
          expires_in: 900,
          scope: 'notis:read',
        }));
      });
      const port = await bound;
      const stateFile = listenerStatePath(configFile, profileName);
      writeFileSync(stateFile, JSON.stringify({
        profile: profileName,
        api_base: 'https://api.notis.ai',
        pid: process.pid,
        port,
        authorize_url: 'https://mcp.notis.ai/oauth/authorize?state=global-lock-state',
        expires_at: Math.floor(Date.now() / 1000) + 600,
      }));

      // Stand in for the all-profile logout snapshot while it owns the global
      // mutation lock. The child must not exchange or mutate local state until
      // that snapshot is finished.
      globalLock = await acquireListenerGlobalLock();
      const callback = httpGet(
        `http://127.0.0.1:${port}/callback?code=browser-code&state=${state}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(exchangeStarted, false);
      assert.equal(getProfile(loadConfig(), profileName).oauth_access_token, undefined);
      assert.equal(existsSync(stateFile), true);

      releaseListenerGlobalLock(globalLock);
      globalLock = null;
      assert.equal((await callback).status, 302);
      assert.equal(await finished, 0);
      assert.equal(
        getProfile(loadConfig(), profileName).oauth_user_id,
        'globally-serialized-user',
      );
    } finally {
      releaseListenerGlobalLock(globalLock);
      process.send = originalSend;
    }
  });
});

test('a replacement child ignores its predecessor tombstone until publication', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-oauth-replacement-publication-'));
  const configFile = join(home, 'config.json');
  const payloadFile = join(home, 'payload.json');
  const identityToken = 'replacement-child-identity';
  const state = 'replacement-state';
  writeFileSync(payloadFile, JSON.stringify({
    profile: 'default',
    api_base: 'https://api.notis.ai',
    verifier: 'replacement-verifier',
    state,
    scopes: ['notis:read'],
    timeout_ms: 10_000,
    portal_origin: 'https://app.notis.ai',
    metadata: {
      issuer: 'https://mcp.notis.ai',
      resource: 'https://api.notis.ai/cli',
      clientId: 'notis_cli',
      tokenEndpoint: 'https://mcp.notis.ai/oauth/token',
      apiBase: 'https://api.notis.ai',
    },
  }));
  writeFileSync(listenerStatePath(configFile), JSON.stringify({
    profile: 'default',
    api_base: 'https://api.notis.ai',
    pid: 999_999,
    cancelled: true,
    expires_at: Math.floor(Date.now() / 1000) + 600,
  }));

  const originalSend = process.send;
  const bound = new Promise((resolve) => {
    process.send = (message) => resolve(Number(message?.port));
  });
  try {
    const finished = withConfigFileAsync(configFile, () => runDetachedLoginListener(
      payloadFile,
      async () => new Response(JSON.stringify({
        access_token: makeJwt('replacement-user'),
        refresh_token: 'replacement-refresh',
        expires_in: 900,
        scope: 'notis:read',
      })),
      identityToken,
    ));
    const port = await bound;
    await new Promise((resolve) => setTimeout(resolve, 250));
    writeFileSync(listenerStatePath(configFile), JSON.stringify({
      profile: 'default',
      api_base: 'https://api.notis.ai',
      pid: process.pid,
      identity_token: identityToken,
      expires_at: Math.floor(Date.now() / 1000) + 600,
    }));
    const callback = await httpGet(
      `http://127.0.0.1:${port}/callback?code=replacement-code&state=${state}`,
    );
    assert.equal(callback.status, 302);
    assert.equal(await finished, 0);
    assert.equal(
      JSON.parse(readFileSync(configFile, 'utf-8')).profiles.default.oauth_user_id,
      'replacement-user',
    );
  } finally {
    process.send = originalSend;
  }
});

test('a real detached listener signs the profile in without the user touching a code', async () => {
  // End to end over a real spawned process: the injected-spawn tests above prove
  // the routing, this proves the child actually starts, binds, and writes.
  const home = mkdtempSync(join(tmpdir(), 'notis-oauth-e2e-'));
  const configFile = join(home, 'config.json');
  const tokenBodies = [];

  const api = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const origin = `http://${req.headers.host}`;
    const json = (body) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/oauth-protected-resource/cli') {
      return json({
        resource: `${origin}/cli`,
        authorization_servers: [origin],
        notis_cli_client_id: 'notis_cli',
        notis_cli_copy_paste_redirect_uri: 'https://app.notis.ai/cli-setup/code/bootstrap',
      });
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json({
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        revocation_endpoint: `${origin}/oauth/revoke`,
      });
    }
    if (url.pathname === '/oauth/token') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      return req.on('end', () => {
        tokenBodies.push(new URLSearchParams(Buffer.concat(chunks).toString('utf-8')));
        json({
          access_token: makeJwt('e2e-user'),
          refresh_token: 'refresh-token',
          expires_in: 900,
          scope: 'notis:read notis:write',
        });
      });
    }
    res.writeHead(404);
    return res.end();
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  const apiBase = `http://127.0.0.1:${api.address().port}`;

  try {
    const started = await withConfigFileAsync(configFile, () => loginWithOAuth(
      {
        agentMode: true,
        apiBase,
        profileName: 'default',
        config: normalizeConfig({}),
        config_file: configFile,
        hostEnvironment: {},
        hostPlatform: 'darwin',
      },
      {},
      null,
    ));

    assert.equal(started.agentAuthorization.hand_off, 'browser_callback');
    const authorizeUrl = new URL(started.agentAuthorization.authorize_url);
    const redirectUri = new URL(authorizeUrl.searchParams.get('redirect_uri'));
    assert.equal(redirectUri.hostname, '127.0.0.1');

    // Stand in for the browser the user is about to be sent to.
    redirectUri.searchParams.set('code', 'e2e-code');
    redirectUri.searchParams.set('state', authorizeUrl.searchParams.get('state'));
    const callback = await httpGet(redirectUri.toString());
    assert.equal(callback.status, 302);
    assert.match(callback.headers.location, /\/cli-connected$/);

    // The child owns the write, so the credential lands after this command has
    // already returned. That is the whole point, and it is what to wait for.
    let profile = null;
    for (let attempt = 0; attempt < 100 && !profile?.oauth_user_id; attempt += 1) {
      try {
        profile = JSON.parse(readFileSync(configFile, 'utf-8')).profiles?.default;
      } catch { profile = null; }
      if (!profile?.oauth_user_id) await new Promise((r) => { setTimeout(r, 50); });
    }

    assert.equal(profile?.oauth_user_id, 'e2e-user');
    assert.equal(tokenBodies.length, 1);
    assert.equal(tokenBodies[0].get('code'), 'e2e-code');
    assert.equal(
      createHash('sha256').update(tokenBodies[0].get('code_verifier'), 'ascii').digest('base64url'),
      authorizeUrl.searchParams.get('code_challenge'),
    );
  } finally {
    await new Promise((resolve) => api.close(resolve));
  }
});

test('an abandoned detached listener gives up instead of waiting forever', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-oauth-abandon-'));
  const payloadFile = join(home, 'payload.json');
  writeFileSync(payloadFile, JSON.stringify({
    profile: 'default',
    api_base: 'https://api.notis.ai',
    verifier: 'abandoned-verifier',
    state: 'abandoned-state',
    scopes: ['notis:read'],
    timeout_ms: 30,
    portal_origin: 'https://app.notis.ai',
    metadata: { clientId: 'notis_cli', tokenEndpoint: 'https://mcp.notis.ai/oauth/token' },
  }));

  const exit = await withConfigFileAsync(
    join(home, 'config.json'),
    () => runDetachedLoginListener(payloadFile, async () => {
      throw new Error('an abandoned login must never reach the token endpoint');
    }),
  );

  assert.equal(exit, 1);
});

test('an unverifiable listener is cancelled durably and cannot persist its callback', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-oauth-unverified-cancel-'));
  const configFile = join(home, 'config.json');
  const payloadFile = join(home, 'payload.json');
  const state = 'cancelled-listener-state';
  writeFileSync(payloadFile, JSON.stringify({
    profile: 'default',
    api_base: 'https://api.notis.ai',
    verifier: 'cancelled-verifier',
    state,
    scopes: ['notis:read'],
    timeout_ms: 10_000,
    portal_origin: 'https://app.notis.ai',
    metadata: {
      issuer: 'https://mcp.notis.ai',
      resource: 'https://api.notis.ai/cli',
      clientId: 'notis_cli',
      tokenEndpoint: 'https://mcp.notis.ai/oauth/token',
      apiBase: 'https://api.notis.ai',
    },
  }));

  const originalSend = process.send;
  const bound = new Promise((resolve) => {
    process.send = (message) => resolve(Number(message?.port));
  });
  try {
    const exit = await withConfigFileAsync(configFile, async () => {
      const finished = runDetachedLoginListener(payloadFile, async () => new Response(JSON.stringify({
        access_token: makeJwt('must-not-persist'),
        refresh_token: 'must-not-persist',
        expires_in: 900,
      })));
      const port = await bound;
      writeFileSync(listenerStatePath(configFile), JSON.stringify({
        profile: 'default',
        api_base: 'https://api.notis.ai',
        // The current test process is alive, but its command line is not the
        // listener entrypoint, which exercises the unverifiable-PID path.
        pid: process.pid,
        port,
        authorize_url: 'https://mcp.notis.ai/oauth/authorize?state=cancelled',
        expires_at: Math.floor(Date.now() / 1000) + 600,
      }));
      stopPendingListener({ profileName: 'default', apiBase: 'https://api.notis.ai' });
      assert.equal(JSON.parse(readFileSync(listenerStatePath(configFile), 'utf-8')).cancelled, true);
      await httpGet(`http://127.0.0.1:${port}/callback?code=late-code&state=${state}`);
      return finished;
    });
    assert.equal(exit, 1);
    const stored = existsSync(configFile)
      ? JSON.parse(readFileSync(configFile, 'utf-8'))
      : { profiles: {} };
    assert.equal(stored.profiles?.default?.oauth_access_token, undefined);
  } finally {
    process.send = originalSend;
  }
});

test('a cancellation that wins during exchange revokes the discarded OAuth grant', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-oauth-cancel-during-exchange-'));
  const configFile = join(home, 'config.json');
  const payloadFile = join(home, 'payload.json');
  const state = 'exchange-race-state';
  writeFileSync(payloadFile, JSON.stringify({
    profile: 'default',
    api_base: 'https://api.notis.ai',
    verifier: 'exchange-race-verifier',
    state,
    scopes: ['notis:read'],
    timeout_ms: 10_000,
    portal_origin: 'https://app.notis.ai',
    metadata: {
      issuer: 'https://mcp.notis.ai',
      resource: 'https://api.notis.ai/cli',
      clientId: 'notis_cli',
      tokenEndpoint: 'https://mcp.notis.ai/oauth/token',
      revocationEndpoint: 'https://mcp.notis.ai/oauth/revoke',
      apiBase: 'https://api.notis.ai',
    },
  }));

  let exchangeStartedResolve;
  const exchangeStarted = new Promise((resolve) => { exchangeStartedResolve = resolve; });
  let releaseExchange;
  const exchangeRelease = new Promise((resolve) => { releaseExchange = resolve; });
  const revoked = [];
  const ordering = [];
  const replacementChild = spawnFakeListener();
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/oauth/token')) {
      exchangeStartedResolve();
      await exchangeRelease;
      return new Response(JSON.stringify({
        access_token: makeJwt('discarded-user'),
        refresh_token: 'discarded-refresh-token',
        expires_in: 900,
      }));
    }
    if (String(url).endsWith('/oauth/revoke')) {
      revoked.push(new URLSearchParams(init.body).get('token'));
      ordering.push('old-revoked');
      return new Response('{}');
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const originalSend = process.send;
  const bound = new Promise((resolve) => {
    process.send = (message) => resolve(Number(message?.port));
  });
  try {
    const { exit, replacement } = await withConfigFileAsync(configFile, async () => {
      const finished = runDetachedLoginListener(payloadFile, fetchImpl);
      const port = await bound;
      writeFileSync(listenerStatePath(configFile), JSON.stringify({
        profile: 'default',
        api_base: 'https://api.notis.ai',
        pid: process.pid,
        port,
        authorize_url: 'https://mcp.notis.ai/oauth/authorize?state=exchange-race',
        expires_at: Math.floor(Date.now() / 1000) + 600,
      }));
      const callback = httpGet(
        `http://127.0.0.1:${port}/callback?code=exchange-code&state=${state}`,
      );
      await exchangeStarted;
      stopPendingListener({ profileName: 'default', apiBase: 'https://api.notis.ai' });
      let replacementSpawned = false;
      const replacementLogin = loginWithOAuth(
        loginRuntime({ agentMode: true, config_file: configFile }),
        {},
        null,
        cliMetadataFetch(),
        undefined,
        async () => {
          replacementSpawned = true;
          ordering.push('replacement-published');
          return {
            pid: replacementChild.pid,
            port: 51993,
            redirectUri: 'http://127.0.0.1:51993/callback',
            identityToken: replacementChild.listenerIdentity,
            scriptPath: replacementChild.listenerScript,
          };
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(replacementSpawned, false, 'a successor must wait for old-grant compensation');
      releaseExchange();
      await callback;
      return { exit: await finished, replacement: await replacementLogin };
    });
    assert.equal(exit, 1);
    assert.deepEqual(revoked, ['discarded-refresh-token']);
    assert.equal(replacement.agentAuthorization.hand_off, 'browser_callback');
    assert.deepEqual(ordering, ['old-revoked', 'replacement-published']);
  } finally {
    process.send = originalSend;
    try { process.kill(replacementChild.pid); } catch { /* already stopped */ }
  }
});

test('a post-handshake authorization error terminates the unpublished listener', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-post-handshake-')), 'config.json');
  const fake = spawnFakeListener();
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
      authorization_endpoint: 'not a valid URL',
      token_endpoint: 'https://mcp.notis.ai/oauth/token',
      revocation_endpoint: 'https://mcp.notis.ai/oauth/revoke',
    }));
  };

  try {
    await assert.rejects(() => withConfigFileAsync(configFile, () => loginWithOAuth(
      loginRuntime({ agentMode: true, config_file: configFile }),
      {},
      null,
      fetchImpl,
      undefined,
      async () => ({
        pid: fake.pid,
        port: 51888,
        redirectUri: 'http://127.0.0.1:51888/callback',
        identityToken: fake.listenerIdentity,
        scriptPath: fake.listenerScript,
      }),
    )));
    for (let attempt = 0; attempt < 50 && processIsAlive(fake.pid); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(processIsAlive(fake.pid), false);
    assert.equal(existsSync(listenerStatePath(configFile)), false);
  } finally {
    try { process.kill(fake.pid); } catch { /* already stopped */ }
  }
});

test('signing out ends an authorization that is still in flight', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-oauth-logout-listener-'));
  const configFile = join(home, 'config.json');
  // A real child so the kill is real: it waits on a callback that never comes.
  const spawned = spawnFakeListener();
  const isAlive = () => processIsAlive(spawned.pid);

  try {
    await withConfigFileAsync(configFile, async () => {
      writeFileSync(
        `${configFile}.login-listener.${createHash('sha256').update('default').digest('hex').slice(0, 16)}`,
        JSON.stringify({
          profile: 'default',
          // A different endpoint than the logout runtime, which must not shield
          // the listener from being stopped.
          api_base: 'https://api-beta.notis.ai',
          pid: spawned.pid,
          identity_token: spawned.listenerIdentity,
          listener_script: spawned.listenerScript,
          port: 51999,
          authorize_url: 'https://mcp.notis.ai/oauth/authorize?state=abandoned',
          expires_at: Math.floor(Date.now() / 1000) + 600,
        }),
      );
      assert.equal(isAlive(), true);
      await logoutOAuth(
        { profileName: 'default', apiBase: 'https://api.notis.ai', config: normalizeConfig({}) },
        {},
        async () => new Response('{}'),
      );
    });

    for (let attempt = 0; attempt < 50 && isAlive(); attempt += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 20); });
    }
    assert.equal(isAlive(), false, 'logout must stop the listener that would sign the profile back in');
  } finally {
    try { process.kill(spawned.pid); } catch { /* already stopped */ }
  }
});

test('logout cancels an unpersisted named-profile listener without creating the profile', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-oauth-logout-pending-profile-'));
  const configFile = join(home, 'config.json');
  const profileName = 'pending-work';
  const spawned = spawnFakeListener();
  const logoutSpec = authCommandSpecs.find((spec) => spec.command_path.join(' ') === 'logout');
  assert.equal(logoutSpec.allow_unknown_profile, true);

  writeFileSync(listenerStatePath(configFile, profileName), JSON.stringify({
    profile: profileName,
    api_base: 'https://api.notis.ai',
    pid: spawned.pid,
    identity_token: spawned.listenerIdentity,
    listener_script: spawned.listenerScript,
    port: 51998,
    authorize_url: 'https://mcp.notis.ai/oauth/authorize?state=pending-profile',
    expires_at: Math.floor(Date.now() / 1000) + 600,
  }));
  writeFileSync(pendingAuthorizationPath(configFile, profileName), JSON.stringify({
    profile: profileName,
    verifier: 'pending-verifier',
    redirect_uri: 'https://app.notis.ai/cli-setup/code/bootstrap',
    expires_at: Math.floor(Date.now() / 1000) + 600,
  }));

  try {
    await withConfigFileAsync(configFile, () => logoutOAuth(
      { profileName, apiBase: 'https://api.notis.ai', config: normalizeConfig({}) },
      {},
      async () => new Response('{}'),
    ));
    for (let attempt = 0; attempt < 50 && processIsAlive(spawned.pid); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(processIsAlive(spawned.pid), false);
    assert.equal(existsSync(listenerStatePath(configFile, profileName)), false);
    assert.equal(existsSync(pendingAuthorizationPath(configFile, profileName)), false);
    assert.equal(Object.hasOwn(loadConfig().profiles, profileName), false);
  } finally {
    try { process.kill(spawned.pid); } catch { /* already stopped */ }
  }
});

test('logout does not report an arbitrary missing profile as cleared', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-logout-missing-')), 'config.json');
  const result = await withConfigFileAsync(configFile, () => logoutOAuth(
    {
      profileName: 'definitely-missing',
      apiBase: 'https://api.notis.ai',
      config: normalizeConfig({}),
    },
    {},
    async () => new Response('{}'),
  ));
  assert.deepEqual(result.profiles, []);
  assert.equal(Object.hasOwn(loadConfig().profiles, 'definitely-missing'), false);
});

test('logout does not report a stored profile with no OAuth state as disconnected', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-logout-empty-profile-')), 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'local-label',
    profiles: {
      'local-label': { label: 'Local label', api_base: 'https://api.notis.ai' },
    },
  }));
  const one = await withConfigFileAsync(configFile, () => logoutOAuth(
    {
      profileName: 'local-label',
      apiBase: 'https://api.notis.ai',
      config: normalizeConfig({}),
    },
    {},
    async () => new Response('{}'),
  ));
  const all = await withConfigFileAsync(configFile, () => logoutOAuth(
    {
      profileName: 'local-label',
      apiBase: 'https://api.notis.ai',
      config: normalizeConfig({}),
    },
    { allProfiles: true },
    async () => new Response('{}'),
  ));
  assert.deepEqual(one.profiles, []);
  assert.deepEqual(all.profiles, []);
});

test('logout revokes an access-only OAuth profile before clearing it locally', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-logout-access-only-')), 'config.json');
  const accessToken = makeJwt('access-only-user');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'access-only',
    profiles: {
      'access-only': {
        api_base: 'https://api.notis.ai',
        oauth_access_token: accessToken,
        oauth_access_expires_at: future,
        oauth_client_id: 'notis_cli',
        oauth_issuer: 'https://mcp.notis.ai',
        oauth_api_base: 'https://api.notis.ai',
        oauth_resource: 'https://api.notis.ai/cli',
        oauth_user_id: 'access-only-user',
      },
    },
  }));
  const revoked = [];
  const result = await withConfigFileAsync(configFile, () => logoutOAuth(
    {
      profileName: 'access-only',
      apiBase: 'https://api.notis.ai',
      credentialKind: 'oauth',
      config: normalizeConfig({}),
    },
    {},
    async (url, init) => {
      assert.equal(String(url), 'https://mcp.notis.ai/oauth/revoke');
      revoked.push(new URLSearchParams(init.body).get('token'));
      return new Response('{}');
    },
  ));
  assert.deepEqual(result.profiles, ['access-only']);
  assert.deepEqual(revoked, [accessToken]);
  const stored = JSON.parse(readFileSync(configFile, 'utf-8'));
  assert.equal(stored.profiles['access-only'].oauth_access_token, undefined);
});

test('--all-profiles also cancels pending listeners that have no stored profile yet', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-oauth-logout-all-pending-'));
  const configFile = join(home, 'config.json');
  const profileName = 'pending-all';
  const spawned = spawnFakeListener();
  writeFileSync(listenerStatePath(configFile, profileName), JSON.stringify({
    profile: profileName,
    api_base: 'https://api.notis.ai',
    pid: spawned.pid,
    identity_token: spawned.listenerIdentity,
    listener_script: spawned.listenerScript,
    port: 51997,
    authorize_url: 'https://mcp.notis.ai/oauth/authorize?state=pending-all',
    expires_at: Math.floor(Date.now() / 1000) + 600,
  }));

  try {
    await withConfigFileAsync(configFile, () => logoutOAuth(
      { profileName: 'default', apiBase: 'https://api.notis.ai', config: normalizeConfig({}) },
      { allProfiles: true },
      async () => new Response('{}'),
    ));
    for (let attempt = 0; attempt < 50 && processIsAlive(spawned.pid); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(processIsAlive(spawned.pid), false);
    assert.equal(existsSync(listenerStatePath(configFile, profileName)), false);
    assert.equal(Object.hasOwn(loadConfig().profiles, profileName), false);
  } finally {
    try { process.kill(spawned.pid); } catch { /* already stopped */ }
  }
});

test('--all-profiles waits for a new named listener publication before enumerating', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-oauth-logout-all-race-'));
  const configFile = join(home, 'config.json');
  const profileName = 'new-during-logout';
  const fake = spawnFakeListener();
  let spawnStartedResolve;
  const spawnStarted = new Promise((resolve) => { spawnStartedResolve = resolve; });
  let releaseSpawn;
  const spawnRelease = new Promise((resolve) => { releaseSpawn = resolve; });

  try {
    await withConfigFileAsync(configFile, async () => {
      const login = loginWithOAuth(
        loginRuntime({
          agentMode: true,
          profileName,
          config_file: configFile,
        }),
        {},
        null,
        cliMetadataFetch(),
        undefined,
        async () => {
          spawnStartedResolve();
          await spawnRelease;
          return {
            pid: fake.pid,
            port: 51996,
            redirectUri: 'http://127.0.0.1:51996/callback',
            identityToken: fake.listenerIdentity,
            scriptPath: fake.listenerScript,
          };
        },
      );
      await spawnStarted;
      let logoutFinished = false;
      const logout = logoutOAuth(
        { profileName: 'default', apiBase: 'https://api.notis.ai', config: normalizeConfig({}) },
        { allProfiles: true },
        async () => new Response('{}'),
      ).then((result) => {
        logoutFinished = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(logoutFinished, false, 'all-profile logout must wait on publication');
      releaseSpawn();
      await login;
      const result = await logout;
      assert.ok(result.profiles.includes(profileName));
    });

    for (let attempt = 0; attempt < 50 && processIsAlive(fake.pid); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(processIsAlive(fake.pid), false);
    assert.equal(existsSync(listenerStatePath(configFile, profileName)), false);
  } finally {
    releaseSpawn?.();
    try { process.kill(fake.pid); } catch { /* already stopped */ }
  }
});

test('a foreground authorization already in flight is cancelled by all-profile logout', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-oauth-logout-all-foreground-race-'));
  const configFile = join(home, 'config.json');
  const storedProfile = (userId, refreshToken) => ({
    api_base: 'https://api.notis.ai',
    oauth_access_token: makeJwt(userId),
    oauth_refresh_token: refreshToken,
    oauth_access_expires_at: future,
    oauth_refresh_expires_at: future,
    oauth_client_id: 'notis_cli',
    oauth_issuer: 'https://mcp.notis.ai',
    oauth_api_base: 'https://api.notis.ai',
    oauth_resource: 'https://api.notis.ai/cli',
    oauth_scopes: ['notis:read'],
    oauth_user_id: userId,
  });
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'first',
    profiles: {
      first: storedProfile('first-user', 'first-refresh'),
      second: storedProfile('second-user', 'second-refresh'),
    },
  }));

  await withConfigFileAsync(configFile, async () => {
    let callbackWaitStartedResolve;
    const callbackWaitStarted = new Promise((resolve) => {
      callbackWaitStartedResolve = resolve;
    });
    let releaseCallback;
    const callbackRelease = new Promise((resolve) => { releaseCallback = resolve; });
    let tokenRequests = 0;
    const login = loginWithOAuth(
      loginRuntime({ profileName: 'first', config_file: configFile }),
      { mode: 'browser', browser: false },
      null,
      async (url, init) => {
        if (String(url).endsWith('/oauth/token')) tokenRequests += 1;
        return cliMetadataFetch({ withToken: true })(url, init);
      },
      async () => ({
        redirectUri: 'http://127.0.0.1:51995/callback',
        waitForCode: async () => {
          callbackWaitStartedResolve();
          await callbackRelease;
          return 'foreground-code';
        },
        complete() {},
        fail() {},
        close: async () => {},
      }),
    );
    await callbackWaitStarted;
    assert.equal(existsSync(pendingAuthorizationPath(configFile, 'first')), true);
    const logout = logoutOAuth(
      {
        profileName: 'first',
        apiBase: 'https://api.notis.ai',
        credentialKind: 'oauth',
        config: normalizeConfig({}),
      },
      { allProfiles: true },
      async () => new Response('{}'),
    );
    await logout;
    releaseCallback();
    await assert.rejects(login, (error) => error?.code === 'oauth_listener_cancelled');
    assert.equal(tokenRequests, 0, 'logout must cancel before an OAuth grant is minted');
    assert.equal(loadConfig().profiles.first.oauth_access_token, undefined);
    assert.equal(loadConfig().profiles.second.oauth_access_token, undefined);
  });
});

test('a foreground post-exchange persistence failure revokes the issued grant', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-oauth-foreground-persist-failure-'));
  const configFile = join(home, 'config.json');
  const revoked = [];
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/.well-known/oauth-protected-resource/cli')) {
      return cliMetadataFetch()(url, init);
    }
    if (String(url).includes('/.well-known/oauth-authorization-server')) {
      return cliMetadataFetch()(url, init);
    }
    if (String(url).endsWith('/oauth/token')) {
      return new Response(JSON.stringify({
        access_token: makeJwt('unpersisted-foreground-user'),
        refresh_token: 'unpersisted-foreground-refresh',
        expires_in: 900,
      }));
    }
    if (String(url).endsWith('/oauth/revoke')) {
      revoked.push(new URLSearchParams(init.body).get('token'));
      return new Response('{}');
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  await withConfigFileAsync(configFile, async () => {
    await assert.rejects(
      loginWithOAuth(
        loginRuntime({ config_file: configFile }),
        { mode: 'browser', browser: false },
        null,
        fetchImpl,
        async () => ({
          redirectUri: 'http://127.0.0.1:51994/callback',
          waitForCode: async () => {
            mkdirSync(configFile);
            return 'foreground-code';
          },
          complete() {},
          fail() {},
          close: async () => {},
        }),
      ),
      (error) => error?.code !== 'oauth_listener_cancelled',
    );
  });
  assert.deepEqual(revoked, ['unpersisted-foreground-refresh']);
});

test('--all-profiles clears an unpersisted code-only authorization', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-oauth-logout-all-code-'));
  const configFile = join(home, 'config.json');
  const profileName = 'pending-code-only';
  writeFileSync(pendingAuthorizationPath(configFile, profileName), JSON.stringify({
    profile: profileName,
    verifier: 'pending-verifier',
    redirect_uri: 'https://app.notis.ai/cli-setup/code/bootstrap',
    expires_at: Math.floor(Date.now() / 1000) + 600,
  }));

  await withConfigFileAsync(configFile, () => logoutOAuth(
    { profileName: 'default', apiBase: 'https://api.notis.ai', config: normalizeConfig({}) },
    { allProfiles: true },
    async () => new Response('{}'),
  ));
  assert.equal(existsSync(pendingAuthorizationPath(configFile, profileName)), false);
  assert.equal(Object.hasOwn(loadConfig().profiles, profileName), false);
});

test('single-profile logout waits for code publication and clears the parked verifier', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-oauth-logout-code-race-'));
  const configFile = join(home, 'config.json');
  const profileName = 'pending-code-race';
  let spawnStartedResolve;
  const spawnStarted = new Promise((resolve) => { spawnStartedResolve = resolve; });
  let releaseSpawn;
  const spawnRelease = new Promise((resolve) => { releaseSpawn = resolve; });

  await withConfigFileAsync(configFile, async () => {
    const runtime = loginRuntime({
      agentMode: true,
      profileName,
      config_file: configFile,
    });
    const login = loginWithOAuth(
      runtime,
      {},
      null,
      cliMetadataFetch(),
      undefined,
      async () => {
        spawnStartedResolve();
        await spawnRelease;
        return null;
      },
    );
    await spawnStarted;

    let logoutFinished = false;
    const logout = logoutOAuth(
      { profileName, apiBase: 'https://api.notis.ai', config: normalizeConfig({}) },
      {},
      async () => new Response('{}'),
    ).then((result) => {
      logoutFinished = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(logoutFinished, false, 'logout must wait for code publication');

    releaseSpawn();
    const loginResult = await login;
    assert.equal(loginResult.agentAuthorization.hand_off, 'code');
    assert.equal(existsSync(pendingAuthorizationPath(configFile, profileName)), true);
    await logout;
    assert.equal(existsSync(pendingAuthorizationPath(configFile, profileName)), false);
    await assert.rejects(
      loginWithOAuth(runtime, { code: 'code-from-cleared-browser' }, null, async () => {
        throw new Error('a cleared authorization must fail before exchange');
      }),
      (error) => error?.code === 'oauth_pending_login_missing',
    );
  });
});

test('logout waits for an in-flight refresh, revokes the rotated grant, and clears it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-oauth-logout-refresh-race-'));
  const configFile = join(home, 'config.json');
  const expiredAccessToken = makeJwt('oauth-user', 1);
  const rotatedAccessToken = makeJwt('oauth-user');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'default',
    profiles: {
      default: {
        api_base: 'https://api.notis.ai',
        oauth_access_token: expiredAccessToken,
        oauth_refresh_token: 'old-refresh-token',
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
  let refreshStartedResolve;
  const refreshStarted = new Promise((resolve) => { refreshStartedResolve = resolve; });
  let releaseRefresh;
  const refreshRelease = new Promise((resolve) => { releaseRefresh = resolve; });

  await withConfigFileAsync(configFile, async () => {
    const runtime = {
      apiBase: 'https://api.notis.ai',
      profileName: 'default',
      credentialKind: 'oauth',
      oauthAccessToken: expiredAccessToken,
    };
    const refresh = refreshOAuthCredential(runtime, async () => {
      refreshStartedResolve();
      await refreshRelease;
      return new Response(JSON.stringify({
        access_token: rotatedAccessToken,
        refresh_token: 'rotated-refresh-token',
        expires_in: 3600,
        refresh_expires_in: 7200,
        scope: 'notis:read',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await refreshStarted;

    let revokedToken;
    let logoutFinished = false;
    const logout = logoutOAuth(runtime, {}, async (_url, init) => {
      revokedToken = init.body.get('token');
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }).then((result) => {
      logoutFinished = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(logoutFinished, false, 'logout must wait for refresh persistence');
    assert.equal(revokedToken, undefined, 'logout must not revoke the stale pre-refresh grant');

    releaseRefresh();
    assert.equal(await refresh, true);
    await logout;
    assert.equal(revokedToken, 'rotated-refresh-token');
    const stored = loadConfig().profiles.default;
    assert.equal(stored.oauth_access_token, undefined);
    assert.equal(stored.oauth_refresh_token, undefined);
  });
});

test('a completed in-process login stops the listener a non-blocking run left behind', async () => {
  // Deleting the record alone strands a live child: nothing can find it again,
  // so opening its old URL would sign the profile back in after a logout.
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-supersede-')), 'config.json');
  const fake = spawnFakeListener();
  const stateFile = `${configFile}.login-listener.${createHash('sha256').update('default').digest('hex').slice(0, 16)}`;

  await withConfigFileAsync(configFile, async () => {
    writeFileSync(stateFile, JSON.stringify({
      profile: 'default',
      api_base: 'https://api.notis.ai',
      pid: fake.pid,
      identity_token: fake.listenerIdentity,
      listener_script: fake.listenerScript,
      port: 51991,
      authorize_url: 'https://mcp.notis.ai/oauth/authorize?state=stale',
      expires_at: Math.floor(Date.now() / 1000) + 600,
    }));
    assert.equal(processIsAlive(fake.pid), true);

    await loginWithOAuth(
      loginRuntime({ outputMode: 'table', config_file: configFile }),
      { browser: false, timeoutMs: 5_000 },
      null,
      cliMetadataFetch({ withToken: true }),
      async () => ({
        redirectUri: 'http://127.0.0.1:51992/callback',
        waitForCode: async () => 'interactive-code',
        complete() {},
        fail() {},
        close: async () => {},
      }),
    );
  });

  for (let attempt = 0; attempt < 50 && processIsAlive(fake.pid); attempt += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
  assert.equal(processIsAlive(fake.pid), false, 'the superseded listener must be stopped, not just forgotten');
  assert.equal(existsSync(stateFile), false);
  const saved = JSON.parse(readFileSync(configFile, 'utf-8')).profiles.default;
  assert.equal(saved.oauth_user_id, 'detached-demo-user', 'the in-process login must really have completed');
});

test('a listener authorizing different scopes is replaced instead of reused', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-scopes-')), 'config.json');
  const fake = spawnFakeListener();
  const spawned = [];
  const spawnListener = async (runtime, payload) => {
    spawned.push(payload.scopes);
    return {
      pid: fake.pid,
      port: 51993,
      redirectUri: 'http://127.0.0.1:51993/callback',
      identityToken: fake.listenerIdentity,
      scriptPath: fake.listenerScript,
    };
  };

  const { first, second } = await withConfigFileAsync(configFile, async () => {
    const one = await loginWithOAuth(
      loginRuntime({ agentMode: true, config_file: configFile }),
      {}, null, cliMetadataFetch(), undefined, spawnListener,
    );
    const two = await loginWithOAuth(
      loginRuntime({ agentMode: true, config_file: configFile }),
      { scope: ['notis:read'] }, null, cliMetadataFetch(), undefined, spawnListener,
    );
    return { first: one, second: two };
  });

  assert.equal(spawned.length, 2, 'a narrower --scope must not reuse the earlier authorization');
  assert.deepEqual(spawned[1], ['notis:read']);
  assert.notEqual(second.agentAuthorization.authorize_url, first.agentAuthorization.authorize_url);
  assert.equal(
    new URL(second.agentAuthorization.authorize_url).searchParams.get('scope'),
    'notis:read',
  );
  try { process.kill(fake.pid); } catch { /* already stopped */ }
});

test('a recycled pid is not mistaken for a live listener', async () => {
  // This process is alive and is not a listener, which is exactly the shape a
  // reused pid has after a reboot leaves the record behind.
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-recycled-')), 'config.json');
  const stateFile = `${configFile}.login-listener.${createHash('sha256').update('default').digest('hex').slice(0, 16)}`;
  let spawns = 0;

  const result = await withConfigFileAsync(configFile, async () => {
    writeFileSync(stateFile, JSON.stringify({
      profile: 'default',
      api_base: 'https://api.notis.ai',
      pid: process.pid,
      port: 51994,
      authorize_url: 'https://mcp.notis.ai/oauth/authorize?state=recycled',
      expires_at: Math.floor(Date.now() / 1000) + 600,
    }));
    return loginWithOAuth(
      loginRuntime({ agentMode: true, config_file: configFile }),
      {}, null, cliMetadataFetch(), undefined,
      async () => {
        spawns += 1;
        return { pid: 999_999, port: 51995, redirectUri: 'http://127.0.0.1:51995/callback' };
      },
    );
  });

  assert.equal(spawns, 1, 'a stale record on a recycled pid must not be handed back as live');
  assert.match(result.agentAuthorization.authorize_url, /51995/);
});

test('an explicit --timeout-seconds governs the detached listener', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-timeout-')), 'config.json');
  let handed = null;
  const result = await withConfigFileAsync(configFile, () => loginWithOAuth(
    loginRuntime({ agentMode: true, config_file: configFile }),
    { timeoutSeconds: 90 },
    null,
    cliMetadataFetch(),
    undefined,
    async (runtime, payload) => {
      handed = payload.timeoutMs;
      return { pid: 999_998, port: 51996, redirectUri: 'http://127.0.0.1:51996/callback' };
    },
  ));

  assert.equal(handed, 90_000, 'the documented flag must reach the detached listener');
  assert.equal(result.agentAuthorization.expires_in, 90);
});

test('an explicit --timeout-seconds governs the parked code handoff', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-code-timeout-')), 'config.json');
  const startedAt = Math.floor(Date.now() / 1000);
  const result = await withConfigFileAsync(configFile, () => loginWithOAuth(
    loginRuntime({ outputMode: 'json', config_file: configFile }),
    { mode: 'code', timeoutSeconds: 90 },
    null,
    cliMetadataFetch(),
  ));
  const pending = JSON.parse(readFileSync(pendingAuthorizationPath(configFile), 'utf-8'));
  assert.equal(result.agentAuthorization.expires_in, 90);
  assert.ok(pending.expires_at >= startedAt + 89);
  assert.ok(pending.expires_at <= startedAt + 91);
});

test('a changed explicit timeout replaces a parked code authorization', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-code-timeout-retry-')), 'config.json');
  const { first, second } = await withConfigFileAsync(configFile, async () => ({
    first: await loginWithOAuth(
      loginRuntime({ outputMode: 'json', config_file: configFile }),
      { mode: 'code' },
      null,
      cliMetadataFetch(),
    ),
    second: await loginWithOAuth(
      loginRuntime({ outputMode: 'json', config_file: configFile }),
      { mode: 'code', timeoutSeconds: 30 },
      null,
      cliMetadataFetch(),
    ),
  }));
  assert.notEqual(second.agentAuthorization.authorize_url, first.agentAuthorization.authorize_url);
  assert.equal(second.agentAuthorization.expires_in, 30);
});

test('a changed explicit timeout replaces a detached listener authorization', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-listener-timeout-retry-')), 'config.json');
  const listeners = [spawnFakeListener(), spawnFakeListener()];
  let spawns = 0;
  const spawnListener = async () => {
    const child = listeners[spawns];
    const port = 51980 + spawns;
    spawns += 1;
    return {
      pid: child.pid,
      port,
      redirectUri: `http://127.0.0.1:${port}/callback`,
      identityToken: child.listenerIdentity,
      scriptPath: child.listenerScript,
    };
  };
  try {
    const { first, second } = await withConfigFileAsync(configFile, async () => ({
      first: await loginWithOAuth(
        loginRuntime({ agentMode: true, config_file: configFile }),
        {}, null, cliMetadataFetch(), undefined, spawnListener,
      ),
      second: await loginWithOAuth(
        loginRuntime({ agentMode: true, config_file: configFile }),
        { timeoutSeconds: 30 }, null, cliMetadataFetch(), undefined, spawnListener,
      ),
    }));
    assert.equal(spawns, 2);
    assert.notEqual(second.agentAuthorization.authorize_url, first.agentAuthorization.authorize_url);
    assert.equal(second.agentAuthorization.expires_in, 30);
  } finally {
    for (const child of listeners) {
      try { process.kill(child.pid); } catch { /* already stopped */ }
    }
  }
});

test('a timed-out listener does not delete a newer listener record', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-owner-')), 'config.json');
  const stateFile = `${configFile}.login-listener.${createHash('sha256').update('default').digest('hex').slice(0, 16)}`;
  await withConfigFileAsync(configFile, async () => {
    writeFileSync(stateFile, JSON.stringify({
      profile: 'default',
      api_base: 'https://api.notis.ai',
      pid: 4_242_424,
      port: 51997,
      authorize_url: 'https://mcp.notis.ai/oauth/authorize?state=newer',
      expires_at: Math.floor(Date.now() / 1000) + 600,
    }));
    // An older child cleaning up must leave a record naming a different pid.
    clearListenerState({ profileName: 'default' }, { ownerPid: 111_111 });
    assert.equal(existsSync(stateFile), true, 'a stale child must not delete a newer record');
    clearListenerState({ profileName: 'default' }, { ownerPid: 4_242_424 });
    assert.equal(existsSync(stateFile), false, 'its own record must still be removed');
  });
});

test('a degraded login reuses its parked authorization instead of invalidating the URL already handed out', async () => {
  // The code a browser returns can only be redeemed against the verifier parked
  // with it, so re-minting one silently breaks the URL the user already has.
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-degrade-')), 'config.json');
  let listenerAttempts = 0;
  const login = () => loginWithOAuth(
    loginRuntime({ agentMode: true, config_file: configFile }),
    {}, null, cliMetadataFetch(), undefined, async () => {
      listenerAttempts += 1;
      if (listenerAttempts === 1) return null;
      return {
        pid: process.pid,
        port: 51_234,
        redirectUri: 'http://127.0.0.1:51234/callback',
        identityToken: 'must-not-be-published',
        scriptPath: '/tmp/login-listener.js',
      };
    },
  );

  const { first, second } = await withConfigFileAsync(configFile, async () => {
    const one = await login();
    const two = await login();
    return { first: one, second: two };
  });

  assert.equal(first.agentAuthorization.hand_off, 'code');
  assert.equal(second.agentAuthorization.hand_off, 'code');
  assert.equal(
    second.agentAuthorization.authorize_url,
    first.agentAuthorization.authorize_url,
    'a second degraded run must not re-mint the parked authorization',
  );
  assert.equal(listenerAttempts, 1, 'the retry must reuse the parked code before spawning a listener');
});

test('a host whose loopback the user cannot reach starts on the code flow', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-ssh-')), 'config.json');
  let spawned = false;
  const result = await withConfigFileAsync(configFile, () => loginWithOAuth(
    loginRuntime({
      agentMode: true,
      config_file: configFile,
      hostEnvironment: { SSH_CONNECTION: '10.0.0.2 51000 10.0.0.9 22' },
    }),
    {}, null, cliMetadataFetch(), undefined,
    async () => { spawned = true; return null; },
  ));
  assert.equal(spawned, false, 'no listener should be started for a browser that cannot reach it');
  assert.equal(result.agentAuthorization.hand_off, 'code');
  assert.equal(
    new URL(result.agentAuthorization.authorize_url).searchParams.get('redirect_uri'),
    'https://app.notis.ai/cli-setup/code/bootstrap',
  );
});

test('--mode browser still forces the loopback on a remote host', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-ssh-forced-')), 'config.json');
  const previous = process.env.SSH_CONNECTION;
  process.env.SSH_CONNECTION = '10.0.0.2 51000 10.0.0.9 22';
  let receiverCreated = false;
  try {
    await assert.rejects(
      withConfigFileAsync(configFile, () => loginWithOAuth(
        loginRuntime({ outputMode: 'json', config_file: configFile }),
        { mode: 'browser', browser: false, timeoutMs: 20 },
        { note() {} },
        cliMetadataFetch(),
        async (opts) => { receiverCreated = true; return createLoopbackReceiver(opts); },
      )),
      (error) => error.code === 'oauth_timeout',
    );
    assert.ok(receiverCreated, 'an explicit --mode browser must override the remote-host heuristic');
  } finally {
    if (previous === undefined) delete process.env.SSH_CONNECTION;
    else process.env.SSH_CONNECTION = previous;
  }
});

test('redeeming a code stops a listener an earlier run left in flight', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-redeem-stop-')), 'config.json');
  const fake = spawnFakeListener();
  const stateFile = `${configFile}.login-listener.${createHash('sha256').update('default').digest('hex').slice(0, 16)}`;

  await withConfigFileAsync(configFile, async () => {
    const started = await loginWithOAuth(
      loginRuntime({ agentMode: true, config_file: configFile }),
      {}, null, cliMetadataFetch(), undefined, async () => null,
    );
    assert.equal(started.agentAuthorization.hand_off, 'code');
    writeFileSync(stateFile, JSON.stringify({
      profile: 'default',
      api_base: 'https://api.notis.ai',
      pid: fake.pid,
      identity_token: fake.listenerIdentity,
      listener_script: fake.listenerScript,
      port: 51998,
      authorize_url: 'https://mcp.notis.ai/oauth/authorize?state=inflight',
      expires_at: Math.floor(Date.now() / 1000) + 600,
    }));
    await loginWithOAuth(
      loginRuntime({ agentMode: true, config_file: configFile }),
      { code: 'redeemed-code' },
      null,
      cliMetadataFetch({ withToken: true }),
    );
  });

  for (let attempt = 0; attempt < 50 && processIsAlive(fake.pid); attempt += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
  assert.equal(processIsAlive(fake.pid), false, 'redeeming a code must end an authorization still in flight');
});

test('a reused parked authorization reports the code hand-off it documents', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-handoff-')), 'config.json');
  const { first, second } = await withConfigFileAsync(configFile, async () => {
    const runtime = () => loginRuntime({ agentMode: true, config_file: configFile });
    const one = await loginWithOAuth(runtime(), { mode: 'code' }, null, cliMetadataFetch());
    const two = await loginWithOAuth(runtime(), { mode: 'code' }, null, cliMetadataFetch());
    return { first: one, second: two };
  });
  assert.equal(first.agentAuthorization.hand_off, 'code');
  assert.equal(second.agentAuthorization.hand_off, 'code', 'the reuse branch must not omit hand_off');
  assert.equal(second.agentAuthorization.authorize_url, first.agentAuthorization.authorize_url);
});

test('a non-interactive run that degrades returns the URL instead of prompting on stdin', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-noninteractive-')), 'config.json');
  const result = await withConfigFileAsync(configFile, () => loginWithOAuth(
    loginRuntime({ outputMode: 'table', nonInteractive: true, config_file: configFile }),
    { browser: false },
    { note() {} },
    cliMetadataFetch(),
    async () => { throw new Error('EACCES: cannot bind 127.0.0.1'); },
    async () => null,
  ));
  assert.equal(result.agentAuthorization.hand_off, 'code');
  assert.match(result.agentAuthorization.redeem_command, /login --code <code>$/);
});

test('an explicit code hand-off never prompts during a non-interactive run', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-noninteractive-code-')), 'config.json');
  let readCodeCalls = 0;
  const result = await withConfigFileAsync(configFile, () => loginWithOAuth(
    loginRuntime({ outputMode: 'table', nonInteractive: true, config_file: configFile }),
    { mode: 'code' },
    null,
    cliMetadataFetch(),
    undefined,
    undefined,
    async () => {
      readCodeCalls += 1;
      throw new Error('non-interactive login must not read stdin');
    },
  ));
  assert.equal(readCodeCalls, 0);
  assert.equal(result.agentAuthorization.hand_off, 'code');
  assert.match(result.agentAuthorization.redeem_command, /login --code <code>$/);
});

test('a remote auto hand-off never prompts during a non-interactive run', async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), 'notis-oauth-noninteractive-remote-')), 'config.json');
  let readCodeCalls = 0;
  const result = await withConfigFileAsync(configFile, () => loginWithOAuth(
    loginRuntime({
      outputMode: 'table',
      nonInteractive: true,
      config_file: configFile,
      hostEnvironment: { SSH_CONNECTION: '203.0.113.1 12345 203.0.113.2 22' },
      hostPlatform: 'linux',
    }),
    {},
    null,
    cliMetadataFetch(),
    undefined,
    undefined,
    async () => {
      readCodeCalls += 1;
      throw new Error('non-interactive login must not read stdin');
    },
  ));
  assert.equal(readCodeCalls, 0);
  assert.equal(result.agentAuthorization.hand_off, 'code');
  assert.match(result.agentAuthorization.redeem_command, /login --code <code>$/);
});
