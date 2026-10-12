import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Cross-process write lock over ~/.notis/config.json. Independent `notis`
// processes (a `login` in one terminal and a `tools exec` in another) and
// Desktop all rewrite the files in this directory, so the lock directory name
// and these three timings are the whole coordination protocol. Desktop keeps a
// TypeScript copy in electron/src/notis-config-file.ts. Guarded by the
// concurrency test in packages/cli/test/runtime-auth.test.js.
const CONFIG_WRITE_LOCK_TIMEOUT_MS = 5_000;
const CONFIG_WRITE_LOCK_STALE_MS = 2_000;
const CONFIG_WRITE_LOCK_POLL_MS = 10;

/**
 * The shared CLI config file. NOTIS_CLI_CONFIG_FILE moves it (and every file
 * kept next to it, such as computer.json) for tests and isolated runtimes.
 */
export function resolveCliConfigFile() {
  const envConfigFile = process.env.NOTIS_CLI_CONFIG_FILE;
  if (envConfigFile) {
    return resolve(envConfigFile);
  }
  return join(homedir(), '.notis', 'config.json');
}

// The lock records who holds it and when they took it. Reclaiming a stale lock
// by mtime alone is not safe: the reclaimer cannot tell an abandoned lock from
// one it is about to steal from a live writer, and the victim's own release
// would then delete the thief's lock and admit a third writer. Both sides are
// on the same host, so the stored timestamp and Date.now() share a clock.
function readLockOwner(lockDirectory) {
  try {
    return JSON.parse(readFileSync(join(lockDirectory, 'owner'), 'utf-8'));
  } catch {
    return null;
  }
}

function lockDirectoryMtime(lockDirectory) {
  try {
    return statSync(lockDirectory).mtimeMs;
  } catch {
    return null;
  }
}

function publishConfigWriteLock(lockDirectory, ownerId) {
  const candidateDirectory = `${lockDirectory}.candidate-${ownerId}`;
  try {
    mkdirSync(candidateDirectory);
    writeFileSync(
      join(candidateDirectory, 'owner'),
      JSON.stringify({ id: ownerId, at: Date.now() }),
      { mode: 0o600 },
    );
    try {
      renameSync(candidateDirectory, lockDirectory);
      return true;
    } catch (error) {
      if (!existsSync(lockDirectory)) throw error;
      return false;
    }
  } finally {
    rmSync(candidateDirectory, { recursive: true, force: true });
  }
}

/**
 * Run `callback(configFile)` while holding `<configFile>.write-lock`.
 */
export function withConfigFileWriteLock(configFile, callback) {
  const lockDirectory = `${configFile}.write-lock`;
  const ownerId = `${process.pid}.${randomUUID()}`;
  const deadline = Date.now() + CONFIG_WRITE_LOCK_TIMEOUT_MS;
  mkdirSync(dirname(configFile), { recursive: true });
  for (;;) {
    if (!existsSync(lockDirectory) && publishConfigWriteLock(lockDirectory, ownerId)) {
      break;
    }

    const owner = readLockOwner(lockDirectory);
    const observedMtime = lockDirectoryMtime(lockDirectory);
    const ownerIsStale =
      owner?.id && Date.now() - Number(owner.at) > CONFIG_WRITE_LOCK_STALE_MS;
    const ownerlessIsStale =
      !owner
      && observedMtime !== null
      && Date.now() - observedMtime > CONFIG_WRITE_LOCK_STALE_MS;
    if (ownerIsStale || ownerlessIsStale) {
      try {
        const currentOwner = readLockOwner(lockDirectory);
        const ownerUnchanged = owner?.id
          ? currentOwner?.id === owner.id
          : !currentOwner && lockDirectoryMtime(lockDirectory) === observedMtime;
        if (ownerUnchanged) {
          rmSync(lockDirectory, { recursive: true, force: true });
          continue;
        }
      } catch {
        // Losing the reclaim race is normal; fall through and keep waiting.
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting to update ${configFile}`);
    }
    Atomics.wait(
      new Int32Array(new SharedArrayBuffer(4)),
      0,
      0,
      CONFIG_WRITE_LOCK_POLL_MS,
    );
  }
  try {
    return callback(configFile);
  } finally {
    try {
      // Never release a lock that was reclaimed from us while we worked.
      if (readLockOwner(lockDirectory)?.id === ownerId) {
        rmSync(lockDirectory, { recursive: true, force: true });
      }
    } catch {
      // The lock may already have been removed after an interrupted write.
    }
  }
}
