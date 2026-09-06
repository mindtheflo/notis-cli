import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';

import { CliError, EXIT_CODES, usageError } from '../runtime/errors.js';
import { formatTable } from '../runtime/output.js';
import { defaultAppProjectDir, resolveProjectDir, loadAppConfig, detectProjectProblems, detectProjectWarnings, buildArtifact, prepareAppRelease, beginAppCreateIntent, appLinkedStateProfileKey, readManifest, readLinkedState, writeLinkedState, requireLinkedAppId, scaffoldProject, findUnknownScreenshotScenarios, inspectListingReadiness, resolveListingScreenshots, collectArtifactFiles, collectSourceFiles, appRowFieldsFromManifest, pullAppSource, writeVerifyStamp } from '../runtime/app-platform.js';
import {
  filterScaffoldCatalog,
  loadScaffoldCatalog,
  scaffoldRegistryLabel,
} from '../runtime/app-registry-scaffolds.js';
import { startAppTestServer } from '../runtime/app-test-server.js';
import {
  captureHarnessScreenshot,
  describeDesignFinding,
  closeAgentBrowserSession,
  isAgentBrowserAvailable,
  runHarnessRoute,
} from '../runtime/agent-browser.js';
import { getAvailablePort } from '../runtime/ports.js';
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

function assertHarnessResult(result, route, databaseSlugs, mode = 'stub', capabilities = {}) {
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
    if (databaseSlug && !declaredDatabaseSet.has(databaseSlug) && capabilities.workspaceDatabases !== 'read') {
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
  if (result.design_tool_error) {
    assertions.push({ ok: false, code: 'design_check_error',
      message: `Route "${route.slug}" could not complete its automated design checks.`,
      details: result.design_tool_error });
  }
  for (const finding of result.design || []) {
    assertions.push({
      ok: false,
      code: 'design_rule_violation',
      message: `Route "${route.slug}": ${describeDesignFinding(finding)}.`,
      details: finding,
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

export async function assertLinkTarget(runtime, appId, runTool = runToolCommand) {
  const result = await runTool({ runtime, toolName: LIST_APPS_TOOL });
  const app = (result.payload?.apps || []).find(app => (app.app_id || app.id) === appId);
  if (!app || app.can_edit !== true) throw usageError(`Cannot edit app ${appId} in this profile.`);

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
      { command: `cd ${projectDir} && notis apps build`, reason: 'Build and verify the app' },
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
  const profileKey = linkedStateProfileKey(ctx.runtime);
  const teamId = ctx.options.teamId || null;
  const name = ctx.args.name.trim();
  const slug = appConfig?.name || slugify(name);
  if (appConfig && (appConfig.title || name) !== name) {
    throw usageError('The app name must match the config display title. Keep the config machine name unchanged.');
  }
  // Capture the intent before listing: overlapping invocations share the same
  // durable key even when neither can yet see the pending remote creation.
  const intent = beginAppCreateIntent([profileKey, name, teamId, slug], ctx.globalOptions.idempotencyKey);
  const idempotencyKey = intent.key;
  const listed = await runToolCommand({ runtime: ctx.runtime, toolName: LIST_APPS_TOOL });
  const validInventory = result => Array.isArray(result.payload?.apps)
    && result.payload.status !== 'error' && result.payload.successful !== false;
  if (!validInventory(listed)) throw usageError('App inventory is unavailable; absence is not proven. No app was created.');
  const apps = listed.payload.apps;
  const linked = projectDir ? readLinkedState(projectDir, profileKey) : null;
  const matchesIdentity = app => app.name === name && app.slug === slug && (app.team_id || null) === teamId;
  let app;
  if (linked?.app_id) {
    app = apps.find(app => (app.app_id || app.id) === linked.app_id);
    if (!app || !matchesIdentity(app)) throw usageError('This directory is linked to a different app identity. Use its exact name, slug and scope.');
  } else {
    const candidates = apps.filter(app => (app.team_id || null) === teamId && (app.name === name || app.slug === slug));
    if (candidates.length > 1 || (candidates.length === 1 && !matchesIdentity(candidates[0]))) {
      throw usageError('Conflicting app name or slug in this scope. Inspect and link the exact intended identity.');
    }
    app = candidates[0];
  }
  if (app && app.can_edit !== true) throw usageError('The matching app is not editable in this profile.');
  const reused = Boolean(app);
  if (!app) {
    const result = await runToolCommand({
      runtime: ctx.runtime, toolName: CREATE_APP_TOOL,
      arguments_: { name, slug, description: appConfig?.description || undefined,
        icon: appConfig?.icon || undefined, accent: appConfig?.accent ?? undefined,
        ...(teamId ? { team_id: teamId } : {}) },
      mutating: true, idempotencyKey,
    });
    if (result.payload?.status === 'error' && result.payload.outcome === 'rejected') {
      // Only this typed, pre-insert rejection proves that the cached key is
      // finished without side effects. Unknown outcomes retain their intent.
      intent.complete();
      throw usageError(result.payload.message || 'App creation was rejected before insertion. Correct the request before retrying.');
    }
    const created = result.payload.app || result.payload;
    const appId = created?.id || created?.app_id;
    const readback = await runToolCommand({ runtime: ctx.runtime, toolName: LIST_APPS_TOOL });
    if (!validInventory(readback)) throw usageError('Creation readback is unavailable. Reconcile the pending creation before retrying.');
    app = readback.payload.apps.find(row => (row.id || row.app_id) === appId);
    if (!app || !matchesIdentity(app) || app.can_edit !== true) {
      throw usageError('Creation outcome could not be reconciled to the exact editable identity. Do not retry blindly.');
    }
  }
  app = { ...app, id: app.id || app.app_id };
  if (projectDir) {
    const state = buildLinkedAppState(linked, app.id);
    writeLinkedState(projectDir, { ...state,
      version: state.version ?? deployedAppVersion(app),
      expected_updated_at: state.version === 0 && deployedAppVersion(app) === 0 ? app.updated_at : state.expected_updated_at ?? app.updated_at,
    }, profileKey);
  }

  intent.complete();
  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: {
      app,
      project_dir: projectDir,
      linked: Boolean(projectDir),
      reused,
      idempotency_key: idempotencyKey,
    },
    humanSummary: projectDir
      ? `${reused ? 'Reused' : 'Created'} app ${app.name || ctx.args.name} (${app.id}) and linked ${projectDir}`
      : `${reused ? 'Reused' : 'Created'} app ${app.name || ctx.args.name} (${app.id})`,
    hints: projectDir
      ? [{ command: `cd ${projectDir} && notis apps deploy .`, reason: 'Deploy the linked project' }]
      : [{ command: `notis apps link ${app.id} .`, reason: 'Link a local project before deploying' }],
    meta: { mutating: true, idempotency_key: idempotencyKey },
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

function installHarnessSignalCleanup(cleanup) {
  let signalOwned = false;
  const handlers = new Map(['SIGINT', 'SIGTERM'].map((signal) => [signal, () => {
    // The first signal owns cleanup and terminal reporting. Keep both listeners
    // installed while it runs so repeated signals cannot bypass or duplicate it.
    if (signalOwned) return;
    signalOwned = true;
    void cleanup().catch((error) => {
      process.stderr.write(`[notis apps] ${error.message}\n`);
    }).finally(() => {
      removeHandlers();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }]));
  const removeHandlers = () => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  };
  for (const [signal, handler] of handlers) process.on(signal, handler);
  return () => { if (!signalOwned) removeHandlers(); };
}

async function closeHarnessResources(sessionNames, testServer, rawOutputDir = null) {
  const outcomes = await Promise.allSettled(sessionNames.map(async (name) => {
    // Closing a named session is idempotent. Retry once, but never silently
    // certify a release when its temporary browser could not be stopped.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (await closeAgentBrowserSession(name).catch(() => false)) return;
    }
    throw new Error(`Browser session ${name} could not be closed`);
  }));
  if (testServer) outcomes.push(...await Promise.allSettled([testServer.close()]));
  if (rawOutputDir) {
    try { rmSync(rawOutputDir, { recursive: true, force: true }); }
    catch (error) { outcomes.push({ status: 'rejected', reason: error }); }
  }
  const errors = outcomes.filter(result => result.status === 'rejected').map(result => result.reason);
  if (errors.length) {
    throw new AggregateError(errors, `Temporary app harness cleanup failed: ${errors.map(error => error.message).join('; ')}`);
  }
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
  let testServer = null;
  let browserTouched = false;

  let cleanupPromise;
  const cleanup = () => (cleanupPromise ||= closeHarnessResources(
    browserTouched ? [browserSessionName] : [], testServer,
  ));
  const removeSignalHandlers = ctx.registerSignalCleanup
    ? ctx.registerSignalCleanup(cleanup)
    : installHarnessSignalCleanup(cleanup);

  try {
    testServer = await startAppTestServer({
      apps: [{
        slug: appSlug,
        projectDir,
        appId: linkedState?.app_id || 'harness-app',
      }],
      port,
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
          manifest.capabilities || appConfig.capabilities || {},
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
          manifest.capabilities || appConfig.capabilities || {},
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
    // Keep standalone verification diagnostics. Deploy always verifies its own
    // frozen snapshot; this report is never authority to skip that check.
    const verifyStamp = writeVerifyStamp(projectDir, {
      ok: overallOk && summary.manual === 0 && summary.total > 0,
      mode,
      summary,
      results,
    });
    const data = {
      status: overallOk ? (summary.manual ? 'manual' : 'passed') : 'failed',
      artifact_hash: verifyStamp.artifact_hash,
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

    if (!keepOpen) await cleanup();
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
    try { await cleanup(); }
    finally { removeSignalHandlers(); }
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
  let testServer = null;
  let browserTouched = false;

  let cleanupPromise;
  const cleanup = () => (cleanupPromise ||= closeHarnessResources(
    browserTouched ? browserSessionNames : [], testServer, rawOutputDir,
  ));
  const removeSignalHandlers = installHarnessSignalCleanup(cleanup);

  try {
    testServer = await startAppTestServer({
      apps: [{ slug: appSlug, projectDir, appId: linkedState?.app_id || 'harness-app' }],
      port,
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

    await cleanup();
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
    try { await cleanup(); }
    finally { removeSignalHandlers(); }
  }
}

export function buildLinkedAppState(existingState, appId, linkedAt = new Date().toISOString()) {
  return { ...(existingState?.app_id === appId ? existingState : {}), app_id: appId, linked_at: linkedAt };
}

async function appsLinkHandler(ctx) {
  const projectDir = resolveProjectDir(ctx.args.dir || '.');
  const appId = ctx.args.appId;
  const expectedVersion = ctx.options.expectedVersion === undefined ? null : Number(ctx.options.expectedVersion);
  if (expectedVersion !== null && (!/^\d+$/.test(String(ctx.options.expectedVersion)) || !Number.isSafeInteger(expectedVersion))) {
    throw usageError('--expected-version must be a non-negative integer.');
  }

  const app = await assertLinkTarget(ctx.runtime, appId);

  const profileKey = linkedStateProfileKey(ctx.runtime);
  const state = buildLinkedAppState(readLinkedState(projectDir, profileKey), appId);
  const version = deployedAppVersion(app);
  if (expectedVersion !== null && version !== expectedVersion) {
    throw usageError('The app release changed before linking. Preserve local source, pull the current release into a fresh directory, and reapply changes before deploying.');
  }
  if (state.version !== undefined && state.version !== version) {
    throw usageError('A different release exists. Pull current source into a fresh directory and reapply local changes before deploying.');
  }
  if (!app.updated_at) throw usageError('App revision is unavailable; the directory was not relinked.');
  writeLinkedState(projectDir, { ...state, version, expected_updated_at: app.updated_at }, profileKey);

  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: { app_id: appId, project_dir: projectDir, version, expected_updated_at: app.updated_at },
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
    // Pull is source retrieval plus local link state. LIST_APPS is deliberately
    // non-materializing; GET_APP hydrates missing declared databases and would
    // turn a read-only pull into a remote mutation before build/verification.
    toolName: LIST_APPS_TOOL,
  });
  if (
    ctx.runtime.credentialKind === 'oauth'
    && !await ensureFreshOAuthCredential(ctx.runtime)
  ) {
    throw usageError('Pulling app source requires a current OAuth grant. Run `notis login` and retry.');
  }
  const apps = Array.isArray(result.payload?.apps) ? result.payload.apps : [];
  const app = apps.find((candidate) => (candidate?.app_id || candidate?.id) === appId);
  if (!app) {
    throw usageError(`App ${appId} is not accessible to the active profile.`);
  }
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
    expectedUpdatedAt: app.updated_at,
  });

  const versionLabel = pulled.version === 'latest' ? 'latest version' : `v${pulled.version}`;
  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: {
      app_id: appId,
      project_dir: pulled.projectDir,
      version: pulled.version,
    },
    humanSummary: `Pulled ${versionLabel} to ${pulled.projectDir}. Run npm install, edit the source, then build, verify and deploy the update.`,
  });
}

function updateLinkedDeployState(projectDir, linkedState, appId, version, profileKey = null, updatedAt = null) {
  if (!linkedState || linkedState.app_id !== appId || !Number.isFinite(version)) {
    return;
  }
  writeLinkedState(projectDir, {
    ...linkedState,
    app_id: appId,
    version,
    linked_at: linkedState.linked_at || new Date().toISOString(),
    deployed_at: new Date().toISOString(),
    expected_updated_at: updatedAt,
  }, profileKey);
}

async function appsDeployHandler(ctx) {
  const projectDir = resolveProjectDir(ctx.args.dir || '.');
  const profileKey = linkedStateProfileKey(ctx.runtime);
  const appId = requireLinkedAppId(projectDir, ctx.options.appId, profileKey);
  const idempotencyKey = nextIdempotencyKey(ctx.globalOptions);
  const linkedState = readLinkedState(projectDir, profileKey);
  const baseVersion = linkedState?.app_id === appId && Number.isFinite(linkedState?.version)
    ? linkedState.version
    : undefined;

  if (!Number.isInteger(baseVersion) || baseVersion < 0 || !linkedState?.expected_updated_at) {
    throw usageError('Deploy requires a current profile-scoped app link and deployment base. Pull the current release, or link an unreleased app first.');
  }

  // Build if needed
  if (!ctx.options.skipBuild) {
    await buildArtifact(projectDir, {
      stdio: ctx.output.isMachineMode() ? 'pipe' : 'inherit',
    });
  }

  const release = prepareAppRelease(projectDir);
  const { files, sourceFiles, manifest } = release;
  let cleanupVerification = async () => {};
  let uploadStarted = false;
  let cancelled = false;
  const removeDeploySignalHandlers = installHarnessSignalCleanup(async () => {
    cancelled = true;
    const cleanupErrors = [];
    try { await cleanupVerification(); }
    catch (error) { cleanupErrors.push(error.message); }
    finally {
      try { release.close(); } catch (error) { cleanupErrors.push(error.message); }
    }
    ctx.output.emitError({ command: 'apps deploy', error: new CliError({
      code: uploadStarted ? 'app_deploy_outcome_unknown' : 'app_deploy_cancelled',
      message: uploadStarted
        ? 'Deployment interrupted. Read back the exact app/version before retrying.'
        : 'Deployment interrupted before upload; no update was deployed.',
      retryable: false, exitCode: EXIT_CODES.network,
      details: { app_id: appId, base_version: baseVersion,
        target_version: baseVersion + 1, idempotency_key: idempotencyKey,
        activation_outcome: uploadStarted ? 'unknown' : 'not_started',
        ...(cleanupErrors.length ? { cleanup_errors: cleanupErrors } : {}) },
      hints: uploadStarted
        ? [{ command: 'notis apps list --json', reason: 'Reconcile the interrupted deployment' }]
        : [],
    }) });
  });
  try {
    let verification;
    const verifyOutput = {
      ...ctx.output,
      emitSuccess: (result) => { verification = result; },
      isMachineMode: () => true,
    };
    const verified = await appsVerifyHandler({
      ...ctx, args: { dir: release.projectDir },
      options: { skipBuild: true, mode: 'stub' }, output: verifyOutput,
      registerSignalCleanup: (cleanup) => {
        cleanupVerification = cleanup;
        return () => { cleanupVerification = async () => {}; };
      },
    }).catch(async (error) => {
      // The signal handler also awaits verification cleanup. If that shared
      // promise rejects, it still owns the single structured terminal outcome.
      if (cancelled) return await new Promise(() => {});
      throw error;
    });
    if (verified !== EXIT_CODES.ok || verification?.data?.status !== 'passed' || verification?.data?.summary?.passed < 1) {
      throw usageError('App verification failed; no update was deployed. Run notis apps verify for details.');
    }


    // The signal handler owns terminal reporting and exit. A cancellation
    // during verification cleanup must never continue into the mutation.
    if (cancelled) return await new Promise(() => {});

    // Upload uses captured bytes only. Fail closed on a staging identity swap
    // before any remote mutation, and finish local cleanup before activation.
    release.close();

    let result;
    try {
      uploadStarted = true;
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
          base_version: baseVersion,
          expected_updated_at: linkedState.expected_updated_at,
        },
        mutating: true,
        idempotencyKey,
      });
    } catch (error) {
      if (error.code === 'conflict') {
        throw toolConflictToError(error.details, 'Deploy conflict');
      }

      // Transport failure may arrive after commit. Never replay an uncertain release.
      if (error.code === 'network_timeout' || error.code === 'network_error') {
        error.message = `${error.message}. Deployment outcome is unknown; read back the exact app/version before any retry.`;
        error.retryable = false;
        error.details = { ...error.details, app_id: appId, base_version: baseVersion,
          target_version: baseVersion + 1, idempotency_key: idempotencyKey };
        error.hints = [{ command: 'notis apps list --json', reason: `Read back app ${appId} and reconcile the deployment outcome` }];
      }
      throw error;
    }

    const deployedVersion = Number(result?.payload?.version);
    if (!Number.isInteger(deployedVersion) || deployedVersion !== baseVersion + 1 || result.payload.app_id !== appId || !result.payload.updated_at) {
      throw new CliError({
        code: 'network_error',
        message: 'The backend returned an incomplete deploy response. The deploy may have committed; inspect the app version and pull before retrying.',
        exitCode: EXIT_CODES.network,
        retryable: false,
        details: { app_id: appId, base_version: baseVersion, target_version: baseVersion + 1, idempotency_key: idempotencyKey },
        hints: [{ command: 'notis apps list --json', reason: 'Reconcile the incomplete deployment response' }],
      });
    }

    const warnings = [];
    try { updateLinkedDeployState(projectDir, linkedState, appId, deployedVersion, profileKey, result.payload.updated_at); }
    catch { warnings.push('The app was updated, but the local link could not be saved. Pull the installed version before editing again.'); }
    try { release.close(); }
    catch { warnings.push('The app was updated, but the temporary release directory needs local cleanup.'); }

    return ctx.output.emitSuccess({
      command: ctx.spec.command_path.join(' '),
      data: {
        app_id: appId,
        version: deployedVersion,
        idempotency_key: idempotencyKey,
      },
      warnings,
      humanSummary: `Deployed to app ${appId} (version ${deployedVersion})`,
      meta: { mutating: true, idempotency_key: idempotencyKey },
    });
  } finally {
    removeDeploySignalHandlers();
    try { release.close(); } catch { /* Do not mask a committed or unknown release. */ }
  }
}

function deployedAppVersion(app) {
  const value = app?.current_version ?? app?.manifest?.version;
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw usageError('The app returned an invalid deployment version.');
  return parsed;
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
      options: [{ flags: '--team-id <id>', description: 'Create or reuse the exact team-scoped app (default: personal).' }],
    },
    examples: [
      'notis apps create "My App"',
      'notis apps create "My App" .',
    ],
    mutates: true,
    idempotent: true,
    backend_call: { type: 'tool', name: CREATE_APP_TOOL },
    handler: appsCreateHandler,
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
      options: [
        { flags: '--expected-version <version>', description: 'Link only if the remote deployment version still matches this non-negative integer.' },
      ],
    },
    examples: ['notis apps link abc123', 'notis apps link abc123 ./my-app', 'notis apps link abc123 ./recovered-app --expected-version 0'],
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
      'Edit an installed app. Preserve local edits, pull and link its persisted source, then build, verify and deploy.',
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
    summary: 'Build, verify and release the linked Workspace app.',
    when_to_use:
      'Build, verify and release the linked personal or team Workspace app. This command does not publish to the Store.',
    args_schema: {
      arguments: [
        { token: '[dir]', key: 'dir', description: 'Project directory (default: current dir).' },
      ],
      options: [
        { flags: '--app-id <id>', description: 'Override linked app ID.' },
        { flags: '--skip-build', description: 'Reuse unchanged build output; automated verification still runs.' },
      ],
    },
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
