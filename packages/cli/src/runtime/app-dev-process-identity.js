import { execFileSync } from 'node:child_process';
import { readlinkSync, realpathSync } from 'node:fs';

export const NOTIS_APP_BUILD_COMMAND_FINGERPRINT = 'npm:run-build:watch:v1';
export const NOTIS_APPS_DEV_HOST_COMMAND_FINGERPRINT = 'notis:apps-dev:v1';

function normalizePath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return realpathSync(value.trim());
  } catch {
    return null;
  }
}

export function isExpectedNotisBuildCommand(command) {
  if (typeof command !== 'string') return false;
  return /(?:^|[/\s])npm(?:\s|$)/.test(command)
    && /\brun\s+build\b/.test(command)
    && /(?:^|\s)--watch(?:\s|$)/.test(command);
}

export function isExpectedNotisAppsDevHostCommand(command) {
  return typeof command === 'string'
    && /(?:notis(?:\.js)?|@notis_ai[/\\]cli)/.test(command)
    && /\bapps\s+dev\b/.test(command);
}

function readDarwinProcessCwd(pid, execute) {
  const output = execute('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const line = output.split('\n').find((entry) => entry.startsWith('n'));
  return line ? line.slice(1) : null;
}

export function inspectAppDevWatcherProcess(pid, {
  platform = process.platform,
  execute = execFileSync,
  readLink = readlinkSync,
} = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || platform === 'win32') return null;
  try {
    const ps = (field) => execute('ps', ['-o', `${field}=`, '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const processGroupPid = Number.parseInt(ps('pgid'), 10);
    const startIdentity = ps('lstart').replace(/\s+/g, ' ').trim();
    const command = ps('command');
    const cwd = platform === 'linux'
      ? readLink(`/proc/${pid}/cwd`)
      : readDarwinProcessCwd(pid, execute);
    const projectDir = normalizePath(cwd);
    if (!Number.isSafeInteger(processGroupPid) || processGroupPid <= 0) return null;
    if (!startIdentity || !command || !projectDir) return null;
    return { pid, processGroupPid, startIdentity, command, projectDir };
  } catch {
    return null;
  }
}

export function captureDesktopWatcherOwnership({
  pid,
  projectDir,
  desktopOwnerId,
  desktopOwnerScope,
  inspect = inspectAppDevWatcherProcess,
} = {}) {
  const owner = typeof desktopOwnerId === 'string' ? desktopOwnerId.trim() : '';
  const ownerScope = typeof desktopOwnerScope === 'string' ? desktopOwnerScope.trim() : '';
  const expectedProjectDir = normalizePath(projectDir);
  if (!owner || !ownerScope || !expectedProjectDir) return null;
  const identity = inspect(pid);
  if (
    !identity
    || identity.processGroupPid !== pid
    || identity.projectDir !== expectedProjectDir
    || !isExpectedNotisBuildCommand(identity.command)
  ) {
    return null;
  }
  return {
    desktopOwnerId: owner,
    desktopOwnerScope: ownerScope,
    watcherProcessGroupPid: identity.processGroupPid,
    watcherStartIdentity: identity.startIdentity,
    watcherProjectDir: identity.projectDir,
    watcherCommandFingerprint: NOTIS_APP_BUILD_COMMAND_FINGERPRINT,
  };
}

export function captureDesktopHostOwnership({
  pid = process.pid,
  desktopOwnerId,
  desktopOwnerScope,
  inspect = inspectAppDevWatcherProcess,
} = {}) {
  const owner = typeof desktopOwnerId === 'string' ? desktopOwnerId.trim() : '';
  const ownerScope = typeof desktopOwnerScope === 'string' ? desktopOwnerScope.trim() : '';
  if (!owner || !ownerScope) return null;
  const identity = inspect(pid);
  if (!identity || !isExpectedNotisAppsDevHostCommand(identity.command)) return null;
  return {
    desktopOwnerId: owner,
    desktopOwnerScope: ownerScope,
    desktopHostStartIdentity: identity.startIdentity,
    desktopHostCommandFingerprint: NOTIS_APPS_DEV_HOST_COMMAND_FINGERPRINT,
  };
}
