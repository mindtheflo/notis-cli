import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  appLinkedStateProfileKey,
  readLinkedState,
  writeLinkedState,
} from '../src/runtime/app-platform.js';

function project() {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-linked-state-profile-'));
  mkdirSync(join(projectDir, '.notis'), { recursive: true });
  return projectDir;
}

test('development and installed links are scoped by authenticated environment', () => {
  const projectDir = project();
  const production = appLinkedStateProfileKey({
    apiBase: 'https://api.notis.ai',
    userId: 'user-1',
  });
  const beta = appLinkedStateProfileKey({
    apiBase: 'https://api-beta.notis.ai/',
    userId: 'user-1',
  });
  writeLinkedState(projectDir, { app_id: 'prod-app', dev_app_id: 'prod-dev' }, production);
  writeLinkedState(projectDir, { app_id: 'beta-app', dev_app_id: 'beta-dev' }, beta);
  assert.equal(readLinkedState(projectDir, production).app_id, 'prod-app');
  assert.equal(readLinkedState(projectDir, production).dev_app_id, 'prod-dev');
  assert.equal(readLinkedState(projectDir, beta).app_id, 'beta-app');
  assert.equal(readLinkedState(projectDir, beta).dev_app_id, 'beta-dev');
});

test('legacy scalar links migrate compatibly into the first authenticated profile', () => {
  const projectDir = project();
  writeLinkedState(projectDir, { app_id: 'legacy-app', linked_at: '2026-08-25T08:00:00Z' });
  const profile = appLinkedStateProfileKey({
    apiBase: 'https://api.notis.ai',
    userId: 'user-1',
  });
  const legacy = readLinkedState(projectDir, profile);
  assert.equal(legacy.app_id, 'legacy-app');
  writeLinkedState(projectDir, legacy, profile);
  assert.equal(readLinkedState(projectDir, profile).app_id, 'legacy-app');
  assert.equal(readLinkedState(projectDir).app_id, undefined);
  assert.equal(readLinkedState(projectDir).profiles[profile].app_id, 'legacy-app');
});

test('profile state writes recover a lock left by a dead writer', () => {
  const projectDir = project();
  const statePath = join(projectDir, '.notis', 'state.json');
  const lockPath = `${statePath}.write-lock`;
  mkdirSync(lockPath);
  writeFileSync(join(lockPath, 'owner'), '999999999.orphan');
  const profile = appLinkedStateProfileKey({
    apiBase: 'https://api.notis.ai',
    userId: 'user-1',
  });

  writeLinkedState(projectDir, { app_id: 'installed-app' }, profile);

  assert.equal(readLinkedState(projectDir, profile).app_id, 'installed-app');
  assert.equal(existsSync(lockPath), false);
});

test('profile state writes recover an aged lock with an invalid owner', () => {
  const projectDir = project();
  const statePath = join(projectDir, '.notis', 'state.json');
  const lockPath = `${statePath}.write-lock`;
  mkdirSync(lockPath);
  writeFileSync(join(lockPath, 'owner'), 'not-a-valid-owner');
  const staleTime = new Date(Date.now() - 10_000);
  utimesSync(lockPath, staleTime, staleTime);
  const profile = appLinkedStateProfileKey({
    apiBase: 'https://api.notis.ai',
    userId: 'user-1',
  });

  writeLinkedState(projectDir, { app_id: 'installed-app' }, profile);

  assert.equal(readLinkedState(projectDir, profile).app_id, 'installed-app');
  assert.equal(existsSync(lockPath), false);
});

test('profile state writes recover an aged lock whose PID has been reused', () => {
  const projectDir = project();
  const statePath = join(projectDir, '.notis', 'state.json');
  const lockPath = `${statePath}.write-lock`;
  mkdirSync(lockPath);
  writeFileSync(join(lockPath, 'owner'), `${process.pid}.orphan-from-earlier-process`);
  const staleTime = new Date(Date.now() - 10_000);
  utimesSync(lockPath, staleTime, staleTime);
  const profile = appLinkedStateProfileKey({
    apiBase: 'https://api.notis.ai',
    userId: 'user-1',
  });

  writeLinkedState(projectDir, { app_id: 'installed-app' }, profile);

  assert.equal(readLinkedState(projectDir, profile).app_id, 'installed-app');
  assert.equal(existsSync(lockPath), false);
});
