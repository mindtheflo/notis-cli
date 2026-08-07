import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDesktopAuthRecovery } from '../src/runtime/desktop-auth.js';

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
  // A half-written file is the expected shape here: the desktop app rewrites
  // config.json while `notis start` is polling it.
  writeFileSync(join(home, '.notis', 'config.json'), '{"jwt": "abc', 'utf-8');

  const profiles = await loadProfilesWithHome(home, 'corrupt');
  const config = profiles.loadConfig();

  assert.equal(profiles.getJwt(config, 'default'), undefined);
  assert.equal(config.current_profile, 'default');
});

test('loadConfig still reads a well-formed config file', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-cli-valid-'));
  mkdirSync(join(home, '.notis'), { recursive: true });
  writeFileSync(
    join(home, '.notis', 'config.json'),
    JSON.stringify({ current_profile: 'default', profiles: { default: { jwt: 'token-123' } } }),
    'utf-8',
  );

  const profiles = await loadProfilesWithHome(home, 'valid');
  const config = profiles.loadConfig();

  const previousEnvJwt = process.env.NOTIS_JWT;
  delete process.env.NOTIS_JWT;
  try {
    assert.equal(profiles.getJwt(config, 'default'), 'token-123');
  } finally {
    if (previousEnvJwt !== undefined) process.env.NOTIS_JWT = previousEnvJwt;
  }
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
    profiles: { default: { jwt: 'recovered-token' } },
  }));

  assert.equal(
    JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'))
      .profiles.default.jwt,
    'recovered-token',
  );
});

test('missing credentials do not tell the caller to renew a session they never had', () => {
  const runtime = { apiBase: 'https://api.notis.ai', desktopPid: undefined };

  const missing = getDesktopAuthRecovery(runtime, { mode: 'missing' });
  assert.equal(missing.hints[0].command, 'notis login');
  assert.ok(missing.hints.every((hint) => !/renew/i.test(hint.reason)));

  const expired = getDesktopAuthRecovery(runtime);
  assert.match(expired.hints[0].reason, /renew/i);
});

// Notis Desktop and the npx CLI are separate packages that serialize writes to
// ~/.notis/config.json only through a lock directory on disk. Nothing but this
// test keeps the two independent implementations agreeing on that protocol.
test('the desktop and CLI config write locks share the same lock directory and timings', () => {
  const readLockConstants = (source) => Object.fromEntries(
    [...source.matchAll(/const (CONFIG_WRITE_LOCK_[A-Z_]+) = ([\d_]+);/g)]
      .map(([, name, value]) => [name, Number(value.replaceAll('_', ''))]),
  );
  const cliSource = readFileSync(
    new URL('../src/runtime/profiles.js', import.meta.url),
    'utf-8',
  );
  const desktopSource = readFileSync(
    new URL('../../../electron/src/cli-auth.ts', import.meta.url),
    'utf-8',
  );

  const cliConstants = readLockConstants(cliSource);
  // A rename on the CLI side must fail here rather than silently compare {} to {}.
  assert.equal(Object.keys(cliConstants).length, 3);
  assert.deepEqual(readLockConstants(desktopSource), cliConstants);
  for (const source of [cliSource, desktopSource]) {
    assert.ok(source.includes('`${configFile}.write-lock`'));
  }

  // A stale lock is only reclaimable while a waiter is still inside its
  // acquisition window, so staleness must stay below the acquire timeout.
  assert.ok(cliConstants.CONFIG_WRITE_LOCK_STALE_MS < cliConstants.CONFIG_WRITE_LOCK_TIMEOUT_MS);
});
