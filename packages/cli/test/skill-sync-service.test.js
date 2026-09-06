import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { installSkillSyncService } from '../src/runtime/skill-sync-service.js';
import { runAutomaticSkillSync } from '../src/skill-sync-worker.js';
import { syncSkillsHandler } from '../src/command-specs/skills.js';

const account = { profile: 'beta', apiBase: 'https://api-beta.notis.ai', userId: 'owner' };
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
  for (const patch of [{ oauthUserId: 'other' }, { apiBase: 'https://api.notis.ai' }, { credentialKind: 'dev' }]) {
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
