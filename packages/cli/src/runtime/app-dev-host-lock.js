import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_LOCK_ROOT = join(homedir(), '.notis', 'app-dev-host-locks');
const OWNER_FILE = 'owner.json';

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function lockName(identity, apiBase, projectDir) {
  return createHash('sha256').update(`${identity}\0${apiBase}\0${projectDir}`).digest('hex');
}

function readOwner(path) {
  try {
    const value = JSON.parse(readFileSync(join(path, OWNER_FILE), 'utf8'));
    return Number.isSafeInteger(value?.pid) && typeof value?.ownerId === 'string'
      ? { pid: value.pid, ownerId: value.ownerId }
      : null;
  } catch {
    return null;
  }
}

function reclaimable(path, now, staleAfterMs) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Refusing unsafe app development host lock: ${path}`);
  }
  const owner = readOwner(path);
  if (owner) return !processIsRunning(owner.pid);
  return now - stat.mtimeMs >= staleAfterMs;
}

export function tryAcquireAppDevHostLock(options) {
  const lockRoot = options.lockRoot || DEFAULT_LOCK_ROOT;
  mkdirSync(lockRoot, { recursive: true, mode: 0o700 });
  const path = join(lockRoot, lockName(options.identity, options.apiBase, options.projectDir));
  const ownerId = `${process.pid}.${randomUUID()}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(path, { mode: 0o700 });
      try {
        writeFileSync(join(path, OWNER_FILE), JSON.stringify({ pid: process.pid, ownerId }), {
          mode: 0o600,
        });
      } catch (error) {
        rmSync(path, { recursive: true, force: true });
        throw error;
      }
      return { path, ownerId };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (reclaimable(path, options.now ?? Date.now(), options.staleAfterMs ?? 60_000)) {
        rmSync(path, { recursive: true, force: true });
        continue;
      }
      return null;
    }
  }
  return null;
}

export function releaseAppDevHostLock(lock) {
  try {
    if (readOwner(lock.path)?.ownerId === lock.ownerId) {
      rmSync(lock.path, { recursive: true, force: true });
    }
  } catch {
    // A replaced lock belongs to another process.
  }
}
