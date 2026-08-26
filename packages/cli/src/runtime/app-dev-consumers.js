import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_APP_DEV_CONSUMERS_FILE = join(homedir(), '.notis', 'app-dev-consumers.json');
export const APP_DEV_CONSUMER_EXPIRES_AFTER_MS = 10_000;
const waitArray = new Int32Array(new SharedArrayBuffer(4));
const CONSUMER_LOCK_STALE_AFTER_MS = 30_000;

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function reclaimConsumerLock(lockPath) {
  const stat = lstatSync(lockPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Refusing unsafe app development consumer lock: ${lockPath}`);
  }
  let ownerPid = null;
  try {
    const owner = readFileSync(join(lockPath, 'owner'), 'utf8').trim();
    const parsed = Number.parseInt(owner.split('.')[0] || '', 10);
    ownerPid = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    // An interrupted owner write is reclaimed after the bounded stale window.
  }
  if (ownerPid !== null) return !processIsRunning(ownerPid);
  return Date.now() - stat.mtimeMs >= CONSUMER_LOCK_STALE_AFTER_MS;
}

function withLock(filePath, callback) {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const lockPath = `${filePath}.lock`;
  const owner = `${process.pid}.${randomUUID()}`;
  const startedAt = Date.now();
  while (true) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      writeFileSync(join(lockPath, 'owner'), owner, { mode: 0o600 });
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        if (reclaimConsumerLock(lockPath)) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (lockError) {
        if (lockError?.code === 'ENOENT') continue;
        throw lockError;
      }
      if (Date.now() - startedAt > 2_000) {
        throw new Error('App development consumer registry is busy.');
      }
      Atomics.wait(waitArray, 0, 0, 10);
    }
  }
  try {
    return callback();
  } finally {
    try {
      if (readFileSync(join(lockPath, 'owner'), 'utf8').trim() === owner) {
        rmSync(lockPath, { recursive: true, force: true });
      }
    } catch {
      // A replaced lock belongs to another writer.
    }
  }
}

function normalize(value, now) {
  const raw = value && typeof value === 'object' && Array.isArray(value.consumers)
    ? value.consumers
    : [];
  return raw.filter((lease) => {
    const heartbeat = Date.parse(String(lease?.lastHeartbeatAt || ''));
    return typeof lease?.instanceId === 'string'
      && typeof lease?.userId === 'string'
      && typeof lease?.apiBase === 'string'
      && Number.isSafeInteger(lease?.pid)
      && Number.isFinite(heartbeat)
      && now - heartbeat <= APP_DEV_CONSUMER_EXPIRES_AFTER_MS;
  });
}

export function readAppDevConsumers(filePath = DEFAULT_APP_DEV_CONSUMERS_FILE, now = Date.now()) {
  if (!existsSync(filePath)) return [];
  try {
    return normalize(JSON.parse(readFileSync(filePath, 'utf8')), now);
  } catch {
    return [];
  }
}

function writeAppDevConsumers(filePath, consumers) {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify({ version: 1, consumers }, null, 2), { mode: 0o600 });
  renameSync(temporary, filePath);
}

export function heartbeatAppDevConsumer(
  lease,
  filePath = DEFAULT_APP_DEV_CONSUMERS_FILE,
) {
  return withLock(filePath, () => {
    const now = Date.now();
    const next = readAppDevConsumers(filePath, now)
      .filter((entry) => entry.instanceId !== lease.instanceId);
    next.push({
      ...lease,
      apiBase: lease.apiBase.replace(/\/$/, ''),
      lastHeartbeatAt: new Date(now).toISOString(),
    });
    writeAppDevConsumers(filePath, next);
    return next;
  });
}

export function removeAppDevConsumer(
  instanceId,
  filePath = DEFAULT_APP_DEV_CONSUMERS_FILE,
) {
  return withLock(filePath, () => {
    const next = readAppDevConsumers(filePath)
      .filter((entry) => entry.instanceId !== instanceId);
    writeAppDevConsumers(filePath, next);
    return next;
  });
}

export function hasAppDevConsumer(consumers, { mode, userId, apiBase }) {
  if (mode === 'machine') return consumers.length > 0;
  if (mode !== 'environment') return true;
  const normalizedApiBase = String(apiBase || '').replace(/\/$/, '');
  return consumers.some((consumer) => (
    consumer.userId === userId
    && consumer.apiBase.replace(/\/$/, '') === normalizedApiBase
  ));
}
