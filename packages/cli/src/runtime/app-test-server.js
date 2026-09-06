/** Temporary, explicit app verification/screenshot server. Never mounts a Workspace app. */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportNameFromPath, getBundleDir, loadAppConfig, readManifest } from './app-platform.js';

const CONTENT_TYPES = { '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json; charset=utf-8' };
const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = resolve(CLI_ROOT, '../..');
const HARNESS_TEMPLATE_PATH = join(CLI_ROOT, 'template', '.harness', 'index.html.tmpl');
const FALLBACK_REACT_VERSION = '19.0.0';

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
      resourceDeepLinks: route.resourceDeepLinks === true,
      collection: route.collection || null,
    },
    databases,
    context: { collectionItem: null, resourceId: null, screenshotScenario: scenario },
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


/** Serve only explicitly supplied built projects, without discovery or filesystem watchers. */
export async function startAppTestServer({ apps, port, harness = {} }) {
  if (!Array.isArray(apps) || !apps.length) throw new Error('At least one built app is required.');
  const states = new Map();
  for (const app of apps) {
    states.set(app.slug, {
      ...app,
      manifest: readManifest(app.projectDir),
      appConfig: await loadAppConfig(app.projectDir),
      bundleDir: getBundleDir(app.projectDir),
    });
  }
  const server = createServer((req, res) => {
    const headers = corsHeaders(req.headers.origin || '');
    const respond = (status, content, contentType = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { ...headers, 'Content-Type': contentType });
      res.end(req.method === 'HEAD' ? undefined : content);
    };
    try {
      if (req.headers.origin && !isAllowedOrigin(req.headers.origin)) return respond(403, 'origin not allowed');
      if (req.method === 'OPTIONS') return respond(204, '');
      if (!['GET', 'HEAD'].includes(req.method)) return respond(405, 'method not allowed');
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/healthz') return respond(200, JSON.stringify({ ok: true }), 'application/json');
      const match = url.pathname.match(/^\/a\/([^/]+)\/(.*)$/);
      const state = match && states.get(decodeURIComponent(match[1]));
      if (!state) return respond(404, 'not found');
      if (match[2] === 'harness') {
        const route = findHarnessRoute(state.manifest, url.searchParams.get('route') || '');
        if (!route) return respond(404, 'unknown route');
        return respond(200, renderHarnessHtml({ state, manifest: state.manifest, appConfig: state.appConfig, route, harnessOptions: harness, scenario: url.searchParams.get('scenario') }), 'text/html; charset=utf-8');
      }
      if (match[2].startsWith('bundle/')) {
        const relativePath = decodeURIComponent(match[2].slice('bundle/'.length));
        const file = safeJoin(state.bundleDir, relativePath);
        if (!file || !existsSync(file) || !statSync(file).isFile()) return respond(404, 'not found');
        return respond(200, readFileSync(file), CONTENT_TYPES[extFor(file)] || 'application/octet-stream');
      }
      return respond(404, 'not found');
    } catch (error) {
      return respond(500, error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); accept(); });
  });
  let closing;
  return {
    port: server.address().port,
    close() {
      closing ||= new Promise((accept) => {
        server.close(accept);
        server.closeAllConnections?.();
      });
      return closing;
    },
  };
}
