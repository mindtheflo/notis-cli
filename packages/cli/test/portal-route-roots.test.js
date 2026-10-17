import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateViewPath } from '../src/runtime/space-view-manifest.js';

test('every consumer uses the generated current Portal route ownership list', () => {
  const check = spawnSync(process.execPath, [fileURLToPath(new URL('../../../scripts/generate-portal-route-roots.mjs', import.meta.url)), '--check'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  assert.throws(() => validateViewPath('skills'), /belongs to the Portal/);
  assert.throws(() => validateViewPath('api/private'), /belongs to the Portal/);
  assert.equal(validateViewPath('notes'), 'notes');
});

test('a hidden folder in the Portal app tree adds no route root', () => {
  const repo = mkdtempSync(join(tmpdir(), 'portal-route-roots-'));
  try {
    const generator = join(repo, 'scripts/generate-portal-route-roots.mjs');
    mkdirSync(dirname(generator), { recursive: true });
    cpSync(fileURLToPath(new URL('../../../scripts/generate-portal-route-roots.mjs', import.meta.url)), generator);
    // An untracked local `.well-known` route, one inside a route group, a leftover folder
    // holding only a hidden folder and one holding only a hidden file must leave the outputs
    // as a fresh checkout makes them.
    for (const file of ['settings/page.tsx', '.well-known/oauth-client-metadata.json/route.ts',
      '(main)/.well-known/route.ts', 'leftover/.cache/state.json', 'finder/.DS_Store']) {
      const path = join(repo, 'portal/src/app', file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '');
    }
    const run = spawnSync(process.execPath, [generator], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const expected = `${JSON.stringify(['documents', 'settings', 'share', 'view'], null, 2)}\n`;
    for (const output of ['server/config/portal_route_roots.json', 'packages/cli/config/portal-route-roots.json',
      'portal/src/generated/portalRouteRoots.json', 'electron/src/generated/portalRouteRoots.json']) {
      assert.equal(readFileSync(join(repo, output), 'utf8'), expected, output);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('the Portal Space view rewrite holds back exactly the listed first words', () => {
  const read = (path) => readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');
  const config = read('portal/next.config.ts');
  assert.match(config, /^import portalRouteRoots from '\.\/src\/generated\/portalRouteRoots\.json';$/m);
  const rewrite = config.match(/\{ source: `\/:viewPath\((.*)\)`, destination: '\/space-view' \}/);
  assert.ok(rewrite, 'portal/next.config.ts has no Space view rewrite');
  const roots = JSON.parse(read('portal/src/generated/portalRouteRoots.json'));
  const pattern = rewrite[1].replace("${portalRouteRoots.join('|')}", roots.join('|'));
  assert.ok(!pattern.includes('${'), pattern);
  // Next compiles a rewrite source made of one named parameter with its own pattern with
  // path-to-regexp (strict and case-insensitive), then lets one trailing slash through
  // (modifyRouteRegex in Next's lib/redirect-status.js), which gives this RegExp.
  const toSpaceView = new RegExp(`^(?:\\/(${pattern}))(?:\\/)?$`, 'i');
  for (const path of ['/notes', '/notes/', '/notes/detail', '/xwell-known', '/xwell-known/', '/xwell-known/detail']) {
    assert.equal(toSpaceView.test(path), true, path);
  }
  for (const word of roots) {
    assert.equal(toSpaceView.test(`/${word}`), false, word);
    assert.equal(toSpaceView.test(`/${word}/`), false, `${word}/`);
    assert.equal(toSpaceView.test(`/${word}/detail`), false, `${word}/detail`);
  }
  // A word that only starts with a listed one is not held back.
  for (const word of roots.filter((listed) => !roots.includes(`${listed}x`))) {
    assert.equal(toSpaceView.test(`/${word}x`), true, `${word}x`);
  }
});
