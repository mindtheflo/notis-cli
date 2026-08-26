import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse as parsePath, resolve } from 'node:path';

import { usageError } from './errors.js';
import { CONFIG_DIR } from './profiles.js';

export const APP_DEV_ROOTS_VERSION = 1;
export const DEFAULT_APP_DEV_ROOT = join(homedir(), '.notis', 'apps');
export const DEFAULT_APP_DEV_ROOTS_FILE = join(CONFIG_DIR, 'app-dev-roots.json');
const CONFIG_FILENAMES = ['notis.config.ts', 'notis.config.js', 'notis.config.mjs'];
const LOCK_TIMEOUT_MS = 5_000;
const lockWait = new Int32Array(new SharedArrayBuffer(4));

function rootsFile(filePath) {
  if (filePath) return resolve(filePath);
  const envPath = process.env.NOTIS_APP_DEV_ROOTS_FILE;
  return typeof envPath === 'string' && envPath.trim()
    ? resolve(envPath.trim())
    : DEFAULT_APP_DEV_ROOTS_FILE;
}

function legacyProjectsFile(filePath) {
  const sessionsFile = filePath
    || join(CONFIG_DIR, 'app-dev-sessions.json');
  const parsed = parsePath(resolve(sessionsFile));
  return join(parsed.dir, `${parsed.name}-projects${parsed.ext || '.json'}`);
}

function readLockOwner(lockPath) {
  try {
    return readFileSync(join(lockPath, 'owner'), 'utf8').trim();
  } catch {
    return null;
  }
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
        const stat = lstatSync(lockPath);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw new Error(`Refusing unsafe app development roots lock: ${lockPath}`);
        }
        const existingOwner = readLockOwner(lockPath);
        const pid = Number.parseInt(String(existingOwner || '').split('.')[0] || '', 10);
        if (Number.isInteger(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
          } catch (ownerError) {
            if (ownerError?.code === 'ESRCH') {
              rmSync(lockPath, { recursive: true, force: true });
              continue;
            }
          }
        }
      } catch (statError) {
        if (statError?.code === 'ENOENT') continue;
        throw statError;
      }
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for app development roots lock: ${filePath}`);
      }
      Atomics.wait(lockWait, 0, 0, 10);
    }
  }
  try {
    return callback();
  } finally {
    if (readLockOwner(lockPath) === owner) {
      rmSync(lockPath, { recursive: true, force: true });
    }
  }
}

function canonicalExistingDirectory(inputPath) {
  const absolute = resolve(String(inputPath || ''));
  let stat;
  try {
    stat = statSync(absolute);
  } catch {
    throw usageError(`App development root does not exist: ${absolute}`);
  }
  if (!stat.isDirectory()) {
    throw usageError(`App development root is not a directory: ${absolute}`);
  }
  return realpathSync(absolute);
}

function normalizeRegistry(raw) {
  const roots = Array.isArray(raw?.roots) ? raw.roots : [];
  const seen = new Set();
  return roots
    .map((entry) => typeof entry === 'string' ? { path: entry } : entry)
    .filter((entry) => entry && typeof entry.path === 'string' && entry.path.trim())
    .map((entry) => ({
      path: resolve(entry.path),
      registeredAt: typeof entry.registeredAt === 'string'
        ? entry.registeredAt
        : new Date(0).toISOString(),
    }))
    .filter((entry) => {
      if (seen.has(entry.path)) return false;
      seen.add(entry.path);
      return true;
    });
}

function readRaw(filePath) {
  if (!existsSync(filePath)) return { version: APP_DEV_ROOTS_VERSION, roots: [] };
  try {
    return {
      version: APP_DEV_ROOTS_VERSION,
      roots: normalizeRegistry(JSON.parse(readFileSync(filePath, 'utf8'))),
    };
  } catch {
    return { version: APP_DEV_ROOTS_VERSION, roots: [] };
  }
}

function writeRaw(registry, filePath) {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const normalized = {
    version: APP_DEV_ROOTS_VERSION,
    roots: normalizeRegistry(registry),
  };
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(normalized, null, 2), { mode: 0o600 });
  renameSync(temporary, filePath);
  return normalized;
}

function migrateLegacyProjectsUnlocked(registry, options) {
  const path = legacyProjectsFile(options.legacySessionsFilePath);
  if (!existsSync(path)) return registry;
  let projects = [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    projects = Array.isArray(raw?.projects) ? raw.projects : [];
  } catch {
    return registry;
  }
  const byPath = new Map(registry.roots.map((entry) => [entry.path, entry]));
  for (const project of projects) {
    if (typeof project?.projectDir !== 'string' || !project.projectDir.trim()) continue;
    try {
      const path = canonicalExistingDirectory(project.projectDir);
      if (path === realpathIfExists(DEFAULT_APP_DEV_ROOT)) continue;
      if (!byPath.has(path)) {
        byPath.set(path, {
          path,
          registeredAt: typeof project.lastMountedAt === 'string'
            ? project.lastMountedAt
            : new Date().toISOString(),
        });
      }
    } catch {
      // Deleted or inaccessible legacy projects are intentionally not migrated.
    }
  }
  rmSync(path, { force: true });
  return { version: APP_DEV_ROOTS_VERSION, roots: [...byPath.values()] };
}

function realpathIfExists(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export function readAppDevRoots(options = {}) {
  const filePath = rootsFile(options.filePath);
  let registry = readRaw(filePath);
  if (options.migrateLegacy !== false) {
    registry = withLock(filePath, () => {
      const before = readRaw(filePath);
      const after = migrateLegacyProjectsUnlocked(before, options);
      const changed = JSON.stringify(before.roots) !== JSON.stringify(after.roots);
      return changed ? writeRaw(after, filePath) : before;
    });
  }
  const implicit = realpathIfExists(options.defaultRoot || DEFAULT_APP_DEV_ROOT);
  const roots = [
    { path: implicit, registeredAt: null, implicit: true },
    ...registry.roots
      .filter((entry) => entry.path !== implicit)
      .map((entry) => ({ ...entry, implicit: false })),
  ];
  return { version: APP_DEV_ROOTS_VERSION, roots };
}

export function registerAppDevRoot(inputPath, options = {}) {
  const path = canonicalExistingDirectory(inputPath);
  const implicit = realpathIfExists(options.defaultRoot || DEFAULT_APP_DEV_ROOT);
  if (path === implicit) return readAppDevRoots(options);
  const filePath = rootsFile(options.filePath);
  withLock(filePath, () => {
    const registry = readRaw(filePath);
    if (!registry.roots.some((entry) => entry.path === path)) {
      registry.roots.push({ path, registeredAt: new Date().toISOString() });
      writeRaw(registry, filePath);
    }
  });
  return readAppDevRoots({ ...options, migrateLegacy: false });
}

export function removeAppDevRoot(inputPath, options = {}) {
  const path = realpathIfExists(resolve(String(inputPath || '')));
  const implicit = realpathIfExists(options.defaultRoot || DEFAULT_APP_DEV_ROOT);
  if (path === implicit) {
    throw usageError(`The default app development root cannot be removed: ${implicit}`);
  }
  const filePath = rootsFile(options.filePath);
  let removed = false;
  withLock(filePath, () => {
    const registry = readRaw(filePath);
    const next = registry.roots.filter((entry) => entry.path !== path);
    removed = next.length !== registry.roots.length;
    if (removed) writeRaw({ ...registry, roots: next }, filePath);
  });
  return { removed, path, registry: readAppDevRoots({ ...options, migrateLegacy: false }) };
}

function hasConfig(path) {
  return CONFIG_FILENAMES.some((name) => existsSync(join(path, name)));
}

function childAppDirs(parent) {
  if (!existsSync(parent)) return [];
  let entries = [];
  try {
    entries = readdirSync(parent, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !entry.name.startsWith('.') && !entry.name.startsWith('_'))
    .filter((entry) => entry.name !== 'node_modules')
    .map((entry) => join(parent, entry.name))
    .filter(hasConfig);
}

export function discoverAppProjectsInRoot(inputRoot) {
  const root = realpathIfExists(resolve(inputRoot));
  const candidates = [];
  if (hasConfig(root)) candidates.push(root);
  candidates.push(...childAppDirs(root));
  candidates.push(...childAppDirs(join(root, 'apps')));
  return [...new Set(candidates.map(realpathIfExists))].sort();
}

export function discoverRegisteredAppProjects(options = {}) {
  const roots = readAppDevRoots(options).roots;
  return [...new Set(roots.flatMap((entry) => discoverAppProjectsInRoot(entry.path)))].sort();
}

export function getAppDevRootsFile(filePath) {
  return rootsFile(filePath);
}
