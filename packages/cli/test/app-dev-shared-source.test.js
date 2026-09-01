import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  startAppDevServer,
  terminateBuildProcessTree,
} from '../src/runtime/app-dev-server.js';
import { findSharedSourceBundleUrls } from '../src/command-specs/apps.js';
import { readAppDevSessions, upsertAppDevSessions } from '../src/runtime/app-dev-sessions.js';
import {
  appLinkedStateProfileKey,
  readLinkedState,
  writeLinkedState,
} from '../src/runtime/app-platform.js';

async function availablePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition.');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

test('watcher cleanup terminates the npm wrapper and its descendants', {
  skip: process.platform === 'win32',
}, async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'notis-app-watch-tree-'));
  const grandchildPidFile = join(tempDir, 'grandchild.pid');
  const parentScript = `
    const { spawn } = require('node:child_process');
    const { writeFileSync } = require('node:fs');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    writeFileSync(process.argv[1], String(child.pid));
    setInterval(() => {}, 1000);
  `;
  const parent = spawn(process.execPath, ['-e', parentScript, grandchildPidFile], {
    detached: true,
    stdio: 'ignore',
  });
  t.after(() => {
    try {
      process.kill(-parent.pid, 'SIGKILL');
    } catch {
      // The process group was already cleaned up.
    }
  });
  await waitFor(() => existsSync(grandchildPidFile));
  const grandchildPid = Number.parseInt(readFileSync(grandchildPidFile, 'utf8'), 10);
  assert.equal(processIsRunning(parent.pid), true);
  assert.equal(processIsRunning(grandchildPid), true);

  await terminateBuildProcessTree(parent, { graceMs: 500 });
  await waitFor(() => !processIsRunning(parent.pid) && !processIsRunning(grandchildPid));
});

test('an exited watcher is not signalled again during later server shutdown', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-app-exited-watch-'));
  mkdirSync(join(projectDir, 'app'), { recursive: true });
  writeFileSync(join(projectDir, 'app', 'page.tsx'), 'export default function Page() { return null; }\n');
  writeFileSync(join(projectDir, 'vite.config.ts'), 'export default {};\n');
  writeFileSync(join(projectDir, 'notis.config.ts'), `
import { defineNotisApp } from '@notis/sdk/config';

export default defineNotisApp({
  name: 'Exited Watch App',
  routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
});
`);
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
    name: 'exited-watch-app',
    private: true,
    scripts: { build: 'node -e "process.exit(0)" --' },
  }));

  const stoppedPids = [];
  const port = await availablePort();
  const server = await startAppDevServer({
    apps: [{ slug: 'exited-watch-dev', projectDir }],
    port,
    watch: true,
    terminateBuildProcess: async (child) => {
      stoppedPids.push(child.pid);
    },
    log: () => {},
    logError: () => {},
  });
  await waitFor(() => stoppedPids.length === 1, 10_000);
  await server.close();

  assert.equal(stoppedPids.length, 1);
});

test('only an explicitly Desktop-owned server exposes watcher ownership metadata', {
  skip: process.platform === 'win32',
}, async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-app-desktop-owner-'));
  mkdirSync(join(projectDir, 'app'), { recursive: true });
  writeFileSync(join(projectDir, 'app', 'page.tsx'), 'export default function Page() { return null; }\n');
  writeFileSync(join(projectDir, 'vite.config.ts'), 'export default {};\n');
  writeFileSync(join(projectDir, 'notis.config.ts'), `
import { defineNotisApp } from '@notis/sdk/config';

export default defineNotisApp({
  name: 'Desktop Owner App',
  routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
});
`);
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
    name: 'desktop-owner-app',
    private: true,
    scripts: { build: 'node -e "setInterval(() => {}, 1000)" --' },
  }));

  const port = await availablePort();
  const server = await startAppDevServer({
    apps: [{ slug: 'desktop-owner-dev', projectDir }],
    port,
    watch: true,
    desktopOwnerId: 'desktop-instance',
    desktopOwnerScope: '/desktop/scope',
    log: () => {},
    logError: () => {},
  });
  try {
    const ownership = server.getWatcherOwnership('desktop-owner-dev');
    assert.equal(ownership?.desktopOwnerId, 'desktop-instance');
    assert.equal(ownership?.desktopOwnerScope, '/desktop/scope');
    assert.equal(ownership?.watcherProjectDir, realpathSync(projectDir));
    assert.equal(ownership?.watcherProcessGroupPid > 0, true);
    assert.equal(typeof ownership?.watcherStartIdentity, 'string');
    assert.equal(ownership?.watcherCommandFingerprint, 'npm:run-build:watch:v1');
  } finally {
    await server.close();
  }
});

test('dev diagnostics persist host and watcher state as JSONL', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-app-diagnostics-'));
  const bundleDir = join(projectDir, '.notis', 'output', 'bundle');
  const diagnosticsFile = join(projectDir, '.context', 'app-dev-diagnostics.jsonl');
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(join(bundleDir, 'app.js'), 'export default function App() {}\n');
  writeFileSync(join(bundleDir, 'app.css'), ':host {}\n');
  const port = await availablePort();
  const server = await startAppDevServer({
    apps: [{ slug: 'diagnostic-dev', projectDir }],
    port,
    watch: false,
    diagnosticsFile,
    log: () => {},
  });
  await server.close();

  const records = readFileSync(diagnosticsFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map((record) => record.event), ['started', 'stopping', 'stopped']);
  assert.equal(records[0].host_pid, process.pid);
  assert.equal(records[0].apps[0].slug, 'diagnostic-dev');
  assert.equal(records[0].apps[0].watcher_group_rss_bytes, null);
  assert.equal(records[0].watcher_groups_rss_bytes, 0);
  assert.equal(typeof records[0].system_free_bytes, 'number');
});

test('one source host links independent authenticated environment mounts', async (t) => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-shared-source-'));
  const bundleDir = join(projectDir, '.notis', 'output', 'bundle');
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(join(bundleDir, 'app.js'), 'export default function App() {}\n');
  writeFileSync(join(bundleDir, 'app.css'), ':host {}\n');
  writeFileSync(join(projectDir, '.notis', 'output', 'manifest.json'), JSON.stringify({
    version: 1,
    app: { name: 'Shared Source' },
    routes: [{ path: '/', slug: 'home', name: 'Home', default: true }],
    databases: [],
    tools: [],
  }));

  const productionProfile = appLinkedStateProfileKey({
    apiBase: 'https://api.notis.ai',
    userId: 'user-1',
  });
  const betaProfile = appLinkedStateProfileKey({
    apiBase: 'https://api-beta.notis.ai',
    userId: 'user-1',
  });
  writeLinkedState(projectDir, { app_id: 'prod-installed' }, productionProfile);
  writeLinkedState(projectDir, { dev_app_id: 'beta-dev' }, betaProfile);

  const registryPath = join(projectDir, 'sessions.json');
  const port = await availablePort();
  const bundleBaseUrl = `http://127.0.0.1:${port}/a/shared-dev`;
  const now = new Date().toISOString();
  upsertAppDevSessions([
    {
      sessionId: 'source-session',
      hostPid: process.pid,
      sourceHost: true,
      bundleReady: true,
      userId: 'user-1',
      apiBase: 'https://api.notis.ai',
      profileKey: productionProfile,
      appId: 'prod-dev',
      targetAppId: 'prod-installed',
      mountNonce: 'prod-nonce',
      devSlug: 'shared-dev',
      bundleBaseUrl,
      projectDir,
      lastHeartbeatAt: now,
    },
    {
      sessionId: 'beta-mount',
      hostPid: process.pid,
      sourceHost: false,
      bundleReady: true,
      userId: 'user-1',
      apiBase: 'https://api-beta.notis.ai',
      profileKey: betaProfile,
      appId: 'beta-dev',
      mountNonce: 'beta-nonce',
      devSlug: 'shared-dev',
      bundleBaseUrl,
      projectDir,
      lastHeartbeatAt: now,
    },
  ], registryPath);

  const server = await startAppDevServer({
    apps: [{
      slug: 'shared-dev',
      projectDir,
      appId: 'prod-dev',
      targetAppId: 'prod-installed',
      profileKey: productionProfile,
      sessionId: 'source-session',
      mountNonce: 'prod-nonce',
    }],
    port,
    watch: false,
    sessionsFilePath: registryPath,
    log: () => {},
  });
  t.after(() => server.close());
  await server.waitForBundle('shared-dev');

  const hostEventsController = new AbortController();
  const hostEventsResponse = await fetch(`http://127.0.0.1:${port}/events`, {
    signal: hostEventsController.signal,
  });
  assert.match(hostEventsResponse.headers.get('content-type') || '', /^text\/event-stream/);
  const hostEventsReader = hostEventsResponse.body.getReader();
  const firstHostEventChunk = await hostEventsReader.read();
  assert.match(new TextDecoder().decode(firstHostEventChunk.value), /: connected/);
  hostEventsController.abort();

  const response = await fetch(`${bundleBaseUrl}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: 'beta-dev',
      version: 2,
      session_id: 'beta-mount',
      mount_nonce: 'beta-nonce',
    }),
  });
  assert.equal(response.status, 200, await response.text());
  assert.equal(readLinkedState(projectDir, productionProfile).app_id, 'prod-installed');
  assert.equal(readLinkedState(projectDir, betaProfile).app_id, 'beta-dev');
  assert.equal(readLinkedState(projectDir, betaProfile).dev_app_id, undefined);
  const sessions = readAppDevSessions(registryPath).sessions;
  assert.equal(sessions.find((session) => session.sessionId === 'source-session').targetAppId, 'prod-installed');
  assert.equal(sessions.find((session) => session.sessionId === 'beta-mount').targetAppId, 'beta-dev');
});

test('a source host can build before registration and receive its mount identity later', async (t) => {
  const projectDir = mkdtempSync(join(tmpdir(), 'notis-shared-source-incremental-'));
  const bundleDir = join(projectDir, '.notis', 'output', 'bundle');
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(join(bundleDir, 'app.js'), 'export default function App() {}\n');
  writeFileSync(join(bundleDir, 'app.css'), ':host {}\n');

  const port = await availablePort();
  const server = await startAppDevServer({
    apps: [{
      slug: 'incremental-dev',
      projectDir,
      appId: null,
      targetAppId: null,
      sessionId: 'incremental-session',
      mountNonce: 'incremental-nonce',
    }],
    port,
    watch: false,
    log: () => {},
  });
  t.after(() => server.close());

  assert.equal(server.isBundleReady('incremental-dev'), true);
  server.updateApp('incremental-dev', {
    appId: 'incremental-app',
    targetAppId: 'installed-app',
  });
  const health = await fetch(`http://127.0.0.1:${port}/healthz`).then((response) => response.json());
  assert.equal(health.sessions[0].appId, 'incremental-app');
  assert.equal(health.sessions[0].targetAppId, 'installed-app');
});

test('a shared consumer reuses the complete canonical source set when discovery contains duplicates', () => {
  const registryPath = join(mkdtempSync(join(tmpdir(), 'notis-shared-canonical-')), 'sessions.json');
  const discoveredProjects = ['/default/skill-graph', '/explicit/skill-graph', '/default/notes'];
  const canonicalProjects = ['/explicit/skill-graph', '/default/notes'];
  const now = new Date().toISOString();
  upsertAppDevSessions(canonicalProjects.map((projectDir, index) => ({
    sessionId: 'canonical-source',
    hostPid: process.pid,
    sourceHost: true,
    bundleReady: true,
    discoveredProjects,
    canonicalProjects,
    userId: 'source-user',
    apiBase: 'http://localhost:3001',
    profileKey: 'source-profile',
    appId: `dev-app-${index}`,
    mountNonce: `nonce-${index}`,
    devSlug: index === 0 ? 'skill-graph-dev' : 'notes-dev',
    bundleBaseUrl: `http://127.0.0.1:5173/a/app-${index}`,
    projectDir,
    lastHeartbeatAt: now,
  })), registryPath);

  assert.deepEqual(
    [...findSharedSourceBundleUrls(discoveredProjects, registryPath).keys()],
    canonicalProjects,
  );
});

test('a shared consumer waits until every canonical source has published', () => {
  const registryPath = join(mkdtempSync(join(tmpdir(), 'notis-shared-canonical-pending-')), 'sessions.json');
  const discoveredProjects = ['/default/skill-graph', '/explicit/skill-graph', '/default/notes'];
  const canonicalProjects = ['/explicit/skill-graph', '/default/notes'];
  upsertAppDevSessions({
    sessionId: 'canonical-source-pending',
    hostPid: process.pid,
    sourceHost: true,
    bundleReady: true,
    discoveredProjects,
    canonicalProjects,
    userId: 'source-user',
    apiBase: 'http://localhost:3001',
    profileKey: 'source-profile',
    appId: 'dev-app-0',
    mountNonce: 'nonce-0',
    devSlug: 'skill-graph-dev',
    bundleBaseUrl: 'http://127.0.0.1:5173/a/app-0',
    projectDir: canonicalProjects[0],
    lastHeartbeatAt: new Date().toISOString(),
  }, registryPath);

  assert.equal(findSharedSourceBundleUrls(discoveredProjects, registryPath), null);
});
