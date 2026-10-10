import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readdirSync, existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldSpaceCollection } from '../src/runtime/space-collection-scaffold.js';
import { loadSelectedSpace } from '../src/runtime/space-source.js';
import { generateSpaceManifest, buildSpaceArtifact, prepareSpaceRelease } from '../src/runtime/space-platform.js';
import { spacesCommandSpecs } from '../src/command-specs/spaces.js';
import { createSpaceFixtureEngine } from '../src/runtime/space-test-server.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
test('collection scaffold is buildable V4 source with a main record param, declared list, native layout and EN/FR copy', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'notis-collection-scaffold-'));
  try {
    await scaffoldSpaceCollection({ projectDir: directory, name: 'Notes', databaseKey: 'notes', path: 'notes' });
    mkdirSync(join(directory, 'node_modules'), { recursive: true });
    for (const source of ['portal/node_modules', 'packages/sdk/node_modules', 'packages/cli/node_modules']) {
      for (const name of readdirSync(join(root, source)).filter(name => !name.startsWith('.'))) {
        if (name.startsWith('@')) {
          mkdirSync(join(directory, 'node_modules', name), { recursive: true });
          for (const child of readdirSync(join(root, source, name))) if (!existsSync(join(directory, 'node_modules', name, child))) {
            symlinkSync(join(root, source, name, child), join(directory, 'node_modules', name, child), 'dir');
          }
        } else if (!existsSync(join(directory, 'node_modules', name))) symlinkSync(join(root, source, name), join(directory, 'node_modules', name), 'dir');
      }
    }
    mkdirSync(join(directory, 'node_modules/@notis'), { recursive: true });
    rmSync(join(directory, 'node_modules/@notis/sdk'), { force: true, recursive: true });
    symlinkSync(join(directory, 'packages/sdk'), join(directory, 'node_modules/@notis/sdk'), 'dir');
    mkdirSync(join(directory, 'node_modules/.bin'), { recursive: true });
    symlinkSync(join(directory, 'node_modules/vite/bin/vite.js'), join(directory, 'node_modules/.bin/vite'));
    const selection = await loadSelectedSpace(directory, 'collection');
    const manifest = generateSpaceManifest(selection);
    assert.equal(manifest.spec_version, 2);
    assert.equal(manifest.params.item.main, true);
    assert.equal(manifest.shows.items.open, 'item');
    assert.equal(manifest.resources.items.key, 'notes');
    assert.equal(manifest.memory.attachments, true);
    const view = readFileSync(join(directory, 'spaces/collection/view.tsx'), 'utf8');
    for (const expected of ['DocumentPage', 'usePrefetchRecord', 'breadcrumb', 'useViewParams', 'useShown', 'toSpace']) assert.ok(view.includes(expected));
    assert.doesNotMatch(view, /\/documents|\?record=|\?selection=/);
    assert.match(view, /fr:/);
    const result = await buildSpaceArtifact(directory, 'collection');
    assert.equal(result.manifest.presentation.export_name, 'SpaceView');
    assert.equal(result.manifest.collection.titleProperty, 'title');
    assert.deepEqual(result.manifest.shows.items.where, {});
    const release = await prepareSpaceRelease(directory, 'collection');
    try {
      const fixture = createSpaceFixtureEngine(release);
      assert.deepEqual(fixture.executeShown('items', {}).rows, []);
    } finally { release.close(); }
    await assert.rejects(scaffoldSpaceCollection({ projectDir: directory, name: 'Overwrite', databaseKey: 'notes' }), /empty|exists|configured/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('spaces init is a local collection scaffold, not an implicit provider mutation', () => {
  const spec = spacesCommandSpecs.find(value => value.command_path.join(' ') === 'spaces init');
  assert.equal(spec.require_auth, false);
  assert.equal(spec.backend_call.type, 'local');
});
