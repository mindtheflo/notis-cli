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

function createAppProject() {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-app-verify-'));
  mkdirSync(join(projectDir, 'app'), { recursive: true });
  writeFileSync(join(projectDir, 'app', 'page.tsx'), 'export default function Page() { return null; }\n');
  writeFileSync(join(projectDir, 'vite.config.ts'), 'export default {};\n');
  writeFileSync(join(projectDir, 'notis.config.ts'), `
import { defineNotisApp } from '@notis/sdk/config';

export default defineNotisApp({
  name: 'Verify App',
  description: 'A fixture app for verifying the generated harness.',
  tagline: 'Verify a production-ready app.',
  categories: ['Productivity'],
  screenshots: [
    { path: 'metadata/screenshot-1.png', alt: 'Verify App home' },
    { path: 'metadata/screenshot-2.png', alt: 'Verify App detail' },
    { path: 'metadata/screenshot-3.png', alt: 'Verify App final state' },
  ],
  databases: ['items'],
  routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
  tools: ['LOCAL_NOTIS_DATABASE_QUERY'],
});
`);
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

async function buildAppProject() {
  const projectDir = createAppProject();
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
