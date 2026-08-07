import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, parse as parsePath } from 'node:path';
import { CONFIG_DIR } from './profiles.js';

export const DEFAULT_APP_DEV_SESSIONS_FILE = join(CONFIG_DIR, 'app-dev-sessions.json');
export const APP_DEV_SESSIONS_FILE = DEFAULT_APP_DEV_SESSIONS_FILE;
export const APP_DEV_SESSIONS_VERSION = 1;
export const APP_DEV_SESSION_MOUNT_ACKS_VERSION = 1;

export function getAppDevSessionsFile(filePath) {
  if (filePath) {
    return filePath;
  }
  const envPath = process.env.NOTIS_APP_DEV_SESSIONS_FILE;
  if (typeof envPath === 'string' && envPath.trim()) {
    return envPath.trim();
  }
  return DEFAULT_APP_DEV_SESSIONS_FILE;
}

export function getAppDevSessionMountAcksFile(sessionsFilePath) {
  const resolvedSessionsFile = getAppDevSessionsFile(sessionsFilePath);
  const parsed = parsePath(resolvedSessionsFile);
  return join(parsed.dir, `${parsed.name}-mount-acks${parsed.ext || '.json'}`);
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

export function writeAppDevSessions(registry, filePath) {
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

export function upsertAppDevSessions(sessions, filePath) {
  const nextSessions = Array.isArray(sessions) ? sessions : [sessions];
  const registry = readAppDevSessions(filePath);
  const keys = new Set(nextSessions.map((session) => `${session.sessionId}:${session.appId}`));
  registry.sessions = [
    ...registry.sessions.filter((session) => !keys.has(`${session.sessionId}:${session.appId}`)),
    ...nextSessions,
  ];
  return writeAppDevSessions(registry, filePath);
}

export function heartbeatAppDevSession(sessionId, lastHeartbeatAt, filePath) {
  const registry = readAppDevSessions(filePath);
  registry.sessions = registry.sessions.map((session) =>
    session.sessionId === sessionId
      ? { ...session, lastHeartbeatAt }
      : session,
  );
  return writeAppDevSessions(registry, filePath);
}

export function linkAppDevSessionTarget({ appId, devSlug, targetAppId, lastHeartbeatAt = new Date().toISOString() }, filePath) {
  const target = typeof targetAppId === 'string' ? targetAppId.trim() : '';
  if (!target) {
    return readAppDevSessions(filePath);
  }
  const registry = readAppDevSessions(filePath);
  registry.sessions = registry.sessions.map((session) => {
    const matchesApp = appId && session.appId === appId;
    const matchesSlug = devSlug && session.devSlug === devSlug;
    if (!matchesApp || !matchesSlug) {
      return session;
    }
    return {
      ...session,
      targetAppId: target,
      lastHeartbeatAt,
    };
  });
  return writeAppDevSessions(registry, filePath);
}

export function removeAppDevSession(sessionId, filePath) {
  const registry = readAppDevSessions(filePath);
  registry.sessions = registry.sessions.filter((session) => session.sessionId !== sessionId);
  const result = writeAppDevSessions(registry, filePath);
  removeAppDevSessionMountAcknowledgements(sessionId, filePath);
  return result;
}

function normalizeMountAcknowledgements(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.acknowledgements)) {
    return [];
  }
  return raw.acknowledgements.filter((acknowledgement) =>
    acknowledgement &&
    typeof acknowledgement === 'object' &&
    typeof acknowledgement.sessionId === 'string' &&
    typeof acknowledgement.appId === 'string' &&
    typeof acknowledgement.devSlug === 'string' &&
    typeof acknowledgement.mountNonce === 'string' &&
    typeof acknowledgement.acknowledgedAt === 'string' &&
    ['listed', 'rendered'].includes(acknowledgement.stage),
  );
}

export function readAppDevSessionMountAcknowledgements(sessionsFilePath) {
  const filePath = getAppDevSessionMountAcksFile(sessionsFilePath);
  if (!existsSync(filePath)) {
    return { version: APP_DEV_SESSION_MOUNT_ACKS_VERSION, acknowledgements: [] };
  }
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    return {
      version: APP_DEV_SESSION_MOUNT_ACKS_VERSION,
      acknowledgements: normalizeMountAcknowledgements(raw),
    };
  } catch {
    return { version: APP_DEV_SESSION_MOUNT_ACKS_VERSION, acknowledgements: [] };
  }
}

function writeAppDevSessionMountAcknowledgements(registry, sessionsFilePath) {
  const filePath = getAppDevSessionMountAcksFile(sessionsFilePath);
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const normalized = {
    version: APP_DEV_SESSION_MOUNT_ACKS_VERSION,
    acknowledgements: normalizeMountAcknowledgements(registry),
  };
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(normalized, null, 2), { mode: 0o600 });
  renameSync(tempPath, filePath);
  return normalized;
}

export function removeAppDevSessionMountAcknowledgements(sessionId, sessionsFilePath) {
  const filePath = getAppDevSessionMountAcksFile(sessionsFilePath);
  if (!existsSync(filePath)) {
    return { version: APP_DEV_SESSION_MOUNT_ACKS_VERSION, acknowledgements: [] };
  }
  const registry = readAppDevSessionMountAcknowledgements(sessionsFilePath);
  registry.acknowledgements = registry.acknowledgements.filter(
    (acknowledgement) => acknowledgement.sessionId !== sessionId,
  );
  return writeAppDevSessionMountAcknowledgements(registry, sessionsFilePath);
}

function mountAcknowledgementKey(value, fallbackStage = 'listed') {
  return `${value.sessionId}:${value.appId}:${value.devSlug}:${value.mountNonce}:${value.stage || fallbackStage}`;
}

export async function waitForAppDevSessionMountAcknowledgements(expectedSessions, options = {}) {
  const expected = Array.isArray(expectedSessions) ? expectedSessions : [expectedSessions];
  const stage = options.stage === 'rendered' ? 'rendered' : 'listed';
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(0, options.timeoutMs) : 15_000;
  const pollIntervalMs = Number.isFinite(options.pollIntervalMs)
    ? Math.max(1, options.pollIntervalMs)
    : 100;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const sleep = typeof options.sleep === 'function'
    ? options.sleep
    : (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
  const startedAt = now();

  while (true) {
    const registry = readAppDevSessionMountAcknowledgements(options.sessionsFilePath);
    const acknowledgedKeys = new Set(registry.acknowledgements.map(mountAcknowledgementKey));
    const missing = expected.filter(
      (session) => !acknowledgedKeys.has(mountAcknowledgementKey(session, stage)),
    );
    if (missing.length === 0) {
      return { mounted: true, missing: [], acknowledgements: registry.acknowledgements };
    }

    const elapsedMs = now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      return { mounted: false, missing, acknowledgements: registry.acknowledgements };
    }
    await sleep(Math.min(pollIntervalMs, timeoutMs - elapsedMs));
  }
}

export function waitForAppDevSessionRenderAcknowledgements(expectedSessions, options = {}) {
  return waitForAppDevSessionMountAcknowledgements(expectedSessions, {
    ...options,
    stage: 'rendered',
  });
}
