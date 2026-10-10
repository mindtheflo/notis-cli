import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildArtifact, runProjectScript } from '../src/runtime/app-platform.js';
import { pinnedBuildEnvironment, pinnedViteCommand } from '../src/runtime/confined-space-build.js';

function project(script) {
  const directory = mkdtempSync(join(tmpdir(), 'notis-confined-build-'));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module', scripts: { build: script } }));
  writeFileSync(join(directory, 'notis.config.ts'), 'export default {};\n');
  mkdirSync(join(directory, 'node_modules/vite/bin'), { recursive: true });
  writeFileSync(join(directory, 'node_modules/vite/bin/vite.js'), '');
  return directory;
}

test('the confined runner only runs the canonical vite build with this node', () => {
  const directory = project('vite build --configLoader runner');
  try {
    const command = pinnedViteCommand(directory, '/pinned/node');
    assert.equal(command[0], '/pinned/node');
    assert.match(command[1], /node_modules\/vite\/bin\/vite\.js$/);
    assert.deepEqual(command.slice(2), ['build', '--configLoader', 'runner']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
  for (const script of ['npm run build && curl https://example.com', 'vite build; rm -rf ~', 'node build.js']) {
    const other = project(script);
    try { assert.throws(() => pinnedViteCommand(other), /canonical vite build/); }
    finally { rmSync(other, { recursive: true, force: true }); }
  }
});

test('the confined build environment is rebuilt, never inherited', () => {
  const environment = pinnedBuildEnvironment({ HOME: '/private/op/home', TMPDIR: '/private/op/tmp',
    NOTIS_TOKEN: 'secret', AWS_SECRET_ACCESS_KEY: 'secret', npm_config_registry: 'https://registry' });
  assert.deepEqual(Object.keys(environment).sort(), ['HOME', 'LANG', 'LC_ALL', 'NODE_ENV', 'PATH', 'TMPDIR']);
  assert.equal(environment.HOME, '/private/op/home');
  assert.ok(!JSON.stringify(environment).includes('secret'));
});

test('buildArtifact runs the injected runner instead of the PATH npm script', async () => {
  const directory = project('vite build --configLoader runner');
  const calls = [];
  try {
    const manifest = { schema: 'notis-space/v1', local_key: 'tasks', kind: 'container', name: 'Tasks' };
    const result = await buildArtifact(directory, {
      refreshSdk: false, includeMetadata: false,
      prepare: async root => {
        mkdirSync(join(root, '.notis/output'), { recursive: true });
        writeFileSync(join(root, '.notis/output/manifest.json'), JSON.stringify(manifest));
      },
      runBuild: async request => {
        calls.push(request);
        mkdirSync(join(request.projectDir, '.notis/output/bundle'), { recursive: true });
        writeFileSync(join(request.projectDir, '.notis/output/bundle/app.js'), 'export default 1;\n');
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].scriptName, 'build');
    assert.deepEqual(calls[0].args, []);
    assert.equal(result.manifest.local_key, 'tasks');
  } finally { rmSync(directory, { recursive: true, force: true }); }
  assert.equal(typeof runProjectScript, 'function');
});
