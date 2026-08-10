import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getAuthRecovery } from '../src/runtime/auth-recovery.js';

// CONFIG_FILE is derived from homedir() at import time, so each case points HOME
// at a scratch directory and re-imports the module with a cache-busting query.
async function loadProfilesWithHome(home, cacheKey) {
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    return await import(`../src/runtime/profiles.js?home=${cacheKey}`);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
}

test('loadConfig degrades to unauthenticated when the config file is corrupt', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-cli-corrupt-'));
  mkdirSync(join(home, '.notis'), { recursive: true });
  // A half-written file is the expected shape here: one `notis` process
  // rewrites config.json while another is reading it.
  writeFileSync(join(home, '.notis', 'config.json'), '{"oauth_access_token": "abc', 'utf-8');

  const profiles = await loadProfilesWithHome(home, 'corrupt');
  const config = profiles.loadConfig();

  assert.equal(profiles.profileHasCredential(profiles.getProfile(config, 'default')), false);
  assert.equal(config.current_profile, 'default');
});

test('loadConfig still reads a well-formed config file', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-cli-valid-'));
  mkdirSync(join(home, '.notis'), { recursive: true });
  writeFileSync(
    join(home, '.notis', 'config.json'),
    JSON.stringify({
      current_profile: 'work',
      profiles: {
        default: {},
        work: { oauth_access_token: 'token-123', api_base: 'https://api-beta.notis.ai' },
      },
    }),
    'utf-8',
  );

  const profiles = await loadProfilesWithHome(home, 'valid');
  const config = profiles.loadConfig();

  assert.equal(config.current_profile, 'work');
  assert.equal(profiles.getProfile(config, 'work').oauth_access_token, 'token-123');
  assert.equal(profiles.getApiBase(config, 'work'), 'https://api-beta.notis.ai');
});

// A credential the desktop app wrote is not one anything renews now. Keeping it
// readable would leave upgraded machines authenticating with a token that
// silently stops working, instead of pointing them at `notis login`.
test('a credential left behind by Notis Desktop no longer authenticates the CLI', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-cli-legacy-desktop-'));
  mkdirSync(join(home, '.notis'), { recursive: true });
  writeFileSync(
    join(home, '.notis', 'config.json'),
    JSON.stringify({
      current_profile: 'default',
      profiles: {
        default: {
          jwt: 'desktop-supabase-token',
          access_expires_at: 4_102_444_800,
          desktop_app_name: 'Notis',
          desktop_pid: 4242,
        },
      },
    }),
    'utf-8',
  );

  const profiles = await loadProfilesWithHome(home, 'legacy-desktop');
  const profile = profiles.getProfile(profiles.loadConfig(), 'default');

  assert.equal(profile.jwt, undefined);
  assert.equal(profile.desktop_app_name, undefined);
  assert.equal(profile.desktop_pid, undefined);
  assert.equal(profiles.profileHasCredential(profile), false);
});

test('ordinary CLI config writes preserve legacy Desktop auth until packaged migration', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-cli-legacy-desktop-preserve-'));
  const configFile = join(home, '.notis', 'config.json');
  mkdirSync(join(home, '.notis'), { recursive: true });
  const legacy = {
    jwt: 'legacy-desktop-token',
    auth_mode: 'dev_portal',
    refresh_token: 'legacy-refresh-token',
    access_expires_at: 4_102_444_800,
    refresh_expires_at: 4_102_444_900,
    desktop_app_name: 'Notis',
    desktop_pid: 4242,
  };
  writeFileSync(
    configFile,
    JSON.stringify({
      current_profile: 'default',
      profiles: { default: { ...legacy, api_base: 'https://api.notis.ai' } },
    }),
    'utf-8',
  );

  const profiles = await loadProfilesWithHome(home, 'legacy-desktop-preserve');
  profiles.updateConfig((config) => {
    config.profiles.default.label = 'Account';
    return config;
  });

  const raw = JSON.parse(readFileSync(configFile, 'utf-8'));
  assert.deepEqual(
    Object.fromEntries(Object.keys(legacy).map((key) => [key, raw.profiles.default[key]])),
    legacy,
  );
  assert.equal(raw.profiles.default.label, 'Account');
  assert.equal(profiles.profileHasCredential(profiles.loadConfig().profiles.default), false);
});

test('legacy profile names remain usable and survive later config writes', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-cli-legacy-profile-name-'));
  const configFile = join(home, '.notis', 'config.json');
  const legacyName = 'Work account — Zürich';
  mkdirSync(join(home, '.notis'), { recursive: true });
  writeFileSync(
    configFile,
    JSON.stringify({
      current_profile: legacyName,
      profiles: {
        default: {},
        [legacyName]: {
          api_base: 'https://api.notis.ai',
          oauth_access_token: 'legacy-oauth-token',
          oauth_access_expires_at: 4_102_444_800,
          oauth_user_id: 'legacy-user',
        },
      },
    }),
    'utf-8',
  );

  const profiles = await loadProfilesWithHome(home, 'legacy-profile-name');
  const loaded = profiles.loadConfig();
  assert.equal(loaded.current_profile, legacyName);
  assert.equal(profiles.profileExists(loaded, legacyName), true);
  assert.equal(profiles.getProfile(loaded, legacyName).oauth_access_token, 'legacy-oauth-token');

  profiles.updateConfig((config) => {
    config.current_profile = 'default';
    return config;
  });
  const raw = JSON.parse(readFileSync(configFile, 'utf-8'));
  assert.equal(raw.profiles[legacyName].oauth_access_token, 'legacy-oauth-token');
});

test('worktree cleanup preserves raw legacy Desktop auth until packaged migration', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-cli-archive-preserves-legacy-'));
  const configFile = join(home, '.notis', 'config.json');
  mkdirSync(join(home, '.notis'), { recursive: true });
  writeFileSync(
    configFile,
    JSON.stringify({
      current_profile: 'dev-owned',
      future_top_level: 'preserve-me',
      profiles: {
        default: {
          jwt: 'legacy-desktop-token',
          access_expires_at: 4_102_444_800,
          desktop_app_name: 'Notis',
          future_profile_field: 'preserve-me-too',
        },
        'dev-owned': {
          dev_access_token: 'dev-token',
          dev_workspace_root: '/worktree/owned',
        },
        'dev-other': {
          dev_access_token: 'other-token',
          dev_workspace_root: '/worktree/other',
        },
      },
    }),
    'utf-8',
  );

  const profiles = await loadProfilesWithHome(home, 'archive-preserves-legacy');
  const removed = profiles.removeOwnedDevProfiles(
    ['dev-owned', 'dev-other'],
    '/worktree/owned',
  );
  const raw = JSON.parse(readFileSync(configFile, 'utf-8'));

  assert.deepEqual(removed, ['dev-owned']);
  assert.equal(raw.current_profile, 'default');
  assert.equal(raw.future_top_level, 'preserve-me');
  assert.equal(raw.profiles.default.jwt, 'legacy-desktop-token');
  assert.equal(raw.profiles.default.desktop_app_name, 'Notis');
  assert.equal(raw.profiles.default.future_profile_field, 'preserve-me-too');
  assert.equal(raw.profiles['dev-other'].dev_access_token, 'other-token');
  assert.equal(Object.hasOwn(raw.profiles, 'dev-owned'), false);
});

test('config writes recover an aged ownerless lock from an interrupted acquisition', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-cli-ownerless-lock-'));
  const configDir = join(home, '.notis');
  const lockDirectory = join(configDir, 'config.json.write-lock');
  mkdirSync(lockDirectory, { recursive: true });
  const stale = new Date(Date.now() - 10_000);
  utimesSync(lockDirectory, stale, stale);

  const profiles = await loadProfilesWithHome(home, 'ownerless-lock');
  profiles.saveConfig(profiles.normalizeConfig({
    current_profile: 'default',
    profiles: { default: { oauth_access_token: 'recovered-token' } },
  }));

  assert.equal(
    JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'))
      .profiles.default.oauth_access_token,
    'recovered-token',
  );
});

test('missing credentials do not tell the caller to renew a session they never had', () => {
  const runtime = { profileName: 'default', apiBase: 'https://api.notis.ai' };

  const missing = getAuthRecovery(runtime, { mode: 'missing' });
  assert.equal(
    missing.hints[0].command,
    'npx --package @notis_ai/cli@latest -- notis login',
  );
  assert.ok(missing.hints.every((hint) => !/renew/i.test(hint.reason)));

  const expired = getAuthRecovery(runtime);
  assert.match(expired.hints[0].reason, /fresh/i);
});

// Recovery advice that names the wrong profile sends someone to authorize an
// account they are not running as, which looks like a no-op and is worse than
// no hint at all.
test('recovery hints target the profile that actually failed', () => {
  const hints = getAuthRecovery({ profileName: 'work' }, { mode: 'missing' }).hints;
  assert.equal(
    hints[0].command,
    "npx --package @notis_ai/cli@latest -- notis login --profile 'work'",
  );
  assert.equal(
    hints[2].command,
    "npx --package @notis_ai/cli@latest -- notis doctor --profile 'work'",
  );
});

test('profile inspection reports the OAuth-owned endpoint over stale legacy routing', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-cli-oauth-endpoint-'));
  const profiles = await loadProfilesWithHome(home, 'oauth-endpoint');
  const listed = profiles.listProfiles({
    current_profile: 'default',
    profiles: {
      default: {
        api_base: 'http://localhost:4311',
        oauth_api_base: 'https://api.notis.ai',
        oauth_access_token: 'oauth-token',
      },
    },
  });

  assert.equal(listed[0].api_base, 'https://api.notis.ai');
});

function readLockConstants(source) {
  return Object.fromEntries(
    [...source.matchAll(/const (CONFIG_WRITE_LOCK_[A-Z_]+) = ([\d_]+);/g)]
      .map(([, name, value]) => [name, Number(value.replaceAll('_', ''))]),
  );
}

// Independent `notis` processes serialize writes to ~/.notis/config.json only
// through a lock directory on disk, so the timings have to stay internally
// consistent for the reclaim path to be safe.
test('the config write lock keeps staleness inside its acquisition window', () => {
  const cliSource = readFileSync(
    new URL('../src/runtime/profiles.js', import.meta.url),
    'utf-8',
  );

  const cliConstants = readLockConstants(cliSource);
  // A rename must fail here rather than silently compare {} to {}.
  assert.equal(Object.keys(cliConstants).length, 3);
  assert.ok(cliSource.includes('`${configFile}.write-lock`'));

  // A stale lock is only reclaimable while a waiter is still inside its
  // acquisition window, so staleness must stay below the acquire timeout.
  assert.ok(cliConstants.CONFIG_WRITE_LOCK_STALE_MS < cliConstants.CONFIG_WRITE_LOCK_TIMEOUT_MS);
});

// Notis Desktop reimplements this lock independently, to scrub the credential
// older builds wrote into the CLI's config. The two packages coordinate only
// through the lock directory on disk, so nothing but this test keeps them
// agreeing on it.
//
// This suite is published standalone to the public notis-cli mirror, which
// copies packages/cli and deliberately not electron/. Reading the counterpart
// unconditionally made every mirror CI run fail on ENOENT. Skipping when the
// file is absent would be worse: a rename in the monorepo would silently
// retire the check. So decide from the checkout, not from the file — inside
// the monorepo the counterpart must exist.
test('the desktop config write lock has not drifted from the CLI one', () => {
  const electronPackage = new URL('../../../electron/package.json', import.meta.url);
  const desktopSessionPath = new URL('../../../electron/src/desktop-session.ts', import.meta.url);
  if (!existsSync(electronPackage)) {
    // Standalone mirror: there is no second implementation to drift from.
    return;
  }

  assert.ok(
    existsSync(desktopSessionPath),
    'electron/src/desktop-session.ts is missing: if it moved, re-point this drift check at its new home rather than deleting it',
  );

  const cliSource = readFileSync(
    new URL('../src/runtime/profiles.js', import.meta.url),
    'utf-8',
  );
  const desktopSource = readFileSync(desktopSessionPath, 'utf-8');
  const cliConstants = readLockConstants(cliSource);
  const desktopConstants = readLockConstants(desktopSource);

  assert.equal(Object.keys(desktopConstants).length, 3);
  assert.deepEqual(desktopConstants, cliConstants);
  assert.ok(desktopSource.includes('`${configFile}.write-lock`'));
});
