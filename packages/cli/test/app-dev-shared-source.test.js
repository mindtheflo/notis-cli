import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { startAppDevServer } from '../src/runtime/app-dev-server.js';
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
