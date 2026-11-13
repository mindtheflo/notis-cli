import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { installSkillSyncService } from '../src/runtime/skill-sync-service.js';
import { main as runSkillSyncWorker, runAutomaticSkillSync, signInFingerprint } from '../src/skill-sync-worker.js';
import { syncSkillsHandler } from '../src/command-specs/skills.js';
import { refreshTokenFingerprint, resolveRuntimeProfile } from '../src/runtime/profiles.js';

const account = { profile: 'beta', apiBase: 'https://api-nightly.notis.ai', userId: 'owner' };
const runtime = () => ({ profileName: account.profile, apiBase: account.apiBase, oauthUserId: 'owner', credentialKind: 'oauth', jwt: 'expired' });

test('automatic sync refreshes its own OAuth grant and works without a desktop session', async () => {
  const live = runtime();
  let locked = false;
  const result = await runAutomaticSkillSync(account, {
    resolveRuntime: () => live,
    refresh: async value => { value.jwt = 'fresh'; },
    settings: async (_url, token) => {
      assert.equal(token, 'fresh');
      return { user_id: 'owner', sync_enabled: true };
    },
    lock: async fn => { locked = true; return fn(); },
    sync: async (_url, token, deps, options) => {
      assert.equal(token, 'fresh');
      assert.equal(locked, true);
      assert.equal((await deps.fetchSyncSettings()).user_id, 'owner');
      assert.equal(options.honorSyncEnabled, true);
      return { linked: 2 };
    },
  });
  assert.equal(result.status, 'synced');
  assert.equal(result.linked, 2);
});

test('disabled automatic sync never acquires a lock or cleans another account links', async () => {
  const result = await runAutomaticSkillSync(account, {
    resolveRuntime: runtime, refresh: async () => {},
    settings: async () => ({ user_id: 'owner', sync_enabled: false }),
    lock: async () => assert.fail('opt-out must not touch account files'),
  });
  assert.equal(result.status, 'disabled');
});

test('changed profile identity or endpoint cannot silently rebind the background job', async () => {
  for (const patch of [
    { oauthUserId: 'other' },
    { apiBase: 'https://api.notis.ai' },
    { apiBase: 'https://api.notis.ai', oauthApiBase: 'https://api.notis.ai' },
    { credentialKind: 'dev' },
  ]) {
    await assert.rejects(runAutomaticSkillSync(account, {
      resolveRuntime: () => ({ ...runtime(), ...patch }),
      refresh: async () => assert.fail('must reject before using credentials'),
    }), /account changed/);
  }
  await assert.rejects(runAutomaticSkillSync(account, {
    resolveRuntime: runtime, refresh: async () => {},
    settings: async () => ({ user_id: 'other', sync_enabled: true }),
    lock: async () => assert.fail('must reject before writes'),
  }), /identity mismatch/);
});

// The worker runs every minute. A sign-in the server rejected can only fail
// the same way again, so the worker waits until that sign-in changes.
function workerHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'notis-service-worker-'));
  const exitCode = process.exitCode;
  t.after(() => {
    process.exitCode = exitCode;
    rmSync(home, { recursive: true, force: true });
  });
  return { home, status: join(home, '.notis', 'skills', 'service', 'status.json') };
}

const workerArgs = [account.profile, account.apiBase, account.userId];

function failingWith(code, counter) {
  return async () => {
    counter.runs += 1;
    throw Object.assign(new Error('failed'), { code });
  };
}

test('background sync stops presenting a rejected sign-in until it changes', async t => {
  const { home, status } = workerHome(t);
  const counter = { runs: 0 };
  const rejected = failingWith('invalid_grant', counter);
  await runSkillSyncWorker(workerArgs, { home, run: rejected, fingerprint: () => 'sign-in-1' });
  const first = JSON.parse(readFileSync(status, 'utf8'));
  assert.equal(counter.runs, 1);
  assert.deepEqual(
    { status: first.status, code: first.code, sign_in: first.sign_in, profile: first.profile },
    { status: 'error', code: 'invalid_grant', sign_in: 'sign-in-1', profile: 'beta' },
  );

  // The same sign-in is not presented again and the status stays as it was.
  await runSkillSyncWorker(workerArgs, { home, run: rejected, fingerprint: () => 'sign-in-1' });
  assert.equal(counter.runs, 1);
  assert.equal(readFileSync(status, 'utf8'), JSON.stringify(first, null, 2));

  // A new sign-in, from `notis login` or a renewal by another process, is used.
  await runSkillSyncWorker(workerArgs, {
    home,
    run: async () => {
      counter.runs += 1;
      return { status: 'synced' };
    },
    fingerprint: () => 'sign-in-2',
  });
  assert.equal(counter.runs, 2);
  assert.equal(JSON.parse(readFileSync(status, 'utf8')).status, 'synced');
});

// CLI-035: a dead grant routes to stable, but the worker is bound to the
// grant's own API, so it reaches the refresh and records the refusal.
test('background sync of a grant the server refused records the refusal, not an account change', async t => {
  const { home, status } = workerHome(t);
  const configFile = join(home, 'config.json');
  writeFileSync(configFile, JSON.stringify({
    current_profile: 'beta',
    profiles: {
      beta: {
        api_base: 'https://api-nightly.notis.ai',
        oauth_api_base: 'https://api-nightly.notis.ai',
        oauth_access_token: 'expired',
        oauth_refresh_token: 'beta-refresh',
        oauth_refresh_rejected_for: refreshTokenFingerprint('beta-refresh'),
        oauth_access_expires_at: 1,
        oauth_refresh_expires_at: 2,
        oauth_client_id: 'notis_cli',
        oauth_issuer: 'https://mcp-nightly.notis.ai',
        oauth_user_id: 'owner',
      },
    },
  }));
  const previous = {
    NOTIS_CLI_CONFIG_FILE: process.env.NOTIS_CLI_CONFIG_FILE,
    NOTIS_TEST_DISABLE_WORKTREE_ROUTING: process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING,
    NOTIS_API_BASE: process.env.NOTIS_API_BASE,
    NOTIS_JWT: process.env.NOTIS_JWT,
  };
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.NOTIS_CLI_CONFIG_FILE = configFile;
  process.env.NOTIS_TEST_DISABLE_WORKTREE_ROUTING = '1';
  delete process.env.NOTIS_API_BASE;
  delete process.env.NOTIS_JWT;
  assert.equal(resolveRuntimeProfile({ profile: 'beta' }).apiBase, 'https://api.notis.ai');
  const refreshed = [];
  await runSkillSyncWorker(workerArgs, {
    home,
    run: (bound) => runAutomaticSkillSync(bound, {
      refresh: async (runtime) => {
        refreshed.push(runtime.oauthApiBase);
        throw Object.assign(new Error('The refresh token is invalid.'), { code: 'invalid_grant' });
      },
    }),
  });
  assert.deepEqual(refreshed, ['https://api-nightly.notis.ai']);
  const recorded = JSON.parse(readFileSync(status, 'utf8'));
  assert.equal(recorded.code, 'invalid_grant');
  assert.equal(recorded.sign_in, signInFingerprint('beta'));
});

test('background sync keeps trying after failures that leave the sign-in usable', async t => {
  const { home, status } = workerHome(t);
  const counter = { runs: 0 };
  const unknown = failingWith('oauth_refresh_outcome_unknown', counter);
  await runSkillSyncWorker(workerArgs, { home, run: unknown, fingerprint: () => 'sign-in-1' });
  assert.equal(JSON.parse(readFileSync(status, 'utf8')).sign_in, undefined);
  await runSkillSyncWorker(workerArgs, { home, run: unknown, fingerprint: () => 'sign-in-1' });
  assert.equal(counter.runs, 2);

  // A rejection recorded for another profile does not hold this one back.
  mkdirSync(join(home, '.notis', 'skills', 'service'), { recursive: true });
  writeFileSync(status, JSON.stringify({ status: 'error', code: 'invalid_grant', sign_in: 'sign-in-1', profile: 'other' }));
  await runSkillSyncWorker(workerArgs, { home, run: unknown, fingerprint: () => 'sign-in-1' });
  assert.equal(counter.runs, 3);
});

test('the sign-in fingerprint follows every renewal and holds no credential', () => {
  const profile = {
    oauth_access_token: 'access-token-value',
    oauth_refresh_token: 'refresh-token-value',
    oauth_client_id: 'notis_cli',
    oauth_issuer: 'https://mcp.notis.ai',
    oauth_user_id: 'owner',
    oauth_access_expires_at: 1000,
    oauth_refresh_expires_at: 2000,
  };
  const config = (patch = {}) => ({ current_profile: 'beta', profiles: { beta: { ...profile, ...patch } } });
  const value = signInFingerprint('beta', config());
  assert.match(value, /^[0-9a-f]{16}$/);
  // The tokens themselves are never part of it.
  assert.equal(signInFingerprint('beta', config({ oauth_refresh_token: 'another-value' })), value);
  // A renewal or a new sign-in changes it.
  assert.notEqual(signInFingerprint('beta', config({ oauth_access_expires_at: 1900 })), value);
  assert.notEqual(signInFingerprint('beta', config({ oauth_client_id: 'notis_cli_2' })), value);
  assert.equal(signInFingerprint('missing', config()), null);
});

test('LaunchAgent survives npm cache removal, has no secrets and is idempotent', async t => {
  const home = mkdtempSync(join(tmpdir(), 'notis-service-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const source = join(home, 'source.mjs');
  writeFileSync(source, 'process.exit(0);');
  let loaded = false;
  const calls = [];
  const options = { home, source, platform: 'darwin', nodePath: '/node & tools/node', uid: 123,
    run: (_command, args) => {
      calls.push(args);
      if (args[0] === 'print') return { status: loaded ? 0 : 1 };
      if (args[0] === 'bootstrap') loaded = true;
      return { status: 0 };
    },
  };
  assert.equal((await installSkillSyncService(runtime(), options)).status, 'installed');
  const plist = readFileSync(join(home, 'Library/LaunchAgents/ai.notis.skills-sync.plist'), 'utf8');
  assert.match(plist, /StartInterval<\/key><integer>60/);
  assert.match(plist, /node &amp; tools/);
  assert.ok(!plist.includes('expired'));
  assert.ok(!plist.includes(source));
  assert.equal((await installSkillSyncService(runtime(), options)).status, 'installed');
  assert.equal(calls.filter(args => args[0] === 'bootstrap').length, 1);
});

test('dev and hosted profiles cannot enroll a global sync job', async () => {
  const run = () => assert.fail('must not call launchctl');
  for (const patch of [{ credentialKind: 'dev' }, { apiBase: 'http://localhost:1234' }, { credentialKind: 'env' }]) {
    assert.equal((await installSkillSyncService({ ...runtime(), ...patch }, { platform: 'darwin', run })).status, 'skipped_non_personal_profile');
  }
});

test('manual sync uses refreshed OAuth and canonical account before reconciliation', async () => {
  const ctx = { runtime: runtime(), options: {}, output: { emitSuccess: value => value } };
  const response = await syncSkillsHandler(ctx, {
    onCloudComputer: () => false,
    refresh: async value => { value.jwt = 'fresh'; },
    loadEngine: async () => ({
      fetchSyncSettings: async (_url, token) => {
        assert.equal(token, 'fresh');
        return { user_id: 'canonical', sync_enabled: true };
      },
      runSkillSync: async () => ({}),
    }),
    reconcile: async options => {
      assert.equal(options.jwt, 'fresh');
      assert.equal(options.userId, 'canonical');
      return { syncEnabled: true, baseSkills: [], failedPushes: [] };
    },
    install: () => ({ status: 'installed' }),
  });
  assert.equal(response.data.automaticSync.status, 'installed');
});

test('manual sync on the cloud computer leaves the Notis-owned root alone and prunes dead links', async () => {
  const home = mkdtempSync(join(tmpdir(), 'notis-cloud-sync-'));
  try {
    const live = join(home, '.notis', 'skills', 'pptx');
    mkdirSync(live, { recursive: true });
    const agentDir = join(home, '.codex', 'skills');
    mkdirSync(agentDir, { recursive: true });
    symlinkSync('../../.notis/skills/users/owner/skills/native-x', join(agentDir, 'native-x'));
    symlinkSync(live, join(agentDir, 'pptx'));
    symlinkSync('/elsewhere/missing', join(agentDir, 'foreign'));
    const ctx = { runtime: runtime(), options: {}, output: { emitSuccess: value => value } };
    const response = await syncSkillsHandler(ctx, {
      onCloudComputer: () => true,
      home,
      refresh: () => assert.fail('must not sync the account'),
      reconcile: () => assert.fail('must not sync the account'),
    });
    assert.equal(response.data.cloudComputer, true);
    assert.equal(response.data.removedStaleLinks, 1);
    assert.equal(existsSync(join(agentDir, 'pptx')), true);
    assert.equal(lstatSync(join(agentDir, 'foreign')).isSymbolicLink(), true);
    assert.throws(() => lstatSync(join(agentDir, 'native-x')));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
