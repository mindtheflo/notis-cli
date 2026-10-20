import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { syncEmbeddedSdk } from '../src/runtime/app-platform.js';
import { SPACE_HOST_SDK_MODULES, assertSpaceBundleUsesHostSdk } from '../src/runtime/space-platform.js';
import { buildSpaceSdk, readHostModules } from '../scripts/build-space-sdk.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const sdkDir = join(repoRoot, 'packages/sdk');
const spaceSdkDir = join(repoRoot, 'packages/cli/dist/space-sdk');

function write(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

test('the CLI bundle guard allows exactly the host modules of the SDK runtime contract', async () => {
  const { hostModules } = await readHostModules(sdkDir);
  assert.deepEqual([...SPACE_HOST_SDK_MODULES].sort(), Object.keys(hostModules).sort());
});

test('a Space bundle may import only the host SDK modules and never carries SDK code', () => {
  assertSpaceBundleUsesHostSdk('import { useNotis } from "@notis/sdk"; import * as ui from "@notis/sdk/ui"; export { useNotis, ui };');
  assertSpaceBundleUsesHostSdk('export const view = () => import("@notis/sdk/ui");');
  for (const specifier of ['@notis/sdk/words', '@notis/sdk/interactions', '@notis/sdk/styles.css', '@notis/sdk/toolkit.css']) {
    assert.throws(() => assertSpaceBundleUsesHostSdk(`import { x } from "${specifier}";`),
      (error) => error.message.includes(specifier), specifier);
  }
  // Vendored SDK internals carry their registry keys.
  assert.throws(() => assertSpaceBundleUsesHostSdk('const key = Symbol.for("notis.sdk.runtime");'),
    /contains Notis SDK code/);
});

test('a Space SDK refresh mirrors the package exactly and removes everything else', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-space-sdk-prune-'));
  try {
    const template = join(root, 'space-sdk');
    write(template, 'package.json', JSON.stringify({ name: '@notis/sdk', version: '9.9.9' }));
    write(template, 'src/index.d.ts', 'export declare const useNotis: () => string;\n');
    write(template, 'src/words/index.ts', 'export const words = {};\n');
    write(template, 'dist/index.js', 'export * from "./chunk-NEW.js";\n');
    write(template, 'dist/chunk-NEW.js', 'export const useNotis = () => "new";\n');
    const project = join(root, 'space');
    write(project, 'notis.config.ts', 'export default {};\n');
    write(project, 'packages/sdk/package.json', JSON.stringify({ name: '@notis/sdk', version: '0.1.0' }));
    write(project, 'packages/sdk/tsconfig.json', '{}');
    write(project, 'packages/sdk/src/index.ts', 'export const vendored = true;\n');
    write(project, 'packages/sdk/src/provider.tsx', 'export const Provider = null;\n');
    write(project, 'packages/sdk/src/components/Card.tsx', 'export const Card = null;\n');
    write(project, 'packages/sdk/src/styles.css', '.list-row {}\n');
    // The previous test runtime: its chunk names change with every SDK release.
    write(project, 'packages/sdk/dist/index.js', 'export * from "./chunk-OLD.js";\n');
    write(project, 'packages/sdk/dist/chunk-OLD.js', 'export const useNotis = () => "old";\n');
    write(project, 'packages/sdk/dist/nested/stale.js', 'export {};\n');

    const result = syncEmbeddedSdk(project, { templateSdkDir: template, retiredFiles: {}, prune: true });
    assert.equal(result.updated, true);
    assert.equal(readFileSync(join(project, 'packages/sdk/src/index.d.ts'), 'utf8'), 'export declare const useNotis: () => string;\n');
    assert.equal(existsSync(join(project, 'packages/sdk/src/words/index.ts')), true);
    assert.equal(readFileSync(join(project, 'packages/sdk/dist/index.js'), 'utf8'), 'export * from "./chunk-NEW.js";\n');
    assert.equal(existsSync(join(project, 'packages/sdk/dist/chunk-NEW.js')), true);
    for (const gone of ['tsconfig.json', 'src/index.ts', 'src/provider.tsx', 'src/components/Card.tsx', 'src/styles.css', 'src/components',
      'dist/chunk-OLD.js', 'dist/nested']) {
      assert.equal(existsSync(join(project, 'packages/sdk', gone)), false, gone);
    }
    assert.equal(JSON.parse(readFileSync(join(project, 'packages/sdk/package.json'), 'utf8')).version, '9.9.9');

    // A template without a runtime leaves no runtime folder behind.
    rmSync(join(template, 'dist'), { recursive: true });
    syncEmbeddedSdk(project, { templateSdkDir: template, retiredFiles: {}, prune: true });
    assert.equal(existsSync(join(project, 'packages/sdk/dist')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a legacy app SDK refresh never touches packages/sdk/dist', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-legacy-sdk-dist-'));
  try {
    const template = join(root, 'sdk');
    write(template, 'package.json', JSON.stringify({ name: '@notis/sdk', version: '9.9.9' }));
    write(template, 'src/index.ts', 'export const fresh = true;\n');
    write(template, 'dist/index.js', 'export const templateRuntime = true;\n');
    const project = join(root, 'app');
    write(project, 'notis.config.ts', 'export default {};\n');
    write(project, 'packages/sdk/package.json', JSON.stringify({ name: '@notis/sdk', version: '0.1.0' }));
    write(project, 'packages/sdk/dist/local.js', 'export const mine = true;\n');
    const result = syncEmbeddedSdk(project, { templateSdkDir: template, retiredFiles: {}, log() {} });
    assert.deepEqual(result.changed.sort(), ['package.json', 'src/index.ts']);
    assert.equal(existsSync(join(project, 'packages/sdk/dist/index.js')), false);
    assert.equal(readFileSync(join(project, 'packages/sdk/dist/local.js'), 'utf8'), 'export const mine = true;\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function writeSdkFixture(fixture, { index = [] } = {}) {
  write(fixture, 'package.json', JSON.stringify({
    name: '@notis/sdk', version: '0.3.0', type: 'module',
    scripts: { test: 'x' }, devDependencies: { typescript: '*' }, peerDependencies: { react: '>=19' },
    exports: {
      '.': './src/index.ts', './ui': './src/ui/index.ts', './words': './src/words/index.ts',
      './config': './src/config.ts', './vite': './src/vite.ts', './toolkit.css': './src/ui/toolkit.css',
      './internal': './src/internal.ts',
    },
  }));
  write(fixture, 'tsconfig.json', JSON.stringify({
    compilerOptions: { rootDir: 'src', target: 'es2022', module: 'esnext', moduleResolution: 'bundler', strict: true, jsx: 'react-jsx', skipLibCheck: true, noEmit: true, types: [] },
    include: ['src'],
  }));
  write(fixture, 'src/runtimeModules.ts', readFileSync(join(sdkDir, 'src/runtimeModules.ts'), 'utf8'));
  write(fixture, 'src/index.ts', [
    "import { createElement } from 'react';",
    "import { greet } from './words';",
    "export { registry } from './shared';",
    "export const useNotis = () => greet('notis');",
    "export const element = () => createElement('div');",
    "export const rowClass = 'nui-row flex items-center px-3 document.body';",
    ...index,
  ].join('\n') + '\n');
  write(fixture, 'src/shared.ts', 'export const registry = new Map<string, number>();\n');
  write(fixture, 'src/ui/index.ts', "export { registry as uiRegistry } from '../shared';\nexport const panelClass = 'nui-panel grid-cols-[1fr_2fr]';\n");
  write(fixture, 'src/ui/toolkit.css', ':root { --nui: 1; }\n');
  write(fixture, 'src/words/index.ts', "import { join } from './join';\nexport const greet = (name: string) => join('hello', name);\n");
  write(fixture, 'src/words/join.ts', 'export const join = (a: string, b: string) => `${a} ${b}`;\n');
  write(fixture, 'src/config.ts', "/** Example: import { x } from './never'; */\nexport const defineConfig = <T>(value: T) => value;\n");
  write(fixture, 'src/vite.ts', "export const notisVite = () => ({ name: 'notis' });\n");
  write(fixture, 'src/internal.ts', 'export const secret = 1;\n');
  symlinkSync(join(sdkDir, 'node_modules'), join(fixture, 'node_modules'));
}

test('the Space SDK package ships host types, bundled source and a Node-only test runtime', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-space-sdk-build-'));
  try {
    const fixture = join(root, 'sdk');
    writeSdkFixture(fixture);
    const target = join(root, 'space/packages/sdk');
    const result = await buildSpaceSdk({ sdkDir: fixture, targetDir: target });
    assert.deepEqual(result.exports, {
      '.': { types: './src/index.d.ts', node: './dist/index.js' }, './ui': { types: './src/ui/index.d.ts', node: './dist/ui.js' },
      './words': './src/words/index.ts', './config': './src/config.ts', './vite': './src/vite.ts',
    });
    // TypeScript takes the first matching condition, so declarations must come first.
    assert.deepEqual(Object.keys(result.exports['.']), ['types', 'node']);
    // Host modules ship as declarations plus the test runtime, never as source.
    assert.equal(existsSync(join(target, 'src/index.ts')), false);
    assert.equal(existsSync(join(target, 'src/ui/index.ts')), false);
    // Both entries share one chunk; packages stay bare imports and CSS is never part of it.
    assert.equal(result.runtime.length, 3);
    assert.deepEqual(result.runtime.filter(file => !/^dist\/chunk-[A-Z0-9]+\.js$/.test(file)), ['dist/index.js', 'dist/ui.js']);
    const entry = readFileSync(join(target, 'dist/index.js'), 'utf8');
    assert.match(entry, /^\/\/ Generated by packages\/cli\/scripts\/build-space-sdk\.js for Node tests only\./);
    assert.match(entry, /from\s*"react"/);
    assert.equal(readdirSync(join(target, 'dist')).some(file => file.endsWith('.css')), false);
    // A Space resolves the runtime through the `node` condition, from its own node_modules.
    symlinkSync(join(sdkDir, 'node_modules'), join(root, 'space/node_modules'));
    const probe = "const [root, ui] = await Promise.all([import('@notis/sdk'), import('@notis/sdk/ui')]);"
      + ' process.stdout.write(JSON.stringify({ shared: root.registry === ui.uiRegistry, hook: root.useNotis(), element: typeof root.element, panel: ui.panelClass }));';
    const consumer = join(root, 'consumer');
    write(consumer, 'package.json', JSON.stringify({ type: 'module' }));
    mkdirSync(join(consumer, 'node_modules/@notis'), { recursive: true });
    symlinkSync(target, join(consumer, 'node_modules/@notis/sdk'), 'dir');
    assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: consumer, encoding: 'utf8' })),
      { shared: true, hook: 'hello notis', element: 'function', panel: 'nui-panel grid-cols-[1fr_2fr]' });
    assert.match(readFileSync(join(target, 'src/index.d.ts'), 'utf8'), /^\/\/\/ <reference path="\.\/tailwind-candidates\.d\.ts" \/>/);
    assert.match(readFileSync(join(target, 'src/index.d.ts'), 'utf8'), /useNotis/);
    // Bundled entries ship as source with their value closure.
    assert.equal(existsSync(join(target, 'src/words/join.ts')), true);
    // No CSS and no entry outside the Space contract.
    assert.equal(existsSync(join(target, 'src/ui/toolkit.css')), false);
    assert.equal(existsSync(join(target, 'src/internal.ts')), false);
    assert.equal(existsSync(join(target, 'src/internal.d.ts')), false);
    // The host renders these classes inside the Space, so its Tailwind scan sees them; code paths are dropped.
    const candidates = readFileSync(join(target, 'src/tailwind-candidates.d.ts'), 'utf8');
    for (const word of ['nui-row', 'items-center', 'grid-cols-[1fr_2fr]']) assert.ok(candidates.includes(`\n${word}\n`), word);
    assert.equal(candidates.includes('document.body'), false);
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
    assert.equal(manifest.scripts, undefined);
    assert.equal(manifest.devDependencies, undefined);
    assert.deepEqual(manifest.peerDependencies, { react: '>=19' });
    assert.equal(manifest.types, './src/index.d.ts');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the Space SDK build refuses a runtime import the package does not declare', async () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-space-sdk-undeclared-'));
  try {
    const fixture = join(root, 'sdk');
    writeSdkFixture(fixture, { index: ["export { createPortal } from 'react-dom';"] });
    await assert.rejects(buildSpaceSdk({ sdkDir: fixture, targetDir: join(root, 'out') }),
      /imports react-dom without declaring it in dependencies or peerDependencies/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function hostSubpath(specifier) {
  return specifier === '@notis/sdk' ? '.' : `./${specifier.slice('@notis/sdk/'.length)}`;
}

test('the built CLI carries the Space SDK package: host types, a Node-only test runtime and no SDK source', { skip: !existsSync(join(spaceSdkDir, 'package.json')) }, () => {
  const manifest = JSON.parse(readFileSync(join(spaceSdkDir, 'package.json'), 'utf8'));
  for (const specifier of SPACE_HOST_SDK_MODULES) {
    const subpath = hostSubpath(specifier);
    assert.deepEqual(Object.keys(manifest.exports[subpath]), ['types', 'node'], subpath);
    assert.match(manifest.exports[subpath].node, /^\.\/dist\/[a-z-]+\.js$/, subpath);
    assert.equal(existsSync(join(spaceSdkDir, manifest.exports[subpath].node)), true, subpath);
  }
  for (const gone of ['./interactions', './styles.css', './toolkit.css']) assert.equal(manifest.exports[gone], undefined, gone);
  for (const runtime of ['src/index.ts', 'src/provider.tsx', 'src/ui/index.ts', 'src/presentation.tsx']) {
    assert.equal(existsSync(join(spaceSdkDir, runtime)), false, runtime);
  }
  // Every package the runtime imports resolves from the Space's own install.
  const declared = new Set(Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }));
  for (const file of readdirSync(join(spaceSdkDir, 'dist'))) {
    for (const [, specifier] of readFileSync(join(spaceSdkDir, 'dist', file), 'utf8').matchAll(/\b(?:from|import)\s*\(?\s*"([^".][^"]*)"/g)) {
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      assert.ok(declared.has(name), `${file} imports ${specifier}`);
    }
  }
});

test('a Space test imports the built SDK runtime from its own install', {
  skip: !existsSync(join(spaceSdkDir, 'dist')) || !existsSync(join(sdkDir, 'node_modules/recharts')),
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-space-sdk-runtime-'));
  try {
    const manifest = JSON.parse(readFileSync(join(spaceSdkDir, 'package.json'), 'utf8'));
    cpSync(spaceSdkDir, join(root, 'packages/sdk'), { recursive: true });
    write(root, 'package.json', JSON.stringify({ type: 'module', dependencies: { '@notis/sdk': 'file:./packages/sdk' } }));
    mkdirSync(join(root, 'node_modules/@notis'), { recursive: true });
    symlinkSync(join(root, 'packages/sdk'), join(root, 'node_modules/@notis/sdk'), 'dir');
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      if (!existsSync(join(sdkDir, 'node_modules', name))) continue; // Build-time peers (vite) are not runtime imports.
      mkdirSync(dirname(join(root, 'node_modules', name)), { recursive: true });
      symlinkSync(join(sdkDir, 'node_modules', name), join(root, 'node_modules', name), 'dir');
    }
    const probe = "const [root, ui] = await Promise.all([import('@notis/sdk'), import('@notis/sdk/ui')]);"
      + ' process.stdout.write(JSON.stringify({ useNotis: typeof root.useNotis, ui: Object.keys(ui).length }));';
    const loaded = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: root, encoding: 'utf8' }));
    assert.equal(loaded.useNotis, 'function');
    assert.ok(loaded.ui > 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
