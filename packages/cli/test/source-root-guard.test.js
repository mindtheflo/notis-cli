import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { spacesCommandSpecs } from '../src/command-specs/spaces.js';
import { buildArtifact, syncEmbeddedSdk } from '../src/runtime/app-platform.js';
import { buildSpaceArtifact } from '../src/runtime/space-platform.js';

// 2026-10-02 incident: `notis spaces build .` from the Notis repository root
// refreshed the repository's own packages/sdk and deleted its presentation.tsx.
const HOST = 'export const host = createPortal(view, mount);\n';
const RETIRED = { 'src/presentation.tsx': [createHash('sha256').update(HOST).digest('hex')] };

function snapshot(root) {
  const files = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files[relative(root, path)] = readFileSync(path, 'utf8');
    }
  };
  walk(root);
  return files;
}

function template(root) {
  const dir = join(root, 'template-sdk');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@notis/sdk', version: '9.9.9' }));
  writeFileSync(join(dir, 'tsconfig.json'), '{}\n');
  writeFileSync(join(dir, 'src/index.ts'), 'export const fresh = true;\n');
  return dir;
}

/** A folder shaped like the Notis repository: packages/sdk with its host-only file, no Space marker. */
function repoShaped(root) {
  const dir = join(root, 'notis-repo');
  mkdirSync(join(dir, 'packages/sdk/src'), { recursive: true });
  mkdirSync(join(dir, 'packages/cli/src'), { recursive: true });
  writeFileSync(join(dir, 'packages/sdk/package.json'), JSON.stringify({ name: '@notis/sdk', version: '1.0.0' }));
  writeFileSync(join(dir, 'packages/sdk/src/presentation.tsx'), HOST);
  writeFileSync(join(dir, 'packages/sdk/src/index.ts'), 'export const canonical = true;\n');
  writeFileSync(join(dir, 'packages/cli/src/cli.js'), 'export {};\n');
  writeFileSync(join(dir, 'AGENTS.md'), '# Notis\n');
  return dir;
}

function commandContext(operation, dir) {
  const spec = spacesCommandSpecs.find(value => value.command_path.join(' ') === `spaces ${operation}`);
  return { spec, args: { dir }, options: { space: 'overview', spaceId: 'space-1', requestId: 'release-1' }, globalOptions: {},
    runtime: { apiBase: 'https://fixture.invalid' }, output: { isMachineMode: () => true, emitSuccess: value => value } };
}

test('every source-writing entry point refuses a folder that is not a Space source and changes nothing', async t => {
  const root = mkdtempSync(join(tmpdir(), 'notis-source-guard-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const templateSdkDir = template(root), dir = repoShaped(root);
  const before = snapshot(dir);
  const refusal = new RegExp(`${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is not a Space source: it has no notis\\.config\\.ts`);

  assert.throws(() => syncEmbeddedSdk(dir, { templateSdkDir, retiredFiles: RETIRED, log() {} }), refusal);
  await assert.rejects(buildSpaceArtifact(dir, 'overview', { stdio: 'pipe' }), refusal);
  await assert.rejects(buildArtifact(dir, { stdio: 'pipe' }), refusal);
  for (const operation of ['build', 'verify', 'preview', 'deploy', 'inspect']) {
    const ctx = commandContext(operation, dir);
    await assert.rejects(Promise.resolve().then(() => ctx.spec.handler(ctx)), refusal, operation);
  }

  // The canonical SDK keeps its host-only file, and no .notis state or staging appeared.
  assert.deepEqual(snapshot(dir), before);
});

test('a real Space source still builds, and the SDK refresh touches only the files it owns', async t => {
  const root = mkdtempSync(join(tmpdir(), 'notis-source-guard-real-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const templateSdkDir = template(root), source = join(root, 'space-source');
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  mkdirSync(join(source, 'node_modules'), { recursive: true });
  symlinkSync(join(repo, 'packages/sdk/node_modules/typescript'), join(source, 'node_modules/typescript'), 'dir');
  writeFileSync(join(source, 'package.json'), '{"name":"real-source","type":"module"}');
  writeFileSync(join(source, 'notis.config.ts'), "export default {spaces:{overview:{definition:'overview.ts'}}};");
  writeFileSync(join(source, 'overview.ts'), "export default {name:'Overview'};");
  // An old embedded mirror plus files the refresh does not own.
  mkdirSync(join(source, 'packages/sdk/src'), { recursive: true });
  mkdirSync(join(source, 'packages/other'), { recursive: true });
  writeFileSync(join(source, 'packages/sdk/package.json'), JSON.stringify({ name: '@notis/sdk', version: '0.1.0' }));
  writeFileSync(join(source, 'packages/sdk/src/index.ts'), 'export const fresh = false;\n');
  writeFileSync(join(source, 'packages/sdk/src/presentation.tsx'), HOST);
  writeFileSync(join(source, 'packages/sdk/src/local.ts'), 'export const mine = true;\n');
  writeFileSync(join(source, 'packages/other/presentation.tsx'), HOST);
  writeFileSync(join(source, 'presentation.tsx'), HOST);

  const result = syncEmbeddedSdk(source, { templateSdkDir, retiredFiles: RETIRED, log() {} });
  assert.deepEqual(result.changed.sort(), ['package.json', 'src/index.ts', 'src/presentation.tsx', 'tsconfig.json']);
  assert.equal(readFileSync(join(source, 'packages/sdk/src/index.ts'), 'utf8'), 'export const fresh = true;\n');
  assert.equal(readFileSync(join(source, 'packages/sdk/src/local.ts'), 'utf8'), 'export const mine = true;\n');
  assert.equal(readFileSync(join(source, 'packages/other/presentation.tsx'), 'utf8'), HOST);
  assert.equal(readFileSync(join(source, 'presentation.tsx'), 'utf8'), HOST);

  const built = await buildSpaceArtifact(source, 'overview', { stdio: 'pipe' });
  assert.equal(built.manifest.local_key, 'overview');
  const ctx = commandContext('build', source);
  const viaCommand = await ctx.spec.handler(ctx);
  assert.equal(viaCommand.data.manifest.local_key, 'overview');
});
