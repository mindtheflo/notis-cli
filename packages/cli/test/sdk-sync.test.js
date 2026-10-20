import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildArtifact, npmFailureReason, reconcileSdkLockfile, syncEmbeddedSdk, syncSpaceSdk } from '../src/runtime/app-platform.js';
import { collectProjectBoundaryViolations, collectArtifactBoundaryViolations } from '../src/runtime/app-boundary-validator.js';

// A real source has a Space index at its root; the refresh refuses any other folder.
function markSource(projectDir) {
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'notis.config.ts'), 'export default {};\n');
}

function makeTemplate(root) {
  const dir = join(root, 'template-sdk');
  mkdirSync(join(dir, 'src', 'hooks'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@notis/sdk', version: '9.9.9' }));
  writeFileSync(join(dir, 'tsconfig.json'), '{}\n');
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const fresh = true;\n');
  writeFileSync(join(dir, 'src', 'hooks', 'useQuery.ts'), 'export const useQuery = () => null;\n');
  return dir;
}

test('app SDK mirrors exclude host mounting code and retire only exact owned copies', t => {
  const root=mkdtempSync(join(tmpdir(),'notis-sdk-host-only-'));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  const templateSdkDir=makeTemplate(root);
  const host='export const host = createPortal(view, mount);\n';
  writeFileSync(join(templateSdkDir,'src/presentation.tsx'),host);
  const retiredFiles={'src/presentation.tsx':[createHash('sha256').update(host).digest('hex')]};
  for(const mode of ['absent','owned','modified']) {
    const projectDir=join(root,mode), sdk=join(projectDir,'packages/sdk'); markSource(projectDir);
    mkdirSync(join(sdk,'src'),{recursive:true});writeFileSync(join(sdk,'package.json'),'{}');
    const path=join(sdk,'src/presentation.tsx');
    if(mode!=='absent') writeFileSync(path,host+(mode==='modified'?'// user changes\n':''));
    const result=syncEmbeddedSdk(projectDir,{templateSdkDir,retiredFiles,log() {}});
    assert.equal(existsSync(path),mode==='modified');
    assert.equal(collectProjectBoundaryViolations(projectDir).length,mode==='modified'?1:0);
    if(mode==='modified') {
      assert.equal(readFileSync(path,'utf8'),host+'// user changes\n');
      assert.ok(result.foreign.includes('src/presentation.tsx'));
    }
  }
  assert.ok(collectArtifactBoundaryViolations({'app.js':host}).some(message=>message.includes('React portals')));
});

test('SDK refresh retires exact owned bytes only and preserves modified or additional files', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-sdk-retired-'));
  try {
    const templateSdkDir = makeTemplate(root), projectDir = join(root, 'app'); markSource(projectDir);
    const sdk = join(projectDir, 'packages/sdk'); mkdirSync(join(sdk, 'src'), { recursive: true });
    writeFileSync(join(sdk, 'package.json'), '{"name":"@notis/sdk"}');
    const original = 'export const obsoleteCanonicalHost = true;\n';
    const digest = createHash('sha256').update(original).digest('hex');
    writeFileSync(join(sdk, 'src/old.ts'), original);
    writeFileSync(join(sdk, 'src/modified.ts'), original + '// local addition\n');
    writeFileSync(join(sdk, 'src/local.ts'), 'local source');
    const result = syncEmbeddedSdk(projectDir, { templateSdkDir, log() {},
      retiredFiles: { 'src/old.ts': [digest], 'src/modified.ts': [digest] } });
    assert.equal(existsSync(join(sdk, 'src/old.ts')), false);
    assert.equal(readFileSync(join(sdk, 'src/modified.ts'), 'utf8'), original + '// local addition\n');
    assert.equal(readFileSync(join(sdk, 'src/local.ts'), 'utf8'), 'local source');
    assert.ok(result.changed.includes('src/old.ts'));
    assert.deepEqual(result.foreign.sort(), ['src/local.ts', 'src/modified.ts']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('syncEmbeddedSdk overwrites a stale embedded SDK and reports the update once', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-sdk-sync-'));
  try {
    const templateSdkDir = makeTemplate(root);
    const projectDir = join(root, 'app'); markSource(projectDir);
    mkdirSync(join(projectDir, 'packages', 'sdk', 'src'), { recursive: true });
    writeFileSync(join(projectDir, 'packages', 'sdk', 'package.json'), JSON.stringify({ name: '@notis/sdk', version: '0.1.0' }));
    writeFileSync(join(projectDir, 'packages', 'sdk', 'src', 'index.ts'), 'export const fresh = false;\n');
    writeFileSync(join(projectDir, 'packages', 'sdk', 'src', 'local-only.ts'), 'export const keep = true;\n');

    const logged = [];
    const first = syncEmbeddedSdk(projectDir, { templateSdkDir, log: (message) => logged.push(message) });
    assert.equal(first.updated, true);
    assert.deepEqual(first.changed.sort(), ['package.json', 'src/hooks/useQuery.ts', 'src/index.ts', 'tsconfig.json']);
    assert.deepEqual(first.foreign, ['src/local-only.ts']);
    assert.match(logged[0], /Updated embedded @notis\/sdk to 9\.9\.9/);
    assert.ok(logged.some((message) => /local-only\.ts is not part of the @notis\/sdk template/.test(message)));
    assert.equal(readFileSync(join(projectDir, 'packages', 'sdk', 'src', 'index.ts'), 'utf-8'), 'export const fresh = true;\n');
    assert.equal(readFileSync(join(projectDir, 'packages', 'sdk', 'src', 'local-only.ts'), 'utf-8'), 'export const keep = true;\n');

    const second = syncEmbeddedSdk(projectDir, { templateSdkDir, log: () => {} });
    assert.equal(second.updated, false);
    assert.deepEqual(second.changed, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('syncEmbeddedSdk is a no-op for projects without an embedded SDK', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-sdk-sync-'));
  try {
    const templateSdkDir = makeTemplate(root);
    const projectDir = join(root, 'plain'); markSource(projectDir);
    mkdirSync(projectDir, { recursive: true });
    assert.deepEqual(syncEmbeddedSdk(projectDir, { templateSdkDir, log: () => {} }), { updated: false, reason: 'no-embedded-sdk' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


for (const target of ['packages', 'packages/sdk', 'packages/sdk/src', 'packages/sdk/src/index.ts', 'packages/sdk/package.json']) {
  test(`SDK refresh rejects linked ${target} without changing outside bytes or retaining a build receipt`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'notis-sdk-link-'));
    try {
      const projectDir = join(root, 'app'); markSource(projectDir);
      const outside = join(root, 'outside');
      mkdirSync(join(projectDir, '.notis'), { recursive: true });
      mkdirSync(outside);
      writeFileSync(join(projectDir, '.notis/build-receipt.json'), '{}');
      const segments = target.split('/');
      const leaf = segments.pop();
      const parent = join(projectDir, ...segments);
      mkdirSync(parent, { recursive: true });
      if (target.endsWith('.json') || target.endsWith('.ts')) {
        const victim = join(outside, 'victim');
        writeFileSync(victim, 'outside sentinel');
        symlinkSync(victim, join(parent, leaf));
      } else {
        writeFileSync(join(outside, 'package.json'), 'outside sentinel');
        symlinkSync(outside, join(parent, leaf), 'dir');
      }
      if (!target.endsWith('package.json') && target.startsWith('packages/sdk/src')) {
        writeFileSync(join(projectDir, 'packages/sdk/package.json'), '{"name":"@notis/sdk","version":"0.0.0"}');
      }
      await assert.rejects(buildArtifact(projectDir, { stdio: 'pipe', prepare: () => assert.fail('prepare ran after a refused SDK refresh') }),
        /unsafe target|unsafe package/);
      const victim = join(outside, target.endsWith('.json') || target.endsWith('.ts') ? 'victim' : 'package.json');
      assert.equal(readFileSync(victim, 'utf8'), 'outside sentinel');
      assert.equal(existsSync(join(projectDir, '.notis/build-receipt.json')), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test('SDK refresh replaces a hard-linked mirror without truncating the outside file', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-sdk-hardlink-'));
  try {
    const templateSdkDir = makeTemplate(root);
    const projectDir = join(root, 'app'); markSource(projectDir);
    mkdirSync(join(projectDir, 'packages/sdk/src'), { recursive: true });
    writeFileSync(join(projectDir, 'packages/sdk/package.json'), '{"name":"@notis/sdk","version":"0.0.0"}');
    const victim = join(root, 'outside');
    writeFileSync(victim, 'outside sentinel');
    linkSync(victim, join(projectDir, 'packages/sdk/src/index.ts'));
    syncEmbeddedSdk(projectDir, { templateSdkDir, log: () => {} });
    assert.equal(readFileSync(victim, 'utf8'), 'outside sentinel');
    assert.equal(readFileSync(join(projectDir, 'packages/sdk/src/index.ts'), 'utf8'), 'export const fresh = true;\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('SDK refresh rejects a parent-directory swap before any outside write', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-sdk-parent-race-'));
  const previousCwd = process.cwd();
  const originalChdir = process.chdir;
  try {
    const templateSdkDir = makeTemplate(root);
    const projectDir = join(root, 'app'); markSource(projectDir);
    const sdkDir = join(projectDir, 'packages/sdk');
    const outside = join(root, 'outside');
    mkdirSync(join(sdkDir, 'src'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(sdkDir, 'package.json'), '{"name":"@notis/sdk","version":"0.0.0"}');
    writeFileSync(join(outside, 'index.ts'), 'outside sentinel');
    let swapped = false;
    process.chdir = (target) => {
      if (target === 'src' && !swapped) {
        swapped = true;
        renameSync(join(sdkDir, 'src'), join(sdkDir, 'original-src'));
        symlinkSync(outside, join(sdkDir, 'src'), 'dir');
      }
      return originalChdir.call(process, target);
    };
    assert.throws(() => syncEmbeddedSdk(projectDir, { templateSdkDir, log: () => {} }), /target changed/);
    assert.equal(swapped, true);
    assert.equal(readFileSync(join(outside, 'index.ts'), 'utf8'), 'outside sentinel');
  } finally {
    process.chdir = originalChdir;
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
});

// The 0.2.0 legacy copy of the chart data table before it moved into the Spaces toolkit.
const LEGACY_RENDER_CHART_DATA = "'use client';\n\nimport type { ReactNode } from 'react';\n\n/** A chart's data, available to view Markdown without adding a second visible table.\n * Keep labels/values identical to the chart. The renderer recognizes this semantic\n * table inside Shadow DOM; snapshots never infer numbers from SVG geometry.\n */\nexport function RenderChartData({ title, columns, rows, children }: {\n  title: string;\n  columns: readonly string[];\n  rows: readonly (readonly (string | number | boolean | null)[])[];\n  children?: ReactNode;\n}) {\n  return <>{children}<table hidden data-notis-render=\"chart-data\" aria-label={title}>\n    <thead><tr>{columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead>\n    <tbody>{rows.map((row, index) => <tr key={index}>{columns.map((_, column) => <td key={column}>{row[column] == null ? '' : String(row[column])}</td>)}</tr>)}</tbody>\n  </table></>;\n}\n";

test('a legacy app refresh retires the moved chart table and vendors no Spaces toolkit', t => {
  const root = mkdtempSync(join(tmpdir(), 'notis-legacy-sdk-refresh-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const projectDir = join(root, 'app'); markSource(projectDir);
  const sdk = join(projectDir, 'packages/sdk');
  mkdirSync(join(sdk, 'src/components'), { recursive: true });
  writeFileSync(join(sdk, 'package.json'), '{"name":"@notis/sdk","version":"0.2.0"}');
  writeFileSync(join(sdk, 'src/components/RenderChartData.tsx'), LEGACY_RENDER_CHART_DATA);
  const result = syncEmbeddedSdk(projectDir, { log() {} });
  assert.equal(existsSync(join(sdk, 'src/components/RenderChartData.tsx')), false);
  assert.ok(result.changed.includes('src/components/RenderChartData.tsx'));
  assert.deepEqual(result.foreign, []);
  assert.equal(existsSync(join(sdk, 'src/ui/charts/RenderChartData.tsx')), true);
  for (const toolkit of ['src/ui/index.ts', 'src/ui/toolkit.css', 'src/words/index.ts']) {
    assert.equal(existsSync(join(sdk, toolkit)), false, toolkit);
  }
  assert.deepEqual(collectProjectBoundaryViolations(projectDir), []);
});

// A Space SDK whose dependencies changed since the lock was written.
const SPACE_SDK_MANIFEST = { name: '@notis/sdk', version: '0.3.0', type: 'module',
  dependencies: { 'react-markdown': '^10.1.0', recharts: '^3.10.1' }, peerDependencies: { react: '>=18.0.0' } };

function lockedSpace(root, sdkEntry) {
  const templateSdkDir = join(root, 'space-sdk');
  mkdirSync(join(templateSdkDir, 'src'), { recursive: true });
  mkdirSync(join(templateSdkDir, 'dist'), { recursive: true });
  writeFileSync(join(templateSdkDir, 'package.json'), JSON.stringify(SPACE_SDK_MANIFEST));
  writeFileSync(join(templateSdkDir, 'src/index.d.ts'), 'export declare const useNotis: () => null;\n');
  writeFileSync(join(templateSdkDir, 'dist/index.js'), 'export const useNotis = () => null;\n');
  const projectDir = join(root, 'space'); markSource(projectDir);
  mkdirSync(join(projectDir, 'packages/sdk'), { recursive: true });
  writeFileSync(join(projectDir, 'packages/sdk/package.json'), JSON.stringify({ name: '@notis/sdk', version: '0.2.0' }));
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'space', dependencies: { '@notis/sdk': 'file:./packages/sdk' } }));
  writeFileSync(join(projectDir, 'package-lock.json'), JSON.stringify({ name: 'space', lockfileVersion: 3, requires: true, packages: {
    '': { name: 'space', dependencies: { '@notis/sdk': 'file:./packages/sdk' } },
    'node_modules/@notis/sdk': { resolved: 'packages/sdk', link: true },
    'packages/sdk': sdkEntry,
  } }, null, 2));
  return { projectDir, templateSdkDir };
}

const lockedSdk = projectDir => JSON.parse(readFileSync(join(projectDir, 'package-lock.json'), 'utf8')).packages['packages/sdk'];

test('a Space SDK sync updates package-lock.json only when its @notis/sdk record differs', t => {
  const root = mkdtempSync(join(tmpdir(), 'notis-space-sdk-lock-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { projectDir, templateSdkDir } = lockedSpace(root, { name: '@notis/sdk', version: '0.2.0',
    dependencies: { 'react-markdown': '^10.1.0' }, devDependencies: { typescript: '^7.0.2' }, peerDependencies: { react: '>=18.0.0' } });
  const calls = [], messages = [];
  // Stands in for `npm install --package-lock-only`, which records the linked manifest.
  const updateLock = (directory) => {
    calls.push(directory);
    const lock = JSON.parse(readFileSync(join(directory, 'package-lock.json'), 'utf8'));
    const { name, version, dependencies, peerDependencies } = SPACE_SDK_MANIFEST;
    lock.packages['packages/sdk'] = { name, version, dependencies, peerDependencies };
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify(lock, null, 2));
    return { ok: true };
  };
  const first = syncSpaceSdk(projectDir, { templateSdkDir, updateLock, log: message => messages.push(message) });
  assert.equal(first.lockfile, 'updated');
  assert.deepEqual(calls, [realpathSync(projectDir)]);
  assert.equal(readFileSync(join(projectDir, 'packages/sdk/dist/index.js'), 'utf8'), 'export const useNotis = () => null;\n');
  assert.ok(messages.some(message => message.startsWith('Updated package-lock.json for @notis/sdk 0.3.0.')), messages.join('\n'));
  assert.equal(lockedSdk(projectDir).devDependencies, undefined);

  const second = syncSpaceSdk(projectDir, { templateSdkDir, updateLock, log() {} });
  assert.equal(second.lockfile, 'current');
  assert.equal(calls.length, 1);
});

test('a Space SDK sync that cannot reach npm keeps going and says how to repair the lock', t => {
  const root = mkdtempSync(join(tmpdir(), 'notis-space-sdk-lock-offline-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stale = { name: '@notis/sdk', version: '0.2.0', dependencies: { 'react-markdown': '^10.1.0' } };
  const { projectDir, templateSdkDir } = lockedSpace(root, stale);
  const messages = [];
  const result = syncSpaceSdk(projectDir, { templateSdkDir, log: message => messages.push(message),
    updateLock: () => ({ ok: false, detail: 'npm error code ENOTFOUND' }) });
  assert.equal(result.updated, true);
  assert.equal(result.lockfile, 'stale');
  assert.deepEqual(lockedSdk(projectDir), stale);
  assert.ok(messages.some(message => message.includes('npm ci will refuse it (npm error code ENOTFOUND)')
    && message.includes('run npm install')), messages.join('\n'));
});

test('a Space SDK sync asks npm for the lock only, retries once, and shows npm\'s own reason', { skip: process.platform === 'win32' && 'POSIX npm stand-in' }, t => {
  const root = mkdtempSync(join(tmpdir(), 'notis-space-sdk-lock-npm-'));
  const pathBefore = process.env.PATH;
  t.after(() => { process.env.PATH = pathBefore; rmSync(root, { recursive: true, force: true }); });
  const stale = { name: '@notis/sdk', version: '0.2.0', dependencies: { 'react-markdown': '^10.1.0' } };
  const { projectDir, templateSdkDir } = lockedSpace(root, stale);
  // Stands in for npm on a machine without network, with npm's own output.
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'npm'), ['#!/bin/sh',
    `pwd -P > "${join(root, 'npm-cwd')}"`, `printf '%s\\n' "$@" > "${join(root, 'npm-args')}"`,
    ...['code ENOTFOUND', 'syscall getaddrinfo', 'errno ENOTFOUND',
      'network request to https://registry.npmjs.org/recharts failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org',
      'A complete log of this run can be found in: /tmp/npm-debug-0.log'].map(line => `echo 'npm error ${line}' >&2`),
    'exit 1'].join('\n'), { mode: 0o755 });
  process.env.PATH = `${bin}:${pathBefore}`;
  const messages = [];
  const result = syncSpaceSdk(projectDir, { templateSdkDir, log: message => messages.push(message) });
  assert.equal(result.lockfile, 'stale');
  assert.deepEqual(lockedSdk(projectDir), stale);
  assert.equal(readFileSync(join(root, 'npm-cwd'), 'utf8').trim(), realpathSync(projectDir));
  const args = readFileSync(join(root, 'npm-args'), 'utf8').trim().split('\n');
  assert.equal(args[0], 'install');
  for (const flag of ['--package-lock-only', '--ignore-scripts', '--fetch-retries=1']) assert.ok(args.includes(flag), `${flag} in ${args.join(' ')}`);
  assert.ok(messages.some(message => message.includes(
    'npm ci will refuse it (network request to https://registry.npmjs.org/recharts failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org).',
  )), messages.join('\n'));
});

test('an npm failure reads as npm\'s own reason, without its metadata, stack or log pointer', () => {
  assert.equal(npmFailureReason(['npm error code ECONNREFUSED', 'npm error syscall connect', 'npm error errno ECONNREFUSED',
    'npm error FetchError: request to http://127.0.0.1:9/date-fns failed, reason: connect ECONNREFUSED 127.0.0.1:9',
    'npm error     at ClientRequest.<anonymous> (minipass-fetch/lib/index.js:130:14)'].join('\n')),
  'FetchError: request to http://127.0.0.1:9/date-fns failed, reason: connect ECONNREFUSED 127.0.0.1:9');
  assert.equal(npmFailureReason('npm warn config production Use `--omit=dev` instead.\nnpm error code ETARGET\n'
    + 'npm error notarget No matching version found for recharts@^9.0.0.'), 'notarget No matching version found for recharts@^9.0.0.');
  assert.equal(npmFailureReason(''), '');
});

test('the lock check never runs npm without an npm lock or a linked SDK', t => {
  const root = mkdtempSync(join(tmpdir(), 'notis-space-sdk-lock-skip-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { projectDir } = lockedSpace(root, { name: '@notis/sdk', version: '0.2.0' });
  const updateLock = () => { throw new Error('npm must not run'); };
  const check = () => reconcileSdkLockfile(projectDir, { manifest: SPACE_SDK_MANIFEST, updateLock, log() {} });
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ dependencies: { '@notis/sdk': '^0.2.0' } }));
  assert.equal(check(), 'unlinked');
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ dependencies: { '@notis/sdk': 'file:./packages/sdk' } }));
  writeFileSync(join(projectDir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 1, dependencies: {} }));
  assert.equal(check(), 'unsupported');
  rmSync(join(projectDir, 'package-lock.json'));
  assert.equal(check(), 'absent');
});
