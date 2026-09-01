/**
 * Dev server for `notis apps dev`.
 *
 * Hosts one or more app bundles on a single HTTP server bound to 127.0.0.1.
 * Each app lives at `/a/<slug>/...`:
 *   - `/a/<slug>/bundle/app.js`  — watched Vite output
 *   - `/a/<slug>/bundle/app.css` — watched Vite output
 *   - `/a/<slug>/events`         — SSE push on rebuild
 *
 * A `vite build --watch` is spawned per app so the monorepo case (one CLI
 * invocation at the repo root, many apps under `apps/*`) stays cheap to run.
 */

import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  watch as fsWatch,
} from 'node:fs';
import { freemem, loadavg, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  collectArtifactFiles,
  collectSourceFiles,
  exportNameFromPath,
  getBundleDir,
  loadAppConfig,
  prepareArtifactBuild,
  readManifest,
  readLinkedState,
  writeLinkedState,
} from './app-platform.js';
import {
  linkAppDevSessionTarget,
  readAppDevSessions,
} from './app-dev-sessions.js';

const CONTENT_TYPES = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};
const MAX_JSON_BODY_BYTES = 64 * 1024;
const RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(RUNTIME_DIR, '../..');
const REPO_ROOT = resolve(RUNTIME_DIR, '../../../..');
const HARNESS_TEMPLATE_PATH = join(CLI_ROOT, 'template', '.harness', 'index.html.tmpl');
const FALLBACK_REACT_VERSION = '19.0.0';
const BUILD_PROCESS_STOP_GRACE_MS = 1_000;
const DEV_DIAGNOSTIC_INTERVAL_MS = 30_000;
const DEV_DIAGNOSTIC_MAX_BYTES = 20 * 1024 * 1024;

function processGroupIsRunning(pid, signalProcess = process.kill) {
  try {
    signalProcess(-pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function readProcessGroupRssBytes(groupPids) {
  if (process.platform === 'win32' || groupPids.size === 0) return new Map();
  try {
    const output = execFileSync('ps', ['-axo', 'pgid=,rss='], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const rssByGroup = new Map();
    for (const line of output.split('\n')) {
      const [rawGroupPid, rawRssKiB] = line.trim().split(/\s+/, 2);
      const groupPid = Number.parseInt(rawGroupPid, 10);
      if (!groupPids.has(groupPid)) continue;
      const rssKiB = Number.parseInt(rawRssKiB, 10);
      if (!Number.isFinite(rssKiB)) continue;
      rssByGroup.set(groupPid, (rssByGroup.get(groupPid) || 0) + (rssKiB * 1024));
    }
    return rssByGroup;
  } catch {
    return new Map();
  }
}

/**
 * Stop the npm wrapper and every Vite/esbuild descendant it launched.
 *
 * Killing only the npm PID leaves its watch process alive after a Desktop host
 * restart. Each watcher therefore owns a separate POSIX process group. Windows
 * uses taskkill's tree mode for the equivalent cleanup.
 */
export async function terminateBuildProcessTree(child, {
  platform = process.platform,
  signalProcess = process.kill,
  spawnProcess = spawn,
  graceMs = BUILD_PROCESS_STOP_GRACE_MS,
} = {}) {
  const pid = child?.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) return;

  if (platform === 'win32') {
    await new Promise((resolvePromise) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolvePromise();
      };
      try {
        const killer = spawnProcess('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.once('error', () => {
          try {
            child.kill('SIGTERM');
          } catch {
            // The wrapper already exited.
          }
          finish();
        });
        killer.once('exit', finish);
        setTimeout(finish, graceMs).unref?.();
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          // The wrapper already exited.
        }
        finish();
      }
    });
    return;
  }

  try {
    signalProcess(-pid, 'SIGTERM');
  } catch (error) {
    if (error?.code === 'ESRCH') return;
    try {
      child.kill('SIGTERM');
    } catch {
      return;
    }
  }

  const deadline = Date.now() + graceMs;
  while (processGroupIsRunning(pid, signalProcess) && Date.now() < deadline) {
    await delay(25);
  }
  if (!processGroupIsRunning(pid, signalProcess)) return;
  try {
    signalProcess(-pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function extFor(pathname) {
  const idx = pathname.lastIndexOf('.');
  return idx === -1 ? '' : pathname.slice(idx);
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === 'notis-app:') return true;
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  const allowOrigin = origin && isAllowedOrigin(origin) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
    'Cache-Control': 'no-store',
  };
}

function safeJoin(baseDir, relPath) {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('..')) return null;
  return join(baseDir, normalized);
}

function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function timingMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function formatTimingMs(value) {
  return value.toFixed(value < 10 ? 2 : 1);
}

function readJsonFile(path) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function readRequestJson(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > MAX_JSON_BODY_BYTES) {
        rejectPromise(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(JSON.parse(body));
      } catch {
        rejectPromise(new Error('invalid JSON body'));
      }
    });
    req.on('error', rejectPromise);
  });
}

function reactVersionFromPeer(peerRange) {
  if (typeof peerRange !== 'string' || !peerRange) {
    return FALLBACK_REACT_VERSION;
  }
  const exact = peerRange.match(/\d+\.\d+\.\d+/);
  if (exact && !/[<>=~^*x]/i.test(peerRange.replace(exact[0], ''))) {
    return exact[0];
  }
  if (peerRange.includes('19') || peerRange.includes('18')) {
    return FALLBACK_REACT_VERSION;
  }
  return FALLBACK_REACT_VERSION;
}

function resolveHarnessReactVersion(projectDir) {
  const candidates = [
    join(projectDir, 'node_modules', '@notis', 'sdk', 'package.json'),
    join(REPO_ROOT, 'packages', 'sdk', 'package.json'),
    join(CLI_ROOT, 'template', 'packages', 'sdk', 'package.json'),
  ];
  for (const candidate of candidates) {
    const pkg = readJsonFile(candidate);
    const peer = pkg?.peerDependencies?.react;
    if (peer) {
      return reactVersionFromPeer(peer);
    }
  }
  return FALLBACK_REACT_VERSION;
}

function titleFromSlug(slug) {
  return String(slug || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeDatabaseDescriptors(databases) {
  return (Array.isArray(databases) ? databases : [])
    .map((entry) => {
      if (typeof entry === 'string') {
        return {
          slug: entry,
          title: titleFromSlug(entry),
          description: null,
          icon: null,
          properties: [],
        };
      }
      if (entry && typeof entry === 'object' && typeof entry.slug === 'string') {
        return {
          slug: entry.slug,
          title: entry.title || titleFromSlug(entry.slug),
          description: entry.description || null,
          icon: entry.icon || null,
          properties: Array.isArray(entry.properties) ? entry.properties : [],
        };
      }
      return null;
    })
    .filter(Boolean);
}

function normalizeToolDescriptors(tools) {
  return (Array.isArray(tools) ? tools : [])
    .map((entry) => {
      if (typeof entry === 'string') {
        return { name: entry };
      }
      if (entry && typeof entry === 'object' && typeof entry.name === 'string') {
        return entry;
      }
      return null;
    })
    .filter(Boolean);
}

function defaultRouteForManifest(manifest) {
  const routes = Array.isArray(manifest?.routes) ? manifest.routes : [];
  return routes.find((route) => route?.default) || routes[0] || null;
}

function findHarnessRoute(manifest, routeSlug) {
  const routes = Array.isArray(manifest?.routes) ? manifest.routes : [];
  if (!routeSlug) {
    return defaultRouteForManifest(manifest);
  }
  return routes.find((route) => route?.slug === routeSlug) || null;
}

function buildHarnessDescriptor({ state, manifest, appConfig, route, scenario = null }) {
  const databases = normalizeDatabaseDescriptors(
    Array.isArray(appConfig?.databases) && appConfig.databases.length
      ? appConfig.databases
      : manifest.databases,
  );
  const tools = normalizeToolDescriptors(
    Array.isArray(appConfig?.tools) && appConfig.tools.length
      ? appConfig.tools
      : manifest.tools,
  );

  return {
    app: {
      id: state.appId || 'harness-app',
      slug: state.slug,
      name: manifest.app?.name || appConfig?.name || state.slug,
      icon: manifest.app?.icon || appConfig?.icon || null,
      description: manifest.app?.description || appConfig?.description || null,
    },
    route: {
      slug: route.slug,
      path: route.path || '/',
      name: route.name || titleFromSlug(route.slug),
      icon: route.icon || null,
      parentSlug: route.parentSlug || null,
      default: Boolean(route.default),
      collection: route.collection || null,
    },
    databases,
    context: { collectionItem: null, screenshotScenario: scenario },
    tools,
  };
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * Resolve the fixture payload injected into one harness page load.
 *
 * A scenario may override individual `tools` / `requests` keys on top of the
 * file-level defaults, which is how one route renders both its populated and
 * its empty state. Each capture is its own page load, so a shallow per-key
 * merge is all the isolation a scenario needs.
 */
function harnessFixtures(projectDir, scenario) {
  const fixtureConfig = readJsonFile(join(projectDir, 'metadata', 'screenshot-fixtures.json')) || {};
  const scenarios = plainObject(fixtureConfig.scenarios);
  const selected = scenario ? plainObject(scenarios[scenario]) : null;
  return {
    tools: { ...plainObject(fixtureConfig.tools), ...plainObject(selected?.tools) },
    requests: { ...plainObject(fixtureConfig.requests), ...plainObject(selected?.requests) },
    scenario: selected && Object.keys(selected).length > 0 ? selected : null,
  };
}

function renderHarnessHtml({ state, manifest, appConfig, route, harnessOptions, scenario = null }) {
  const template = readFileSync(HARNESS_TEMPLATE_PATH, 'utf-8');
  const descriptor = buildHarnessDescriptor({ state, manifest, appConfig, route, scenario });
  const routeExport = route.export_name || route.exportName || exportNameFromPath(route.path || '/');
  const replacements = {
    '{{REACT_VERSION}}': resolveHarnessReactVersion(state.projectDir),
    '{{ROUTE_EXPORT}}': scriptJson(routeExport),
    '{{RUNTIME_DESCRIPTOR}}': scriptJson(descriptor),
    '{{MODE}}': scriptJson(harnessOptions.mode || 'stub'),
    '{{API_BASE}}': scriptJson(harnessOptions.apiBase || null),
    '{{JWT}}': scriptJson(harnessOptions.jwt || null),
    '{{FIXTURES}}': scriptJson(harnessFixtures(state.projectDir, scenario)),
  };
  let html = template;
  for (const [token, value] of Object.entries(replacements)) {
    html = html.replaceAll(token, value);
  }
  return html;
}

/**
 * Start the dev server for one or more apps.
 *
 * @param {{apps: Array<{slug: string, projectDir: string, appId?: string, targetAppId?: string, userId?: string, profileKey?: string, sessionId?: string, mountNonce?: string}>, port: number, watch?: boolean, sessionsFilePath?: string, harness?: { mode?: string, apiBase?: string, jwt?: string }, diagnosticsFile?: string | null, terminateBuildProcess?: typeof terminateBuildProcessTree, log?: (m: string) => void, logError?: (m: string) => void}} options
 */
export async function startAppDevServer({
  apps,
  port,
  watch = true,
  sessionsFilePath,
  harness = {},
  diagnosticsFile = process.env.NOTIS_DEV_DIAGNOSTICS_FILE || null,
  terminateBuildProcess = terminateBuildProcessTree,
  log = (msg) => process.stdout.write(`${msg}\n`),
  logError = (msg) => process.stderr.write(`${msg}\n`),
}) {
  if (!Array.isArray(apps) || apps.length === 0) {
    throw new Error('startAppDevServer requires at least one app.');
  }

  const appState = new Map();
  let diagnosticsTimer = null;
  let diagnosticWriteFailed = false;
  let serverClosing = false;
  // Sidebar reconciliation needs one stream for the shared host, not one
  // long-lived HTTP/1.1 connection per discovered app. Keeping a stream per
  // app exhausts Chromium's per-origin connection pool and can indefinitely
  // queue the active view's bundle fetch during hot reload.
  const hostSseClients = new Set();
  const createAppState = (app) => {
    let resolveBundleReady;
    const bundleReadyPromise = new Promise((resolvePromise) => {
      resolveBundleReady = resolvePromise;
    });
    return {
      slug: app.slug,
      projectDir: app.projectDir,
      appId: app.appId || null,
      targetAppId: app.targetAppId || null,
      userId: app.userId || null,
      profileKey: app.profileKey || null,
      sessionId: app.sessionId || null,
      mountNonce: app.mountNonce || null,
      canonicalBundleDir: getBundleDir(app.projectDir),
      bundleDir: null,
      jsPath: null,
      sseClients: new Set(),
      watcher: null,
      sourceWatchers: [],
      prepareTimer: null,
      reloadTimer: null,
      buildProcess: null,
      lastMtimeMs: 0,
      watchPollTimer: null,
      bundleReady: false,
      bundleReadyPromise,
      resolveBundleReady,
      buildProcessStopPromise: null,
    };
  };
  for (const app of apps) {
    appState.set(app.slug, createAppState(app));
  }

  function writeDevDiagnostic(event) {
    if (!diagnosticsFile) return;
    const memory = process.memoryUsage();
    const watcherPids = new Set(
      [...appState.values()]
        .map((state) => state.buildProcess?.pid)
        .filter((pid) => Number.isSafeInteger(pid) && pid > 0),
    );
    const watcherGroupRss = readProcessGroupRssBytes(watcherPids);
    const record = {
      at: new Date().toISOString(),
      event,
      host_pid: process.pid,
      parent_pid: process.ppid,
      rss_bytes: memory.rss,
      heap_used_bytes: memory.heapUsed,
      heap_total_bytes: memory.heapTotal,
      external_bytes: memory.external,
      system_free_bytes: freemem(),
      system_total_bytes: totalmem(),
      load_average_1m: loadavg()[0],
      watcher_groups_rss_bytes: [...watcherGroupRss.values()].reduce((total, rss) => total + rss, 0),
      apps: [...appState.values()].map((state) => ({
        slug: state.slug,
        project_dir: state.projectDir,
        watcher_pid: state.buildProcess?.pid || null,
        watcher_exit_code: state.buildProcess?.exitCode ?? null,
        watcher_signal: state.buildProcess?.signalCode ?? null,
        watcher_group_rss_bytes: watcherGroupRss.get(state.buildProcess?.pid) ?? null,
        bundle_ready: state.bundleReady,
      })),
    };
    try {
      mkdirSync(dirname(diagnosticsFile), { recursive: true, mode: 0o700 });
      if (existsSync(diagnosticsFile) && statSync(diagnosticsFile).size >= DEV_DIAGNOSTIC_MAX_BYTES) {
        const previous = `${diagnosticsFile}.previous`;
        rmSync(previous, { force: true });
        renameSync(diagnosticsFile, previous);
      }
      appendFileSync(diagnosticsFile, `${JSON.stringify(record)}\n`, { mode: 0o600 });
      diagnosticWriteFailed = false;
    } catch (error) {
      if (!diagnosticWriteFailed) {
        diagnosticWriteFailed = true;
        logError(`[notis apps dev] persistent diagnostics failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  function broadcastReload(slug) {
    const state = appState.get(slug);
    if (!state) return;
    const payload = `event: reload\ndata: ${Date.now()}\n\n`;
    for (const res of state.sseClients) {
      try {
        res.write(payload);
      } catch {
        state.sseClients.delete(res);
      }
    }
    const hostPayload = `event: reload\ndata: ${JSON.stringify({ slug, at: Date.now() })}\n\n`;
    for (const res of hostSseClients) {
      try {
        res.write(hostPayload);
      } catch {
        hostSseClients.delete(res);
      }
    }
  }

  function matchAppRoute(pathname) {
    // Matches `/a/<slug>/<rest>` — returns { slug, rest } or null.
    const match = pathname.match(/^\/a\/([^/]+)(?:\/(.*))?$/);
    if (!match) return null;
    return { slug: decodeURIComponent(match[1]), rest: match[2] || '' };
  }

  function resolveBundleDir(state) {
    if (existsSync(join(state.canonicalBundleDir, 'app.js'))) {
      return state.canonicalBundleDir;
    }
    return null;
  }

  function updateBundleDir(state, bundleDir) {
    if (!bundleDir || state.bundleDir === bundleDir) {
      return;
    }
    if (state.watcher) {
      try {
        state.watcher.close();
      } catch {
        // ignore
      }
      state.watcher = null;
    }
    state.bundleDir = bundleDir;
    state.jsPath = join(bundleDir, 'app.js');
    try {
      state.lastMtimeMs = statSync(state.jsPath).mtimeMs;
      if (!state.bundleReady) {
        state.bundleReady = true;
        state.resolveBundleReady();
      }
    } catch {
      state.lastMtimeMs = 0;
    }
  }

  async function serveHarness(req, res, url, state, headers) {
    let manifest;
    let appConfig;
    try {
      manifest = readManifest(state.projectDir);
      appConfig = await loadAppConfig(state.projectDir);
    } catch (error) {
      res.writeHead(500, {
        ...headers,
        'Content-Type': 'text/plain; charset=utf-8',
      });
      res.end(error instanceof Error ? error.message : String(error));
      return;
    }

    const routeSlug = url.searchParams.get('route') || '';
    const scenario = url.searchParams.get('scenario') || null;
    const route = findHarnessRoute(manifest, routeSlug);
    if (!route) {
      res.writeHead(404, {
        ...headers,
        'Content-Type': 'text/plain; charset=utf-8',
      });
      res.end(routeSlug ? `unknown route: ${routeSlug}` : 'no default route');
      return;
    }

    const html = renderHarnessHtml({
      state,
      manifest,
      appConfig,
      route,
      harnessOptions: harness,
      scenario,
    });
    res.writeHead(200, {
      ...headers,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(html)),
    });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(html);
    }
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const origin = req.headers.origin || '';
    const headers = corsHeaders(origin);
    if (origin && !isAllowedOrigin(origin)) {
      res.writeHead(403, headers);
      res.end('origin not allowed');
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers);
      res.end();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.method === 'POST') {
        const routed = matchAppRoute(url.pathname);
        const state = routed ? appState.get(routed.slug) : null;
        if (state && routed.rest === 'link') {
          void (async () => {
            try {
              const body = await readRequestJson(req);
              const appId = typeof body.app_id === 'string' ? body.app_id.trim() : '';
              const version = Number.isInteger(body.version) && body.version > 0
                ? body.version
                : null;
              if (!appId) {
                res.writeHead(400, {
                  ...headers,
                  'Content-Type': 'application/json; charset=utf-8',
                });
                res.end(JSON.stringify({ error: 'app_id is required' }));
                return;
              }
              if (version === null) {
                res.writeHead(400, {
                  ...headers,
                  'Content-Type': 'application/json; charset=utf-8',
                });
                res.end(JSON.stringify({ error: 'version must be a positive integer' }));
                return;
              }
              const proofSession = readAppDevSessions(sessionsFilePath).sessions.find((session) => (
                typeof body.session_id === 'string'
                && typeof body.mount_nonce === 'string'
                && session.sessionId === body.session_id
                && session.mountNonce === body.mount_nonce
                && session.devSlug === state.slug
                && session.projectDir === state.projectDir
              ));
              if (!proofSession) {
                res.writeHead(403, {
                  ...headers,
                  'Content-Type': 'application/json; charset=utf-8',
                });
                res.end(JSON.stringify({ error: 'invalid app development session proof' }));
                return;
              }
              const expectedAppId = proofSession.targetAppId || proofSession.appId;
              if (!expectedAppId || appId !== expectedAppId) {
                res.writeHead(409, {
                  ...headers,
                  'Content-Type': 'application/json; charset=utf-8',
                });
                res.end(JSON.stringify({ error: 'app_id does not match this development session' }));
                return;
              }

              const currentState = readLinkedState(
                state.projectDir,
                proofSession.profileKey || state.profileKey,
              ) || {};
              const now = new Date().toISOString();
              const promotedInPlace = proofSession.appId === appId;
              const nextState = {
                ...currentState,
                app_id: appId,
                linked_at: currentState.linked_at || now,
                version,
                deployed_at: now,
                updated_at: now,
              };
              if (promotedInPlace) {
                delete nextState.dev_app_id;
                delete nextState.dev_linked_at;
              } else {
                nextState.dev_app_id = proofSession.appId || currentState.dev_app_id;
                nextState.dev_linked_at = currentState.dev_linked_at || now;
              }
              writeLinkedState(
                state.projectDir,
                nextState,
                proofSession.profileKey || state.profileKey,
              );
              linkAppDevSessionTarget({
                sessionId: proofSession.sessionId,
                appId: proofSession.appId,
                devSlug: state.slug,
                targetAppId: appId,
                lastHeartbeatAt: now,
              }, sessionsFilePath);
              const response = {
                ok: true,
                app_id: appId,
                dev_app_id: promotedInPlace ? null : proofSession.appId || null,
                target_app_id: appId,
                version,
              };
              res.writeHead(200, {
                ...headers,
                'Content-Type': 'application/json; charset=utf-8',
              });
              res.end(JSON.stringify(response));
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              res.writeHead(400, {
                ...headers,
                'Content-Type': 'application/json; charset=utf-8',
              });
              res.end(JSON.stringify({ error: message }));
            }
          })();
          return;
        }
      }
      res.writeHead(405, headers);
      res.end('method not allowed');
      return;
    }

    if (url.pathname === '/healthz') {
      const now = new Date().toISOString();
      const sessions = Array.from(appState.values()).map((state) => ({
        appId: state.appId,
        targetAppId: state.targetAppId || undefined,
        userId: state.userId,
        devSlug: state.slug,
        bundleBaseUrl: `http://127.0.0.1:${port}/a/${state.slug}`,
        projectDir: state.projectDir,
        lastHeartbeatAt: now,
        status: 'connected',
      }));
      res.writeHead(200, {
        ...headers,
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify({ ok: true, apps: Array.from(appState.keys()), sessions }));
      return;
    }

    if (url.pathname === '/events') {
      res.writeHead(200, {
        ...headers,
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      hostSseClients.add(res);
      req.on('close', () => hostSseClients.delete(res));
      return;
    }

    const routed = matchAppRoute(url.pathname);
    if (!routed) {
      res.writeHead(404, headers);
      res.end('not found');
      return;
    }

    const state = appState.get(routed.slug);
    if (!state) {
      res.writeHead(404, headers);
      res.end(`unknown app: ${routed.slug}`);
      return;
    }

    if (routed.rest === 'events') {
      res.writeHead(200, {
        ...headers,
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      state.sseClients.add(res);
      req.on('close', () => state.sseClients.delete(res));
      return;
    }

    if (routed.rest === 'harness') {
      void serveHarness(req, res, url, state, headers);
      return;
    }

    if (routed.rest === 'snapshot') {
      try {
        updateBundleDir(state, resolveBundleDir(state));
        const manifest = readManifest(state.projectDir);
        const payload = {
          app_id: state.appId,
          target_app_id: state.targetAppId || null,
          dev_slug: state.slug,
          manifest,
          files: collectArtifactFiles(state.projectDir),
          source_files: collectSourceFiles(state.projectDir),
        };
        const body = JSON.stringify(payload);
        res.writeHead(200, {
          ...headers,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': String(Buffer.byteLength(body)),
        });
        if (req.method === 'HEAD') {
          res.end();
        } else {
          res.end(body);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(500, {
          ...headers,
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    if (routed.rest.startsWith('bundle/')) {
      const startedAt = process.hrtime.bigint();
      updateBundleDir(state, resolveBundleDir(state));
      const rel = routed.rest.slice('bundle/'.length);
      if (!state.bundleDir) {
        res.writeHead(404, headers);
        res.end('not found');
        log(`[notis apps timing] ${state.slug}: GET bundle/${rel} -> 404 in ${formatTimingMs(timingMs(startedAt))}ms`);
        return;
      }
      const full = safeJoin(state.bundleDir, rel);
      if (!full || !existsSync(full)) {
        res.writeHead(404, headers);
        res.end('not found');
        log(`[notis apps timing] ${state.slug}: GET bundle/${rel} -> 404 in ${formatTimingMs(timingMs(startedAt))}ms`);
        return;
      }
      const ext = extFor(rel);
      const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
      const content = readFileSync(full);
      res.writeHead(200, {
        ...headers,
        'Content-Type': contentType,
        'Content-Length': String(content.byteLength),
      });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(content);
      }
      log(
        `[notis apps timing] ${state.slug}: GET bundle/${rel} -> 200 ` +
        `${content.byteLength}B in ${formatTimingMs(timingMs(startedAt))}ms`,
      );
      return;
    }

    res.writeHead(404, headers);
    res.end('not found');
  });

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', rejectPromise);
      resolvePromise();
    });
  });

  function startBundleWatch(state) {
    if (state.watcher || !state.bundleDir) return;
    try {
      state.watcher = fsWatch(state.bundleDir, { persistent: false }, (_event, filename) => {
        if (!filename || filename !== 'app.js') return;
        // Vite may emit the filesystem notification while its output file is
        // still being replaced. Debounce the notification so consumers never
        // fetch the previous or partially-written bundle under the new build
        // revision.
        if (state.reloadTimer) clearTimeout(state.reloadTimer);
        state.reloadTimer = setTimeout(() => {
          state.reloadTimer = null;
          try {
            const stat = statSync(state.jsPath);
            if (stat.mtimeMs === state.lastMtimeMs) return;
            state.lastMtimeMs = stat.mtimeMs;
            log(`[notis apps dev] ${state.slug}: bundle updated — reloading portal`);
            broadcastReload(state.slug);
          } catch {
            // Bundle file may be missing mid-write; the next change retries.
          }
        }, 100);
      });
    } catch (error) {
      logError(`[notis apps dev] ${state.slug}: watch failed: ${error.message}`);
    }
  }

  function pollForBundleAndWatch(state) {
    const bundleDir = resolveBundleDir(state);
    if (bundleDir) {
      updateBundleDir(state, bundleDir);
      startBundleWatch(state);
      return;
    }
    state.watchPollTimer = setTimeout(() => pollForBundleAndWatch(state), 300);
  }

  function watchManifestInputs(state) {
    const schedulePrepare = () => {
      if (state.prepareTimer) clearTimeout(state.prepareTimer);
      state.prepareTimer = setTimeout(() => {
        state.prepareTimer = null;
        void prepareArtifactBuild(state.projectDir).then(() => {
          // Name, icon, and route metadata can change without changing the
          // compiled JS bytes. Notify consumers immediately; a generated-entry
          // change will produce the normal second reload after Vite rebuilds.
          broadcastReload(state.slug);
        }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          logError(`[notis apps dev] ${state.slug}: ${message}`);
        });
      }, 75);
    };
    try {
      state.sourceWatchers.push(fsWatch(
        state.projectDir,
        { persistent: false },
        (_event, filename) => {
          if (filename && /^notis\.config\.(?:ts|js|mjs)$/.test(String(filename))) {
            schedulePrepare();
          }
        },
      ));
    } catch (error) {
      logError(`[notis apps dev] ${state.slug}: config watch failed: ${error.message}`);
    }
    const appDir = join(state.projectDir, 'app');
    if (existsSync(appDir)) {
      try {
        state.sourceWatchers.push(fsWatch(
          appDir,
          { persistent: false, recursive: process.platform === 'darwin' || process.platform === 'win32' },
          schedulePrepare,
        ));
      } catch (error) {
        logError(`[notis apps dev] ${state.slug}: route watch failed: ${error.message}`);
      }
    }
  }

  for (const state of appState.values()) {
    if (watch) {
      await prepareArtifactBuild(state.projectDir);
      watchManifestInputs(state);
      pollForBundleAndWatch(state);

      const buildProcess = spawn('npm', ['run', 'build', '--', '--watch'], {
        cwd: state.projectDir,
        detached: process.platform !== 'win32',
        stdio: 'inherit',
        env: { ...process.env, NOTIS_DEV: '1' },
      });
      state.buildProcess = buildProcess;

      buildProcess.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          logError(`[notis apps dev] ${state.slug}: vite build --watch exited with code ${code}`);
        }
        if (!serverClosing) {
          if (state.buildProcess === buildProcess) state.buildProcess = null;
          const stopPromise = terminateBuildProcess(buildProcess).catch((error) => {
            logError(`[notis apps dev] ${state.slug}: watcher cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
          });
          state.buildProcessStopPromise = stopPromise;
          void stopPromise.finally(() => {
            if (state.buildProcessStopPromise === stopPromise) {
              state.buildProcessStopPromise = null;
            }
          });
        }
      });
    } else {
      updateBundleDir(state, resolveBundleDir(state));
    }

    log(`[notis apps dev] ${state.slug}: serving bundle at http://127.0.0.1:${port}/a/${state.slug}/bundle/app.js`);
  }

  writeDevDiagnostic('started');
  if (diagnosticsFile) {
    diagnosticsTimer = setInterval(() => writeDevDiagnostic('sample'), DEV_DIAGNOSTIC_INTERVAL_MS);
    diagnosticsTimer.unref?.();
  }

  return {
    port,
    updateApp(slug, updates = {}) {
      const state = appState.get(slug);
      if (!state) throw new Error(`unknown app: ${slug}`);
      for (const key of ['appId', 'targetAppId', 'userId', 'profileKey', 'sessionId', 'mountNonce']) {
        if (Object.prototype.hasOwnProperty.call(updates, key)) {
          state[key] = updates[key] || null;
        }
      }
    },
    isBundleReady(slug) {
      const state = appState.get(slug);
      if (!state) throw new Error(`unknown app: ${slug}`);
      return state.bundleReady;
    },
    waitForBundle(slug) {
      const state = appState.get(slug);
      if (!state) return Promise.reject(new Error(`unknown app: ${slug}`));
      return state.bundleReadyPromise;
    },
    async close() {
      serverClosing = true;
      if (diagnosticsTimer) {
        clearInterval(diagnosticsTimer);
        diagnosticsTimer = null;
      }
      writeDevDiagnostic('stopping');
      const buildProcessStops = [];
      for (const state of appState.values()) {
        if (state.prepareTimer) clearTimeout(state.prepareTimer);
        if (state.reloadTimer) clearTimeout(state.reloadTimer);
        for (const watcher of state.sourceWatchers) {
          try {
            watcher.close();
          } catch {
            // ignore
          }
        }
        state.sourceWatchers = [];
        if (state.watchPollTimer) clearTimeout(state.watchPollTimer);
        if (state.watcher) {
          try {
            state.watcher.close();
          } catch {
            // ignore
          }
        }
        for (const res of state.sseClients) {
          try {
            res.end();
          } catch {
            // ignore
          }
        }
        state.sseClients.clear();
        if (state.buildProcessStopPromise) {
          buildProcessStops.push(state.buildProcessStopPromise);
        }
        if (state.buildProcess) {
          const buildProcess = state.buildProcess;
          state.buildProcess = null;
          buildProcessStops.push(terminateBuildProcess(buildProcess));
        }
      }
      await Promise.allSettled(buildProcessStops);
      for (const res of hostSseClients) {
        try {
          res.end();
        } catch {
          // ignore
        }
      }
      hostSseClients.clear();
      await new Promise((resolvePromise) => server.close(() => resolvePromise()));
      writeDevDiagnostic('stopped');
    },
  };
}
