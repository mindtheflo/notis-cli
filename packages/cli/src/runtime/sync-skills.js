import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { reconcileBaseSkills } from './base-skills.js';

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_STALE_MS = 10 * 60_000;
const DEFAULT_LOCK_POLL_MS = 50;

async function lockSnapshot(lockDirectory) {
  try {
    const [raw, metadata] = await Promise.all([
      readFile(join(lockDirectory, 'owner'), 'utf8').catch(() => ''),
      stat(lockDirectory),
    ]);
    let owner = {};
    try {
      owner = raw ? JSON.parse(raw) : {};
    } catch {
      // A process can die between mkdir and the atomic owner write. Preserve
      // the directory mtime as a reclaimable ownerless lease.
    }
    return {
      id: typeof owner.id === 'string' ? owner.id : null,
      pid: Number.isInteger(Number(owner.pid)) ? Number(owner.pid) : null,
      at: Number.isFinite(Number(owner.at)) ? Number(owner.at) : metadata.mtimeMs,
      mtimeMs: metadata.mtimeMs,
    };
  } catch {
    return null;
  }
}

function sameLockSnapshot(left, right) {
  return Boolean(
    left
    && right
    && left.id === right.id
    && left.pid === right.pid
    && left.at === right.at
    && left.mtimeMs === right.mtimeMs,
  );
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function quarantineStaleLock(lockDirectory, snapshot) {
  const quarantineRoot = join(dirname(lockDirectory), '.stale-operation-locks');
  const snapshotToken = createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex');
  await mkdir(quarantineRoot, { recursive: true, mode: 0o700 });
  try {
    // The deterministic destination is the compare-and-swap guard. If two
    // waiters observed the same stale owner, only one can move it here. The
    // retained non-empty tombstone prevents the loser from ever moving a new
    // live lock that appeared at the shared pathname in the meantime.
    await rename(lockDirectory, join(quarantineRoot, snapshotToken));
    return true;
  } catch (error) {
    if (['EEXIST', 'ENOTEMPTY', 'ENOENT'].includes(error?.code)) return false;
    throw error;
  }
}

async function writeLockOwnerAtomically(lockDirectory, owner) {
  const temporaryOwnerPath = join(lockDirectory, `.owner.${owner.id}.tmp`);
  const ownerPath = join(lockDirectory, 'owner');
  await writeFile(temporaryOwnerPath, JSON.stringify(owner), { mode: 0o600 });
  await rename(temporaryOwnerPath, ownerPath);
}

/** Serialize Desktop and terminal skill sync across processes on one Mac. */
export async function withSkillSyncLock(callback, {
  home = homedir(),
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  staleMs = DEFAULT_LOCK_STALE_MS,
  pollMs = DEFAULT_LOCK_POLL_MS,
  now = () => Date.now(),
} = {}) {
  const lockDirectory = join(home, '.notis', 'skills', '.operation-lock');
  const ownerId = `${process.pid}.${randomUUID()}`;
  const deadline = now() + timeoutMs;
  await mkdir(dirname(lockDirectory), { recursive: true, mode: 0o700 });

  for (;;) {
    try {
      await mkdir(lockDirectory, { mode: 0o700 });
      try {
        await writeLockOwnerAtomically(lockDirectory, {
          id: ownerId,
          pid: process.pid,
          at: now(),
        });
      } catch (error) {
        // This process exclusively created the directory and has not yet
        // published an owner, so it is safe to undo a failed acquisition.
        await rm(lockDirectory, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }

    const observed = await lockSnapshot(lockDirectory);
    if (
      observed
      && now() - observed.at > staleMs
      && !processIsAlive(observed.pid)
    ) {
      // Require an unchanged observation interval before stealing. This avoids
      // racing a holder that is publishing or refreshing its owner lease.
      await delay(Math.max(pollMs, 10));
      const current = await lockSnapshot(lockDirectory);
      if (sameLockSnapshot(observed, current) && !processIsAlive(current?.pid)) {
        if (await quarantineStaleLock(lockDirectory, current)) continue;
      }
    }
    if (now() >= deadline) {
      throw new Error('Timed out waiting for another Notis skill sync to finish.');
    }
    await delay(pollMs);
  }

  const heartbeatMs = Math.max(10, Math.min(30_000, Math.floor(staleMs / 3)));
  let heartbeatStopped = false;
  let heartbeatInFlight = Promise.resolve();
  const refreshHeartbeat = async () => {
      if (heartbeatStopped) return;
      const temporaryOwnerPath = join(lockDirectory, `.owner.${ownerId}.tmp`);
      await writeFile(
        temporaryOwnerPath,
        JSON.stringify({ id: ownerId, pid: process.pid, at: now() }),
        { mode: 0o600 },
      );
      const owner = await lockSnapshot(lockDirectory);
      if (owner?.id !== ownerId) {
        await rm(temporaryOwnerPath, { force: true });
        return;
      }
      // If a stale-lock reclaimer moved this directory after the ownership
      // check, the source path disappears and rename fails instead of
      // overwriting the owner of a newly acquired lock at the shared path.
      await rename(temporaryOwnerPath, join(lockDirectory, 'owner'));
  };
  const heartbeat = setInterval(() => {
    // Serialize refreshes and retain the active promise so cleanup cannot race
    // a temporary owner write that was already in flight when the interval was
    // cleared.
    heartbeatInFlight = heartbeatInFlight
      .then(refreshHeartbeat)
      .catch(() => undefined);
  }, heartbeatMs);
  heartbeat.unref?.();

  try {
    return await callback();
  } finally {
    heartbeatStopped = true;
    clearInterval(heartbeat);
    await heartbeatInFlight;
    const owner = await lockSnapshot(lockDirectory);
    if (owner?.id === ownerId) {
      await rm(lockDirectory, { recursive: true, force: true });
    }
  }
}

/**
 * Shared CLI-owned orchestration for base-skill installation plus account sync.
 * Desktop injects the source engine that webpack bundles; the CLI command
 * injects the generated dist engine used by the published package.
 */
export async function reconcileAllSkills({
  serverUrl,
  jwt,
  honorSyncEnabled,
  userId = null,
  home,
  runAccountSync,
  reconcileBase = reconcileBaseSkills,
  lockOptions = {},
}) {
  return withSkillSyncLock(async () => {
    const base = reconcileBase({ userId, ...(home ? { home } : {}) });
    const account = await runAccountSync(
      serverUrl,
      jwt,
      {},
      { honorSyncEnabled },
    );
    return {
      ...account,
      baseSkills: base.skills,
      baseInstalled: base.installed,
      baseLinked: base.linked,
      baseBackups: base.backups,
    };
  }, { ...lockOptions, ...(home ? { home } : {}) });
}
