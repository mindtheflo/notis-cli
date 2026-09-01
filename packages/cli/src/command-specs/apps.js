/**
 * Notis apps CLI commands.
 *
 * Canonical Notis app workflow:
 *   init -> dev -> build -> deploy -> publish (after explicit approval)
 *
 * Supporting commands: list, link, doctor, pull.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { CliError, EXIT_CODES, usageError } from '../runtime/errors.js';
import { formatTable } from '../runtime/output.js';
import {
  defaultAppProjectDir,
  resolveProjectDir,
  loadAppConfig,
  detectProjectProblems,
  detectProjectWarnings,
  buildArtifact,
  appLinkedStateProfileKey,
  readManifest,
  readLinkedState,
  writeLinkedState,
  requireLinkedAppId,
  scaffoldProject,
  findUnknownScreenshotScenarios,
  inspectListingReadiness,
  resolveListingScreenshots,
  collectArtifactFiles,
  collectSourceFiles,
  resolveConfiguredAppSkills,
  normalizeAppCapabilities,
  normalizeAppToolBindings,
  normalizeAppSkillManifestPath,
  appRowFieldsFromManifest,
  directDeploy,
  pullAppSource,
} from '../runtime/app-platform.js';
import {
  filterScaffoldCatalog,
  loadScaffoldCatalog,
  scaffoldRegistryLabel,
} from '../runtime/app-registry-scaffolds.js';
import { startAppDevServer } from '../runtime/app-dev-server.js';
import { captureDesktopHostOwnership } from '../runtime/app-dev-process-identity.js';
import {
  discoverRegisteredAppProjects,
  readAppDevRoots,
  registerAppDevRoot,
  removeAppDevRoot,
} from '../runtime/app-dev-roots.js';
import {
  captureHarnessScreenshot,
  closeAgentBrowserSession,
  isAgentBrowserAvailable,
  runHarnessRoute,
} from '../runtime/agent-browser.js';
import {
  getAppDevSessionsFile,
  heartbeatAppDevSession,
  linkAppDevSessionTarget,
  readAppDevSessions,
  removeAppDevSession,
  upsertAppDevSessions,
} from '../runtime/app-dev-sessions.js';
import {
  releaseAppDevHostLock,
  tryAcquireAppDevHostLock,
} from '../runtime/app-dev-host-lock.js';
import {
  heartbeatAppDevConsumer,
  hasAppDevConsumer,
  readAppDevConsumers,
  removeAppDevConsumer,
} from '../runtime/app-dev-consumers.js';
import { getAvailablePort, getAvailablePortPreferring } from '../runtime/ports.js';
import { getCliMode } from '../runtime/cli-mode.js';
import { composeStoreScreenshot } from '../runtime/store-screenshot.js';
import { httpRequest } from '../runtime/transport.js';
import { ensureFreshOAuthCredential } from '../runtime/oauth.js';
import {
  localNotisToolSlug,
  nextIdempotencyKey,
  runToolCommand,
  toolConflictToError,
} from './helpers.js';

export { appRowFieldsFromManifest } from '../runtime/app-platform.js';

const DEFAULT_DEV_PORT = 5173;
const DEV_HEARTBEAT_INTERVAL_MS = 10_000;
const DEV_CONSUMER_HEARTBEAT_INTERVAL_MS = 3_000;
const DEV_CONSUMER_POLL_INTERVAL_MS = 5_000;
const SHARED_APP_DEV_HOST_KEY = '__registered_roots__';

function projectIsWithinRoot(projectDir, rootDir) {
  const nested = relative(rootDir, projectDir);
  return nested === '' || (nested !== '..' && !nested.startsWith(`..${sep}`) && !isAbsolute(nested));
}

function parseNotisAppVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
    String(value || '').trim(),
  );
  if (!match) return null;
  const prerelease = match[4] ? match[4].split('.') : [];
  if (prerelease.some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0'))) {
    return null;
  }
  return {
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease,
  };
}

function compareNumericSemverIdentifiers(left, right) {
  if (left.length !== right.length) return left.length > right.length ? 1 : -1;
  return left === right ? 0 : left > right ? 1 : -1;
}

function compareNotisPrerelease(left, right) {
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? 0 : left.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === rightIdentifier ? 0 : leftIdentifier === undefined ? -1 : 1;
    }
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return compareNumericSemverIdentifiers(leftIdentifier, rightIdentifier);
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier > rightIdentifier ? 1 : -1;
  }
  return 0;
}

export function compareNotisAppVersions(leftValue, rightValue) {
  const left = parseNotisAppVersion(leftValue);
  const right = parseNotisAppVersion(rightValue);
  if (!left || !right) return null;
  for (const key of ['major', 'minor', 'patch']) {
    const comparison = compareNumericSemverIdentifiers(left[key], right[key]);
    if (comparison !== 0) return comparison;
  }
  return compareNotisPrerelease(left.prerelease, right.prerelease);
}

function readLocalNotisAppVersion(projectDir) {
  try {
    const packageJson = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
    const version = String(packageJson.notisAppVersion || '').trim();
    return parseNotisAppVersion(version) ? version : null;
  } catch {
    return null;
  }
}

/**
 * A CLI launch may add one root, but the shared host always serves the complete
 * machine registry. Desktop sets skipRootRegistration because it is reconciling
 * an already-registered snapshot; this must never narrow discovery to the one
 * project path used to start the host.
 */
export function discoverAppDevLaunchProjects(rootDir, {
  skipRootRegistration = false,
  registerRoot = registerAppDevRoot,
  discoverProjects = discoverRegisteredAppProjects,
} = {}) {
  if (!skipRootRegistration) registerRoot(rootDir);
  return discoverProjects();
}

/**
 * Collapse duplicate local sources before they reach the shared loopback host.
 * An explicitly registered root is more intentional than the implicit
 * ~/.notis/apps root. If two equally intentional roots claim the same dev
 * slug, omit that slug and keep serving every unrelated app.
 */
export function selectCanonicalDevApps(candidates, rootsRegistry) {
  const roots = Array.isArray(rootsRegistry?.roots) ? rootsRegistry.roots : [];
  const groups = new Map();
  for (const candidate of candidates) {
    groups.set(candidate.devSlug, [...(groups.get(candidate.devSlug) || []), candidate]);
  }

  const selected = [];
  const warnings = [];
  for (const [devSlug, group] of groups) {
    if (group.length === 1) {
      selected.push(group[0]);
      continue;
    }
    const ranked = group.map((candidate) => {
      const explicitRoots = roots.filter((root) => (
        root?.implicit !== true
        && typeof root?.path === 'string'
        && projectIsWithinRoot(candidate.projectDir, root.path)
      ));
      const newestRegistration = explicitRoots.reduce((latest, root) => {
        const timestamp = Date.parse(root.registeredAt || '');
        return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
      }, 0);
      return {
        candidate,
        rank: explicitRoots.length > 0 ? 1 : 0,
        newestRegistration,
      };
    }).sort((left, right) => (
      right.rank - left.rank
      || right.newestRegistration - left.newestRegistration
    ));
    const winner = ranked[0];
    const runnerUp = ranked[1];
    const unambiguous = winner.rank > runnerUp.rank
      || winner.newestRegistration > runnerUp.newestRegistration;
    if (unambiguous) {
      selected.push(winner.candidate);
      warnings.push(
        `Using ${winner.candidate.projectDir} for development slug "${devSlug}"; ignored duplicate source(s): ${ranked.slice(1).map(({ candidate }) => candidate.projectDir).join(', ')}.`,
      );
      continue;
    }
    warnings.push(
      `Skipped ambiguous development slug "${devSlug}" because multiple equally ranked sources are registered: ${ranked.map(({ candidate }) => candidate.projectDir).join(', ')}. Remove a root or set a unique devSlug.`,
    );
  }
  return { selected, warnings };
}

export function findSharedSourceBundleUrls(projectDirs, sessionsFilePath) {
  const now = Date.now();
  const sourceSessions = readAppDevSessions(sessionsFilePath).sessions
    .filter((session) => {
      if (session.sourceHost !== true) return false;
      const heartbeatAt = Date.parse(session.lastHeartbeatAt || '');
      if (!Number.isFinite(heartbeatAt) || now - heartbeatAt > 45_000) return false;
      if (!Number.isInteger(session.hostPid) || session.hostPid <= 0) return false;
      try {
        process.kill(session.hostPid, 0);
        return true;
      } catch {
        return false;
      }
    });
  const groups = new Map();
  for (const session of sourceSessions) {
    const key = `${session.hostPid || 0}:${session.sessionId}`;
    groups.set(key, [...(groups.get(key) || []), session]);
  }
  for (const sessions of groups.values()) {
    const byProject = new Map(sessions.map((session) => [session.projectDir, session]));
    const canonicalProjects = sessions.find((session) => (
      Array.isArray(session.canonicalProjects)
    ))?.canonicalProjects;
    const discoveredProjects = sessions.find((session) => (
      Array.isArray(session.discoveredProjects)
    ))?.discoveredProjects;
    const discoveryMatches = discoveredProjects
      && JSON.stringify([...discoveredProjects].sort()) === JSON.stringify([...projectDirs].sort());
    if (
      discoveryMatches
      && canonicalProjects
      && canonicalProjects.every((projectDir) => byProject.has(projectDir))
    ) {
      return new Map(canonicalProjects.map((projectDir) => [
        projectDir,
        byProject.get(projectDir).bundleBaseUrl,
      ]));
    }
    if (!projectDirs.every((projectDir) => byProject.has(projectDir))) continue;
    return new Map(projectDirs.map((projectDir) => [
      projectDir,
      byProject.get(projectDir).bundleBaseUrl,
    ]));
  }
  return null;
}
const ENSURE_DEV_APP_INSTALLATION_TOOL = 'LOCAL_NOTIS_ENSURE_DEV_APP_INSTALLATION';
const GET_APP_TOOL = 'LOCAL_NOTIS_GET_APP';
const LIST_APPS_TOOL = 'LOCAL_NOTIS_LIST_APPS';
const CREATE_APP_TOOL = 'LOCAL_NOTIS_CREATE_APP';
const DUPLICATE_APP_TOOL = 'LOCAL_NOTIS_DUPLICATE_APP';
const SAVE_APP_FILES_TOOL = 'LOCAL_NOTIS_SAVE_APP_FILES';
export const APP_DEPLOY_TIMEOUT_MS = 600_000;

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function appsTable(apps) {
  return formatTable(apps, [
    { label: 'ID', value: (app) => app.app_id || app.id || '' },
    { label: 'Name', value: (app) => app.name || 'Untitled' },
    { label: 'Version', value: (app) => app.current_version || app.manifest?.version || 0 },
    { label: 'Status', value: (app) => app.status || '' },
  ]);
}

function scaffoldsTable(scaffolds) {
  return formatTable(scaffolds, [
    { label: 'Slug', value: (scaffold) => scaffold.slug || '' },
    { label: 'Name', value: (scaffold) => scaffold.name || scaffold.slug || '' },
    { label: 'Category', value: (scaffold) => (scaffold.categories || [])[0] || '' },
    { label: 'Tagline', value: (scaffold) => scaffold.tagline || scaffold.description || '' },
  ]);
}

function appDevRootsTable(roots) {
  return formatTable(roots, [
    { label: 'Folder', value: (root) => root.path },
    { label: 'Source', value: (root) => root.implicit ? 'default' : 'registered' },
    { label: 'Registered', value: (root) => root.registeredAt || '' },
  ]);
}

function decodeJwtSub(jwt) {
  if (!jwt) return null;
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return decoded.sub || decoded.email || null;
  } catch {
    return null;
  }
}

function linkedStateProfileKey(runtime) {
  return appLinkedStateProfileKey({
    apiBase: runtime?.apiBase,
    userId: decodeJwtSub(runtime?.jwt),
  });
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function buildDevInstallSlug(appConfig) {
  const base = slugify(appConfig?.devSlug || appConfig?.name);
  if (!base) {
    return '';
  }
  return base.endsWith('-dev') ? base : `${base}-dev`;
}

function timingMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function logAppsTiming(label, details = {}) {
  const suffix = Object.entries(details)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  process.stderr.write(`[notis apps timing] ${label}${suffix ? ` ${suffix}` : ''}\n`);
}

function nextDevInstallIdempotencyKey(globalOptions = {}, devSlug) {
  if (globalOptions.idempotencyKey) {
    return `${globalOptions.idempotencyKey}:${devSlug}`;
  }
  return nextIdempotencyKey(globalOptions);
}

function pickDefaultRouteSlug(manifest) {
  const routes = Array.isArray(manifest?.routes) ? manifest.routes : [];
  const explicit = routes.find((route) => route && route.default && typeof route.slug === 'string');
  if (explicit) return explicit.slug;
  const firstWithSlug = routes.find((route) => route && typeof route.slug === 'string' && route.slug);
  return firstWithSlug ? firstWithSlug.slug : null;
}

export function buildDevelopmentAppHref({
  appSlug,
  appId,
  devSlug,
  targetAppId = null,
  targetAppSlug = null,
  manifest,
}) {
  const routeAppId = `${targetAppId || appId}__local_dev__${devSlug}`;
  const routeAppSlug = targetAppSlug || devSlug || appSlug;
  const originlessBase = `/apps/${routeAppSlug}-${routeAppId}`;
  const routeSlug = pickDefaultRouteSlug(manifest);
  return routeSlug ? `${originlessBase}/${routeSlug}` : originlessBase;
}

function parsePort(value) {
  if (!value) return null;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw usageError('Port must be between 1 and 65535.');
  }
  return port;
}

function parsePositiveInt(value) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw usageError('Expected a positive integer.');
  }
  return parsed;
}

function parseRouteSlugs(value) {
  if (!value) return null;
  const slugs = String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (slugs.length === 0) {
    throw usageError('--routes must include at least one route slug.');
  }
  return slugs;
}

function routeSelection(manifest, rawRouteSlugs) {
  const routes = Array.isArray(manifest?.routes) ? manifest.routes : [];
  if (routes.length === 0) {
    throw usageError('Manifest has no routes to verify.');
  }
  if (!rawRouteSlugs) {
    return routes;
  }

  const bySlug = new Map(routes.map((route) => [route.slug, route]));
  const selected = [];
  const missing = [];
  for (const slug of rawRouteSlugs) {
    const route = bySlug.get(slug);
    if (route) {
      selected.push(route);
    } else {
      missing.push(slug);
    }
  }
  if (missing.length) {
    throw usageError(
      `Unknown route slug${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`,
      { available_routes: routes.map((route) => route.slug) },
    );
  }
  return selected;
}

export function pruneStaleScreenshotFiles(outputDir, keepCount) {
  for (const entry of readdirSync(outputDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = /^screenshot-(\d+)\.png$/i.exec(entry.name);
    if (match && Number.parseInt(match[1], 10) > keepCount) {
      rmSync(join(outputDir, entry.name), { force: true });
    }
  }
}

export function shouldPruneStaleScreenshotFiles(selectedRouteSlugs, failedCount) {
  return failedCount === 0 && !selectedRouteSlugs;
}

export function screenshotIndexByRouteSlug(manifest) {
  const routes = Array.isArray(manifest?.routes) ? manifest.routes : [];
  return new Map(routes.map((route, index) => [route.slug, index + 1]));
}

export function screenshotExitCode(failedCount) {
  return failedCount === 0 ? EXIT_CODES.ok : EXIT_CODES.unexpected;
}

function declaredDatabaseSlugs(appConfig, manifest, route) {
  const slugs = new Set();
  for (const entry of appConfig?.databases || manifest?.databases || []) {
    if (typeof entry === 'string' && entry) {
      slugs.add(entry);
    } else if (entry && typeof entry === 'object' && typeof entry.slug === 'string') {
      slugs.add(entry.slug);
    }
  }
  if (route?.collection?.database) {
    slugs.add(route.collection.database);
  }
  return Array.from(slugs);
}

function harnessErrorMessage(error) {
  if (!error || typeof error !== 'object') {
    return String(error);
  }
  return error.message || error.reason || error.type || JSON.stringify(error);
}

function runtimeCallLabel(call) {
  if (call?.op === 'callTool') {
    return call?.args?.name || 'callTool';
  }
  if (call?.op === 'request') {
    return `request ${call?.args?.path || ''}`.trim();
  }
  return call?.op || 'runtime call';
}

function assertHarnessResult(result, route, databaseSlugs, mode = 'stub') {
  const assertions = [];
  if (result.tool_error) {
    assertions.push({
      ok: false,
      code: 'tool_error',
      message: `agent-browser ${result.tool_error.phase || 'command'} failed`,
      details: result.tool_error,
    });
  }
  if (result.mounted !== true) {
    assertions.push({
      ok: false,
      code: 'not_mounted',
      message: 'Harness did not report mounted === true.',
    });
  }
  if (result.timed_out) {
    assertions.push({
      ok: false,
      code: 'timeout',
      message: 'Timed out waiting for window.__harness.mounted.',
    });
  }
  for (const error of result.errors || []) {
    assertions.push({
      ok: false,
      code: 'render_error',
      message: harnessErrorMessage(error),
      details: error,
    });
  }
  const runtimeCalls = result.runtimeCalls || [];
  const declaredDatabaseSet = new Set(databaseSlugs);
  const databaseQueries = runtimeCalls.filter(
    (call) =>
      call?.op === 'callTool'
      && localNotisToolSlug(call?.args?.name) === 'LOCAL_NOTIS_DATABASE_QUERY',
  );
  for (const call of databaseQueries) {
    const databaseSlug = call?.args?.arguments?.database_slug;
    if (databaseSlug && !declaredDatabaseSet.has(databaseSlug)) {
      assertions.push({
        ok: false,
        code: 'undeclared_database_query',
        message: `Route "${route.slug}" queried undeclared database "${databaseSlug}".`,
        details: { databaseSlug },
      });
    }
  }
  const collectionDatabase = route?.collection?.database;
  if (
    collectionDatabase
    && !databaseQueries.some((call) => call?.args?.arguments?.database_slug === collectionDatabase)
  ) {
    assertions.push({
      ok: false,
      code: 'missing_collection_database_query',
      message: `Collection route "${route.slug}" did not query "${collectionDatabase}".`,
      details: { databaseSlug: collectionDatabase },
    });
  }
  if (mode === 'live') {
    // In live mode an app that catches every failed call and renders its error
    // state still mounts cleanly, so the render assertions above all pass. Only
    // the recorded outcomes reveal that nothing real came back.
    if (runtimeCalls.length > 0 && runtimeCalls.every((call) => call?.ok === false)) {
      assertions.push({
        ok: false,
        code: 'all_runtime_calls_failed',
        message: `Route "${route.slug}" rendered without data: all ${runtimeCalls.length} runtime call(s) failed. First error: ${runtimeCalls[0]?.error || 'unknown'}.`,
        details: {
          failed: runtimeCalls.map((call) => ({ call: runtimeCallLabel(call), error: call?.error || null })),
        },
      });
    }
    for (const databaseSlug of databaseSlugs) {
      const queries = databaseQueries.filter(
        (call) => call?.args?.arguments?.database_slug === databaseSlug,
      );
      // A call still in flight when the harness was read has ok === null; only
      // an explicit failure with no successful sibling is a real problem.
      if (queries.some((call) => call?.ok === false) && !queries.some((call) => call?.ok === true)) {
        assertions.push({
          ok: false,
          code: 'failed_database_query',
          message: `Route "${route.slug}" never got a successful "${databaseSlug}" query. Last error: ${queries[queries.length - 1]?.error || 'unknown'}.`,
          details: { databaseSlug },
        });
      }
    }
  }
  return assertions;
}

function renderVerifyReport({ summary, results, noBrowser }) {
  const lines = [
    noBrowser
      ? `Harness URLs ready for ${summary.total} route${summary.total === 1 ? '' : 's'}.`
      : `Verified ${summary.total} route${summary.total === 1 ? '' : 's'}: ${summary.passed} passed, ${summary.failed} failed.`,
  ];
  for (const result of results) {
    const marker = result.ok ? 'PASS' : result.status === 'manual' ? 'URL' : 'FAIL';
    lines.push(`${marker.padEnd(4)} ${result.route.padEnd(18)} ${result.url}`);
    for (const assertion of result.assertions || []) {
      lines.push(`     - ${assertion.message}`);
      for (const failure of assertion.details?.failed || []) {
        lines.push(`       ${failure.call}: ${failure.error || 'unknown error'}`);
      }
    }
  }
  if (noBrowser) {
    lines.push('', 'Pass --keep-open to leave the harness process running while you inspect the URLs.');
  }
  return lines.join('\n');
}

function buildManifestForDev(appConfig, projectDir) {
  const routes = Array.isArray(appConfig.routes) ? appConfig.routes : [];
  return {
    version: 1,
    spec_version: 3,
    app: {
      name: appConfig.name,
      description: appConfig.description || null,
      icon: appConfig.icon || null,
      release_version: readLocalNotisAppVersion(projectDir),
    },
    routes: routes.map((route) => ({
      path: route.path,
      slug: route.slug,
      name: route.name,
      icon: route.icon || null,
      parentSlug: route.parentSlug || null,
      default: route.default || false,
      resourceDeepLinks: route.resourceDeepLinks === true,
      export_name: route.exportName || route.export_name,
      collection: route.collection || null,
    })),
    bundle: {
      js: 'bundle/app.js',
      css: 'bundle/app.css',
    },
    databases: appConfig.databases || [],
    capabilities: normalizeAppCapabilities(appConfig.capabilities),
    tools: appConfig.tools || [],
    tool_bindings: normalizeAppToolBindings(appConfig.toolBindings),
    skills: (appConfig.skills || []).map((skill) => ({
      key: skill.key,
      path: normalizeAppSkillManifestPath(skill.path),
      name: skill.name,
      description: skill.description || null,
    })),
    onboarding: appConfig.onboarding || null,
  };
}

export function buildEnsureDevInstallArguments({
  appConfig,
  manifest,
  linkedState,
  skills,
  useInstalledDatabases = false,
  approvedCapabilities = null,
}) {
  const devSlug = buildDevInstallSlug(appConfig);
  const arguments_ = {
    dev_slug: devSlug,
    name: appConfig.name,
    manifest,
    skills,
  };
  if (linkedState?.dev_app_id) {
    arguments_.app_id = linkedState.dev_app_id;
  }
  if (useInstalledDatabases && linkedState?.app_id) {
    arguments_.installed_app_id = linkedState.app_id;
  }
  // Sent on every ensure call, including as `false`, so a `--scratch` session
  // puts the app on its own dev copies and the next plain session puts it back
  // on the installed app's databases.
  arguments_.use_installed_databases = Boolean(useInstalledDatabases);
  if (Array.isArray(approvedCapabilities) && approvedCapabilities.length > 0) {
    arguments_.approved_capabilities = approvedCapabilities;
  }
  return arguments_;
}

const CLOUD_SHELL_CONSENT_KEY = 'cloud_computer_shell_consent';

/**
 * Collect the developer's explicit approval for `cloudComputer: 'shell'`.
 *
 * The server never grants shell from authorship alone — holding an app's source
 * (a scaffold, a pulled repo) is not consent to full-authority commands on the
 * cloud computer — so `apps dev` asks once, records the answer in the linked
 * state, and passes the grant with the ensure call. Runs before the parallel
 * ensure fan-out so the prompt cannot interleave.
 */
export async function resolveCloudShellConsent({
  appConfig,
  projectDir,
  grantCloudShell = false,
  logger = console,
  profileKey = null,
}) {
  const capabilities = normalizeAppCapabilities(appConfig.capabilities);
  if (capabilities.cloudComputer !== 'shell') {
    return null;
  }
  const approved = ['cloud_computer_read', 'cloud_computer_shell'];
  const linkedState = readLinkedState(projectDir, profileKey) || {};
  const recordDecision = (decision) => {
    writeLinkedState(
      projectDir,
      { ...linkedState, [CLOUD_SHELL_CONSENT_KEY]: decision },
      profileKey,
    );
  };

  if (grantCloudShell) {
    recordDecision('granted');
    return approved;
  }
  const recorded = linkedState[CLOUD_SHELL_CONSENT_KEY];
  if (recorded === 'granted') {
    return approved;
  }
  const declineHint =
    `${appConfig.name}: cloud computer shell stays denied for this dev session. `
    + 'Re-run with --grant-cloud-shell to approve it.';
  if (recorded === 'declined') {
    logger.warn(declineHint);
    return null;
  }
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    logger.warn(declineHint);
    return null;
  }
  const { createInterface } = await import('node:readline/promises');
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await prompt.question(
      `${appConfig.name} declares cloudComputer: 'shell' - its views will run commands and `
      + 'read or write files on your cloud computer with the same authority as your own '
      + 'agent. Allow for this dev app? [y/N] ',
    )).trim().toLowerCase();
    const granted = answer === 'y' || answer === 'yes';
    recordDecision(granted ? 'granted' : 'declined');
    if (!granted) {
      logger.warn(declineHint);
    }
    return granted ? approved : null;
  } finally {
    prompt.close();
  }
}

export async function ensureDevInstall({
  ctx,
  appConfig,
  projectDir,
  idempotencyKey,
  useInstalledDatabases = false,
  approvedCapabilities = null,
  runTool = runToolCommand,
}) {
  if (!appConfig.name) {
    throw usageError(`notis.config.ts in ${projectDir} must define a non-empty name.`);
  }
  const devSlug = buildDevInstallSlug(appConfig);
  if (!devSlug) {
    throw usageError(`notis.config.ts devSlug or name in ${projectDir} must slugify to a non-empty value.`);
  }

  const manifest = buildManifestForDev(appConfig, projectDir);
  const skills = resolveConfiguredAppSkills(appConfig, projectDir);
  const profileKey = linkedStateProfileKey(ctx.runtime);
  let linkedState = readLinkedState(projectDir, profileKey);
  let linkedApp = null;
  if (linkedState?.dev_app_id) {
    const devApp = await getAccessibleApp(ctx.runtime, linkedState.dev_app_id, runTool);
    if (!devApp || devApp.manifest?.is_dev !== true) {
      const { dev_app_id: _devAppId, dev_linked_at: _devLinkedAt, ...rest } = linkedState;
      linkedState = rest;
      writeLinkedState(projectDir, linkedState, profileKey);
    }
  }
  if (linkedState?.app_id) {
    linkedApp = await getAccessibleApp(ctx.runtime, linkedState.app_id, runTool);
    if (linkedApp?.manifest?.is_dev === true) {
      const { app_id: legacyDevAppId, linked_at: _linkedAt, deployed_at: _deployedAt, version: _version, ...rest } = linkedState;
      const devAppId = linkedState.dev_app_id || legacyDevAppId;
      linkedState = {
        ...rest,
        ...(devAppId ? { dev_app_id: devAppId } : {}),
        ...(devAppId ? {
          dev_linked_at: linkedState.dev_linked_at || linkedState.linked_at || new Date().toISOString(),
        } : {}),
      };
      writeLinkedState(projectDir, linkedState, profileKey);
      linkedApp = null;
    }
  }
  // A checkout can be shared by Beta and a source-workspace desktop. Its
  // installed app link is valid for the Beta account but intentionally
  // inaccessible to the worktree's test user. Preserve that durable link for
  // Beta, while omitting it from this run so the local dev app uses its own
  // resources instead of sending an unauthorized installed_app_id to ensure.
  if (!linkedState?.app_id) {
    const installedResolution = await findInstalledLinkCandidatesForLegacyDevState(
      ctx.runtime,
      devSlug,
      linkedState?.dev_app_id,
      projectDir,
      profileKey,
      runTool,
    );
    const installedCandidates = installedResolution.candidates;
    if (installedCandidates.length > 1) {
      if (installedResolution.source === 'persisted-project-link') {
        throw usageError(
          `Multiple accessible installed apps are persisted for ${projectDir}. `
          + `Run \`notis apps link <app-id> ${projectDir}\` to choose one for this environment.`,
        );
      }
      throw usageError(
        `Multiple accessible installed apps use the exact slug "${devSlug.slice(0, -4)}". `
        + `Run \`notis apps link <app-id> ${projectDir}\` to choose one.`,
      );
    }
    if (installedCandidates.length === 1) {
      const now = new Date().toISOString();
      linkedApp = installedCandidates[0];
      linkedState = {
        ...(linkedState || {}),
        app_id: linkedApp.app_id || linkedApp.id,
        linked_at: now,
        auto_linked_at: now,
      };
      writeLinkedState(projectDir, linkedState, profileKey);
    }
  }
  const runtimeLinkedState = linkedState?.app_id && !linkedApp
    ? Object.fromEntries(
        Object.entries(linkedState).filter(([key]) => ![
          'app_id', 'linked_at', 'deployed_at', 'version',
        ].includes(key)),
      )
    : linkedState;
  const localReleaseVersion = manifest.app.release_version || null;
  const installedReleaseVersion = linkedApp?.manifest?.app?.release_version || '0.0.0';
  const mountEligible = !linkedApp
    || compareNotisAppVersions(localReleaseVersion, installedReleaseVersion) === 1;
  const ensureArguments = buildEnsureDevInstallArguments({
    appConfig,
    manifest,
    linkedState: runtimeLinkedState,
    skills,
    useInstalledDatabases,
    approvedCapabilities,
  });
  let ensureResult;
  try {
    ensureResult = await runTool({
      runtime: ctx.runtime,
      toolName: ENSURE_DEV_APP_INSTALLATION_TOOL,
      arguments_: ensureArguments,
      mutating: true,
      idempotencyKey,
    });
  } catch (error) {
    const backendCode = error?.details?.error?.code;
    if (linkedState?.dev_app_id && backendCode === 'dev_app_slug_conflict') {
      // The authenticated environment can outlive an older local API profile.
      // If that profile remembered a different dev row while this user already
      // owns the exact canonical dev slug, the backend refuses a duplicate.
      // Retry without the stale row id so the backend deterministically adopts
      // the unique slug owner; preserve the installed target and every grant.
      const staleDevAppId = linkedState.dev_app_id;
      const { dev_app_id: _devAppId, dev_linked_at: _devLinkedAt, ...rest } = linkedState;
      linkedState = rest;
      writeLinkedState(projectDir, linkedState, profileKey);
      const retryArguments = { ...ensureArguments };
      delete retryArguments.app_id;
      ensureResult = await runTool({
        runtime: ctx.runtime,
        toolName: ENSURE_DEV_APP_INSTALLATION_TOOL,
        arguments_: retryArguments,
        mutating: true,
        idempotencyKey: `${idempotencyKey}:adopt-slug-owner:${staleDevAppId}`,
      });
    } else {
      throw error;
    }
  }
  const appId = ensureResult.payload.app_id;
  if (!appId) {
    throw usageError('Dev installation tool did not return an app_id.');
  }
  if (linkedState?.dev_app_id !== appId) {
    const now = new Date().toISOString();
    writeLinkedState(projectDir, {
      ...(linkedState || {}),
      dev_app_id: appId,
      dev_linked_at: linkedState?.dev_linked_at || now,
    }, profileKey);
  }
  return {
    slug: ensureResult.payload.slug || devSlug,
    devSlug,
    name: appConfig.name,
    appId,
    projectDir,
    manifest,
    created: ensureResult.payload.created || false,
    linkedAppId: runtimeLinkedState?.app_id || null,
    targetAppId: runtimeLinkedState?.app_id || null,
    targetAppSlug: linkedApp?.slug || null,
    localReleaseVersion,
    installedReleaseVersion: linkedApp ? installedReleaseVersion : null,
    mountEligible,
    databaseMaterialization: ensureResult.payload.database_materialization || { created: [], unresolved: [] },
    liveData: ensureResult.payload.live_data || null,
  };
}

function databaseMaterializationWarnings(apps) {
  const warnings = [];
  for (const app of apps) {
    const unresolved = app.databaseMaterialization?.unresolved || [];
    if (!unresolved.length) {
      continue;
    }
    warnings.push(
      `${app.name}: database slug${unresolved.length === 1 ? '' : 's'} ${unresolved.join(', ')} ` +
      'could not be created because no store snapshot schema exists. Create them manually or link to a store-installed app.',
    );
  }
  return warnings;
}

function liveDataWarnings(apps) {
  return apps
    .filter((app) => app.liveData?.warning)
    .map((app) => `${app.name}: ${app.liveData.warning}`);
}

function versionPrecedenceWarnings(apps) {
  return apps
    .filter((app) => app.targetAppId && app.mountEligible === false)
    .map((app) => {
      const localVersion = app.localReleaseVersion || 'missing or invalid';
      const pullCommand = `npx --package @notis_ai/cli@latest -- notis apps pull ${app.targetAppId} ${JSON.stringify(app.projectDir)} --force`;
      return `${app.name}: local version ${localVersion} is not strictly newer than installed version ${app.installedReleaseVersion}; Workspace keeps serving the online bundle. Preserve any local edits, pull latest with \`${pullCommand}\`, then bump package.json notisAppVersion before development.`;
    });
}

async function getAccessibleApp(runtime, appId, runTool = runToolCommand) {
  const result = await runTool({
    runtime,
    toolName: GET_APP_TOOL,
    arguments_: { app_id: appId, include_documents: false },
  });
  if (result.payload?.app) {
    return {
      ...result.payload.app,
      apps_access: result.payload.apps_access,
    };
  }
  const message = typeof result.payload?.message === 'string' ? result.payload.message : '';
  const errorCode = result.payload?.code || result.payload?.error?.code;
  if (
    result.payload?.status === 'error'
    && (errorCode === 'app_not_found' || /^App not found\.?$/i.test(message.trim()))
  ) {
    return null;
  }
  throw usageError(`Could not verify access to app ${appId}${message ? `: ${message}` : '.'}`);
}

async function findInstalledLinkCandidatesForLegacyDevState(
  runtime,
  devSlug,
  devAppId,
  projectDir,
  profileKey,
  runTool = runToolCommand,
) {
  const installedSlug = devSlug.endsWith('-dev') ? devSlug.slice(0, -4) : '';
  if (!installedSlug) return { candidates: [], source: null };

  const result = await runTool({
    runtime,
    toolName: LIST_APPS_TOOL,
  });
  const accessibleInstalledApps = (result.payload?.apps || []).filter((app) => (
    (app?.app_id || app?.id)
    && (app.app_id || app.id) !== devAppId
    && app?.manifest?.is_dev !== true
  ));

  // A project-local app id is stronger evidence than a slug. Older CLI runs
  // could persist that explicit link under another API/user profile before
  // the machine-local discovery host mounted the same source here. Migrate it
  // only when exactly one such id is accessible in the current environment;
  // multiple accessible ids remain ambiguous and fail closed below.
  const rawState = readLinkedState(projectDir) || {};
  const persistedAppIds = new Set();
  if (rawState.app_id) persistedAppIds.add(rawState.app_id);
  const profiles = rawState.profiles && typeof rawState.profiles === 'object'
    ? rawState.profiles
    : {};
  for (const [storedProfileKey, state] of Object.entries(profiles)) {
    if (storedProfileKey === profileKey || !state || typeof state !== 'object') continue;
    if (state.app_id) persistedAppIds.add(state.app_id);
  }
  const persistedCandidates = accessibleInstalledApps.filter((app) => (
    persistedAppIds.has(app.app_id || app.id)
  ));
  if (persistedCandidates.length) {
    return { candidates: persistedCandidates, source: 'persisted-project-link' };
  }

  // The database row slug can change when a Store app is installed or an old
  // development app is promoted. The shipped source manifest keeps the
  // canonical app slug, so accept either exact field. Display names are never
  // considered.
  const exactSlugCandidates = accessibleInstalledApps.filter((app) => {
    const canonicalSlugs = new Set([
      app?.slug,
      app?.manifest?.app?.slug,
    ].map(slugify).filter(Boolean));
    return canonicalSlugs.has(installedSlug);
  });
  return { candidates: exactSlugCandidates, source: 'exact-slug' };
}

export async function assertDirectDeployAccess(runtime, appId, runTool = runToolCommand) {
  const app = await getAccessibleApp(runtime, appId, runTool);
  if (!app) {
    throw usageError(`Direct deploy requires access to app ${appId}.`);
  }
  if (app.apps_access?.has_access !== true) {
    throw usageError('Notis Apps require a PRO+ or ULTRA plan after your trial.');
  }
  if (app.can_edit !== true) {
    throw usageError(`Direct deploy requires edit access to app ${appId}.`);
  }
  if (app.manifest?.is_dev === true) {
    throw usageError(
      'A development app cannot be deployed directly. Retry without --direct so first deploy can promote it safely.',
    );
  }
  return app;
}

export async function assertLinkTarget(runtime, appId, runTool = runToolCommand) {
  const app = await getAccessibleApp(runtime, appId, runTool);
  if (!app) {
    throw usageError(`Cannot link to inaccessible app ${appId}.`);
  }
  if (app.manifest?.is_dev === true) {
    throw usageError(
      `Cannot link to development runtime app ${appId}. ` +
      'Link to an installed workspace app, or run `notis apps dev` without a target.',
    );
  }
  return app;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function appsListHandler(ctx) {
  const result = await runToolCommand({
    runtime: ctx.runtime,
    toolName: LIST_APPS_TOOL,
  });
  const apps = result.payload.apps || [];
  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: { apps },
    humanSummary: apps.length ? `Found ${apps.length} apps` : 'No apps found.',
    renderHuman: () => (apps.length ? appsTable(apps) : 'No apps found.'),
  });
}

async function appsInitHandler(ctx) {
  const projectDir = ctx.args.dir
    ? resolveProjectDir(ctx.args.dir)
    : defaultAppProjectDir(slugify(ctx.args.name));
  const fromSlug = ctx.options.from || null;

  await scaffoldProject({ projectDir, appName: ctx.args.name, fromSlug });

  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: { project_dir: projectDir, app_name: ctx.args.name, scaffold: fromSlug },
    humanSummary: fromSlug
      ? `Scaffolded "${ctx.args.name}" from ${fromSlug} in ${projectDir}`
      : `Scaffolded "${ctx.args.name}" in ${projectDir}`,
    hints: [
      { command: `cd ${projectDir} && npm install`, reason: 'Install dependencies' },
      { command: `cd ${projectDir} && notis apps dev`, reason: 'Start the real-portal dev workflow' },
    ],
  });
}

async function appsScaffoldsListHandler(ctx) {
  const searchTerm = ctx.options.search || null;
  const catalog = await loadScaffoldCatalog();
  const scaffolds = filterScaffoldCatalog(catalog, searchTerm);
  const registry = scaffoldRegistryLabel();
  const emptyMessage = searchTerm
    ? `No published scaffolds match "${searchTerm}" (${catalog.length} available; run without --search to see all).`
    : `No published scaffolds found in ${registry}.`;
  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: { scaffolds, registry, search: searchTerm },
    humanSummary: scaffolds.length
      ? `Found ${scaffolds.length} published scaffolds in ${registry}`
      : emptyMessage,
    renderHuman: () => (scaffolds.length ? scaffoldsTable(scaffolds) : emptyMessage),
  });
}

async function appsCreateHandler(ctx) {
  const projectDir = ctx.args.dir ? resolveProjectDir(ctx.args.dir) : null;
  const appConfig = projectDir ? await loadAppConfig(projectDir) : null;
  const idempotencyKey = nextIdempotencyKey(ctx.globalOptions);
  const result = await runToolCommand({
    runtime: ctx.runtime,
    toolName: CREATE_APP_TOOL,
    arguments_: {
      name: ctx.args.name,
      description: appConfig?.description || undefined,
      icon: appConfig?.icon || undefined,
      accent: appConfig?.accent ?? undefined,
    },
    mutating: true,
    idempotencyKey,
  });

  const app = result.payload.app || result.payload;
  if (!app?.id) {
    throw usageError('Create app did not return an app id.');
  }

  if (projectDir) {
    writeLinkedState(projectDir, {
      app_id: app.id,
      linked_at: new Date().toISOString(),
    }, linkedStateProfileKey(ctx.runtime));
  }

  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: {
      app,
      project_dir: projectDir,
      linked: Boolean(projectDir),
      idempotency_key: idempotencyKey,
    },
    humanSummary: projectDir
      ? `Created app ${app.name || ctx.args.name} (${app.id}) and linked ${projectDir}`
      : `Created app ${app.name || ctx.args.name} (${app.id})`,
    hints: projectDir
      ? [{ command: `cd ${projectDir} && notis apps deploy .`, reason: 'Deploy the linked project' }]
      : [{ command: `notis apps link ${app.id} .`, reason: 'Link a local project before deploying' }],
    meta: { mutating: true, idempotency_key: idempotencyKey },
  });
}

async function appsDevHandler(ctx) {
  const rootDir = resolveProjectDir(ctx.args.dir || '.');
  const skipRootRegistration = process.env.NOTIS_APPS_DEV_ALL_REGISTERED_ROOTS === '1';
  let appDirs = discoverAppDevLaunchProjects(rootDir, { skipRootRegistration });
  const discoveredAppDirs = [...appDirs];
  const sessionsFilePath = getAppDevSessionsFile();
  let sharedBundleBaseUrls = null;
  const sharedBundlesRaw = process.env.NOTIS_APPS_DEV_SHARED_BUNDLE_URLS;
  if (sharedBundlesRaw) {
    let parsed;
    try {
      parsed = JSON.parse(sharedBundlesRaw);
    } catch {
      throw usageError('The shared app development bundle map is invalid.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw usageError('The shared app development bundle map must be an object.');
    }
    const sharedProjectDirs = Object.keys(parsed);
    const discoveredProjects = new Set(appDirs);
    for (const projectDir of sharedProjectDirs) {
      if (!discoveredProjects.has(projectDir)) {
        throw usageError(`The shared bundle map references an unregistered app: ${projectDir}.`);
      }
    }
    appDirs = sharedProjectDirs;
    sharedBundleBaseUrls = new Map();
    for (const projectDir of appDirs) {
      const value = parsed[projectDir];
      let url;
      try {
        url = new URL(String(value || ''));
      } catch {
        throw usageError(`The shared bundle URL is missing or invalid for ${projectDir}.`);
      }
      if (
        url.protocol !== 'http:'
        || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      ) {
        throw usageError(`The shared bundle URL must use loopback HTTP for ${projectDir}.`);
      }
      sharedBundleBaseUrls.set(projectDir, url.toString().replace(/\/$/, ''));
    }
  }

  if (appDirs.length === 0) {
    return ctx.output.emitSuccess({
      command: ctx.spec.command_path.join(' '),
      data: {
        registered_root: skipRootRegistration ? null : rootDir,
        apps: [],
        watching_on_desktop_launch: true,
      },
      humanSummary: [
        skipRootRegistration
          ? 'No registered Notis apps are present yet.'
          : `Registered app development root: ${rootDir}`,
        'No Notis apps are present yet. A running Notis Desktop will discover and mount apps created here automatically.',
      ].join('\n'),
      hints: [
        { command: 'notis apps roots list', reason: 'Show every persistent development root' },
      ],
      meta: { mutating: true },
    });
  }

  if (!sharedBundleBaseUrls) {
    sharedBundleBaseUrls = findSharedSourceBundleUrls(appDirs, sessionsFilePath);
  }
  let sourceHostLock = null;
  if (
    !sharedBundleBaseUrls
    && process.env.NOTIS_APPS_DEV_HOST_LOCK_HELD !== '1'
  ) {
    sourceHostLock = tryAcquireAppDevHostLock({
      identity: '__mac_user__',
      apiBase: 'loopback-source',
      projectDir: SHARED_APP_DEV_HOST_KEY,
    });
    if (!sourceHostLock) {
      const startedAt = Date.now();
      while (!sharedBundleBaseUrls && Date.now() - startedAt < 45_000) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        sharedBundleBaseUrls = findSharedSourceBundleUrls(appDirs, sessionsFilePath);
      }
      if (!sharedBundleBaseUrls) {
        throw usageError('The shared app development host is busy but did not become ready. Retry after checking ~/.notis/app-dev-host.log.');
      }
    }
  }

  for (const projectDir of appDirs) {
    const problems = detectProjectProblems(projectDir);
    if (problems.length) {
      throw usageError(`Project ${projectDir} has problems:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    }
  }

  let port = null;
  if (sharedBundleBaseUrls) {
    // The source host owns the only loopback listener and build watchers.
  } else if (ctx.options.port) {
    port = Number.parseInt(ctx.options.port, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw usageError('Port must be between 1 and 65535.');
    }
  } else {
    // Concurrent sessions must not fight over the default port: the desktop
    // auto-starts every known project at launch, so only the first one can
    // have 5173 and the rest fall back to an ephemeral port.
    port = await getAvailablePortPreferring(DEFAULT_DEV_PORT);
  }

  const mode = getCliMode();
  const identity = decodeJwtSub(ctx.runtime.jwt);
  if (!identity) {
    throw usageError('Could not determine the current user from the CLI credential. Run notis login and retry.');
  }
  const apiBase = String(ctx.runtime.apiBase || '').replace(/\/$/, '');
  const sessionId = randomUUID();
  const profileKey = linkedStateProfileKey(ctx.runtime);
  const consumerMode = process.env.NOTIS_APPS_DEV_CONSUMER_MODE;
  const manualConsumerInstanceId = sharedBundleBaseUrls && !consumerMode
    ? `cli.${process.pid}.${sessionId}`
    : null;
  let manualConsumerTimer = null;
  if (manualConsumerInstanceId) {
    const heartbeatManualConsumer = () => heartbeatAppDevConsumer({
      instanceId: manualConsumerInstanceId,
      userId: identity,
      apiBase,
      pid: process.pid,
    });
    heartbeatManualConsumer();
    manualConsumerTimer = setInterval(() => {
      try {
        heartbeatManualConsumer();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[notis apps dev] consumer heartbeat failed: ${message}\n`);
      }
    }, DEV_CONSUMER_HEARTBEAT_INTERVAL_MS);
  }
  // One app, one dataset: a dev session runs the app from local source against
  // the same databases the installed app uses, the way `npm run dev` serves the
  // same database as the deployed site. `--scratch` is the marked case; the
  // old `--live-data` flag now names the default and is kept as a no-op so
  // muscle memory and scripts keep working.
  if (ctx.options?.scratch && ctx.options?.liveData) {
    throw usageError('--scratch and --live-data contradict each other; pass at most one.');
  }
  const useInstalledDatabases = !ctx.options?.scratch;

  const candidates = [];
  for (const projectDir of appDirs) {
    const appConfig = await loadAppConfig(projectDir);
    if (!appConfig.name) {
      throw usageError(`notis.config.ts in ${projectDir} must define a non-empty name.`);
    }
    const devSlug = buildDevInstallSlug(appConfig);
    if (!devSlug) {
      throw usageError(`notis.config.ts devSlug or name in ${projectDir} must slugify to a non-empty value.`);
    }
    candidates.push({ appConfig, devSlug, projectDir });
  }

  const canonicalSelection = selectCanonicalDevApps(candidates, readAppDevRoots());
  const canonicalCandidates = [];
  for (const { appConfig, devSlug, projectDir } of canonicalSelection.selected) {
    // Sequential on purpose: the shell-consent prompt must never interleave
    // with another app's, and the ensure fan-out below runs in parallel.
    const approvedCapabilities = await resolveCloudShellConsent({
      appConfig,
      projectDir,
      grantCloudShell: Boolean(ctx.options?.grantCloudShell),
      profileKey,
    });
    canonicalCandidates.push({
      appConfig,
      devSlug,
      projectDir,
      approvedCapabilities,
      mountNonce: randomUUID(),
    });
  }

  // Start every build watcher before the backend registrations finish. A
  // machine with several apps must not show an empty sidebar for minutes while
  // unrelated registrations run sequentially. Each successful registration is
  // published below as soon as its own last-known bundle is ready.
  const devServer = sharedBundleBaseUrls
    ? {
        close: async () => {},
        isBundleReady: () => true,
        updateApp: () => {},
        waitForBundle: async () => {},
        getWatcherOwnership: () => null,
      }
    : await startAppDevServer({
        apps: canonicalCandidates.map((app) => ({
          slug: app.devSlug,
          projectDir: app.projectDir,
          appId: null,
          targetAppId: null,
          userId: identity,
          profileKey,
          sessionId,
          mountNonce: app.mountNonce,
        })),
        port,
        sessionsFilePath,
      });
  const desktopHostOwnership = captureDesktopHostOwnership({
    desktopOwnerId: process.env.NOTIS_APPS_DEV_DESKTOP_OWNER_ID,
    desktopOwnerScope: process.env.NOTIS_APPS_DEV_DESKTOP_OWNER_SCOPE,
  });

  let heartbeatTimer = setInterval(() => {
    try {
      heartbeatAppDevSession(sessionId, new Date().toISOString(), sessionsFilePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[notis apps dev] heartbeat failed: ${message}\n`);
    }
  }, DEV_HEARTBEAT_INTERVAL_MS);

  const registrationStartedAt = process.hrtime.bigint();
  const apps = [];
  const registrationWarnings = [];
  let firstRegistrationError = null;
  // The local development backend is deliberately a single worker. Register
  // apps sequentially so a large root cannot queue many long mutations behind
  // one another. Unlike the old all-or-nothing startup, publish each healthy
  // app immediately while later registrations continue in the background.
  for (const {
    appConfig,
    devSlug,
    projectDir,
    approvedCapabilities,
    mountNonce,
  } of canonicalCandidates) {
    const appStartedAt = process.hrtime.bigint();
    try {
      const registeredApp = await ensureDevInstall({
        ctx,
        appConfig,
        projectDir,
        idempotencyKey: nextDevInstallIdempotencyKey(ctx.globalOptions, devSlug),
        useInstalledDatabases,
        approvedCapabilities,
      });
      const bundleBaseUrl = sharedBundleBaseUrls?.get(registeredApp.projectDir)
        || `http://127.0.0.1:${port}/a/${registeredApp.devSlug}`;
      const app = {
        ...registeredApp,
        bundleBaseUrl,
        mountNonce,
        appHref: buildDevelopmentAppHref({
          appSlug: registeredApp.slug,
          appId: registeredApp.appId,
          devSlug: registeredApp.devSlug,
          targetAppId: registeredApp.targetAppId,
          targetAppSlug: registeredApp.targetAppSlug,
          manifest: registeredApp.manifest,
        }),
      };
      devServer.updateApp(app.devSlug, {
        appId: app.appId,
        targetAppId: app.targetAppId || null,
      });
      const now = new Date().toISOString();
      const sessionRecord = {
        sessionId,
        hostPid: process.pid,
        sourceHost: !sharedBundleBaseUrls,
        ...(desktopHostOwnership || {}),
        ...(devServer.getWatcherOwnership(app.devSlug) || {}),
        bundleReady: devServer.isBundleReady(app.devSlug),
        ...(!sharedBundleBaseUrls ? {
          discoveredProjects: discoveredAppDirs,
          canonicalProjects: canonicalCandidates.map((candidate) => candidate.projectDir),
        } : {}),
        userId: identity,
        apiBase,
        profileKey,
        appId: app.appId,
        targetAppId: app.targetAppId || undefined,
        mountNonce: app.mountNonce,
        devSlug: app.devSlug,
        bundleBaseUrl: app.bundleBaseUrl,
        projectDir: app.projectDir,
        startedAt: now,
        lastHeartbeatAt: now,
      };
      upsertAppDevSessions(sessionRecord, sessionsFilePath);
      apps.push(app);
      if (!sessionRecord.bundleReady) {
        void devServer.waitForBundle(app.devSlug).then(() => {
          upsertAppDevSessions({
            ...sessionRecord,
            bundleReady: true,
            lastHeartbeatAt: new Date().toISOString(),
          }, sessionsFilePath);
        }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(`[notis apps dev] ${app.devSlug}: initial bundle failed: ${message}\n`);
        });
      }
    } catch (error) {
      firstRegistrationError ||= error;
      const message = error instanceof Error ? error.message : String(error);
      registrationWarnings.push(
        `${projectDir} could not be mounted: ${message}. It will be retried when the shared host reconciles again.`,
      );
      process.stderr.write(`[notis apps dev] ${devSlug}: registration failed: ${message}\n`);
    } finally {
      logAppsTiming('ensure-dev-install', {
        slug: devSlug,
        ms: timingMs(appStartedAt).toFixed(1),
      });
    }
  }
  if (apps.length === 0) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    try {
      await devServer.close();
    } catch {
      // preserve the original registration error
    }
    if (sourceHostLock) {
      releaseAppDevHostLock(sourceHostLock);
      sourceHostLock = null;
    }
    if (manualConsumerTimer) clearInterval(manualConsumerTimer);
    if (manualConsumerInstanceId) {
      try {
        removeAppDevConsumer(manualConsumerInstanceId);
      } catch {
        // Preserve the registration error; a failed lease cleanup expires.
      }
    }
    throw firstRegistrationError || usageError('No unambiguous development apps could be mounted.');
  }
  logAppsTiming('ensure-dev-install:all', {
    apps: apps.length,
    ms: timingMs(registrationStartedAt).toFixed(1),
  });

  const warnings = [
    ...canonicalSelection.warnings,
    ...registrationWarnings,
    ...databaseMaterializationWarnings(apps),
    ...liveDataWarnings(apps),
    ...versionPrecedenceWarnings(apps),
  ];

  let consumerTimer = null;

  ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: {
      mode,
      api_base: apiBase,
      session_id: sessionId,
      mount_status: 'serving',
      source_host: !sharedBundleBaseUrls,
      identity,
      apps: apps.map((app) => ({
        slug: app.devSlug,
        app_id: app.appId,
        target_app_id: app.targetAppId,
        name: app.name,
        project_dir: app.projectDir,
        bundle_base_url: app.bundleBaseUrl,
        app_href: app.appHref,
        created: app.created,
        linked_app_id: app.linkedAppId,
        database_materialization: app.databaseMaterialization,
        live_data: app.liveData,
        local_release_version: app.localReleaseVersion,
        installed_release_version: app.installedReleaseVersion,
        mount_eligible: app.mountEligible,
      })),
    },
    warnings,
    humanSummary: [
      `Running apps dev against ${apiBase} as ${identity} (mode: ${mode})`,
      ...(!skipRootRegistration ? [`Registered development root: ${rootDir}`] : []),
      `Watching ${readAppDevRoots().roots.length} persistent development root(s).`,
      ...(useInstalledDatabases
        ? [`Databases: ${apps.filter((app) => app.liveData?.enabled).length}/${apps.length} app(s) reading the installed app's live rows`]
        : []),
      '',
      ...apps.map((app) => (
        app.mountEligible
          ? `  ${app.name.padEnd(24)} ${app.bundleBaseUrl} -> ${app.appHref}`
          : `  ${app.name.padEnd(24)} online v${app.installedReleaseVersion} (local ${app.localReleaseVersion || 'version missing'})`
      )),
      '',
      sharedBundleBaseUrls
        ? `Attached to the shared source host: ${apps.filter((app) => app.mountEligible).length}/${apps.length} app${apps.length === 1 ? '' : 's'} eligible to substitute.`
        : `Serving one shared loopback host for ${apps.length} app${apps.length === 1 ? '' : 's'}; ${apps.filter((app) => app.mountEligible).length} eligible to substitute.`,
      '',
      'Press Ctrl-C to stop.',
    ].join('\n'),
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`\n[notis apps dev] stopping (${signal})...\n`);
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (consumerTimer) {
      clearInterval(consumerTimer);
      consumerTimer = null;
    }
    if (manualConsumerTimer) {
      clearInterval(manualConsumerTimer);
      manualConsumerTimer = null;
    }
    if (manualConsumerInstanceId) {
      try {
        removeAppDevConsumer(manualConsumerInstanceId);
      } catch {
        // A crashed CLI lease expires automatically after the heartbeat window.
      }
    }
    try {
      await devServer.close();
    } catch {
      // ignore cleanup failures during shutdown
    }
    // Keep ownership records until every watcher group has stopped. If the
    // Desktop must force this host down, the next launch can still recover a
    // verified orphan instead of losing its only ownership proof.
    try {
      removeAppDevSession(sessionId, sessionsFilePath);
    } catch {
      // ignore cleanup failures during shutdown
    }
    if (sourceHostLock) {
      releaseAppDevHostLock(sourceHostLock);
      sourceHostLock = null;
    }
    process.exit(EXIT_CODES.ok);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  if (consumerMode === 'machine' || consumerMode === 'environment') {
    consumerTimer = setInterval(() => {
      if (!hasAppDevConsumer(readAppDevConsumers(), {
        mode: consumerMode,
        userId: identity,
        apiBase,
      })) {
        void shutdown('last consumer detached');
      }
    }, DEV_CONSUMER_POLL_INTERVAL_MS);
  }

  await new Promise(() => {});

  return EXIT_CODES.ok;
}

async function appsRootsListHandler(ctx) {
  const registry = readAppDevRoots();
  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: { roots: registry.roots },
    humanSummary: appDevRootsTable(registry.roots),
    meta: { mutating: false },
  });
}

async function appsRootsRemoveHandler(ctx) {
  const rootDir = resolve(ctx.args.dir);
  const result = removeAppDevRoot(rootDir);
  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: {
      removed: result.removed,
      root: result.path,
      roots: result.registry.roots,
    },
    humanSummary: result.removed
      ? `Removed app development root: ${result.path}`
      : `App development root was not registered: ${result.path}`,
    hints: result.removed
      ? []
      : [{ command: 'notis apps roots list', reason: 'Show registered roots' }],
    meta: { mutating: result.removed },
  });
}

async function appsBuildHandler(ctx) {
  const projectDir = resolveProjectDir(ctx.args.dir || '.');
  const problems = detectProjectProblems(projectDir);
  if (problems.length) {
    throw usageError(`Project has problems:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }

  const { manifest } = await buildArtifact(projectDir, {
    stdio: ctx.output.isMachineMode() ? 'pipe' : 'inherit',
  });

  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: { manifest },
    humanSummary: `Built ${manifest.routes.length} routes into .notis/output/`,
  });
}

async function appsVerifyHandler(ctx) {
  const projectDir = resolveProjectDir(ctx.args.dir || '.');
  const problems = detectProjectProblems(projectDir);
  if (problems.length) {
    throw usageError(`Project has problems:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }

  const mode = ctx.options.mode || 'stub';
  if (!['stub', 'live'].includes(mode)) {
    throw usageError('--mode must be either "stub" or "live".');
  }

  let linkedState = null;
  if (mode === 'live') {
    if (
      ctx.runtime.credentialKind === 'oauth'
      && !await ensureFreshOAuthCredential(ctx.runtime)
    ) {
      throw usageError('Live verify mode requires a current OAuth grant. Run `notis login` and retry.');
    }
    if (!ctx.runtime.jwt) {
      throw usageError('Live verify mode requires CLI auth. Run notis login and retry.');
    }
    linkedState = readLinkedState(projectDir, linkedStateProfileKey(ctx.runtime));
    if (!linkedState?.app_id) {
      throw usageError('Live verify mode requires a linked app. Run `notis apps link <app-id> .` first.');
    }
  }

  if (!ctx.options.skipBuild) {
    await buildArtifact(projectDir, {
      stdio: ctx.output.isMachineMode() ? 'pipe' : 'inherit',
    });
  }

  const manifest = readManifest(projectDir);
  const appConfig = await loadAppConfig(projectDir);
  const listing = inspectListingReadiness(projectDir, appConfig);
  // Store readiness is a publish concern, not a render concern. Verify reports
  // it so the gaps stay visible while the app is still being built; only
  // --listing (and `apps publish`) turn it back into a hard gate.
  if (listing.errors.length && ctx.options.listing === true) {
    throw usageError(`Listing metadata has problems:\n${listing.errors.map((error) => `  - ${error}`).join('\n')}`);
  }
  const listingWarnings = [
    ...[...listing.errors, ...listing.warnings].map((message) => `Store readiness: ${message}`),
    ...findUnknownScreenshotScenarios(projectDir, resolveListingScreenshots(projectDir, appConfig)),
  ];
  const routes = routeSelection(manifest, parseRouteSlugs(ctx.options.routes));
  const port = parsePort(ctx.options.port) || await getAvailablePort();
  const appSlug = slugify(appConfig.name || manifest.app?.name || 'app') || 'app';
  const baseUrl = `http://127.0.0.1:${port}/a/${appSlug}`;
  const browserSessionName = `notis-verify-${process.pid}`;
  const noBrowser = ctx.options.browser === false;
  const keepOpen = Boolean(ctx.options.keepOpen);
  let devServer = null;
  let browserTouched = false;

  try {
    devServer = await startAppDevServer({
      apps: [{
        slug: appSlug,
        projectDir,
        appId: linkedState?.app_id || 'harness-app',
      }],
      port,
      watch: false,
      harness: {
        mode,
        apiBase: ctx.runtime.apiBase,
        jwt: mode === 'live' ? ctx.runtime.jwt : null,
      },
      log: () => {},
      logError: (message) => process.stderr.write(`${message}\n`),
    });

    const urls = routes.map((route) => ({
      route,
      url: `${baseUrl}/harness?route=${encodeURIComponent(route.slug)}`,
    }));

    let results;
    const warnings = [...listingWarnings];
    if (noBrowser) {
      results = urls.map(({ route, url }) => ({
        route: route.slug,
        path: route.path,
        url,
        ok: true,
        status: 'manual',
        mounted: null,
        errors: [],
        runtimeCalls: [],
        assertions: [],
        snapshot_path: null,
        tool_error: null,
      }));
    } else if (!isAgentBrowserAvailable()) {
      warnings.push('agent-browser is not available on PATH; rerun with --no-browser to inspect harness URLs manually.');
      results = urls.map(({ route, url }) => {
        const toolError = {
          phase: 'available',
          message: 'agent-browser is not available on PATH',
        };
        const result = {
          route: route.slug,
          path: route.path,
          url,
          mounted: false,
          renderStarted: false,
          errors: [],
          runtimeCalls: [],
          snapshotPath: null,
          tool_error: toolError,
        };
        const assertions = assertHarnessResult(
          result,
          route,
          declaredDatabaseSlugs(appConfig, manifest, route),
          mode,
        );
        return {
          ...result,
          ok: false,
          status: 'failed',
          assertions,
          snapshot_path: null,
        };
      });
    } else {
      browserTouched = true;
      results = [];
      for (const { route, url } of urls) {
        const snapshotPath = join(projectDir, '.notis', 'output', '.harness', `${route.slug}.snapshot.txt`);
        const result = await runHarnessRoute({
          url,
          sessionName: browserSessionName,
          timeoutMs: Number.parseInt(ctx.globalOptions.timeoutMs || '', 10) || 10_000,
          snapshotPath,
        });
        const assertions = assertHarnessResult(
          result,
          route,
          declaredDatabaseSlugs(appConfig, manifest, route),
          mode,
        );
        results.push({
          route: route.slug,
          path: route.path,
          url,
          ok: assertions.length === 0,
          status: assertions.length === 0 ? 'passed' : 'failed',
          mounted: result.mounted,
          renderStarted: result.renderStarted,
          errors: result.errors,
          runtimeCalls: result.runtimeCalls,
          assertions,
          snapshot_path: result.snapshotPath,
          timed_out: Boolean(result.timed_out),
          tool_error: result.tool_error,
        });
      }
    }

    const summary = {
      total: results.length,
      passed: results.filter((result) => result.status === 'passed').length,
      failed: results.filter((result) => result.status === 'failed').length,
      manual: results.filter((result) => result.status === 'manual').length,
    };
    const overallOk = summary.failed === 0;
    const exitCode = overallOk ? EXIT_CODES.ok : EXIT_CODES.unexpected;
    const data = {
      status: overallOk ? (summary.manual ? 'manual' : 'passed') : 'failed',
      project_dir: projectDir,
      app_slug: appSlug,
      mode,
      browser_session: noBrowser ? null : browserSessionName,
      server: {
        port,
        base_url: baseUrl,
        urls: urls.map(({ route, url }) => ({ route: route.slug, url })),
      },
      summary,
      results,
      listing: {
        ready: listing.ready,
        gated: ctx.options.listing === true,
        problems: listing.errors,
      },
    };

    ctx.output.emitSuccess({
      ok: overallOk,
      command: ctx.spec.command_path.join(' '),
      data,
      humanSummary: overallOk
        ? (summary.manual ? `Harness URLs ready for ${summary.manual} routes.` : `Verified ${summary.passed} routes successfully.`)
        : `Verification failed for ${summary.failed} routes.`,
      warnings,
      renderHuman: () => renderVerifyReport({ summary, results, noBrowser }),
    });

    if (keepOpen) {
      process.stderr.write(`[notis apps verify] harness open at ${baseUrl}. Press Ctrl-C to stop.\n`);
      await new Promise(() => {});
    }

    return exitCode;
  } finally {
    if (!keepOpen) {
      if (browserTouched) {
        try {
          await closeAgentBrowserSession(browserSessionName);
        } catch {
          // Ignore browser cleanup failures.
        }
      }
      if (devServer) {
        try {
          await devServer.close();
        } catch {
          // Ignore server cleanup failures.
        }
      }
    }
  }
}

async function appsScreenshotHandler(ctx) {
  const projectDir = resolveProjectDir(ctx.args.dir || '.');
  const problems = detectProjectProblems(projectDir);
  if (problems.length) {
    throw usageError(`Project has problems:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }

  if (!isAgentBrowserAvailable()) {
    throw usageError('agent-browser is not available on PATH. It ships with the Notis desktop app; open it once, then retry.');
  }

  const mode = ctx.options.mode || 'stub';
  if (!['stub', 'live'].includes(mode)) {
    throw usageError('--mode must be either "stub" or "live".');
  }

  let linkedState = null;
  if (mode === 'live') {
    if (
      ctx.runtime.credentialKind === 'oauth'
      && !await ensureFreshOAuthCredential(ctx.runtime)
    ) {
      throw usageError('Live mode requires a current OAuth grant. Run `notis login` and retry.');
    }
    if (!ctx.runtime.jwt) {
      throw usageError('Live mode requires CLI auth. Run notis login and retry.');
    }
    linkedState = readLinkedState(projectDir, linkedStateProfileKey(ctx.runtime));
    if (!linkedState?.app_id) {
      throw usageError('Live mode requires a linked app. Run `notis apps link <app-id> .` first.');
    }
  }

  if (!ctx.options.skipBuild) {
    await buildArtifact(projectDir, {
      stdio: ctx.output.isMachineMode() ? 'pipe' : 'inherit',
    });
  }

  const manifest = readManifest(projectDir);
  const appConfig = await loadAppConfig(projectDir);
  const selectedRouteSlugs = parseRouteSlugs(ctx.options.routes);
  const routes = routeSelection(manifest, selectedRouteSlugs);
  const screenshotSlots = screenshotIndexByRouteSlug(manifest);
  if (!routes.length) {
    throw usageError('No routes to screenshot.');
  }

  const width = parsePositiveInt(ctx.options.width) || 2000;
  const height = parsePositiveInt(ctx.options.height) || 1250;
  const outputDir = ctx.options.outputDir
    ? resolveProjectDir(ctx.options.outputDir)
    : join(projectDir, 'metadata');

  const port = parsePort(ctx.options.port) || await getAvailablePort();
  const appSlug = slugify(appConfig.name || manifest.app?.name || 'app') || 'app';
  const baseUrl = `http://127.0.0.1:${port}/a/${appSlug}`;
  const browserSessionName = `notis-screenshot-${process.pid}`;
  const browserSessionNames = [];
  const configuredScreenshots = resolveListingScreenshots(projectDir, appConfig)
    .filter((screenshot) => screenshot.route)
    .filter((screenshot) => !selectedRouteSlugs || selectedRouteSlugs.includes(screenshot.route));
  const scenarioWarnings = findUnknownScreenshotScenarios(projectDir, configuredScreenshots);
  const routeBySlug = new Map(routes.map((route) => [route.slug, route]));
  const captures = configuredScreenshots.length > 0
    ? configuredScreenshots.map((screenshot) => {
      const route = routeBySlug.get(screenshot.route);
      if (!route) {
        throw usageError(
          `Screenshot ${screenshot.path} references unavailable route slug "${screenshot.route}".`,
          { available_routes: routes.map((entry) => entry.slug) },
        );
      }
      return {
        route,
        scenario: screenshot.scenario,
        focus: screenshot.focus,
        theme: screenshot.theme || 'light',
        fileName: basename(screenshot.path),
      };
    })
    : routes.map((route, index) => ({
      route,
      scenario: null,
      focus: null,
      theme: 'light',
      fileName: `screenshot-${screenshotSlots.get(route.slug) || index + 1}.png`,
    }));
  const rawOutputDir = ctx.options.raw
    ? null
    : mkdtempSync(join(tmpdir(), 'notis-store-screenshots-'));
  let devServer = null;
  let browserTouched = false;

  try {
    devServer = await startAppDevServer({
      apps: [{ slug: appSlug, projectDir, appId: linkedState?.app_id || 'harness-app' }],
      port,
      watch: false,
      harness: {
        mode,
        apiBase: ctx.runtime.apiBase,
        jwt: mode === 'live' ? ctx.runtime.jwt : null,
      },
      log: () => {},
      logError: (message) => process.stderr.write(`${message}\n`),
    });
    browserTouched = true;

    mkdirSync(outputDir, { recursive: true });
    const results = [];
    for (const capture of captures) {
      const { route, scenario, focus, theme, fileName } = capture;
      const screenshotPath = join(outputDir, fileName);
      const browserScreenshotPath = rawOutputDir
        ? join(rawOutputDir, fileName)
        : screenshotPath;
      const scenarioParam = scenario ? `&scenario=${encodeURIComponent(scenario)}` : '';
      const themeParam = `&theme=${encodeURIComponent(theme || 'light')}`;
      // Keep scenario captures on independent pages. Chromium can otherwise
      // reuse stale compositor layers when the next screenshot changes the
      // same app route into a substantially different state.
      const captureSessionName = `${browserSessionName}-${results.length + 1}`;
      browserSessionNames.push(captureSessionName);
      let result = await captureHarnessScreenshot({
        url: `${baseUrl}/harness?route=${encodeURIComponent(route.slug)}${scenarioParam}${themeParam}`,
        sessionName: captureSessionName,
        screenshotPath: browserScreenshotPath,
        focusSelector: ctx.options.raw ? null : focus,
        width,
        height,
        timeoutMs: Number.parseInt(ctx.globalOptions.timeoutMs || '', 10) || 15_000,
      });
      let presentation = { mode: 'raw' };
      if (result.ok && rawOutputDir) {
        try {
          presentation = await composeStoreScreenshot({
            inputPath: browserScreenshotPath,
            outputPath: screenshotPath,
            width,
            height,
            accent: appConfig.accent,
            seed: appConfig.name || manifest.app?.name || appSlug,
            focused: Boolean(focus),
            theme: theme || 'light',
          });
        } catch (error) {
          result = {
            ...result,
            ok: false,
            screenshotPath: null,
            tool_error: {
              phase: 'compose',
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }
      }
      results.push({
        route: route.slug,
        path: route.path,
        file: relative(projectDir, screenshotPath),
        ok: result.ok,
        errors: result.errors || [],
        timed_out: Boolean(result.timed_out),
        tool_error: result.tool_error,
        framing: result.framing || null,
        theme: theme || 'light',
        presentation,
      });
    }

    const captured = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    const warnings = [...scenarioWarnings];

    // Drop stale screenshots only after a full refresh. A selected-route
    // capture intentionally leaves other listing screenshots untouched.
    if (shouldPruneStaleScreenshotFiles(selectedRouteSlugs, failed.length)) {
      pruneStaleScreenshotFiles(outputDir, captures.length);
    }
    if (failed.length) {
      warnings.push(`${failed.length}/${results.length} routes failed to capture; see results.`);
    }

    ctx.output.emitSuccess({
      ok: failed.length === 0,
      command: ctx.spec.command_path.join(' '),
      data: {
        project_dir: projectDir,
        output_dir: outputDir,
        mode,
        presentation: ctx.options.raw ? 'raw' : 'framed',
        viewport: { width, height },
        summary: { total: results.length, captured: captured.length, failed: failed.length },
        results,
      },
      humanSummary: failed.length === 0
        ? `Captured ${captured.length} screenshot(s) to ${relative(projectDir, outputDir) || 'metadata'}/.`
        : `Captured ${captured.length}/${results.length} screenshots; ${failed.length} failed.`,
      warnings,
    });
    return screenshotExitCode(failed.length);
  } finally {
    if (browserTouched) {
      await Promise.all(browserSessionNames.map(async (sessionName) => {
        try {
          await closeAgentBrowserSession(sessionName);
        } catch {
          // Ignore browser cleanup failures.
        }
      }));
    }
    if (devServer) {
      try {
        await devServer.close();
      } catch {
        // Ignore server cleanup failures.
      }
    }
    if (rawOutputDir) {
      rmSync(rawOutputDir, { recursive: true, force: true });
    }
  }
}

export function buildLinkedAppState(
  existingState,
  appId,
  linkedAt = new Date().toISOString(),
) {
  const sameIdPromotion = existingState?.dev_app_id === appId;
  return {
    ...(!sameIdPromotion && existingState?.dev_app_id ? { dev_app_id: existingState.dev_app_id } : {}),
    ...(!sameIdPromotion && existingState?.dev_linked_at ? { dev_linked_at: existingState.dev_linked_at } : {}),
    app_id: appId,
    linked_at: linkedAt,
  };
}

async function appsLinkHandler(ctx) {
  const projectDir = resolveProjectDir(ctx.args.dir || '.');
  const appId = ctx.args.appId;

  await assertLinkTarget(ctx.runtime, appId);

  writeLinkedState(
    projectDir,
    buildLinkedAppState(
      readLinkedState(projectDir, linkedStateProfileKey(ctx.runtime)),
      appId,
      new Date().toISOString(),
    ),
    linkedStateProfileKey(ctx.runtime),
  );

  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: { app_id: appId, project_dir: projectDir },
    humanSummary: `Linked to app ${appId}`,
    hints: [
      { command: 'notis apps deploy .', reason: 'Deploy the app' },
    ],
  });
}

async function appsPullHandler(ctx) {
  const appId = ctx.args.appId;
  const result = await runToolCommand({
    runtime: ctx.runtime,
    toolName: GET_APP_TOOL,
    arguments_: { app_id: appId },
  });
  if (
    ctx.runtime.credentialKind === 'oauth'
    && !await ensureFreshOAuthCredential(ctx.runtime)
  ) {
    throw usageError('Pulling app source requires a current OAuth grant. Run `notis login` and retry.');
  }
  const app = result.payload?.app || {};
  const defaultDir = slugify(app.slug) || slugify(app.name) || slugify(appId);
  const targetDir = ctx.args.dir
    ? resolveProjectDir(ctx.args.dir)
    : defaultAppProjectDir(defaultDir);
  const version = ctx.options.sourceVersion || 'latest';

  const pulled = await pullAppSource({
    apiBase: ctx.runtime.apiBase,
    jwt: ctx.runtime.jwt,
    appId,
    targetDir,
    version,
    force: Boolean(ctx.options.force),
    profileKey: linkedStateProfileKey(ctx.runtime),
  });

  const versionLabel = pulled.version === 'latest' ? 'latest version' : `v${pulled.version}`;
  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: {
      app_id: appId,
      project_dir: pulled.projectDir,
      version: pulled.version,
    },
    humanSummary: `Pulled ${versionLabel} to ${pulled.projectDir}. Increment package.json notisAppVersion above the pulled release, then run \`cd ${pulled.projectDir} && npm install && notis apps dev\` to substitute the online bundle.`,
  });
}

function updateLinkedDeployState(projectDir, linkedState, appId, version, profileKey = null) {
  if (!linkedState || linkedState.app_id !== appId || !Number.isFinite(version)) {
    return;
  }
  writeLinkedState(projectDir, {
    ...linkedState,
    app_id: appId,
    version,
    linked_at: linkedState.linked_at || new Date().toISOString(),
    deployed_at: new Date().toISOString(),
  }, profileKey);
}

// Resolve first deploy without mutating. Promotion is part of the final
// SAVE_APP_FILES update, after build and uploads succeed, so a failed deploy
// cannot leave an empty installed app behind.
function resolveDeployTarget(ctx, projectDir) {
  if (ctx.options.appId) return { appId: ctx.options.appId, needsPromotion: false };
  const profileKey = linkedStateProfileKey(ctx.runtime);
  const state = readLinkedState(projectDir, profileKey);
  if (state?.app_id) return { appId: state.app_id, needsPromotion: false };
  if (!state?.dev_app_id) {
    return { appId: requireLinkedAppId(projectDir, ctx.options.appId, profileKey), needsPromotion: false };
  }
  return { appId: state.dev_app_id, needsPromotion: true };
}

async function appsDeployHandler(ctx) {
  const projectDir = resolveProjectDir(ctx.args.dir || '.');
  const profileKey = linkedStateProfileKey(ctx.runtime);
  const { appId, needsPromotion } = resolveDeployTarget(ctx, projectDir);
  const idempotencyKey = nextIdempotencyKey(ctx.globalOptions);
  const linkedState = readLinkedState(projectDir, profileKey);
  const baseVersion = linkedState?.app_id === appId && Number.isFinite(linkedState?.version)
    ? linkedState.version
    : undefined;

  // Build if needed
  if (!ctx.options.skipBuild) {
    await buildArtifact(projectDir, {
      stdio: ctx.output.isMachineMode() ? 'pipe' : 'inherit',
    });
  }

  // Direct deploy mode: upload to Supabase storage directly
  if (ctx.options.direct) {
    if (needsPromotion) {
      throw usageError('The first deploy must use the backend so promotion and save are atomic. Retry without --direct.');
    }
    await assertDirectDeployAccess(ctx.runtime, appId);
    const { version } = await directDeploy(projectDir, appId);
    updateLinkedDeployState(projectDir, linkedState, appId, version, profileKey);
    return ctx.output.emitSuccess({
      command: ctx.spec.command_path.join(' '),
      data: { app_id: appId, version, mode: 'direct' },
      humanSummary: `Deployed to app ${appId} (version ${version}) via direct upload`,
      meta: { mutating: true },
    });
  }

  // Standard deploy via backend server, with auto-fallback to direct
  const files = collectArtifactFiles(projectDir);
  const sourceFiles = collectSourceFiles(projectDir);
  const manifest = readManifest(projectDir);

  let result;
  try {
    result = await runToolCommand({
      // App deploys upload both the built artifact and the editable source
      // snapshot. The ordinary 30s CLI timeout is too short for larger apps,
      // and timing out a mutation is ambiguous: the backend may commit after
      // the client disconnects. Give this operation its real completion window.
      runtime: {
        ...ctx.runtime,
        timeoutMs: Math.max(ctx.runtime.timeoutMs || 0, APP_DEPLOY_TIMEOUT_MS),
      },
      toolName: SAVE_APP_FILES_TOOL,
      arguments_: {
        app_id: appId,
        files,
        source_files: sourceFiles,
        manifest,
        ...appRowFieldsFromManifest(manifest),
        ...(baseVersion !== undefined ? { base_version: baseVersion } : {}),
        ...(needsPromotion ? { promote_dev_app: true } : {}),
      },
      mutating: true,
      idempotencyKey,
    });
  } catch (error) {
    if (error.code === 'conflict') {
      throw toolConflictToError(error.details, 'Deploy conflict');
    }

    // A timed-out mutation may already have committed on the backend. A direct
    // upload here would create a second revision, so fail closed and let the
    // caller inspect/pull the app before deciding whether to retry.
    if (error.code === 'network_timeout') {
      error.message = `${error.message}. The backend may still complete this deploy; direct fallback was not attempted to avoid creating a duplicate revision. Inspect the app version, then pull before retrying if needed.`;
      throw error;
    }

    // A network failure is ambiguous for a mutation. It can happen after the
    // backend committed but before undici finished reading the response (for
    // example ECONNRESET / UND_ERR_SOCKET). Never infer pre-dispatch from a
    // generic network_error or its message: an automatic direct upload could
    // create a second revision. Operators who have proved the backend is down
    // can still choose the explicit --direct mode.
    if (error.code === 'network_error') {
      error.message = `${error.message}. The backend may have committed this deploy; direct fallback was not attempted to avoid creating a duplicate revision. Inspect the app version, then pull before retrying, or use --direct only after proving the backend mutation did not land.`;
      throw error;
    }

    throw error;
  }

  const deployedVersion = Number(result?.payload?.version);
  if (!Number.isFinite(deployedVersion) || deployedVersion <= 0) {
    throw new CliError({
      code: 'network_error',
      message: 'The backend returned an incomplete deploy response. The deploy may have committed; inspect the app version and pull before retrying. Direct fallback was not attempted to avoid creating a duplicate revision.',
      exitCode: EXIT_CODES.network,
      retryable: true,
    });
  }

  if (needsPromotion) {
    const now = new Date().toISOString();
    writeLinkedState(projectDir, {
      ...linkedState,
      app_id: appId,
      linked_at: linkedState?.linked_at || now,
      version: deployedVersion,
      deployed_at: now,
      dev_app_id: undefined,
      dev_linked_at: undefined,
    }, profileKey);
    try {
      linkAppDevSessionTarget(
        { appId, targetAppId: appId },
        getAppDevSessionsFile(),
      );
    } catch (error) {
      ctx.output.emitProgress({
        phase: 'warning',
        message: `Deploy succeeded, but the local development session could not be retargeted: ${error.message}`,
      });
    }
    ctx.output.emitProgress({
      phase: 'promote',
      message: `Promoted development app to installed app ${appId}`,
    });
  } else {
    updateLinkedDeployState(projectDir, linkedState, appId, deployedVersion, profileKey);
  }
  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: {
      app_id: appId,
      version: deployedVersion,
      idempotency_key: idempotencyKey,
    },
    humanSummary: `Deployed to app ${appId} (version ${deployedVersion})`,
    meta: { mutating: true, idempotency_key: idempotencyKey },
  });
}

function deployedAppVersion(app) {
  const value = app?.current_version ?? app?.manifest?.version;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function appsDuplicateHandler(ctx) {
  const projectDir = resolveProjectDir(ctx.args.dir || '.');
  // Either target an app explicitly, or duplicate whatever this project is
  // linked to, so `notis apps duplicate` works from inside a project.
  const appId = requireLinkedAppId(projectDir, ctx.options.appId, linkedStateProfileKey(ctx.runtime));
  const idempotencyKey = nextIdempotencyKey(ctx.globalOptions);

  const copyDocuments = ctx.options.copyDocuments || 'declared';
  if (!['declared', 'all', 'none'].includes(copyDocuments)) {
    throw usageError("--copy-documents must be one of: declared, all, none.");
  }

  const result = await runToolCommand({
    runtime: ctx.runtime,
    toolName: DUPLICATE_APP_TOOL,
    arguments_: {
      app_id: appId,
      ...(ctx.options.name ? { name: ctx.options.name } : {}),
      copy_documents: copyDocuments,
    },
    mutating: true,
    idempotencyKey,
  });

  const payload = result.payload || {};
  if (payload.status === 'error') {
    throw usageError(`Could not duplicate app ${appId}: ${payload.message || 'unknown error'}`);
  }

  const duplicated = payload.app || {};
  if (!duplicated.id) {
    throw usageError(`Could not duplicate app ${appId}: the backend did not return an app id.`);
  }

  const data = {
    app_id: duplicated.id,
    name: duplicated.name,
    slug: duplicated.slug,
    duplicated_from_app_id: payload.duplicated_from_app_id || appId,
    copied_document_count: payload.copied_document_count ?? 0,
    portal_url: payload.portal_url,
    idempotency_key: idempotencyKey,
    // The duplicate owns brand new databases; nothing is shared with the source.
    databases: (payload.databases || []).map((database) => ({
      id: database.id,
      slug: database.slug,
      name: database.name,
    })),
  };

  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data,
    humanSummary: `Duplicated app ${appId} as ${duplicated.name || duplicated.id}`,
    hints: payload.portal_url
      ? [{ command: payload.portal_url, reason: 'Open the duplicated app in Portal' }]
      : [],
    meta: { mutating: true, idempotency_key: idempotencyKey },
  });
}

async function appsPublishHandler(ctx) {
  if (ctx.options.confirmReady !== true) {
    throw usageError(
      'Store submission requires explicit user confirmation that App Details is ready. ' +
      'After confirmation, rerun with --confirm-ready.',
    );
  }

  const projectDir = resolveProjectDir(ctx.args.dir || '.');
  const appId = requireLinkedAppId(projectDir, ctx.options.appId, linkedStateProfileKey(ctx.runtime));
  const linkedState = readLinkedState(projectDir, linkedStateProfileKey(ctx.runtime));
  const appConfig = await loadAppConfig(projectDir);
  const readiness = inspectListingReadiness(projectDir, appConfig);
  if (!readiness.ready) {
    throw usageError(
      `Store listing is not ready:\n${readiness.errors.map((error) => `  - ${error}`).join('\n')}`,
    );
  }

  const detailResult = await runToolCommand({
    runtime: ctx.runtime,
    toolName: GET_APP_TOOL,
    arguments_: { app_id: appId },
  });
  const detail = detailResult.payload || {};
  const app = detail.app || {};
  if (!app.id) {
    throw usageError(`Could not load deployed app ${appId}.`);
  }
  if (!['team', 'public_store_hidden'].includes(app.visibility)) {
    throw usageError('Set the app visibility to Team or Public before Store submission.');
  }

  const remoteVersion = deployedAppVersion(app);
  if (remoteVersion <= 0) {
    throw usageError('App has no deployed source. Run `notis apps deploy` first.');
  }
  if (
    linkedState?.app_id !== appId
    || !Number.isFinite(linkedState?.version)
    || linkedState.version !== remoteVersion
  ) {
    throw usageError(
      `Local project is not confirmed at deployed version ${remoteVersion}. ` +
      'Run `notis apps deploy` from this project before submitting it.',
    );
  }

  const activeSubmission = detail.active_submission || app.active_submission || null;
  if (activeSubmission?.status === 'pending_review') {
    throw usageError(
      `A Store submission is already in review${activeSubmission.github_pr_url ? `: ${activeSubmission.github_pr_url}` : '.'}`,
    );
  }
  if (activeSubmission?.status === 'removal_pending_review') {
    throw usageError('Store removal is currently in review. Wait for it to finish before submitting an update.');
  }

  const result = await httpRequest({
    runtime: ctx.runtime,
    method: 'POST',
    path: '/portal_apps/publish',
    body: { app_id: appId },
  });
  const submission = result.payload.submission || result.payload;
  const reviewStatus = submission.status || 'pending_review';
  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: {
      app_id: appId,
      source_version: submission.source_version || remoteVersion,
      submission,
    },
    humanSummary: reviewStatus === 'merged'
      ? `Published app ${appId} to the Store at version ${submission.source_version || remoteVersion}`
      : `Submitted app ${appId} version ${submission.source_version || remoteVersion} for Store review`,
    hints: submission.github_pr_url
      ? [{ command: submission.github_pr_url, reason: 'Review the Store registry pull request' }]
      : [],
    meta: { mutating: true, request_id: result.requestId },
  });
}

async function appsDoctorHandler(ctx) {
  const projectDir = resolveProjectDir(ctx.args.dir || '.');
  const problems = detectProjectProblems(projectDir);

  let appConfig = null;
  try {
    appConfig = await loadAppConfig(projectDir);
  } catch {
    problems.push('Failed to load notis.config.ts');
  }
  const warnings = detectProjectWarnings(projectDir, appConfig);
  let listing = null;
  if (appConfig) {
    try {
      listing = inspectListingReadiness(projectDir, appConfig);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  const linkedState = readLinkedState(projectDir, linkedStateProfileKey(ctx.runtime));
  const status = problems.length ? 'unhealthy' : warnings.length ? 'warnings' : 'healthy';

  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: { status, problems, warnings, linked: linkedState, config: appConfig, listing },
    humanSummary: problems.length
      ? `Found ${problems.length} problems:\n${problems.map((p) => `  - ${p}`).join('\n')}`
      : warnings.length
        ? `Healthy with ${warnings.length} warnings:\n${warnings.map((w) => `  - ${w}`).join('\n')}`
        : `Project is healthy.${doctorLinkSummary(linkedState)}`,
  });
}

export function doctorLinkSummary(linkedState) {
  if (linkedState?.app_id) {
    return ` Linked to app ${linkedState.app_id}.`;
  }
  if (linkedState?.dev_app_id) {
    return ` Local development app ${linkedState.dev_app_id} is active.`;
  }
  return ' Not linked.';
}

// ---------------------------------------------------------------------------
// Command specs
// ---------------------------------------------------------------------------

export const appsCommandSpecs = [
  {
    command_path: ['apps', 'list'],
    summary: 'List apps the current profile can access.',
    when_to_use: 'Discover existing apps before linking or deploying.',
    args_schema: { arguments: [], options: [] },
    examples: ['notis apps list', 'notis apps list --json'],
    mutates: false,
    idempotent: true,
    backend_call: { type: 'tool', name: LIST_APPS_TOOL },
    handler: appsListHandler,
  },
  {
    command_path: ['apps', 'init'],
    summary: 'Scaffold a new Notis app project.',
    when_to_use: 'Start a new Notis app. Use --from with a published Store app when one is close to the desired app; otherwise creates the bare Vite + React project.',
    args_schema: {
      arguments: [
        { token: '<name>', description: 'Display name for the app.' },
        { token: '[dir]', key: 'dir', description: 'Target directory, resolved from the current directory. Defaults to ~/.notis/apps/<slug>; pass a path to place the project elsewhere, such as a tracked git repo or an existing monorepo.' },
      ],
      options: [
        { flags: '--from <slug>', description: 'Start from a published Store app listed by `notis apps scaffolds list`. Downloads its source from the public app registry.' },
      ],
    },
    examples: [
      'notis apps scaffolds list',
      'notis apps init "Mind the Flo"',
      'notis apps init "My CRM" --from databases',
      'notis apps init "My App" ~/code/my-app',
    ],
    mutates: true,
    idempotent: false,
    require_auth: false,
    backend_call: { type: 'local', name: 'scaffold_project' },
    handler: appsInitHandler,
  },
  {
    command_path: ['apps', 'scaffolds', 'list'],
    summary: 'List published Store apps available as scaffolds.',
    when_to_use: 'Discover published Store apps to start from before creating a new app. Every app published to the public Store is automatically a scaffold; use --search to narrow the catalog.',
    args_schema: {
      arguments: [],
      options: [
        { flags: '--search <term>', description: 'Filter scaffolds by name, tagline, description, or category.' },
      ],
    },
    examples: [
      'notis apps scaffolds list',
      'notis apps scaffolds list --search journal',
      'notis apps init "My App" --from databases',
    ],
    mutates: false,
    idempotent: true,
    require_auth: false,
    backend_call: { type: 'local', name: 'list_scaffolds' },
    handler: appsScaffoldsListHandler,
  },
  {
    command_path: ['apps', 'create'],
    summary: 'Create a new remote Notis app and optionally link a local project to it.',
    when_to_use: 'Provision a fresh remote app before the first deploy. Pass a project directory to link it immediately.',
    args_schema: {
      arguments: [
        { token: '<name>', description: 'Display name for the remote app.' },
        { token: '[dir]', key: 'dir', description: 'Project directory to link after creation (default: do not link).' },
      ],
      options: [],
    },
    examples: [
      'notis apps create "My App"',
      'notis apps create "My App" .',
    ],
    mutates: true,
    idempotent: false,
    backend_call: { type: 'tool', name: CREATE_APP_TOOL },
    handler: appsCreateHandler,
  },
  {
    command_path: ['apps', 'dev'],
    summary: 'Register a development root and connect its apps to the shared local development host.',
    when_to_use:
      'Run this once for any folder that should be watched permanently. The folder itself, direct child apps, and apps/* are discovered automatically by every signed-in Notis Desktop instance. A linked app substitutes its online bundle only when local notisAppVersion is strictly greater than the installed release.',
    args_schema: {
      arguments: [
        { token: '[dir]', key: 'dir', description: 'Project directory or monorepo root (default: current dir).' },
      ],
      options: [
        { flags: '--port <number>', description: `Local bundle server port (default: ${DEFAULT_DEV_PORT}).` },
        {
          flags: '--scratch',
          description:
            'Use isolated empty databases, bundled skills, and bundled automations for this session '
            + "instead of the installed app's resources. For fixture work and destructive experiments.",
        },
        {
          flags: '--live-data',
          description:
            'Deprecated: using the installed app\'s real resources is now the default. '
            + 'Accepted as a no-op; use `--scratch` for the old isolated behavior.',
        },
        {
          flags: '--grant-cloud-shell',
          description:
            "Approve a cloudComputer: 'shell' declaration without the interactive prompt. "
            + 'The grant persists for this dev app; authorship alone never grants it.',
        },
      ],
    },
    examples: [
      'notis apps dev',
      'notis apps dev ./my-app',
      'notis apps dev ./workspace --port 5200',
      'notis apps dev --scratch  # isolated resources for fixture or schema experiments',
    ],
    mutates: true,
    idempotent: true,
    require_auth: true,
    backend_call: { type: 'tool', name: ENSURE_DEV_APP_INSTALLATION_TOOL },
    handler: appsDevHandler,
  },
  {
    command_path: ['apps', 'roots', 'list'],
    summary: 'List persistent machine-local Notis app development roots.',
    when_to_use: 'See which folders every local Notis Desktop instance watches for development apps.',
    args_schema: { arguments: [], options: [] },
    examples: ['notis apps roots list'],
    mutates: false,
    idempotent: true,
    require_auth: false,
    backend_call: { type: 'local', name: 'list_app_development_roots' },
    handler: appsRootsListHandler,
  },
  {
    command_path: ['apps', 'roots', 'remove'],
    summary: 'Stop watching a registered Notis app development root.',
    when_to_use: 'Remove a persistent development root. The built-in ~/.notis/apps root cannot be removed.',
    args_schema: {
      arguments: [
        { token: '<folder>', key: 'dir', description: 'Previously registered development root.' },
      ],
      options: [],
    },
    examples: ['notis apps roots remove ./old-apps'],
    mutates: true,
    idempotent: true,
    require_auth: false,
    backend_call: { type: 'local', name: 'remove_app_development_root' },
    handler: appsRootsRemoveHandler,
  },
  {
    command_path: ['apps', 'build'],
    summary: 'Build and package the app into .notis/output/.',
    when_to_use: 'Prepare the app for verification or deployment.',
    args_schema: {
      arguments: [
        { token: '[dir]', key: 'dir', description: 'Project directory (default: current dir).' },
      ],
      options: [],
    },
    examples: ['notis apps build', 'notis apps build ./my-app'],
    mutates: true,
    idempotent: true,
    require_auth: false,
    backend_call: { type: 'local', name: 'next_build_and_package' },
    handler: appsBuildHandler,
  },
  {
    command_path: ['apps', 'verify'],
    summary: 'Validate that every route renders and reports Store listing readiness.',
    when_to_use:
      'Any time after notis apps build, and before deploy. Catches render-time crashes and ' +
      'missing runtime calls. Incomplete listing media is reported as a warning; pass --listing ' +
      'to fail on it instead.',
    args_schema: {
      arguments: [
        { token: '[dir]', key: 'dir', description: 'Project directory (default: current dir).' },
      ],
      options: [
        { flags: '--routes <slugs>', description: 'Comma-separated route slugs. Default: every route in manifest.' },
        { flags: '--port <n>', description: 'Loopback port. Default: auto-pick.' },
        { flags: '--skip-build', description: 'Skip notis apps build; reuse existing .notis/output/.' },
        { flags: '--mode <mode>', description: 'stub | live. Default stub. Live posts to /portal_views/runtime_query with the CLI JWT and fails routes whose runtime calls all errored.' },
        { flags: '--listing', description: 'Fail instead of warn when the Store listing (tagline, categories, screenshots, changelog) is incomplete.' },
        { flags: '--no-browser', description: 'Start the harness server and print URLs; do not drive agent-browser.' },
        { flags: '--keep-open', description: 'Leave server + browser session running after report (for manual triage).' },
      ],
    },
    examples: [
      'notis apps verify',
      'notis apps verify --routes notes',
      'notis apps verify --mode live',
      'notis apps verify --listing  # gate on Store listing readiness before publish',
      'notis apps verify --no-browser  # start the harness, drive agent-browser yourself',
    ],
    mutates: false,
    idempotent: true,
    require_auth: false,
    backend_call: { type: 'local', name: 'verify_harness' },
    handler: appsVerifyHandler,
  },
  {
    command_path: ['apps', 'screenshot'],
    summary: 'Capture configured listing route/scenario states via the headless harness.',
    when_to_use:
      'Generate the 3–6 declared metadata/screenshot-N.png files for the App Store listing. Apps are ' +
      'icon-led (like Raycast) — there is no cover image, only these screenshots. ' +
      'Each screenshot may set a focus selector to remove empty canvas and a light or dark theme that also controls its Store frame. ' +
      'Run before notis apps verify / deploy / publish.',
    args_schema: {
      arguments: [
        { token: '[dir]', key: 'dir', description: 'Project directory (default: current dir).' },
      ],
      options: [
        { flags: '--routes <slugs>', description: 'Comma-separated route slugs. Default: every configured screenshot state.' },
        { flags: '--port <n>', description: 'Loopback port. Default: auto-pick.' },
        { flags: '--width <px>', description: 'Viewport width. Default: 2000.' },
        { flags: '--height <px>', description: 'Viewport height. Default: 1250 (16:10).' },
        { flags: '--output-dir <dir>', description: 'Where to write screenshot-N.png. Default: metadata/.' },
        { flags: '--mode <mode>', description: 'stub | live. Default stub. Live renders against real data via the CLI JWT (requires a linked app), so screenshots show actual content instead of empty states.' },
        { flags: '--raw', description: 'Write the unframed harness capture instead of the default Store presentation.' },
        { flags: '--skip-build', description: 'Skip notis apps build; reuse existing .notis/output/.' },
      ],
    },
    examples: [
      'notis apps screenshot  # honors notis.config.ts screenshot scenarios',
      'notis apps screenshot --routes home,history',
      'notis apps screenshot --mode live  # populated screenshots from real data',
      'notis apps screenshot --raw  # diagnostic capture without Store framing',
    ],
    mutates: true,
    idempotent: true,
    require_auth: false,
    backend_call: { type: 'local', name: 'screenshot_routes' },
    handler: appsScreenshotHandler,
  },
  {
    command_path: ['apps', 'link'],
    summary: 'Link a local project to a remote Notis app.',
    when_to_use: 'Connect a local project to an existing app for deployment.',
    args_schema: {
      arguments: [
        { token: '<app-id>', description: 'Remote app ID to link to.' },
        { token: '[dir]', key: 'dir', description: 'Project directory (default: current dir).' },
      ],
      options: [],
    },
    examples: ['notis apps link abc123', 'notis apps link abc123 ./my-app'],
    mutates: true,
    idempotent: true,
    require_auth: false,
    backend_call: { type: 'local', name: 'write_link_state' },
    handler: appsLinkHandler,
  },
  {
    command_path: ['apps', 'pull'],
    summary: 'Download a Notis app source snapshot into a local project folder.',
    when_to_use:
      'Edit an installed app locally. Preserve any local edits, pull and link the latest persisted source, then increment package.json notisAppVersion above that release before notis apps dev; continue with build and deploy.',
    args_schema: {
      arguments: [
        { token: '<app-id>', description: 'Remote app ID to pull.' },
        { token: '[dir]', key: 'dir', description: 'Target directory (defaults to ~/.notis/apps/<app-slug>).' },
      ],
      options: [
        { flags: '--force', description: 'Overwrite a non-empty target directory.' },
        { flags: '--source-version <n>', description: 'Pull a specific app source version (default: latest).' },
      ],
    },
    examples: [
      'notis apps pull abc123',
      'notis apps pull abc123 ./my-app --force --source-version 3',
    ],
    mutates: true,
    idempotent: true,
    require_auth: true,
    backend_call: { type: 'http', name: 'portal_apps/source' },
    handler: appsPullHandler,
  },
  {
    command_path: ['apps', 'deploy'],
    summary: 'Build and upload the app to the linked Notis app.',
    when_to_use:
      'Ship the installed app to production for the linked user/team app. A project that has only a development app is promoted in place on first deploy: same app id, same databases, dev markers removed. This command does not publish to the app store.',
    args_schema: {
      arguments: [
        { token: '[dir]', key: 'dir', description: 'Project directory (default: current dir).' },
      ],
      options: [
        { flags: '--app-id <id>', description: 'Override linked app ID.' },
        { flags: '--skip-build', description: 'Skip the build step (use existing .notis/output/).' },
        { flags: '--direct', description: 'Explicitly upload to Supabase storage, bypassing the backend server.' },
      ],
    },
    examples: ['notis apps deploy', 'notis apps deploy --skip-build', 'notis apps deploy --app-id abc123', 'notis apps deploy --direct'],
    mutates: true,
    idempotent: true,
    backend_call: { type: 'tool', name: SAVE_APP_FILES_TOOL },
    handler: appsDeployHandler,
  },
  {
    command_path: ['apps', 'publish'],
    summary: 'Submit the deployed app for Store review.',
    when_to_use:
      'After the user explicitly confirms the App Details page and Store listing are ready. Requires the current local project to match the latest deployed version.',
    args_schema: {
      arguments: [
        { token: '[dir]', key: 'dir', description: 'Project directory (default: current dir).' },
      ],
      options: [
        { flags: '--app-id <id>', description: 'Override linked app ID.' },
        { flags: '--confirm-ready', description: 'Confirm the user approved the current App Details page for Store submission.' },
      ],
    },
    examples: ['notis apps publish --confirm-ready', 'notis apps publish ./my-app --confirm-ready'],
    mutates: true,
    idempotent: false,
    require_auth: true,
    backend_call: { type: 'http', name: 'portal_apps/publish' },
    handler: appsPublishHandler,
  },
  {
    command_path: ['apps', 'duplicate'],
    summary: 'Duplicate an app into an independent copy with its own databases.',
    when_to_use:
      'When the same app should run for a second purpose - a notes app for blog drafts alongside one for bookmarks. The copy shares no data with the source.',
    args_schema: {
      arguments: [
        { token: '[dir]', key: 'dir', description: 'Project directory (default: current dir).' },
      ],
      options: [
        { flags: '--app-id <id>', description: 'App to duplicate. Defaults to the app this project is linked to.' },
        { flags: '--name <name>', description: 'Name for the duplicate (default: the source name followed by "copy").' },
        {
          flags: '--copy-documents <mode>',
          description:
            "Which rows to copy: 'declared' (default, the starter content a fresh install would have), 'all', or 'none'.",
        },
      ],
    },
    examples: [
      'notis apps duplicate --name "Blog"',
      'notis apps duplicate --app-id abc123 --name "Bookmarks" --copy-documents none',
    ],
    mutates: true,
    idempotent: false,
    require_auth: true,
    backend_call: { type: 'tool', name: DUPLICATE_APP_TOOL },
    handler: appsDuplicateHandler,
  },
  {
    command_path: ['apps', 'doctor'],
    summary: 'Check project health and readiness.',
    when_to_use: 'Diagnose issues with a Notis app project.',
    args_schema: {
      arguments: [
        { token: '[dir]', key: 'dir', description: 'Project directory (default: current dir).' },
      ],
      options: [],
    },
    examples: ['notis apps doctor', 'notis apps doctor ./my-app'],
    mutates: false,
    idempotent: true,
    require_auth: false,
    backend_call: { type: 'local', name: 'project_health_check' },
    handler: appsDoctorHandler,
  },
];
