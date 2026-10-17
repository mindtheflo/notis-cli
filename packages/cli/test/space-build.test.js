import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildSpaceArtifact, prepareSpaceRelease } from '../src/runtime/space-platform.js';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(cliRoot, '../..');
const VIEW_DECLARATION = `path:'board',description:'A build contract fixture.',memory:{markdown:false,attachments:false,screenshot:false,snapshots:[]}`;
const BUNDLER_OUTPUT = 'fixture bundler progress line';

/** Stand-in bundler that writes the canonical bundle and talks on stdout, as Vite does. */
function bundlerSource({ js, css, expectedArgs = null }) {
  return `#!/usr/bin/env node
const fs = require('node:fs');
${expectedArgs ? `require('node:assert/strict').deepEqual(process.argv.slice(2), ${JSON.stringify(expectedArgs)});\n` : ''}console.log(${JSON.stringify(BUNDLER_OUTPUT)});
fs.mkdirSync('.notis/output/bundle', { recursive: true });
fs.writeFileSync('.notis/output/bundle/app.js', ${JSON.stringify(js)});
fs.writeFileSync('.notis/output/bundle/app.css', ${JSON.stringify(css)});
`;
}

/**
 * One presentation Space whose build script is a stub in node_modules/.bin:
 * Space staging links node_modules and the source boundary scan skips it, so
 * the stub can emit bytes the source itself must never contain.
 */
function fixture({ buildScript = 'fixture-build', bin = 'fixture-build', sourceCss = 'main { color: inherit; }\n',
  js = 'export default function SpaceView() { return null; }', css = '[data-notis-app-root]{}', expectedArgs = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'notis-space-build-'));
  for (const dir of ['spaces/board', 'node_modules/.bin']) mkdirSync(join(root, dir), { recursive: true });
  symlinkSync(join(repo, 'packages/sdk/node_modules/typescript'), join(root, 'node_modules/typescript'), 'dir');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'space-build-fixture', private: true, scripts: { build: buildScript } }));
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { moduleResolution: 'bundler', module: 'ESNext', jsx: 'react-jsx' } }));
  writeFileSync(join(root, 'notis.config.ts'), `import { defineSpaces } from '@notis/sdk/config';
export default defineSpaces({ spaces: { board: { definition: 'spaces/board/space.config.ts' } } });`);
  writeFileSync(join(root, 'spaces/board/space.config.ts'), `import { defineSpace } from '@notis/sdk/config';
export default defineSpace({ name: 'Board', ${VIEW_DECLARATION}, entry: './view.tsx' });`);
  writeFileSync(join(root, 'spaces/board/view.tsx'), `import './view.css';\nexport default function View() { return null; }\n`);
  writeFileSync(join(root, 'spaces/board/view.css'), sourceCss);
  writeFileSync(join(root, 'node_modules/.bin', bin), bundlerSource({ js, css, expectedArgs }), { mode: 0o755 });
  return root;
}

async function builtFile(root, path) {
  const release = await prepareSpaceRelease(root, 'board');
  try {
    assert.ok(release.files[path], `${path} is in the saved build`);
    return Buffer.from(release.files[path], 'base64').toString('utf8');
  } finally { release.close(); }
}

test('spaces build --json keeps stdout to one JSON envelope while the build script writes to stdout', () => {
  const root = fixture();
  const home = mkdtempSync(join(tmpdir(), 'notis-space-build-home-'));
  try {
    const result = spawnSync(process.execPath, [join(cliRoot, 'bin/notis.js'), 'spaces', 'build', root, '--space', 'board', '--json'], {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: home, NODE_ENV: 'test', NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1' },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(!result.stdout.includes(BUNDLER_OUTPUT), 'build script output stays off machine stdout');
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'spaces build');
    assert.equal(envelope.data.manifest.schema, 'notis-space/v1');
    assert.equal(envelope.data.manifest.local_key, 'board');
    assert.ok(existsSync(envelope.data.receiptPath), 'the selected build was saved');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('a Space build supplies the portable loader for the historical Vite script without rewriting source', async () => {
  const root = fixture({ buildScript: ' vite build ', bin: 'vite', expectedArgs: ['build', '--configLoader', 'runner'] });
  try {
    const packageSource = readFileSync(join(root, 'package.json'), 'utf8');
    const built = await buildSpaceArtifact(root, 'board', { stdio: 'pipe', refreshSdk: false });
    assert.equal(built.manifest.local_key, 'board');
    assert.ok(existsSync(built.receiptPath));
    assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), packageSource);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a Space build rewrites Tailwind-style global selectors into shadow-safe bundle selectors', async () => {
  const root = fixture({ css: 'html,:host{line-height:1.5}:root{--radius:8px}@layer theme{:root,:host{--spacing:.25rem}}body{margin:0}' });
  try {
    await buildSpaceArtifact(root, 'board', { stdio: 'pipe', refreshSdk: false });
    assert.equal(await builtFile(root, 'bundle/app.css'),
      '[data-notis-app-root],:host{line-height:1.5}[data-notis-app-root],:host{--radius:8px}@layer theme{[data-notis-app-root],:host{--spacing:.25rem}}[data-notis-app-root]{margin:0}');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a Space build rejects selected source CSS that escapes the view surface and saves nothing', async () => {
  const root = fixture({ sourceCss: 'body { color: red; }\n' });
  try {
    await assert.rejects(buildSpaceArtifact(root, 'board', { stdio: 'pipe', refreshSdk: false }),
      /Project violates the Notis app portal boundary[\s\S]*body selectors are forbidden/);
    await assert.rejects(prepareSpaceRelease(root, 'board'), /missing or stale/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a Space build rejects bundle JS that reaches for the portal runtime global and saves nothing', async () => {
  const root = fixture({ js: 'const runtime = window.__NOTIS_RUNTIME__; export default function SpaceView() { return runtime ? null : null; }' });
  try {
    await assert.rejects(buildSpaceArtifact(root, 'board', { stdio: 'pipe', refreshSdk: false }),
      /Built app violates the Notis app portal boundary[\s\S]*window\.__NOTIS_RUNTIME__/);
    await assert.rejects(prepareSpaceRelease(root, 'board'), /missing or stale/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
