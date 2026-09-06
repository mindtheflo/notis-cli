import { createServer } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { buildArtifact, computeArtifactHash, prepareAppRelease, readLinkedState, appLinkedStateProfileKey } from '../src/runtime/app-platform.js';
import { startAppTestServer } from '../src/runtime/app-test-server.js';
import { HIDE_HARNESS_STATUS_SCRIPT } from '../src/runtime/agent-browser.js';
import { getAvailablePort } from '../src/runtime/ports.js';

const cliRoot = resolve(import.meta.dirname, '..');
const binPath = join(cliRoot, 'bin', 'notis.js');

// Verify only needs a buildable app with routes. Listing metadata (tagline,
// categories, screenshots, changelog) is a publish concern, so it is opt-in
// here and exercised by the --listing tests.
function createAppProject({ listing = false, workspaceDatabases = false } = {}) {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-app-verify-'));
  mkdirSync(join(projectDir, 'app'), { recursive: true });
  writeFileSync(join(projectDir, 'app', 'page.tsx'), 'export default function Page() { return null; }\n');
  writeFileSync(join(projectDir, 'vite.config.ts'), 'export default {};\n');
  writeFileSync(join(projectDir, 'notis.config.ts'), `
import { defineNotisApp } from '@notis/sdk/config';

export default defineNotisApp({
  name: 'Verify App',
${workspaceDatabases ? "  capabilities: { workspaceDatabases: 'read' },\n" : ''}  description: 'A fixture app for verifying the generated harness.',
${listing ? `  tagline: 'Verify a production-ready app.',
  categories: ['Productivity'],
  screenshots: [
    { path: 'metadata/screenshot-1.png', alt: 'Verify App home' },
    { path: 'metadata/screenshot-2.png', alt: 'Verify App detail' },
    { path: 'metadata/screenshot-3.png', alt: 'Verify App final state' },
  ],
` : ''}  databases: ['items'],
  routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
  tools: ['LOCAL_NOTIS_DATABASE_QUERY'],
});
`);
  if (listing) {
    writeFileSync(
      join(projectDir, 'CHANGELOG.md'),
      '# Verify App Changelog\n\n## [Initial Release] - 2026-07-17\n\n- Added the verification fixture.\n',
    );
    mkdirSync(join(projectDir, 'metadata'), { recursive: true });
    for (let index = 1; index <= 3; index += 1) {
      const png = Buffer.alloc(24);
      Buffer.from('89504e470d0a1a0a', 'hex').copy(png, 0);
      png.writeUInt32BE(2000, 16);
      png.writeUInt32BE(1250, 20);
      writeFileSync(join(projectDir, 'metadata', `screenshot-${index}.png`), png);
    }
  }
  writeFileSync(join(projectDir, 'build.cjs'), `
const fs = require('fs');
const path = require('path');
const out = path.join(process.cwd(), '.notis', 'output', 'bundle');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'app.js'), 'export function index(){ return null; }\\n');
fs.writeFileSync(path.join(out, 'app.css'), '[data-notis-app-root]{display:block;}\\n');
`);
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({
      name: 'verify-app',
      private: true,
      notisAppVersion: '0.1.0',
      scripts: { build: 'node build.cjs' },
    }, null, 2),
  );
  return projectDir;
}

async function buildAppProject(options = {}) {
  const projectDir = createAppProject(options);
  await buildArtifact(projectDir);
  return projectDir;
}

function writeMockAgentBrowser(harness, { design = [] } = {}) {
  const binDir = mkdtempSync(join(tmpdir(), 'notis-agent-browser-'));
  const scriptPath = join(binDir, 'agent-browser');
  writeFileSync(scriptPath, `#!/usr/bin/env node
const harness = ${JSON.stringify(harness)};
const design = ${JSON.stringify(design)};
const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('agent-browser mock\\n');
  process.exit(0);
}
let command = null;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--session') {
    i += 1;
    continue;
  }
  if (arg === '--json' || arg === '-i') {
    continue;
  }
  if (arg.startsWith('--')) {
    continue;
  }
  command = arg;
  break;
}
if (command === 'eval') {
  const script = args[args.indexOf('eval') + 1] || '';
  const isDesign = script.includes('__notisDesignAssertions');
  if (isDesign && process.env.NOTIS_TEST_DESIGN_EVAL_ERROR === '1') process.exit(1);
  if (isDesign && process.env.NOTIS_TEST_DESIGN_MALFORMED === '1') { process.stdout.write('not json'); process.exit(0); }
  process.stdout.write(JSON.stringify({
    success: true,
    data: { result: JSON.stringify(isDesign ? design : harness) },
    error: null,
  }));
  process.exit(0);
}
if (command === 'set') {
  process.exit(process.env.NOTIS_TEST_DESIGN_VIEWPORT_ERROR === '1' ? 1 : 0);
}
if (command === 'snapshot') {
  process.stdout.write('Page: Verify App\\n');
  process.exit(0);
}
if (command === 'close' && process.env.NOTIS_TEST_FAIL_CLOSE === '1') {
  const fs = require('node:fs');
  const firstClose = !fs.existsSync(process.env.NOTIS_TEST_CLOSE_LOG);
  fs.appendFileSync(process.env.NOTIS_TEST_CLOSE_LOG, 'close\\n');
  if (firstClose && process.env.NOTIS_TEST_INTERRUPT_DURING_CLOSE === '1') {
    const parentPid = Number(args.find(value => value.startsWith('notis-verify-')).slice('notis-verify-'.length));
    const signals = (process.env.NOTIS_TEST_SIGNAL_SEQUENCE || 'SIGTERM').split(',');
    process.kill(parentPid, signals[0]);
    if (signals[1]) setTimeout(() => process.kill(parentPid, signals[1]), 25);
  }
  setTimeout(() => process.exit(1), 100);
} else if (command === 'close' && process.env.NOTIS_TEST_INTERRUPT_DURING_CLOSE === '1') {
  process.kill(Number(args.find(value => value.startsWith('notis-verify-')).slice('notis-verify-'.length)), 'SIGTERM');
  setTimeout(() => process.exit(0), 300);
} else if (command === 'open' || command === 'close') {
  process.exit(0);
}
if (command !== 'close') {
  process.stderr.write('unexpected command: ' + args.join(' ') + '\\n');
  process.exit(1);
}
`);
  chmodSync(scriptPath, 0o755);
  return binDir;
}

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: cliRoot,
    env: {
      ...process.env,
      HOME: mkdtempSync(join(tmpdir(), 'notis-cli-home-')),
      NODE_ENV: 'test',
      NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1',
      ...env,
    },
    encoding: 'utf-8',
  });
}

test('apps verify serves a generated harness route from the explicit test server', async (t) => {
  const projectDir = await buildAppProject();
  const port = await getAvailablePort();
  const server = await startAppTestServer({
    apps: [{ slug: 'verify-app', projectDir }],
    port,
    watch: false,
    log: () => {},
    logError: (message) => {
      throw new Error(message);
    },
  });

  t.after(async () => {
    await server.close();
  });

  const response = await fetch(`http://127.0.0.1:${port}/a/verify-app/harness?route=home`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /const routeExport = "index";/);
  assert.match(html, /"slug":"items"/);
  assert.match(html, /"route":\{"slug":"home"/);
});

test('harness injects synthetic tool data and a named screenshot scenario', async (t) => {
  const projectDir = await buildAppProject();
  mkdirSync(join(projectDir, 'metadata'), { recursive: true });
  writeFileSync(
    join(projectDir, 'metadata', 'screenshot-fixtures.json'),
    JSON.stringify({
      tools: { LOCAL_NOTIS_DATABASE_QUERY: { documents: [{ id: 'demo-entry' }] } },
      scenarios: {
        editor: { actions: [{ type: 'click', selector: '[data-open-editor]' }] },
      },
    }),
  );
  const port = await getAvailablePort();
  const server = await startAppTestServer({
    apps: [{ slug: 'verify-app', projectDir }],
    port,
    watch: false,
    log: () => {},
    logError: (message) => {
      throw new Error(message);
    },
  });
  t.after(async () => server.close());

  const response = await fetch(`http://127.0.0.1:${port}/a/verify-app/harness?route=home&scenario=editor&theme=dark`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /"screenshotScenario":"editor"/);
  assert.match(html, /"demo-entry"/);
  assert.match(html, /"selector":"\[data-open-editor\]"/);
  assert.match(html, /document\.documentElement\.classList\.toggle\('dark'/);
  assert.match(html, /:root\.dark/);
  assert.match(html, /color-scheme: dark/);
});

test('a screenshot scenario overrides the file-level tool fixtures', async (t) => {
  const projectDir = await buildAppProject();
  mkdirSync(join(projectDir, 'metadata'), { recursive: true });
  writeFileSync(
    join(projectDir, 'metadata', 'screenshot-fixtures.json'),
    JSON.stringify({
      tools: { LOCAL_NOTIS_DATABASE_QUERY: { documents: [{ id: 'demo-entry' }] } },
      requests: { '/portal_apps/status': { state: 'connected' } },
      scenarios: {
        empty: {
          tools: { LOCAL_NOTIS_DATABASE_QUERY: { documents: [] } },
          requests: { '/portal_apps/status': { state: 'disconnected' } },
        },
      },
    }),
  );
  const port = await getAvailablePort();
  const server = await startAppTestServer({
    apps: [{ slug: 'verify-app', projectDir }],
    port,
    watch: false,
    log: () => {},
    logError: (message) => {
      throw new Error(message);
    },
  });
  t.after(async () => server.close());

  const overridden = await (await fetch(
    `http://127.0.0.1:${port}/a/verify-app/harness?route=home&scenario=empty`,
  )).text();
  assert.doesNotMatch(overridden, /"demo-entry"/);
  assert.match(overridden, /"documents":\[\]/);
  assert.match(overridden, /"state":"disconnected"/);

  const base = await (await fetch(`http://127.0.0.1:${port}/a/verify-app/harness?route=home`)).text();
  assert.match(base, /"demo-entry"/);
  assert.match(base, /"state":"connected"/);
});

test('screenshot capture hides the harness banner without removing its compositor layer', () => {
  assert.match(HIDE_HARNESS_STATUS_SCRIPT, /opacity = '0'/);
  assert.doesNotMatch(HIDE_HARNESS_STATUS_SCRIPT, /display = 'none'/);
});

test('apps verify aggregates a passing mocked harness result', async () => {
  const projectDir = await buildAppProject();
  const mockBin = writeMockAgentBrowser({
    mounted: true,
    renderStarted: true,
    errors: [],
    runtimeCalls: [{ op: 'callTool', args: { name: 'LOCAL_NOTIS_DATABASE_QUERY', arguments: { database_slug: 'items' } } }],
  });

  const result = runCli(['apps', 'verify', projectDir, '--skip-build', '--json'], {
    PATH: `${mockBin}:${process.env.PATH}`,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.status, 'passed');
  assert.equal(payload.data.summary.passed, 1);
  assert.equal(payload.data.results[0].route, 'home');
  assert.equal(payload.data.results[0].runtimeCalls[0].args.arguments.database_slug, 'items');
  assert.ok(readFileSync(payload.data.results[0].snapshot_path, 'utf-8').includes('Verify App'));
});

test('apps verify exits non-zero with structured failures', async () => {
  const projectDir = await buildAppProject();
  const mockBin = writeMockAgentBrowser({
    mounted: true,
    renderStarted: true,
    errors: [{ type: 'window.error', message: 'boom' }],
    runtimeCalls: [],
  });

  const result = runCli(['apps', 'verify', projectDir, '--skip-build', '--json'], {
    PATH: `${mockBin}:${process.env.PATH}`,
  });

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.data.status, 'failed');
  assert.equal(payload.data.summary.failed, 1);
  assert.deepEqual(
    payload.data.results[0].assertions.map((assertion) => assertion.code),
    ['render_error'],
  );
});

test('apps verify rejects runtime database queries missing from the app declaration', async () => {
  const projectDir = await buildAppProject();
  const mockBin = writeMockAgentBrowser({
    mounted: true,
    renderStarted: true,
    errors: [],
    runtimeCalls: [
      {
        op: 'callTool',
        args: {
          name: 'LOCAL_NOTIS_DATABASE_QUERY',
          arguments: { database_slug: 'undeclared-items' },
        },
      },
    ],
  });

  const result = runCli(['apps', 'verify', projectDir, '--skip-build', '--json'], {
    PATH: `${mockBin}:${process.env.PATH}`,
  });

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(
    payload.data.results[0].assertions.map((assertion) => assertion.code),
    ['undeclared_database_query'],
  );
});

test('apps verify permits read-only cross-app queries when workspace database access is declared', async () => {
  const projectDir = await buildAppProject({ workspaceDatabases: true });
  const mockBin = writeMockAgentBrowser({
    mounted: true,
    renderStarted: true,
    errors: [],
    runtimeCalls: [
      {
        op: 'callTool',
        args: {
          name: 'LOCAL_NOTIS_DATABASE_QUERY',
          arguments: { database_slug: 'undeclared-items' },
        },
      },
    ],
  });

  const result = runCli(['apps', 'verify', projectDir, '--skip-build', '--json'], {
    PATH: `${mockBin}:${process.env.PATH}`,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(
    payload.data.results[0].assertions.map((assertion) => assertion.code),
    [],
  );
});

test('apps verify reports Store listing gaps as warnings instead of failing', async () => {
  const projectDir = await buildAppProject();
  const mockBin = writeMockAgentBrowser({
    mounted: true,
    renderStarted: true,
    errors: [],
    runtimeCalls: [],
  });

  const result = runCli(['apps', 'verify', projectDir, '--skip-build', '--json'], {
    PATH: `${mockBin}:${process.env.PATH}`,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.status, 'passed');
  assert.equal(payload.data.listing.ready, false);
  const readinessWarnings = payload.warnings.filter((warning) => warning.startsWith('Store readiness:'));
  assert.ok(readinessWarnings.some((warning) => warning.includes('tagline')));
  assert.ok(readinessWarnings.some((warning) => warning.includes('screenshot')));
});

test('apps verify --listing restores the Store listing gate', async () => {
  const projectDir = await buildAppProject();
  const mockBin = writeMockAgentBrowser({
    mounted: true,
    renderStarted: true,
    errors: [],
    runtimeCalls: [],
  });

  const result = runCli(['apps', 'verify', projectDir, '--skip-build', '--listing', '--json'], {
    PATH: `${mockBin}:${process.env.PATH}`,
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /Listing metadata has problems/);
});

test('apps verify --listing passes once the listing is complete', async () => {
  const projectDir = await buildAppProject({ listing: true });
  const mockBin = writeMockAgentBrowser({
    mounted: true,
    renderStarted: true,
    errors: [],
    runtimeCalls: [],
  });

  const result = runCli(['apps', 'verify', projectDir, '--skip-build', '--listing', '--json'], {
    PATH: `${mockBin}:${process.env.PATH}`,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.data.listing.ready, true);
  assert.deepEqual(payload.warnings.filter((warning) => warning.startsWith('Store readiness:')), []);
});

test('apps verify warns when a configured screenshot names an undefined scenario', async () => {
  const projectDir = await buildAppProject({ listing: true });
  writeFileSync(
    join(projectDir, 'metadata', 'screenshot-fixtures.json'),
    JSON.stringify({ tools: {}, scenarios: { populated: { actions: [] } } }),
  );
  const config = readFileSync(join(projectDir, 'notis.config.ts'), 'utf-8').replace(
    "{ path: 'metadata/screenshot-1.png', alt: 'Verify App home' }",
    "{ path: 'metadata/screenshot-1.png', alt: 'Verify App home', route: 'home', scenario: 'nonexistent' }",
  );
  writeFileSync(join(projectDir, 'notis.config.ts'), config);
  const mockBin = writeMockAgentBrowser({
    mounted: true,
    renderStarted: true,
    errors: [],
    runtimeCalls: [],
  });

  const result = runCli(['apps', 'verify', projectDir, '--skip-build', '--json'], {
    PATH: `${mockBin}:${process.env.PATH}`,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.ok(
    payload.warnings.some((warning) => warning.includes('names scenario "nonexistent"')),
    JSON.stringify(payload.warnings),
  );
});

function liveVerifyEnv(projectDir, mockBin) {
  writeFileSync(
    join(projectDir, '.notis', 'state.json'),
    JSON.stringify({ app_id: 'app-verify-fixture' }),
  );
  return {
    PATH: `${mockBin}:${process.env.PATH}`,
    NOTIS_JWT: 'test-jwt',
  };
}

test('apps verify --mode live fails a route whose runtime calls all failed', async () => {
  const projectDir = await buildAppProject();
  const harness = {
    mounted: true,
    renderStarted: true,
    errors: [],
    runtimeCalls: [
      {
        op: 'callTool',
        args: { name: 'LOCAL_NOTIS_DATABASE_QUERY', arguments: { database_slug: 'items' } },
        ok: false,
        error: 'Runtime request failed: status 403',
        durationMs: 12,
      },
    ],
  };
  const mockBin = writeMockAgentBrowser(harness);

  const live = runCli(
    ['apps', 'verify', projectDir, '--skip-build', '--mode', 'live', '--json'],
    liveVerifyEnv(projectDir, mockBin),
  );
  assert.notEqual(live.status, 0, live.stdout);
  const livePayload = JSON.parse(live.stdout);
  assert.deepEqual(
    livePayload.data.results[0].assertions.map((assertion) => assertion.code),
    ['all_runtime_calls_failed', 'failed_database_query'],
  );
  assert.match(livePayload.data.results[0].assertions[0].message, /status 403/);

  // The same failure is invisible in stub mode: stub responses cannot fail, so
  // the outcome fields are not asserted there.
  const stub = runCli(['apps', 'verify', projectDir, '--skip-build', '--json'], {
    PATH: `${mockBin}:${process.env.PATH}`,
  });
  assert.equal(stub.status, 0, stub.stderr || stub.stdout);
  assert.equal(JSON.parse(stub.stdout).data.results[0].assertions.length, 0);
});

test('apps verify --mode live passes when one runtime call succeeded', async () => {
  const projectDir = await buildAppProject();
  const mockBin = writeMockAgentBrowser({
    mounted: true,
    renderStarted: true,
    errors: [],
    runtimeCalls: [
      {
        op: 'callTool',
        args: { name: 'LOCAL_NOTIS_DATABASE_QUERY', arguments: { database_slug: 'items' } },
        ok: false,
        error: 'Runtime request failed: status 500',
        durationMs: 8,
      },
      {
        op: 'callTool',
        args: { name: 'LOCAL_NOTIS_DATABASE_QUERY', arguments: { database_slug: 'items' } },
        ok: true,
        error: null,
        durationMs: 21,
      },
    ],
  });

  const result = runCli(
    ['apps', 'verify', projectDir, '--skip-build', '--mode', 'live', '--json'],
    liveVerifyEnv(projectDir, mockBin),
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).data.results[0].assertions.length, 0);
});

test('apps verify --mode live passes a route that makes no runtime calls', async () => {
  const projectDir = await buildAppProject();
  const mockBin = writeMockAgentBrowser({
    mounted: true,
    renderStarted: true,
    errors: [],
    runtimeCalls: [],
  });

  const result = runCli(
    ['apps', 'verify', projectDir, '--skip-build', '--mode', 'live', '--json'],
    liveVerifyEnv(projectDir, mockBin),
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).data.results[0].assertions.length, 0);
});


test('apps verify fails a mounted route on runtime design findings and stamps the artifact', async () => {
  const projectDir = await buildAppProject();
  const mockBin = writeMockAgentBrowser(
    { mounted: true, renderStarted: true, errors: [], runtimeCalls: [] },
    { design: [
      { kind: 'nested_border_box', snippet: 'div.rounded-xl.border "Total"' },
      { kind: 'text_below_12px', snippet: 'p.text-[10px] "meta"', font_size: 10 },
    ] },
  );

  const result = runCli(['apps', 'verify', projectDir, '--skip-build', '--json'], {
    PATH: `${mockBin}:${process.env.PATH}`,
  });

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  const codes = payload.data.results[0].assertions.map((assertion) => assertion.code);
  assert.deepEqual(codes, ['design_rule_violation', 'design_rule_violation', 'design_rule_violation', 'design_rule_violation']);
  assert.match(payload.data.results[0].assertions[0].message, /bordered box sits inside another bordered box at desktop/);

  const stamp = JSON.parse(readFileSync(join(projectDir, '.notis', 'output', 'verify.json'), 'utf-8'));
  assert.equal(stamp.ok, false);
  assert.equal(stamp.artifact_hash, payload.data.artifact_hash);
  assert.equal(typeof stamp.artifact_hash, 'string');
});

test('apps verify writes a passing stamp whose hash matches the built artifact', async () => {
  const projectDir = await buildAppProject();
  const mockBin = writeMockAgentBrowser({ mounted: true, renderStarted: true, errors: [], runtimeCalls: [] });

  const result = runCli(['apps', 'verify', projectDir, '--skip-build', '--json'], {
    PATH: `${mockBin}:${process.env.PATH}`,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const stamp = JSON.parse(readFileSync(join(projectDir, '.notis', 'output', 'verify.json'), 'utf-8'));
  assert.equal(stamp.ok, true);
  assert.equal(stamp.artifact_hash, computeArtifactHash(projectDir));
  assert.equal(stamp.routes[0].status, 'passed');
});

test('apps verify --no-browser never writes a passing stamp', async () => {
  const projectDir = await buildAppProject();
  const result = runCli(['apps', 'verify', projectDir, '--skip-build', '--no-browser', '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const stamp = JSON.parse(readFileSync(join(projectDir, '.notis', 'output', 'verify.json'), 'utf-8'));
  assert.equal(stamp.ok, false);
});

test('test server has no mount, snapshot, link or watcher endpoints', async (t) => {
  const projectDir = await buildAppProject();
  const server = await startAppTestServer({ apps: [{ slug: 'verify-app', projectDir }], port: 0 });
  t.after(() => server.close());
  for (const path of ['/events', '/a/verify-app/events', '/a/verify-app/snapshot']) {
    assert.equal((await fetch(`http://127.0.0.1:${server.port}${path}`)).status, 404);
  }
  assert.equal((await fetch(`http://127.0.0.1:${server.port}/a/verify-app/link`, { method: 'POST' })).status, 405);
  assert.equal(server.updateApp, undefined);
  assert.equal(server.getWatcherOwnership, undefined);
});

test('release freezes verified source and artifacts and rejects stale builds', async (t) => {
  const projectDir = await buildAppProject();
  const release = prepareAppRelease(projectDir);
  t.after(() => release.close());
  const oldSource = readFileSync(join(release.projectDir, 'app/page.tsx'), 'utf8');
  const oldBundle = release.files['bundle/app.js'];
  writeFileSync(join(projectDir, 'app/page.tsx'), 'export default function Changed() { return null; }');
  writeFileSync(join(projectDir, '.notis/output/bundle/app.js'), 'changed');
  assert.equal(readFileSync(join(release.projectDir, 'app/page.tsx'), 'utf8'), oldSource);
  assert.equal(release.files['bundle/app.js'], oldBundle);
  assert.throws(() => prepareAppRelease(projectDir), /stale/);
});

test('verification diagnostics are never included in a release', async (t) => {
  const projectDir = await buildAppProject();
  mkdirSync(join(projectDir, '.notis/output/.harness'), { recursive: true });
  writeFileSync(join(projectDir, '.notis/output/.harness/home.snapshot.txt'), 'private diagnostics');
  writeFileSync(join(projectDir, '.notis/output/verify.json'), JSON.stringify({ ok: true, private: 'diagnostics' }));
  const release = prepareAppRelease(projectDir);
  t.after(() => release.close());
  assert.equal(Object.keys(release.files).some((path) => path.startsWith('.harness/')), false);
  assert.equal(release.files['verify.json'], undefined);
});

function runCliAsync(args, env = {}, onChild = () => {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd: cliRoot,
      env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'notis-cli-release-home-')),
        NODE_ENV: 'test', NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    onChild(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolvePromise({ status, stdout, stderr }));
  });
}

for (const outcome of ['success', 'socket-reset', 'partial-response', 'verification-failure', 'design-violation-with-forged-stamp', 'design-eval-error', 'design-malformed', 'design-viewport-error', 'stale-build', 'missing-browser', 'interrupted', 'interrupted-before-upload', 'browser-close-failure', 'interrupted-close-failure', 'repeated-sigterm', 'sigterm-then-sigint', 'sigint-then-sigterm']) {
  test(`deploy frozen snapshot: ${outcome}`, async (t) => {
    const signalSequence = {
      'repeated-sigterm': 'SIGTERM,SIGTERM',
      'sigterm-then-sigint': 'SIGTERM,SIGINT',
      'sigint-then-sigterm': 'SIGINT,SIGTERM',
    }[outcome];
    const interruptedCloseFailure = outcome === 'interrupted-close-failure' || Boolean(signalSequence);
    const beforeUploadInterrupted = outcome === 'interrupted-before-upload' || interruptedCloseFailure;
    const projectDir = await buildAppProject();
    writeFileSync(join(projectDir, '.notis', 'state.json'), JSON.stringify({
      app_id: 'app-release', version: 7, expected_updated_at: 'base-revision',
    }));
    const sourceBefore = readFileSync(join(projectDir, 'app', 'page.tsx'), 'utf8');
    const mockBin = writeMockAgentBrowser({ mounted: true, renderStarted: true,
      errors: outcome === 'verification-failure' ? [{message:'render failed'}] : [], runtimeCalls: [],
    }, { design: outcome === 'design-violation-with-forged-stamp' ? [{ kind: 'nested_border_box', snippet: 'div.border' }] : [] });
    if (outcome === 'design-violation-with-forged-stamp') {
      writeFileSync(join(projectDir, '.notis/output/verify.json'), JSON.stringify({ ok: true, artifact_hash: computeArtifactHash(projectDir) }));
    }
    if (outcome === 'stale-build') writeFileSync(join(projectDir, 'app', 'page.tsx'), 'changed after build');
    const requests = [];
    let deployChild;
    const server = createServer(async (req,res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (outcome === 'interrupted') { deployChild.kill('SIGTERM'); return; }
      if (outcome === 'socket-reset') { res.socket.destroy(); return; }
      if (outcome === 'partial-response') {
        res.writeHead(200, {'content-type':'application/json','content-length':'120'});
        res.write('{"version":8'); res.socket.destroy(); return;
      }
      res.writeHead(200, {'content-type':'application/json'});
      res.end(JSON.stringify({ app_id:'app-release',version:8,updated_at:'committed-revision' }));
    });
    await new Promise(resolvePromise => server.listen(0,'127.0.0.1',resolvePromise));
    t.after(() => new Promise(resolvePromise => server.close(resolvePromise)));
    const apiBase = `http://127.0.0.1:${server.address().port}`;
    const jwt = ['e30', Buffer.from(JSON.stringify({sub:'release-user',exp:9999999999})).toString('base64url'),'signature'].join('.');
    const result = await runCliAsync(['--json','--api-base',apiBase,'apps','deploy',projectDir,'--skip-build'], {
      NOTIS_TEST_DESIGN_EVAL_ERROR: outcome === 'design-eval-error' ? '1' : '',
      NOTIS_TEST_DESIGN_MALFORMED: outcome === 'design-malformed' ? '1' : '',
      NOTIS_TEST_DESIGN_VIEWPORT_ERROR: outcome === 'design-viewport-error' ? '1' : '',
      NOTIS_ALLOW_UNVERIFIED_DEPLOY: outcome === 'design-violation-with-forged-stamp' ? '1' : '',
      NOTIS_TEST_FAIL_CLOSE: outcome === 'browser-close-failure' || interruptedCloseFailure ? '1' : '',
      NOTIS_TEST_CLOSE_LOG: join(projectDir, '.notis', 'close-attempts.log'),
      NOTIS_TEST_SIGNAL_SEQUENCE: signalSequence || '',
      NOTIS_JWT:jwt, NOTIS_TEST_INTERRUPT_DURING_CLOSE: beforeUploadInterrupted ? '1' : '', PATH:outcome === 'missing-browser' ? '/usr/bin:/bin' : `${mockBin}:${process.env.PATH}`,
    }, child => { deployChild = child; });
    assert.deepEqual(readdirSync(join(projectDir,'.notis')).filter(name => name.startsWith('release-')), []);
    if (outcome === 'success') {
      assert.equal(result.status,0,result.stdout + result.stderr);
      assert.equal(requests.length,1);
      const body=requests[0].arguments;
      assert.equal(body.base_version,7);
      assert.equal(body.expected_updated_at,'base-revision');
      assert.equal(body.app_id,'app-release');
      assert.equal(Buffer.from(body.source_files['app/page.tsx'],'base64').toString(),sourceBefore);
      assert.equal(Object.keys(body.files).some(path => path.includes('.harness')),false);
      const linked=readLinkedState(projectDir,appLinkedStateProfileKey({apiBase,userId:'release-user'}));
      assert.equal(linked.version,8);
      assert.equal(linked.expected_updated_at,'committed-revision');
    } else {
      assert.notEqual(result.status,0,result.stdout);
      assert.equal(requests.length, beforeUploadInterrupted || ['stale-build','verification-failure','design-violation-with-forged-stamp','design-eval-error','design-malformed','design-viewport-error','missing-browser','browser-close-failure'].includes(outcome) ? 0 : 1);
      assert.equal(readLinkedState(projectDir).version,7);
      if (['design-eval-error','design-malformed','design-viewport-error'].includes(outcome)) {
        assert.equal(JSON.parse(result.stdout).error.code, 'usage_error');
        const diagnostic = runCli(['apps', 'verify', projectDir, '--skip-build', '--json'], {
          PATH: `${mockBin}:${process.env.PATH}`,
          NOTIS_TEST_DESIGN_EVAL_ERROR: outcome === 'design-eval-error' ? '1' : '',
          NOTIS_TEST_DESIGN_MALFORMED: outcome === 'design-malformed' ? '1' : '',
          NOTIS_TEST_DESIGN_VIEWPORT_ERROR: outcome === 'design-viewport-error' ? '1' : '',
        });
        assert.notEqual(diagnostic.status, 0);
        assert.ok(JSON.parse(diagnostic.stdout).data.results.some(route => route.assertions.some(assertion => assertion.code === 'design_check_error')));
      }
      if (outcome === 'browser-close-failure') {
        assert.equal(readFileSync(join(projectDir, '.notis', 'close-attempts.log'), 'utf8'), 'close\nclose\n');
        assert.equal(JSON.parse(result.stdout).ok, false);
        assert.match(result.stdout + result.stderr, /cleanup failed/);
      }
      if (beforeUploadInterrupted) {
        assert.equal(result.status, signalSequence?.startsWith('SIGINT') ? 130 : 143, result.stdout + result.stderr);
        assert.equal(JSON.parse(result.stdout).error.details.activation_outcome, 'not_started');
        if (interruptedCloseFailure) {
          assert.equal(JSON.parse(result.stdout).error.code, 'app_deploy_cancelled');
          assert.equal(JSON.parse(result.stdout).error.details.cleanup_errors.length, 1);
          assert.equal(readFileSync(join(projectDir, '.notis', 'close-attempts.log'), 'utf8'), 'close\nclose\n');
        }
      }
      if (requests.length) {
        const error = JSON.parse(result.stdout).error;
        assert.equal(error.retryable, false);
        assert.equal(error.details.app_id, 'app-release');
      }
    }
  });
}

test('removed DEV and direct deployment commands are unavailable', () => {
  for (const args of [['apps','dev'],['apps','roots','list'],['apps','deploy','--direct']]) {
    const result=runCli([...args,'--json']);
    assert.notEqual(result.status,0);
  }
});


test('a build refreshes stale embedded SDK before freezing source provenance', async (t) => {
  const projectDir = createAppProject();
  mkdirSync(join(projectDir, 'packages/sdk/src'), { recursive: true });
  writeFileSync(join(projectDir, 'packages/sdk/package.json'), JSON.stringify({ name: '@notis/sdk', version: '0.0.0' }));
  writeFileSync(join(projectDir, 'packages/sdk/src/index.ts'), 'export const stale = true;');
  await buildArtifact(projectDir, { stdio: 'pipe' });
  const release = prepareAppRelease(projectDir);
  t.after(() => release.close());
  assert.deepEqual(Buffer.from(release.sourceFiles['packages/sdk/src/index.ts'], 'base64'),
    readFileSync(join(cliRoot, 'template/packages/sdk/src/index.ts')));
});
