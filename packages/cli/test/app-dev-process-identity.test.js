import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  NOTIS_APP_BUILD_COMMAND_FINGERPRINT,
  NOTIS_APPS_DEV_HOST_COMMAND_FINGERPRINT,
  captureDesktopHostOwnership,
  captureDesktopWatcherOwnership,
  isExpectedNotisAppsDevHostCommand,
  isExpectedNotisBuildCommand,
} from '../src/runtime/app-dev-process-identity.js';

test('expected Notis watcher command requires npm build watch', () => {
  assert.equal(isExpectedNotisBuildCommand('npm run build -- --watch'), true);
  assert.equal(isExpectedNotisBuildCommand('/opt/homebrew/bin/npm run build --watch'), true);
  assert.equal(isExpectedNotisBuildCommand('vite build --watch'), false);
  assert.equal(isExpectedNotisBuildCommand('npm run dev -- --watch'), false);
  assert.equal(isExpectedNotisBuildCommand('npm run build'), false);
});

test('Desktop host ownership requires the expected Notis apps dev command', () => {
  const host = {
    pid: 1234,
    processGroupPid: 1234,
    startIdentity: 'Mon Sep 1 11:59:59 2026',
    command: '/opt/notis.js apps dev --all-registered-roots',
    projectDir: '/tmp/notis',
  };
  assert.equal(isExpectedNotisAppsDevHostCommand(host.command), true);
  assert.deepEqual(captureDesktopHostOwnership({
    pid: host.pid,
    desktopOwnerId: 'desktop-instance',
    desktopOwnerScope: '/desktop/scope',
    inspect: () => host,
  }), {
    desktopOwnerId: 'desktop-instance',
    desktopOwnerScope: '/desktop/scope',
    desktopHostStartIdentity: host.startIdentity,
    desktopHostCommandFingerprint: NOTIS_APPS_DEV_HOST_COMMAND_FINGERPRINT,
  });
  assert.equal(captureDesktopHostOwnership({
    pid: host.pid,
    desktopOwnerId: 'desktop-instance',
    desktopOwnerScope: '/desktop/scope',
    inspect: () => ({ ...host, command: 'vite dev' }),
  }), null);
});

test('Desktop watcher ownership records a fully matched process identity', () => {
  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'notis-desktop-owner-')));
  assert.deepEqual(captureDesktopWatcherOwnership({
    pid: 4321,
    projectDir,
    desktopOwnerId: 'desktop-instance',
    desktopOwnerScope: '/desktop/scope',
    inspect: () => ({
      pid: 4321,
      processGroupPid: 4321,
      startIdentity: 'Mon Sep 1 12:00:00 2026',
      command: 'npm run build -- --watch',
      projectDir,
    }),
  }), {
    desktopOwnerId: 'desktop-instance',
    desktopOwnerScope: '/desktop/scope',
    watcherProcessGroupPid: 4321,
    watcherStartIdentity: 'Mon Sep 1 12:00:00 2026',
    watcherProjectDir: projectDir,
    watcherCommandFingerprint: NOTIS_APP_BUILD_COMMAND_FINGERPRINT,
  });
});

test('terminal launches and mismatched processes never gain Desktop ownership', () => {
  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'notis-terminal-owner-')));
  const identity = {
    pid: 4321,
    processGroupPid: 4321,
    startIdentity: 'Mon Sep 1 12:00:00 2026',
    command: 'npm run build -- --watch',
    projectDir,
  };
  assert.equal(captureDesktopWatcherOwnership({
    pid: 4321,
    projectDir,
    inspect: () => identity,
  }), null);
  assert.equal(captureDesktopWatcherOwnership({
    pid: 4321,
    projectDir,
    desktopOwnerId: 'desktop-instance',
    desktopOwnerScope: '/desktop/scope',
    inspect: () => ({ ...identity, command: 'vite build --watch' }),
  }), null);
  assert.equal(captureDesktopWatcherOwnership({
    pid: 4321,
    projectDir,
    desktopOwnerId: 'desktop-instance',
    desktopOwnerScope: '/desktop/scope',
    inspect: () => ({ ...identity, projectDir: tmpdir() }),
  }), null);
});
