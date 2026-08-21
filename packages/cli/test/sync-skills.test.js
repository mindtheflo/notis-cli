import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { reconcileAllSkills } from '../src/runtime/sync-skills.js';

test('shared skill orchestration keeps base skills current when account sync is disabled', async () => {
  const calls = [];
  const result = await reconcileAllSkills({
    serverUrl: 'http://127.0.0.1:8000',
    jwt: 'header.payload.signature',
    honorSyncEnabled: true,
    userId: 'canonical-user',
    runAccountSync: async (...args) => {
      calls.push(['account', ...args]);
      return { syncEnabled: false };
    },
    reconcileBase: (options) => {
      calls.push(['base', options]);
      return {
        installed: 3,
        linked: 12,
        unchanged: 0,
        backups: [],
        skills: ['notis-apps', 'notis-query', 'notis-cli'],
      };
    },
  });

  assert.equal(calls[0][0], 'base');
  assert.equal(calls[0][1].userId, 'canonical-user');
  assert.equal(calls[1][0], 'account');
  assert.equal(result.syncEnabled, false);
  assert.deepEqual(result.baseSkills, ['notis-apps', 'notis-query', 'notis-cli']);
  assert.equal(result.baseInstalled, 3);
});

test('shared skill orchestration serializes independent callers through a filesystem lock', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'notis-skill-lock-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  let firstEntered;
  const entered = new Promise((resolve) => { firstEntered = resolve; });
  let baseCalls = 0;
  const options = {
    serverUrl: 'http://127.0.0.1:8000',
    jwt: 'header.payload.signature',
    honorSyncEnabled: false,
    home,
    lockOptions: { staleMs: 20, pollMs: 5, timeoutMs: 1_000 },
    reconcileBase: () => {
      baseCalls += 1;
      return { installed: 3, linked: 12, unchanged: 0, backups: [], skills: [] };
    },
  };

  const first = reconcileAllSkills({
    ...options,
    runAccountSync: async () => {
      firstEntered();
      await firstBlocked;
      return { syncEnabled: true };
    },
  });
  await entered;
  const second = reconcileAllSkills({
    ...options,
    runAccountSync: async () => ({ syncEnabled: true }),
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(baseCalls, 1);
  releaseFirst();
  await Promise.all([first, second]);
  assert.equal(baseCalls, 2);
});

test('shared skill orchestration reclaims a stale abandoned lock', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'notis-stale-skill-lock-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const lockDirectory = join(home, '.notis', 'skills', '.operation-lock');
  mkdirSync(lockDirectory, { recursive: true });
  writeFileSync(join(lockDirectory, 'owner'), JSON.stringify({ id: 'dead', at: 1 }));

  const result = await reconcileAllSkills({
    serverUrl: 'http://127.0.0.1:8000',
    jwt: 'header.payload.signature',
    honorSyncEnabled: false,
    home,
    lockOptions: { staleMs: 1 },
    reconcileBase: () => ({ installed: 3, linked: 12, unchanged: 0, backups: [], skills: [] }),
    runAccountSync: async () => ({ syncEnabled: true }),
  });

  assert.equal(result.syncEnabled, true);
});

test('shared skill orchestration reclaims a stale malformed owner file', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'notis-malformed-skill-lock-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const lockDirectory = join(home, '.notis', 'skills', '.operation-lock');
  mkdirSync(lockDirectory, { recursive: true });
  writeFileSync(join(lockDirectory, 'owner'), '{ truncated');
  const old = new Date(1_000);
  utimesSync(lockDirectory, old, old);

  const result = await reconcileAllSkills({
    serverUrl: 'http://127.0.0.1:8000',
    jwt: 'header.payload.signature',
    honorSyncEnabled: false,
    home,
    lockOptions: { staleMs: 1, pollMs: 5 },
    reconcileBase: () => ({ installed: 3, linked: 12, unchanged: 0, backups: [], skills: [] }),
    runAccountSync: async () => ({ syncEnabled: true }),
  });

  assert.equal(result.syncEnabled, true);
});

test('concurrent stale-lock reclaimers never overlap callbacks or delete the new owner', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'notis-concurrent-stale-lock-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const lockDirectory = join(home, '.notis', 'skills', '.operation-lock');
  mkdirSync(lockDirectory, { recursive: true });
  writeFileSync(join(lockDirectory, 'owner'), JSON.stringify({ id: 'one-dead-owner', at: 1 }));

  let active = 0;
  let maximumActive = 0;
  const entered = [];
  const callers = Array.from({ length: 5 }, (_, index) => reconcileAllSkills({
    serverUrl: 'http://127.0.0.1:8000',
    jwt: 'header.payload.signature',
    honorSyncEnabled: false,
    home,
    lockOptions: { staleMs: 1, pollMs: 2, timeoutMs: 2_000 },
    reconcileBase: () => ({ installed: 3, linked: 12, unchanged: 0, backups: [], skills: [] }),
    runAccountSync: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      entered.push(index);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return { syncEnabled: true };
    },
  }));

  await Promise.all(callers);
  assert.equal(maximumActive, 1);
  assert.deepEqual([...entered].sort((a, b) => a - b), [0, 1, 2, 3, 4]);
});
