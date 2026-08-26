import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONFIG_DIR } from './profiles.js';

export const DEFAULT_APP_DEV_SESSIONS_FILE = join(CONFIG_DIR, 'app-dev-sessions.json');
export const APP_DEV_SESSIONS_FILE = DEFAULT_APP_DEV_SESSIONS_FILE;
export const APP_DEV_SESSIONS_VERSION = 1;
const REGISTRY_LOCK_TIMEOUT_MS = 5_000;
const registryLockWait = new Int32Array(new SharedArrayBuffer(4));

function readRegistryLockOwner(lockPath) {
  try {
    return readFileSync(join(lockPath, 'owner'), 'utf8').trim();
  } catch {
    return null;
  }
}

function withRegistryLock(filePath, callback) {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const lockPath = `${filePath}.lock`;
  const ownerId = `${process.pid}.${randomUUID()}`;
  const startedAt = Date.now();
  while (true) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      try {
        writeFileSync(join(lockPath, 'owner'), ownerId, { mode: 0o600 });
      } catch (error) {
        rmSync(lockPath, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const lockStat = lstatSync(lockPath);
        if (lockStat.isSymbolicLink() || !lockStat.isDirectory()) {
          throw new Error(`Refusing unsafe app development registry lock: ${lockPath}`);
        }
      } catch (statError) {
        if (statError?.code === 'ENOENT') continue;
        throw statError;
      }
      if (Date.now() - startedAt >= REGISTRY_LOCK_TIMEOUT_MS) {
        throw new Error(
          `Timed out waiting for app development registry lock: ${filePath}. `
          + `If no app development process is running, remove the orphaned lock: ${lockPath}`,
        );
      }
      Atomics.wait(registryLockWait, 0, 0, 10);
    }
  }
  try {
    return callback();
  } finally {
    try {
      if (readRegistryLockOwner(lockPath) === ownerId) {
        rmSync(lockPath, { recursive: true, force: true });
      }
    } catch {
      // Never remove or disrupt a lock that no longer belongs to this writer.
    }
  }
}

export function getAppDevSessionsFile(filePath) {
  if (filePath) {
    return filePath;
  }
  return DEFAULT_APP_DEV_SESSIONS_FILE;
}

function normalizeSessions(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sessions)) {
    return [];
  }
  return raw.sessions
    .filter((session) =>
      session &&
      typeof session === 'object' &&
      typeof session.sessionId === 'string' &&
      typeof session.appId === 'string' &&
      typeof session.bundleBaseUrl === 'string',
    )
    .map((session) => {
      if (typeof session.targetAppId === 'string' && session.targetAppId.trim()) {
        return { ...session, targetAppId: session.targetAppId.trim() };
      }
      const { targetAppId: _targetAppId, ...rest } = session;
      return rest;
    });
}

export function readAppDevSessions(filePath) {
  const resolvedFilePath = getAppDevSessionsFile(filePath);
  if (!existsSync(resolvedFilePath)) {
    return { version: APP_DEV_SESSIONS_VERSION, sessions: [] };
  }
  try {
    const raw = JSON.parse(readFileSync(resolvedFilePath, 'utf8'));
    return {
      version: APP_DEV_SESSIONS_VERSION,
      sessions: normalizeSessions(raw),
    };
  } catch {
    return { version: APP_DEV_SESSIONS_VERSION, sessions: [] };
  }
}

function writeAppDevSessionsUnlocked(registry, filePath) {
  const resolvedFilePath = getAppDevSessionsFile(filePath);
  mkdirSync(dirname(resolvedFilePath), { recursive: true, mode: 0o700 });
  const normalized = {
    version: APP_DEV_SESSIONS_VERSION,
    sessions: normalizeSessions(registry),
  };
  const tempPath = `${resolvedFilePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(normalized, null, 2), { mode: 0o600 });
  renameSync(tempPath, resolvedFilePath);
  return normalized;
}

export function writeAppDevSessions(registry, filePath) {
  const resolvedFilePath = getAppDevSessionsFile(filePath);
  return withRegistryLock(resolvedFilePath, () => writeAppDevSessionsUnlocked(registry, resolvedFilePath));
}

export function upsertAppDevSessions(sessions, filePath) {
  const nextSessions = Array.isArray(sessions) ? sessions : [sessions];
  const resolvedFilePath = getAppDevSessionsFile(filePath);
  return withRegistryLock(resolvedFilePath, () => {
    const registry = readAppDevSessions(resolvedFilePath);
    const keys = new Set(nextSessions.map((session) => `${session.sessionId}:${session.appId}`));
    registry.sessions = [
      ...registry.sessions.filter((session) => !keys.has(`${session.sessionId}:${session.appId}`)),
      ...nextSessions,
    ];
    return writeAppDevSessionsUnlocked(registry, resolvedFilePath);
  });
}

export function heartbeatAppDevSession(sessionId, lastHeartbeatAt, filePath) {
  const resolvedFilePath = getAppDevSessionsFile(filePath);
  return withRegistryLock(resolvedFilePath, () => {
    const registry = readAppDevSessions(resolvedFilePath);
    registry.sessions = registry.sessions.map((session) =>
      session.sessionId === sessionId ? { ...session, lastHeartbeatAt } : session,
    );
    return writeAppDevSessionsUnlocked(registry, resolvedFilePath);
  });
}

export function linkAppDevSessionTarget({ sessionId, appId, devSlug, targetAppId, lastHeartbeatAt = new Date().toISOString() }, filePath) {
  const target = typeof targetAppId === 'string' ? targetAppId.trim() : '';
  if (!target) {
    return readAppDevSessions(filePath);
  }
  const resolvedFilePath = getAppDevSessionsFile(filePath);
  const result = withRegistryLock(resolvedFilePath, () => {
    const registry = readAppDevSessions(resolvedFilePath);
    registry.sessions = registry.sessions.map((session) => {
      const hasSelector = Boolean(appId || devSlug);
      const matchesSession = !sessionId || session.sessionId === sessionId;
      const matchesApp = !appId || session.appId === appId;
      const matchesSlug = !devSlug || session.devSlug === devSlug;
      if ((!hasSelector && !sessionId) || !matchesSession || !matchesApp || !matchesSlug) return session;
      const linked = { ...session, targetAppId: target, lastHeartbeatAt };
      return linked;
    });
    return writeAppDevSessionsUnlocked(registry, resolvedFilePath);
  });
  return result;
}

export function removeAppDevSession(sessionId, filePath) {
  const resolvedFilePath = getAppDevSessionsFile(filePath);
  const result = withRegistryLock(resolvedFilePath, () => {
    const registry = readAppDevSessions(resolvedFilePath);
    registry.sessions = registry.sessions.filter((session) => session.sessionId !== sessionId);
    return writeAppDevSessionsUnlocked(registry, resolvedFilePath);
  });
  return result;
}
