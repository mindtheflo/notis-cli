import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { buildArtifact } from '../src/runtime/app-platform.js';
import { startAppDevServer } from '../src/runtime/app-dev-server.js';
import { HIDE_HARNESS_STATUS_SCRIPT } from '../src/runtime/agent-browser.js';
import { getAvailablePort } from '../src/runtime/ports.js';

const cliRoot = resolve(import.meta.dirname, '..');
const binPath = join(cliRoot, 'bin', 'notis.js');

// Verify only needs a buildable app with routes. Listing metadata (tagline,
// categories, screenshots, changelog) is a publish concern, so it is opt-in
// here and exercised by the --listing tests.
function createAppProject({ listing = false } = {}) {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-app-verify-'));
  mkdirSync(join(projectDir, 'app'), { recursive: true });
  writeFileSync(join(projectDir, 'app', 'page.tsx'), 'export default function Page() { return null; }\n');
  writeFileSync(join(projectDir, 'vite.config.ts'), 'export default {};\n');
  writeFileSync(join(projectDir, 'notis.config.ts'), `
import { defineNotisApp } from '@notis/sdk/config';

export default defineNotisApp({
  name: 'Verify App',
  description: 'A fixture app for verifying the generated harness.',
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

function writeMockAgentBrowser(harness) {
  const binDir = mkdtempSync(join(tmpdir(), 'notis-agent-browser-'));
  const scriptPath = join(binDir, 'agent-browser');
  writeFileSync(scriptPath, `#!/usr/bin/env node
const harness = ${JSON.stringify(harness)};
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
  process.stdout.write(JSON.stringify({
    success: true,
    data: { result: JSON.stringify(harness) },
    error: null,
  }));
  process.exit(0);
}
if (command === 'snapshot') {
  process.stdout.write('Page: Verify App\\n');
  process.exit(0);
}
if (command === 'open' || command === 'close') {
  process.exit(0);
}
process.stderr.write('unexpected command: ' + args.join(' ') + '\\n');
process.exit(1);
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

test('apps verify serves a generated harness route from the dev server', async (t) => {
  const projectDir = await buildAppProject();
  const port = await getAvailablePort();
  const server = await startAppDevServer({
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
  const server = await startAppDevServer({
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
  const server = await startAppDevServer({
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
