import assert from 'node:assert/strict';
import { mkdtempSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { releaseAppDevHostLock, tryAcquireAppDevHostLock } from '../src/runtime/app-dev-host-lock.js';

const options = (lockRoot) => ({
  identity: '__mac_user__',
  apiBase: 'loopback-source',
  projectDir: '__registered_roots__',
  lockRoot,
});

test('CLI source hosts use the same atomic singleton lock contract', () => {
  const lockRoot = mkdtempSync(join(tmpdir(), 'notis-cli-app-host-lock-'));
  const first = tryAcquireAppDevHostLock(options(lockRoot));
  assert.ok(first);
  const old = new Date(Date.now() - 120_000);
  utimesSync(first.path, old, old);
  assert.equal(tryAcquireAppDevHostLock({ ...options(lockRoot), staleAfterMs: 1 }), null);
  releaseAppDevHostLock(first);
  const second = tryAcquireAppDevHostLock(options(lockRoot));
  assert.ok(second);
  releaseAppDevHostLock(second);
});
