import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  discoverAppProjectsInRoot,
  discoverRegisteredAppProjects,
  readAppDevRoots,
  registerAppDevRoot,
  removeAppDevRoot,
} from '../src/runtime/app-dev-roots.js';

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'notis-app-dev-roots-'));
  const defaultRoot = join(base, 'default-apps');
  const rootsFile = join(base, 'app-dev-roots.json');
  mkdirSync(defaultRoot, { recursive: true });
  return { base, defaultRoot, rootsFile };
}

function app(path) {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'notis.config.ts'), 'export default { name: "Test" };\n');
  return realpathSync(path);
}

test('default app root is implicit and cannot be removed', () => {
  const { defaultRoot, rootsFile } = fixture();
  const roots = readAppDevRoots({ filePath: rootsFile, defaultRoot, migrateLegacy: false });
  assert.deepEqual(roots.roots, [{
    path: realpathSync(defaultRoot),
    registeredAt: null,
    implicit: true,
  }]);
  assert.throws(
    () => removeAppDevRoot(defaultRoot, { filePath: rootsFile, defaultRoot }),
    /cannot be removed/,
  );
});

test('registration canonicalizes and deduplicates persistent roots', () => {
  const { base, defaultRoot, rootsFile } = fixture();
  const custom = join(base, 'custom');
  mkdirSync(custom);
  registerAppDevRoot(custom, { filePath: rootsFile, defaultRoot });
  registerAppDevRoot(join(custom, '.'), { filePath: rootsFile, defaultRoot });
  const roots = readAppDevRoots({ filePath: rootsFile, defaultRoot, migrateLegacy: false });
  assert.equal(roots.roots.length, 2);
  assert.equal(roots.roots[1].path, realpathSync(custom));
  assert.equal(roots.roots[1].implicit, false);

  const removed = removeAppDevRoot(custom, { filePath: rootsFile, defaultRoot });
  assert.equal(removed.removed, true);
  assert.equal(removed.registry.roots.length, 1);
});

test('discovery covers root, direct children, and apps children only', () => {
  const { base } = fixture();
  const root = join(base, 'workspace');
  const direct = app(join(root, 'direct'));
  const conventional = app(join(root, 'apps', 'conventional'));
  app(join(root, 'deep', 'nested', 'ignored'));
  app(join(root, 'node_modules', 'ignored'));
  assert.deepEqual(discoverAppProjectsInRoot(root), [conventional, direct].sort());

  const single = app(join(base, 'single'));
  assert.deepEqual(discoverAppProjectsInRoot(single), [single]);
});

test('new apps are discovered without rewriting the root registry', () => {
  const { base, defaultRoot, rootsFile } = fixture();
  const custom = join(base, 'custom');
  mkdirSync(custom);
  registerAppDevRoot(custom, { filePath: rootsFile, defaultRoot });
  assert.deepEqual(discoverRegisteredAppProjects({
    filePath: rootsFile,
    defaultRoot,
    migrateLegacy: false,
  }), []);

  const created = app(join(custom, 'created-later'));
  assert.deepEqual(discoverRegisteredAppProjects({
    filePath: rootsFile,
    defaultRoot,
    migrateLegacy: false,
  }), [created]);
});

test('legacy project records migrate once into persistent roots', () => {
  const { base, defaultRoot, rootsFile } = fixture();
  const legacySessions = join(base, 'app-dev-sessions.json');
  const legacyProjects = join(base, 'app-dev-sessions-projects.json');
  const projectDir = app(join(base, 'legacy-app'));
  writeFileSync(legacyProjects, JSON.stringify({
    version: 1,
    projects: [{ projectDir, lastMountedAt: '2026-08-25T08:00:00.000Z' }],
  }));

  const roots = readAppDevRoots({
    filePath: rootsFile,
    defaultRoot,
    legacySessionsFilePath: legacySessions,
  });
  assert.equal(roots.roots[1].path, projectDir);
  assert.equal(roots.roots[1].registeredAt, '2026-08-25T08:00:00.000Z');
});
