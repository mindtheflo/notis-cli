/**
 * App platform utilities for the Notis CLI.
 *
 * Handles project scaffolding, validation, building, and linking. This is the
 * CLI-side counterpart to @notis/sdk -- it reads notis.config.ts, runs the
 * Vite build, and packages the bundle for deployment.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, constants as fsConstants, copyFileSync, cpSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { usageError } from './errors.js';
import { acquireScaffoldSource, loadScaffoldCatalog } from './app-registry-scaffolds.js';
import { validateArtifactBoundary, validateProjectBoundary } from './app-boundary-validator.js';
import { CHANGELOG_MERGE_DATE, readAppChangelog } from './app-changelog.js';

const NOTIS_DIR = '.notis';
const STATE_FILE = join(NOTIS_DIR, 'state.json');
const OUTPUT_DIR = join(NOTIS_DIR, 'output');
const BUNDLE_DIR = join(OUTPUT_DIR, 'bundle');
const MANIFEST_FILE = join(OUTPUT_DIR, 'manifest.json');
const METADATA_DIR = 'metadata';
const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE_SDK_DIR = join(CLI_ROOT, 'template', 'packages', 'sdk');
export const NOTIS_APP_CATEGORIES = [
  'Productivity',
  'Sales & Marketing',
  'Operations',
  'Product & Engineering',
  'Personal',
];
export const MIN_LISTING_SCREENSHOTS = 3;
const SOURCE_COPY_EXCLUDES = new Set([
  'node_modules',
  '.notis',
  '.git',
  'dist',
  'tsconfig.tsbuildinfo',
  '.DS_Store',
  // Interpreter droppings: a stray `python -m py_compile` in a skill's
  // scripts/ directory must not ship version-specific bytecode in the bundle.
  '__pycache__',
]);
const SOURCE_COPY_EXCLUDES_CASEFOLDED = new Set(
  [...SOURCE_COPY_EXCLUDES].map((name) => name.toLocaleLowerCase('en-US')),
);
const SCAFFOLD_COPY_EXCLUDES = new Set([
  ...SOURCE_COPY_EXCLUDES,
  'coverage',
  '.next',
  '.turbo',
]);
// Listing media describes the scaffold's own Store entry, so a new project must
// never inherit it. Scaffold packaging still ships these files -- only the
// `apps init` copy drops them. Screenshots only: `screenshot-fixtures.json` is
// not listing media, it is the stub data the dev harness serves, and dropping
// it would make every route of a fresh project render its empty state.
const SCAFFOLD_LISTING_MEDIA = /^metadata\/screenshot-\d+\.png$/i;
const PULL_LOCK_TIMEOUT_MS = 30_000;
const PULL_LOCK_POLL_MS = 25;
const STATE_WRITE_LOCK_TIMEOUT_MS = 5_000;
const STATE_WRITE_LOCK_STALE_MS = 2_000;
const stateWriteLockWait = new Int32Array(new SharedArrayBuffer(4));
// A directory-declared skill ships every supporting file to the sandbox, so it
// needs a ceiling of its own. Kept well above the 512 KB SKILL.md limit so a
// handful of scripts always fits, and far below the bundle machinery's own
// limits so an accidental asset dump fails on the client with a clear message.
export const MAX_APP_SKILL_BUNDLE_BYTES = 5 * 1024 * 1024;
let appConfigImportNonce = 0;

// ---------------------------------------------------------------------------
// Project directory resolution
// ---------------------------------------------------------------------------

// Every Notis app the user did not deliberately place lives here, mirroring the
// desktop's synced-skills root (~/.notis/skills). A default that depends on the
// caller's working directory is unusable for agents: the shell sits wherever
// the previous command left it, so `apps init` would scatter projects into
// unrelated checkouts. Pass an explicit [dir] to override -- that is how an app
// ends up in a tracked git repo or an existing monorepo.
export const DEFAULT_APPS_ROOT = join(homedir(), NOTIS_DIR, 'apps');

export function defaultAppProjectDir(slug) {
  const safeSlug = String(slug || '').trim();
  if (!safeSlug || safeSlug.includes('/') || safeSlug.includes('\\') || safeSlug.startsWith('.')) {
    throw usageError(`Cannot derive a default project directory from "${slug}". Pass an explicit target directory.`);
  }
  return join(DEFAULT_APPS_ROOT, safeSlug);
}

// A `~/...` path only expands when a shell is involved. Agents routinely spawn
// the CLI without one, and the documented default home is written with a tilde,
// so expand it here instead of creating a literal "~" directory.
export function expandHomePath(inputPath) {
  const value = String(inputPath ?? '');
  if (value === '~') {
    return homedir();
  }
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

export function resolveProjectDir(inputDir = '.') {
  return resolve(process.cwd(), expandHomePath(inputDir));
}

export function getBundleDir(projectDir) {
  return join(projectDir, BUNDLE_DIR);
}

export function resolveBuiltBundleDir(projectDir) {
  const bundleDir = getBundleDir(projectDir);
  if (existsSync(join(bundleDir, 'app.js'))) {
    return bundleDir;
  }
  return null;
}

function normalizeShadowScopedCss(css) {
  return css
    // Tailwind preflight emits `html,:host` in v3. Inside a shadow tree we want
    // the shadow host itself to carry those defaults.
    .replace(/html\s*,\s*:host\s*\{/g, ':host{')
    .replace(/:root\s*,\s*:host\s*\{/g, ':host{')
    .replace(/:root\s*\{/g, ':host{')
    .replace(/html\s*\{/g, ':host{')
    // Shadow trees do not contain a body element. Route those defaults to the
    // app root contract instead so authors still get the expected reset.
    .replace(/body\s*\{/g, '[data-notis-app-root]{');
}

function normalizeBundleStylesheets(projectDir) {
  const bundleDir = join(projectDir, BUNDLE_DIR);
  if (!existsSync(bundleDir)) {
    return;
  }

  for (const entry of readdirSync(bundleDir)) {
    if (!entry.endsWith('.css')) {
      continue;
    }
    const cssPath = join(bundleDir, entry);
    const normalizedCss = normalizeShadowScopedCss(readFileSync(cssPath, 'utf-8'));
    writeFileSync(cssPath, normalizedCss);
  }
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Load and parse notis.config.ts from a project directory. Uses a simple
 * approach: we read the file, transpile with the project's TypeScript compiler
 * when available, then evaluate as ESM.
 */
function stripNotisSdkImports(source) {
  return source
    .replace(/import\s+type\s+[\s\S]*?from\s+['"][^'"]*['"]\s*;?/g, '')
    .replace(/import\s*{[\s\S]*?\bdefineNotisApp\b[\s\S]*?}\s+from\s+['"]@notis\/sdk\/config['"]\s*;?/g, '')
    .replace(/defineNotisApp\s*\(/g, '(');
}

function transpileTsConfigSource(source, configPath) {
  // Strip the @notis/sdk/config import unconditionally. The SDK package often
  // points its `exports` at raw .ts source, which Node cannot import from the
  // temp .mjs file we emit below. `defineNotisApp` is just an identity helper,
  // so removing the import and replacing the call with a parens-wrapped
  // expression preserves the config value without ever resolving the SDK.
  const stripped = stripNotisSdkImports(source);
  const requireFromConfig = createRequire(`file://${configPath}`);
  try {
    const ts = requireFromConfig('typescript');
    const transpiled = ts.transpileModule(stripped, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: configPath,
    });
    return transpiled.outputText;
  } catch {
    return stripped;
  }
}

export async function loadAppConfig(projectDir) {
  const configPaths = ['notis.config.ts', 'notis.config.js', 'notis.config.mjs'];
  let configPath = null;

  for (const name of configPaths) {
    const candidate = join(projectDir, name);
    if (existsSync(candidate)) {
      configPath = candidate;
      break;
    }
  }

  if (!configPath) {
    throw usageError('No notis.config.ts found in project directory.');
  }

  // For .js/.mjs files, import directly. For .ts, we need transpilation.
  if (configPath.endsWith('.ts')) {
    const source = readFileSync(configPath, 'utf-8');
    const jsSource = transpileTsConfigSource(source, configPath);

    const tmpPath = join(dirname(configPath), '._notis_config_tmp.mjs');
    mkdirSync(dirname(tmpPath), { recursive: true });
    writeFileSync(tmpPath, jsSource);
    try {
      const mod = await import(`file://${tmpPath}?v=${appConfigImportNonce++}`);
      return mod.default || mod;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw usageError(
          `Failed to parse ${configPath}. Install project dependencies (including typescript) ` +
          'or convert the config to plain JavaScript.',
        );
      }
      throw error;
    } finally {
      try {
        const { unlinkSync } = await import('node:fs');
        unlinkSync(tmpPath);
      } catch {}
    }
  }

  const mod = await import(`file://${configPath}`);
  return mod.default || mod;
}

// ---------------------------------------------------------------------------
// Project validation
// ---------------------------------------------------------------------------

export function detectProjectProblems(projectDir) {
  const problems = [];

  if (!existsSync(join(projectDir, 'package.json'))) {
    problems.push('Missing package.json');
  }

  const hasViteConfig = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']
    .some((name) => existsSync(join(projectDir, name)));
  if (!hasViteConfig) {
    problems.push('Missing vite.config file');
  }

  if (!existsSync(join(projectDir, 'app'))) {
    problems.push('Missing app/ directory');
  }

  const hasNotisConfig = ['notis.config.ts', 'notis.config.js', 'notis.config.mjs']
    .some((name) => existsSync(join(projectDir, name)));
  if (!hasNotisConfig) {
    problems.push('Missing notis.config.ts');
  }

  return problems;
}

export function detectProjectWarnings(projectDir, appConfig = null) {
  const warnings = [];

  if (!existsSync(join(projectDir, 'components.json'))) {
    warnings.push('Missing components.json -- shadcn is not configured.');
  }

  const hasTailwind = ['tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.cjs']
    .some((name) => existsSync(join(projectDir, name)));
  if (!hasTailwind) {
    warnings.push('Missing Tailwind config.');
  }

  const readsWorkspaceDatabases =
    appConfig?.capabilities?.workspaceDatabases === 'read';
  if (
    appConfig
    && !readsWorkspaceDatabases
    && (!Array.isArray(appConfig.databases) || appConfig.databases.length === 0)
  ) {
    warnings.push('No database references declared in notis.config.ts.');
  }

  if (appConfig) {
    try {
      const listing = inspectListingReadiness(projectDir, appConfig);
      warnings.push(...listing.errors, ...listing.warnings);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  return warnings;
}

function safeKebab(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function jsStringLiteral(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function normalizeCategories(categories = []) {
  if (!Array.isArray(categories)) {
    return [];
  }
  const allowed = new Set(NOTIS_APP_CATEGORIES);
  const normalized = [];
  for (const category of categories) {
    if (typeof category !== 'string' || !category.trim()) {
      continue;
    }
    const trimmed = category.trim();
    if (!allowed.has(trimmed)) {
      throw usageError(
        `Invalid Notis app category "${trimmed}". Use one of: ${NOTIS_APP_CATEGORIES.join(', ')}.`,
      );
    }
    if (!normalized.includes(trimmed)) {
      normalized.push(trimmed);
    }
  }
  return normalized;
}

function pngDimensions(buffer) {
  const signature = '89504e470d0a1a0a';
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== signature) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function imageAssetMeta(projectDir, relPath, { maxBytes }) {
  const fullPath = join(projectDir, relPath);
  const content = readFileSync(fullPath);
  const dimensions = pngDimensions(content);
  const errors = [];
  const warnings = [];

  if (!relPath.toLowerCase().endsWith('.png')) {
    errors.push(`${relPath} must be a PNG file.`);
  }
  if (content.length > maxBytes) {
    errors.push(`${relPath} must be ${Math.round(maxBytes / 1024 / 1024)} MB or smaller.`);
  }
  if (!dimensions) {
    errors.push(`${relPath} is not a valid PNG file.`);
  } else if (dimensions.width !== 2000 || dimensions.height !== 1250) {
    errors.push(`${relPath} must be exactly 2000x1250 pixels.`);
  }

  return {
    path: relPath,
    content_type: 'image/png',
    bytes: content.length,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    errors,
    warnings,
  };
}

export function discoverMetadataAssets(projectDir) {
  const metadataDir = join(projectDir, METADATA_DIR);
  const screenshots = [];

  if (existsSync(metadataDir)) {
    for (const entry of readdirSync(metadataDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const match = /^screenshot-(\d+)\.png$/i.exec(entry.name);
      if (!match) continue;
      screenshots.push({
        index: Number.parseInt(match[1], 10),
        ...imageAssetMeta(projectDir, join(METADATA_DIR, entry.name), {
          maxBytes: 2 * 1024 * 1024,
        }),
      });
    }
  }

  screenshots.sort((a, b) => a.index - b.index);
  return {
    screenshots: screenshots.slice(0, 6),
  };
}

function normalizeConfiguredScreenshots(appConfig = null) {
  if (!Array.isArray(appConfig?.screenshots) || appConfig.screenshots.length === 0) {
    return null;
  }
  if (appConfig.screenshots.length > 6) {
    throw usageError('Configure at most six listing screenshots.');
  }

  const seenPaths = new Set();
  return appConfig.screenshots.map((entry, index) => {
    const path = typeof entry?.path === 'string' ? entry.path.trim().replace(/\\/g, '/') : '';
    const alt = typeof entry?.alt === 'string' ? entry.alt.trim() : '';
    const route = typeof entry?.route === 'string' ? entry.route.trim() : '';
    const scenario = typeof entry?.scenario === 'string' ? entry.scenario.trim() : '';
    const focus = typeof entry?.focus === 'string' ? entry.focus.trim() : '';
    const theme = typeof entry?.theme === 'string' ? entry.theme.trim().toLowerCase() : '';
    if (!/^metadata\/screenshot-\d+\.png$/i.test(path)) {
      throw usageError(`screenshots[${index}].path must match metadata/screenshot-N.png.`);
    }
    const expectedPath = `metadata/screenshot-${index + 1}.png`;
    if (path !== expectedPath) {
      throw usageError(`screenshots[${index}].path must be ${expectedPath} so capture order stays stable.`);
    }
    if (seenPaths.has(path)) {
      throw usageError(`Duplicate listing screenshot path: ${path}`);
    }
    if (theme && theme !== 'light' && theme !== 'dark') {
      throw usageError(`screenshots[${index}].theme must be light or dark.`);
    }
    seenPaths.add(path);
    return {
      path,
      alt,
      route: route || null,
      scenario: scenario || null,
      focus: focus || null,
      theme: theme || 'light',
    };
  });
}

/** Resolve listing screenshot files in their configured editorial order. */
export function resolveListingScreenshots(projectDir, appConfig = null) {
  const discovered = discoverMetadataAssets(projectDir).screenshots;
  const configured = normalizeConfiguredScreenshots(appConfig);
  if (!configured) {
    return discovered.map((asset) => ({
      ...asset,
      alt: null,
      route: null,
      scenario: null,
      focus: null,
      theme: 'light',
    }));
  }

  const byPath = new Map(discovered.map((asset) => [asset.path.replace(/\\/g, '/'), asset]));
  return configured.map((entry) => {
    const asset = byPath.get(entry.path);
    if (!asset) {
      return {
        ...entry,
        content_type: 'image/png',
        bytes: null,
        width: null,
        height: null,
        errors: [`${entry.path} is configured but the file does not exist.`],
        warnings: [],
      };
    }
    return { ...asset, ...entry };
  });
}

/**
 * Screenshot scenarios named in notis.config.ts that metadata/screenshot-fixtures.json
 * does not define. A missing scenario is silent at capture time -- the harness
 * simply falls back to the default fixtures -- so it is reported as a warning.
 */
export function findUnknownScreenshotScenarios(projectDir, screenshots = []) {
  const named = screenshots.filter((entry) => entry?.scenario);
  if (named.length === 0) {
    return [];
  }
  const fixturesPath = join(projectDir, METADATA_DIR, 'screenshot-fixtures.json');
  if (!existsSync(fixturesPath)) {
    return ['metadata/screenshot-fixtures.json is missing, so screenshot scenarios cannot be applied.'];
  }
  let defined;
  try {
    const parsed = JSON.parse(readFileSync(fixturesPath, 'utf-8'));
    const scenarios = parsed?.scenarios && typeof parsed.scenarios === 'object' ? parsed.scenarios : {};
    defined = new Set(Object.keys(scenarios));
  } catch {
    return ['metadata/screenshot-fixtures.json is not valid JSON, so screenshot scenarios cannot be applied.'];
  }
  const warnings = [];
  for (const entry of named) {
    if (!defined.has(entry.scenario)) {
      warnings.push(
        `${entry.path} names scenario "${entry.scenario}", which metadata/screenshot-fixtures.json does not define.`,
      );
    }
  }
  return warnings;
}

export function inspectListingReadiness(projectDir, appConfig = null) {
  const config = appConfig || {};
  const warnings = [];
  const errors = [];
  const screenshots = resolveListingScreenshots(projectDir, config);
  const metadata = { screenshots };
  const categories = normalizeCategories(config.categories || []);
  const changelog = readAppChangelog(projectDir);
  errors.push(...changelog.errors);

  const packagePath = join(projectDir, 'package.json');
  if (!existsSync(packagePath)) {
    errors.push('package.json is required for Store publication.');
  } else {
    try {
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
      const notisAppVersion = String(packageJson.notisAppVersion || '').trim();
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(notisAppVersion)) {
        errors.push('package.json must include a semver `notisAppVersion` (for example, "0.1.0").');
      }
    } catch {
      errors.push('package.json must contain valid JSON for Store publication.');
    }
  }

  if (!String(config.tagline || '').trim()) {
    errors.push('Listing tagline missing in notis.config.ts.');
  }
  if (categories.length === 0) {
    errors.push(`Listing category missing in notis.config.ts. Use one of: ${NOTIS_APP_CATEGORIES.join(', ')}.`);
  }
  if (metadata.screenshots.length < MIN_LISTING_SCREENSHOTS) {
    errors.push(`Listing screenshots: ${metadata.screenshots.length}/${MIN_LISTING_SCREENSHOTS} minimum in metadata/screenshot-N.png. Run \`notis apps screenshot\` to generate them.`);
  }
  for (const screenshot of metadata.screenshots) {
    errors.push(...screenshot.errors);
    warnings.push(...screenshot.warnings);
    if (!screenshot.alt) {
      errors.push(`${screenshot.path} is missing descriptive alt text in notis.config.ts -> screenshots.`);
    }
  }

  return {
    ready:
      errors.length === 0 &&
      Boolean(String(config.tagline || '').trim()) &&
      categories.length > 0 &&
      metadata.screenshots.length >= MIN_LISTING_SCREENSHOTS &&
      metadata.screenshots.every((screenshot) => Boolean(screenshot.alt)) &&
      changelog.entries.length > 0,
    warnings,
    errors,
    metadata,
    categories,
    changelog,
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export async function runProjectScript({ projectDir, scriptName, env = {}, stdio = 'inherit' }) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('npm', ['run', scriptName], {
      cwd: projectDir,
      stdio,
      env: { ...process.env, ...env },
    });
    let capturedOutput = '';
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('data', (chunk) => {
        capturedOutput += chunk.toString();
      });
    }
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      const detail = capturedOutput.trim();
      rejectPromise(
        new Error(
          `npm run ${scriptName} failed with exit code ${code}${detail ? `:\n${detail}` : ''}`,
        ),
      );
    });
  });
}

/**
 * Derive an export name from a route path.
 * '/' -> 'index', '/inbox' -> 'inbox', '/my-tasks' -> 'myTasks'
 */
export function exportNameFromPath(routePath) {
  if (routePath === '/') return 'index';
  const slug = routePath.replace(/^\//, '').replace(/\//g, '-');
  const identifier = slug
    .split(/[^A-Za-z0-9_$]+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (index === 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
  if (!identifier) return 'route';
  return /^[A-Za-z_$]/.test(identifier) ? identifier : `r${identifier}`;
}

function slugFromPath(routePath) {
  if (routePath === '/') return 'index';
  return routePath.replace(/^\//, '').replace(/\//g, '-');
}

/**
 * Auto-detect routes from the app/ directory by scanning for page.tsx files.
 */
function autoDetectRoutes(projectDir) {
  const appDir = join(projectDir, 'app');
  const routes = [];

  function scan(dir, pathPrefix) {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

      if (entry.isDirectory()) {
        scan(join(dir, entry.name), `${pathPrefix}/${entry.name}`);
      } else if (entry.name === 'page.tsx' || entry.name === 'page.jsx' || entry.name === 'page.js') {
        const routePath = pathPrefix || '/';
        const slug = slugFromPath(routePath);
        routes.push({
          path: routePath,
          slug,
          name: slug === 'index' ? 'Home' : slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          default: routePath === '/',
          export_name: exportNameFromPath(routePath),
        });
      }
    }
  }

  scan(appDir, '');
  return routes;
}

function validateConfiguredRoutes(routes) {
  if (routes.length === 0) {
    return;
  }

  const slugSet = new Set();
  let defaultCount = 0;

  for (const route of routes) {
    if (!route.slug || typeof route.slug !== 'string') {
      throw usageError(`Route "${route.path}" must define a slug.`);
    }
    if (slugSet.has(route.slug)) {
      throw usageError(`Duplicate route slug "${route.slug}".`);
    }
    slugSet.add(route.slug);
    if (route.default) {
      defaultCount += 1;
    }
    if (route.resourceDeepLinks !== undefined && typeof route.resourceDeepLinks !== 'boolean') {
      throw usageError(`Route "${route.slug}" resourceDeepLinks must be a boolean.`);
    }
  }

  if (defaultCount !== 1) {
    throw usageError(`Expected exactly one default route, received ${defaultCount}.`);
  }

  for (const route of routes) {
    if (route.parentSlug && !slugSet.has(route.parentSlug)) {
      throw usageError(
        `Route "${route.slug}" references unknown parentSlug "${route.parentSlug}".`,
      );
    }
    const collection = route.collection || null;
    if (
      collection?.sidebar?.mode === 'tree' &&
      (!collection.parentProperty || typeof collection.parentProperty !== 'string')
    ) {
      throw usageError(
        `Tree collection route "${route.slug}" must define collection.parentProperty.`,
      );
    }
  }

  const childrenByParent = new Map();
  for (const route of routes) {
    if (!route.parentSlug) {
      continue;
    }
    const children = childrenByParent.get(route.parentSlug) || [];
    children.push(route.slug);
    childrenByParent.set(route.parentSlug, children);
  }

  for (const route of routes) {
    const seen = new Set([route.slug]);
    let current = route.parentSlug || null;
    while (current) {
      if (seen.has(current)) {
        throw usageError(`Route parent cycle detected at "${route.slug}".`);
      }
      seen.add(current);
      current = routes.find((candidate) => candidate.slug === current)?.parentSlug || null;
    }
  }

  for (const route of routes) {
    if (
      route.collection?.sidebar?.mode === 'tree' &&
      (childrenByParent.get(route.slug) || []).length > 0
    ) {
      throw usageError(
        `Tree collection route "${route.slug}" cannot also define static child routes.`,
      );
    }
  }
}

function resolveConfiguredRoutes(appConfig, projectDir) {
  const configuredRoutes = Array.isArray(appConfig.routes) ? appConfig.routes : [];
  validateConfiguredRoutes(configuredRoutes);
  const routes = configuredRoutes.map((route) => ({
    ...route,
    slug: route.slug,
    export_name: route.exportName || route.export_name || exportNameFromPath(route.path),
  }));
  return routes.length > 0 ? routes : autoDetectRoutes(projectDir);
}

/**
 * Generate the _entry.tsx file that re-exports each route's page component.
 */
function generateEntryFile(projectDir, routes) {
  const entryDir = join(projectDir, NOTIS_DIR);
  mkdirSync(entryDir, { recursive: true });

  // Also re-export the layout if it exists
  const lines = [];
  const layoutPath = join(projectDir, 'app', 'layout.tsx');
  if (existsSync(layoutPath)) {
    lines.push(`export { default as __AppShell } from '../app/layout';`);
  }

  for (const route of routes) {
    const pagePath = route.path === '/' ? '../app/page' : `../app${route.path}/page`;
    lines.push(`export { default as ${route.export_name} } from '${pagePath}';`);
  }

  const entryPath = join(entryDir, '_entry.tsx');
  writeFileSync(entryPath, lines.join('\n') + '\n');
  return entryPath;
}

export async function prepareArtifactBuild(projectDir) {
  validateProjectBoundary(projectDir);
  const appConfig = await loadAppConfig(projectDir);
  const detectedRoutes = resolveConfiguredRoutes(appConfig, projectDir);

  generateEntryFile(projectDir, detectedRoutes);

  const manifest = generateManifest(appConfig, projectDir);
  const manifestPath = join(projectDir, MANIFEST_FILE);
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  return { appConfig, manifest, routes: detectedRoutes };
}

/**
 * Generate the manifest from app config and build output.
 */
export function generateManifest(appConfig, projectDir) {
  const routes = resolveConfiguredRoutes(appConfig, projectDir).map((route) => {
    const entry = {
      path: route.path,
      slug: route.slug,
      name: route.name,
      icon: route.icon || null,
      parentSlug: route.parentSlug || null,
      default: route.default || false,
      resourceDeepLinks: route.resourceDeepLinks === true,
      export_name: route.exportName || route.export_name || exportNameFromPath(route.path),
      collection: route.collection || null,
    };
    if (route.tool_access) {
      entry.tool_access = route.tool_access;
    }
    return entry;
  });

  // Database entries may be a bare slug (structure only) or an object opting
  // into shipping rows to installers. Normalize to the manifest's snake_case.
  const databases = (appConfig.databases || []).map((entry) => {
    if (typeof entry === 'string') return entry;
    if (!entry || typeof entry !== 'object' || !entry.slug) return entry;
    const seedDocuments = entry.seedDocuments ?? entry.seed_documents;
    return seedDocuments === true ? { slug: entry.slug, seed_documents: true } : entry.slug;
  });
  const categories = normalizeCategories(appConfig.categories || []);
  const metadata = { screenshots: resolveListingScreenshots(projectDir, appConfig) };
  const appSlug = safeKebab(appConfig.name);
  const displayTitle = appConfig.title || appConfig.displayName || appConfig.name;
  const skills = (Array.isArray(appConfig.skills) ? appConfig.skills : []).map((skill) => ({
    key: skill.key,
    path: normalizeAppSkillManifestPath(skill.path),
    name: skill.name,
    description: skill.description || null,
  }));
  const listingMedia = {
    screenshots: metadata.screenshots.map((screenshot) => ({
      path: screenshot.path,
      content_type: screenshot.content_type,
      width: screenshot.width,
      height: screenshot.height,
      bytes: screenshot.bytes,
      alt: screenshot.alt || null,
      theme: screenshot.theme || 'light',
    })),
  };
  const changelog = readAppChangelog(projectDir);
  if (changelog.exists && changelog.errors.length > 0) {
    throw usageError(changelog.errors.join('\n'));
  }
  const latestChangelogEntry = changelog.entries[0] || null;
  const legacyVersionNotes = latestChangelogEntry?.body
    || appConfig.versionNotes
    || appConfig.version_notes
    || null;
  let releaseVersion = null;
  try {
    const packageJson = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'));
    releaseVersion = String(packageJson.notisAppVersion || '').trim() || null;
  } catch {
    // Store readiness reports missing or malformed package metadata. Ordinary
    // development builds remain usable without a Store release version.
  }

  return {
    version: 1,
    spec_version: 4,
    app: {
      name: displayTitle,
      slug: appSlug || null,
      description: appConfig.description || null,
      icon: appConfig.icon || null,
      accent: appConfig.accent || null,
      title: displayTitle,
      tagline: appConfig.tagline || null,
      categories,
      author: appConfig.author || null,
      release_version: releaseVersion,
      version_notes: legacyVersionNotes,
    },
    listing: {
      title: displayTitle,
      tagline: appConfig.tagline || null,
      categories,
      author: appConfig.author || null,
      version_notes: legacyVersionNotes,
      ...(changelog.exists
        ? {
            changelog: {
              source_path: changelog.source_path,
              entries: changelog.entries,
            },
          }
        : {}),
      media: listingMedia,
    },
    metadata: listingMedia,
    routes,
    bundle: {
      js: 'bundle/app.js',
      css: 'bundle/app.css',
    },
    databases,
    capabilities: normalizeAppCapabilities(appConfig.capabilities),
    tools: appConfig.tools || [],
    tool_bindings: normalizeAppToolBindings(appConfig.toolBindings),
    skills,
    onboarding: appConfig.onboarding || null,
  };
}

/**
 * Keep the persisted app row's presentation metadata aligned with the bundle
 * manifest. The app slug remains the stable identity; title/name is only the
 * user-facing label.
 */
export function appRowFieldsFromManifest(manifest) {
  const app = manifest?.app && typeof manifest.app === 'object' ? manifest.app : {};
  const displayName = typeof app.title === 'string' && app.title.trim()
    ? app.title.trim()
    : typeof app.name === 'string' && app.name.trim()
      ? app.name.trim()
      : null;
  return {
    ...(displayName ? { name: displayName } : {}),
    accent: app.accent ?? null,
  };
}

export function normalizeAppToolBindings(bindings) {
  return (Array.isArray(bindings) ? bindings : [])
    .map((binding) => {
      const name = typeof binding?.name === 'string' ? binding.name.trim() : '';
      const providerToolName =
        typeof binding?.providerToolName === 'string' ? binding.providerToolName.trim() : '';
      return name && providerToolName
        ? { name, provider_tool_name: providerToolName }
        : null;
    })
    .filter(Boolean);
}

/**
 * Keeps only capabilities the platform actually understands, at the exact
 * values it accepts. An unknown key or value is dropped rather than passed
 * through, so a typo can never reach the server as a permission grant.
 */
export function normalizeAppCapabilities(capabilities) {
  if (!capabilities || typeof capabilities !== 'object') {
    return {};
  }
  const normalized = {};
  if (capabilities.workspaceDatabases === 'read') {
    normalized.workspaceDatabases = 'read';
  }
  if (capabilities.cloudComputer === 'read' || capabilities.cloudComputer === 'shell') {
    normalized.cloudComputer = capabilities.cloudComputer;
  }
  return normalized;
}

/**
 * Manifest form of a declared skill path: no leading `./`, no trailing slash.
 * A directory declaration is the same string as the source-tree prefix the
 * server matches the uploaded source files against.
 */
export function normalizeAppSkillManifestPath(sourcePath) {
  return String(sourcePath || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

/**
 * Every packageable file under a declared skill directory, relative to that
 * directory, in stable order. Excludes match `readSourceFiles` so the files a
 * dev session sends inline are exactly the ones a deploy uploads as source.
 */
function readAppSkillDirectoryFiles(skillDir) {
  const entries = [];

  function walk(dir, prefix) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (shouldExcludeSourceEntry(entry.name) || entry.isSymbolicLink()) {
        continue;
      }
      const fullPath = join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        entries.push({ path: relPath, absolutePath: fullPath });
      }
    }
  }

  walk(skillDir, '');
  // Byte order, not locale order: the server sorts the same file set the same
  // way before hashing it, so a dev session and a deploy agree on the hash.
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function resolveConfiguredAppSkills(appConfig, projectDir) {
  const configured = Array.isArray(appConfig.skills) ? appConfig.skills : [];
  const projectRoot = resolve(projectDir);
  const realProjectRoot = realpathSync(projectRoot);
  const seenKeys = new Set();

  return configured.map((skill, index) => {
    const key = typeof skill?.key === 'string' ? skill.key.trim() : '';
    const sourcePath = typeof skill?.path === 'string' ? skill.path.trim() : '';
    const name = typeof skill?.name === 'string' ? skill.name.trim() : '';
    if (!key || !sourcePath || !name) {
      throw usageError(`skills[${index}] must define non-empty key, path, and name values.`);
    }
    if (seenKeys.has(key)) {
      throw usageError(`Duplicate app skill key: ${key}`);
    }
    seenKeys.add(key);

    const absolutePath = resolve(projectRoot, sourcePath);
    const relativePath = relative(projectRoot, absolutePath).replace(/\\/g, '/');
    if (!relativePath || relativePath.startsWith('../') || relativePath === '..') {
      throw usageError(`App skill path must stay inside the project: ${sourcePath}`);
    }
    if (!existsSync(absolutePath)) {
      throw usageError(`App skill entrypoint not found: ${sourcePath}`);
    }
    if (lstatSync(absolutePath).isSymbolicLink()) {
      throw usageError(`App skill entrypoint cannot be a symbolic link: ${sourcePath}`);
    }
    const realAbsolutePath = realpathSync(absolutePath);
    const realRelativePath = relative(realProjectRoot, realAbsolutePath).replace(/\\/g, '/');
    if (!realRelativePath || realRelativePath.startsWith('../') || realRelativePath === '..') {
      throw usageError(`App skill path must stay inside the project after resolving links: ${sourcePath}`);
    }

    const description = typeof skill.description === 'string' ? skill.description.trim() : null;
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      const entries = readAppSkillDirectoryFiles(absolutePath);
      if (!entries.some((entry) => entry.path === 'SKILL.md')) {
        throw usageError(`App skill directory must contain SKILL.md: ${sourcePath}`);
      }
      const bundleFiles = entries.map((entry) => ({
        path: entry.path,
        content: readFileSync(entry.absolutePath),
      }));
      const totalBytes = bundleFiles.reduce((total, entry) => total + entry.content.length, 0);
      if (totalBytes > MAX_APP_SKILL_BUNDLE_BYTES) {
        throw usageError(
          `App skill "${key}" bundles ${totalBytes} bytes, above the ${MAX_APP_SKILL_BUNDLE_BYTES} byte limit.`,
        );
      }
      const skillMd = bundleFiles.find((entry) => entry.path === 'SKILL.md');
      return {
        key,
        path: relativePath,
        name,
        description,
        skill_md: skillMd.content.toString('utf8'),
        bundle_files: bundleFiles.map((entry) => ({
          path: entry.path,
          content_b64: entry.content.toString('base64'),
        })),
      };
    }
    if (!stats.isFile()) {
      throw usageError(`App skill entrypoint not found: ${sourcePath}`);
    }

    return {
      key,
      path: relativePath,
      name,
      description,
      skill_md: readFileSync(absolutePath, 'utf8'),
    };
  });
}

/**
 * Build the app bundle: generate entry file, run `vite build`, package into .notis/output/.
 */
export async function buildArtifact(projectDir, { stdio = 'inherit' } = {}) {
  await prepareArtifactBuild(projectDir);

  // Run Vite build
  await runProjectScript({
    projectDir,
    scriptName: 'build',
    stdio,
  });

  // Verify the canonical `.notis/output/bundle` packaging contract.
  const builtBundleDir = resolveBuiltBundleDir(projectDir);
  if (!builtBundleDir) {
    throw usageError(
      'Vite build did not produce app.js in .notis/output/bundle. Check your vite.config.ts.',
    );
  }
  normalizeBundleStylesheets(projectDir);
  copyMetadataAssets(projectDir);

  validateArtifactBoundary(readArtifactFiles(projectDir));

  const manifest = readManifest(projectDir);

  return { manifest, outputDir: join(projectDir, OUTPUT_DIR) };
}

/**
 * Read the manifest from a built project.
 */
export function readManifest(projectDir) {
  const manifestPath = join(projectDir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw usageError('No manifest found. Run "notis apps build" first.');
  }
  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

function copyMetadataAssets(projectDir) {
  const metadataDir = join(projectDir, METADATA_DIR);
  const outputMetadataDir = join(projectDir, OUTPUT_DIR, METADATA_DIR);
  // Vite clears the bundle directory, not sibling listing media. Always make
  // the packaged metadata an exact reflection of the source tree so removed
  // placeholders can never survive into a later deploy.
  rmSync(outputMetadataDir, { recursive: true, force: true });
  if (!existsSync(metadataDir)) {
    return;
  }
  mkdirSync(outputMetadataDir, { recursive: true });
  for (const entry of readdirSync(metadataDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/^screenshot-\d+\.png$/i.test(entry.name)) {
      continue;
    }
    cpSync(join(metadataDir, entry.name), join(outputMetadataDir, entry.name));
  }
}

// ---------------------------------------------------------------------------
// Linking
// ---------------------------------------------------------------------------

const PROFILE_LINK_FIELDS = new Set([
  'app_id',
  'linked_at',
  'deployed_at',
  'version',
  'dev_app_id',
  'dev_linked_at',
  'auto_linked_at',
  'cloud_computer_shell_consent',
]);

function splitLinkedState(state) {
  const base = {};
  const link = {};
  for (const [key, value] of Object.entries(state || {})) {
    if (key === 'profiles') continue;
    (PROFILE_LINK_FIELDS.has(key) ? link : base)[key] = value;
  }
  return { base, link };
}

export function appLinkedStateProfileKey({ apiBase, userId }) {
  const normalizedApi = String(apiBase || '').trim().replace(/\/$/, '');
  const normalizedUser = String(userId || '').trim();
  if (!normalizedApi || !normalizedUser) return null;
  return Buffer.from(`${normalizedApi}\0${normalizedUser}`).toString('base64url');
}

export function readLinkedState(projectDir, profileKey = null) {
  const statePath = join(projectDir, STATE_FILE);
  assertLinkedStatePathSafe(projectDir);
  if (!existsSync(statePath)) return null;
  const raw = JSON.parse(readFileSync(statePath, 'utf-8'));
  if (!profileKey) return raw;
  const { base, link: legacyLink } = splitLinkedState(raw);
  const profiles = raw?.profiles && typeof raw.profiles === 'object' ? raw.profiles : {};
  const scoped = profiles[profileKey];
  return {
    ...base,
    ...(scoped && typeof scoped === 'object' ? scoped : legacyLink),
  };
}

function readStateWriteLockOwner(lockPath) {
  try {
    return readFileSync(join(lockPath, 'owner'), 'utf8').trim();
  } catch {
    return null;
  }
}

function reclaimStaleStateWriteLock(lockPath, observedOwner, observedMtimeMs) {
  const quarantinePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
  try {
    renameSync(lockPath, quarantinePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }

  let unchanged = false;
  try {
    const quarantinedStat = lstatSync(quarantinePath);
    unchanged = readStateWriteLockOwner(quarantinePath) === observedOwner
      && quarantinedStat.mtimeMs === observedMtimeMs;
  } catch (error) {
    try {
      renameSync(quarantinePath, lockPath);
    } catch {
      // Fail closed below if the quarantined lock cannot be restored.
    }
    throw error;
  }

  if (!unchanged) {
    try {
      renameSync(quarantinePath, lockPath);
    } catch {
      throw usageError(`Notis app state lock changed while it was being recovered: ${lockPath}`);
    }
    return false;
  }

  rmSync(quarantinePath, { recursive: true, force: true });
  return true;
}

function withStateWriteLock(statePath, callback) {
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
  const lockPath = `${statePath}.write-lock`;
  const ownerId = `${process.pid}.${randomUUID()}`;
  const startedAt = Date.now();
  while (true) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      try {
        writeFileSync(join(lockPath, 'owner'), ownerId, { mode: 0o600, flag: 'wx' });
      } catch (error) {
        // A stale-lock recovery may have moved this candidate while the owner
        // record was being written. Never remove a replacement writer's lock.
        if (readStateWriteLockOwner(lockPath) === ownerId) {
          rmSync(lockPath, { recursive: true, force: true });
        }
        throw error;
      }
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const lockStat = lstatSync(lockPath);
        if (lockStat.isSymbolicLink() || !lockStat.isDirectory()) {
          throw usageError(`Refusing unsafe Notis app state lock: ${lockPath}`);
        }
        const observedOwner = readStateWriteLockOwner(lockPath);
        const ownerPidText = String(observedOwner || '').split('.')[0];
        const ownerPid = /^\d+$/.test(ownerPidText) ? Number.parseInt(ownerPidText, 10) : null;
        // PID liveness alone is insufficient: operating systems can reuse a
        // crashed writer's PID for an unrelated process. A linked-state write
        // is synchronous and normally holds this lock only for milliseconds,
        // so an aged lock is stale even when that numeric PID now exists.
        let stale = Date.now() - lockStat.mtimeMs >= STATE_WRITE_LOCK_STALE_MS;
        if (!stale && Number.isInteger(ownerPid) && ownerPid > 0) {
          try {
            process.kill(ownerPid, 0);
          } catch (ownerError) {
            if (ownerError?.code === 'ESRCH') {
              stale = true;
            }
          }
        }
        if (stale && reclaimStaleStateWriteLock(lockPath, observedOwner, lockStat.mtimeMs)) {
          continue;
        }
      } catch (statError) {
        if (statError?.code === 'ENOENT') continue;
        throw statError;
      }
      if (Date.now() - startedAt >= STATE_WRITE_LOCK_TIMEOUT_MS) {
        throw usageError(`Timed out waiting to update Notis app state: ${statePath}`);
      }
      Atomics.wait(stateWriteLockWait, 0, 0, 10);
    }
  }
  try {
    return callback();
  } finally {
    try {
      if (readStateWriteLockOwner(lockPath) === ownerId) {
        rmSync(lockPath, { recursive: true, force: true });
      }
    } catch {
      // Never remove a lock that no longer belongs to this writer.
    }
  }
}

export function writeLinkedState(projectDir, state, profileKey = null) {
  const statePath = join(projectDir, STATE_FILE);
  assertLinkedStatePathSafe(projectDir);
  return withStateWriteLock(statePath, () => {
    let nextState = state;
    if (profileKey) {
      let current = {};
      if (existsSync(statePath)) {
        current = JSON.parse(readFileSync(statePath, 'utf-8'));
      }
      const { base: currentBase } = splitLinkedState(current);
      const { base } = splitLinkedState(state);
      const { link } = splitLinkedState(state);
      const profiles = current?.profiles && typeof current.profiles === 'object'
        ? { ...current.profiles }
        : {};
      profiles[profileKey] = link;
      nextState = { ...currentBase, ...base, profiles };
    }
    const temporary = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(nextState, null, 2) + '\n');
    renameSync(temporary, statePath);
  });
}

function assertLinkedStatePathSafe(projectDir) {
  const notisDir = join(projectDir, NOTIS_DIR);
  try {
    const directoryStat = lstatSync(notisDir);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw usageError(`Refusing to use unsafe Notis state directory: ${notisDir}`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const statePath = join(projectDir, STATE_FILE);
  try {
    const stateStat = lstatSync(statePath);
    if (stateStat.isSymbolicLink() || !stateStat.isFile()) {
      throw usageError(`Refusing to use unsafe Notis state file: ${statePath}`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export function requireLinkedAppId(projectDir, explicitAppId, profileKey = null) {
  if (explicitAppId) return explicitAppId;
  const state = readLinkedState(projectDir, profileKey);
  if (state?.app_id) return state.app_id;
  throw usageError('This project is not linked to a Notis app. Run "notis apps link <app-id> ." first.');
}

// ---------------------------------------------------------------------------
// Scaffolding
// ---------------------------------------------------------------------------

/**
 * Scaffold a new Notis app project from the SDK template or from a published
 * Store app downloaded from the public registry repository.
 */
export async function scaffoldProject({ projectDir, appName, fromSlug = null }) {
  let scaffoldSource = null;
  if (fromSlug) {
    scaffoldSource = await acquireScaffoldSource(fromSlug);
    if (!scaffoldSource) {
      const known = (await loadScaffoldCatalog()).map((entry) => entry.slug).join(', ') || 'none';
      throw usageError(`Unknown scaffold "${fromSlug}". Available scaffolds: ${known}.`);
    }
  }
  try {
    return scaffoldProjectFromDir({
      projectDir,
      appName,
      fromSlug,
      templateDir: scaffoldSource ? scaffoldSource.dir : join(CLI_ROOT, 'template'),
    });
  } finally {
    scaffoldSource?.cleanup();
  }
}

function scaffoldProjectFromDir({ projectDir, appName, fromSlug, templateDir }) {
  const sourceDir = resolve(templateDir);
  const requestedProjectDir = resolve(projectDir);
  if (!existsSync(sourceDir)) {
    throw usageError(`SDK template not found at ${sourceDir}. Ensure @notis_ai/cli is installed correctly.`);
  }

  const parentDir = dirname(requestedProjectDir);
  const targetName = basename(requestedProjectDir);
  mkdirSync(parentDir, { recursive: true });
  const canonicalParent = realpathSync(parentDir);
  const parentIdentity = capturePullTargetIdentity(canonicalParent);
  const initialTargetIdentity = captureScaffoldTargetIdentity(requestedProjectDir);
  const previousCwd = process.cwd();
  const previousCwdIdentity = capturePullTargetIdentity(previousCwd);
  let cwdPinned = false;
  let stageName = null;
  let cleanupStage = true;
  let activeTargetIdentity = null;
  const scaffoldLockName = '.notis-app-scaffold-lock';
  const scaffoldLockOwnerId = `${process.pid}.${randomUUID()}`;
  try {
    process.chdir(canonicalParent);
    cwdPinned = true;
    assertPullTargetIdentity('.', parentIdentity);
    const lockedTargetIdentity = captureScaffoldTargetIdentity(targetName);
    if (!pullTargetIdentitiesMatch(initialTargetIdentity, lockedTargetIdentity)) {
      throw usageError(`App scaffold target changed before copying: ${requestedProjectDir}`);
    }
    if (!lockedTargetIdentity.exists) {
      try {
        mkdirSync(targetName);
      } catch (error) {
        if (error?.code === 'EEXIST') {
          throw usageError(`App scaffold target changed before copying: ${requestedProjectDir}`);
        }
        throw error;
      }
    }
    activeTargetIdentity = captureScaffoldTargetIdentity(targetName);
    process.chdir(targetName);
    if (!pullTargetIdentitiesMatch(
      activeTargetIdentity,
      captureScaffoldTargetIdentity('.'),
    )) {
      throw usageError(`App scaffold target changed before copying: ${requestedProjectDir}`);
    }
    mkdirSync(scaffoldLockName, { mode: 0o700 });
    writeFileSync(
      join(scaffoldLockName, 'owner'),
      JSON.stringify({ id: scaffoldLockOwnerId }),
      { mode: 0o600 },
    );

    stageName = basename(mkdtempSync(join('.', '.notis-app-scaffold-')));
    projectDir = stageName;

    copyScaffoldSource(sourceDir, projectDir);

    // Update package.json with the app name
    const pkgPath = join(projectDir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      pkg.name = appName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
      // A scaffold creates a new app identity, even when its source comes from a
      // versioned Store example. New apps must therefore start their own release
      // history instead of inheriting the example app's registry version.
      pkg.notisAppVersion = '0.1.0';
      normalizeScaffoldPackageScripts(pkg);
      ensureScaffoldLocalSdk(projectDir, pkg);
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      normalizeScaffoldLockfile(projectDir, pkg);
    }

    // Update notis.config.ts with the app name
    const configPath = join(projectDir, 'notis.config.ts');
    if (existsSync(configPath)) {
      let config = readFileSync(configPath, 'utf-8');
      const displayName = jsStringLiteral(appName);
      const slugName = jsStringLiteral(safeKebab(appName) || 'my-notis-app');
      if (fromSlug) {
        if (/name\s*:/.test(config)) {
          config = config.replace(/name\s*:\s*(['"`])[\s\S]*?\1/, `name: ${slugName}`);
        }
        if (/title\s*:/.test(config)) {
          config = config.replace(/title\s*:\s*(['"`])[\s\S]*?\1/, `title: ${displayName}`);
        } else {
          config = config.replace(/name\s*:\s*(['"`])[\s\S]*?\1/, `name: ${slugName},\n  title: ${displayName}`);
        }
      } else {
        if (/name\s*:/.test(config)) {
          config = config.replace(/name\s*:\s*(['"`])[\s\S]*?\1/, `name: ${slugName}`);
        }
        if (/title\s*:/.test(config)) {
          config = config.replace(/title\s*:\s*(['"`])[\s\S]*?\1/, `title: ${displayName}`);
        } else {
          config = config.replace(/'My Notis App'/, displayName);
        }
      }
      if (/devSlug\s*:/.test(config)) {
        config = config.replace(/devSlug\s*:\s*(['"`])[\s\S]*?\1/, `devSlug: ${slugName}`);
      } else {
        config = config.replace(
          /name\s*:\s*(['"`])[\s\S]*?\1/,
          (nameDeclaration) => `${nameDeclaration},\n  devSlug: ${slugName}`,
        );
      }
      config = removeConfigArrayProperty(config, 'screenshots');
      writeFileSync(configPath, config);
    }

    resetScaffoldChangelog(projectDir, appName);

    assertPullParentIdentity(parentDir, canonicalParent, parentIdentity);
    assertPullTargetIdentity(requestedProjectDir, activeTargetIdentity);
    const stageRoot = realpathSync(stageName);
    const installedEntries = [];
    const installedDirectoryIdentities = new Map([['', activeTargetIdentity]]);
    const captureInstalledEntry = (entryPath) => {
      const entryStat = lstatSync(entryPath, { bigint: true });
      return {
        exists: true,
        path: entryPath,
        dev: entryStat.dev,
        ino: entryStat.ino,
        directory: entryStat.isDirectory(),
      };
    };
    const installExclusive = (sourcePath, destinationName, relativePath, parentIdentity) => {
      const sourceStat = lstatSync(sourcePath);
      if (sourceStat.isSymbolicLink()) {
        throw usageError(`Refusing symlinked scaffold source entry: ${sourcePath}`);
      }
      if (sourceStat.isDirectory()) {
        mkdirSync(destinationName, { mode: sourceStat.mode & 0o777 });
        const installedDirectory = captureInstalledEntry(destinationName);
        installedDirectory.path = relativePath;
        installedEntries.push(installedDirectory);
        installedDirectoryIdentities.set(relativePath, installedDirectory);
        process.chdir(destinationName);
        if (!pullTargetIdentitiesMatch(
          installedDirectory,
          capturePullTargetIdentity('.'),
        )) {
          throw usageError(`App scaffold destination changed during installation: ${relativePath}`);
        }
        try {
          for (const name of readdirSync(sourcePath)) {
            installExclusive(
              join(sourcePath, name),
              name,
              `${relativePath}/${name}`,
              installedDirectory,
            );
          }
        } finally {
          const parentRelativePath = dirname(relativePath) === '.' ? '' : dirname(relativePath);
          process.chdir(parentRelativePath
            ? join(requestedProjectDir, parentRelativePath)
            : requestedProjectDir);
          if (!pullTargetIdentitiesMatch(
            parentIdentity,
            capturePullTargetIdentity('.'),
          )) {
            throw usageError(`App scaffold destination changed during installation: ${parentRelativePath || '.'}`);
          }
        }
        return;
      }
      if (!sourceStat.isFile()) {
        throw usageError(`Refusing unsupported scaffold source entry: ${sourcePath}`);
      }
      copyFileSync(sourcePath, destinationName, fsConstants.COPYFILE_EXCL);
      const installedFile = captureInstalledEntry(destinationName);
      installedFile.path = relativePath;
      installedEntries.push(installedFile);
    };
    try {
      for (const name of readdirSync(stageName)) {
        installExclusive(join(stageRoot, name), name, name, activeTargetIdentity);
      }
      assertPullParentIdentity(parentDir, canonicalParent, parentIdentity);
      assertPullTargetIdentity(requestedProjectDir, activeTargetIdentity);
    } catch (error) {
      try {
        for (const installed of installedEntries.reverse()) {
          const parentRelativePath = dirname(installed.path) === '.' ? '' : dirname(installed.path);
          const parentPath = parentRelativePath
            ? join(requestedProjectDir, parentRelativePath)
            : requestedProjectDir;
          const expectedParentIdentity = installedDirectoryIdentities.get(parentRelativePath);
          process.chdir(parentPath);
          if (!expectedParentIdentity || !pullTargetIdentitiesMatch(
            expectedParentIdentity,
            capturePullTargetIdentity('.'),
          )) {
            throw usageError(
              `Refusing to roll back a scaffold directory that changed concurrently: ${parentPath}`,
            );
          }
          const entryName = basename(installed.path);
          const current = captureInstalledEntry(entryName);
          if (
            current.dev !== installed.dev
            || current.ino !== installed.ino
            || current.directory !== installed.directory
          ) {
            throw usageError(
              `Refusing to roll back a scaffold entry that changed concurrently: ${installed.path}`,
            );
          }
          if (installed.directory) {
            rmdirSync(entryName);
          } else {
            unlinkSync(entryName);
          }
        }
      } catch (rollbackError) {
        cleanupStage = false;
        throw usageError(
          `${error instanceof Error ? error.message : String(error)} `
          + `Scaffold rollback failed; recovery files were retained at `
          + `${join(requestedProjectDir, stageName)}: `
          + `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      }
      throw error;
    }
    try {
      rmSync(stageName, { recursive: true, force: true });
      stageName = null;
    } catch (error) {
      cleanupStage = false;
      throw usageError(
        `App scaffold was installed, but staging cleanup failed; recovery files were retained at `
        + `${join(requestedProjectDir, stageName)}: `
        + `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } finally {
    try {
      let targetPinnedForCleanup = false;
      if (activeTargetIdentity) {
        try {
          process.chdir(requestedProjectDir);
          targetPinnedForCleanup = pullTargetIdentitiesMatch(
            activeTargetIdentity,
            capturePullTargetIdentity('.'),
          );
        } catch {
          targetPinnedForCleanup = false;
        }
      }
      if (targetPinnedForCleanup && cleanupStage && stageName) {
        rmSync(stageName, { recursive: true, force: true });
      }
      if (
        targetPinnedForCleanup
        && readPullLockOwner(scaffoldLockName)?.id === scaffoldLockOwnerId
      ) {
        rmSync(scaffoldLockName, { recursive: true, force: true });
      }
    } finally {
      if (cwdPinned) {
        const cwdMatchesPrevious = (
          previousCwdIdentity.exists
          && pullTargetIdentitiesMatch(previousCwdIdentity, capturePullTargetIdentity('.'))
        );
        if (!cwdMatchesPrevious) {
          process.chdir(previousCwd);
        }
      }
    }
  }

  return { projectDir: requestedProjectDir };
}

function normalizeScaffoldPackageScripts(pkg) {
  const scripts = pkg?.scripts;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    return;
  }
  const generateEntry = String(scripts['generate-entry'] || '').trim();
  if (!/^tsx\s+\.\.\/\.\.\/scripts\/generate-entry\.ts\s+\.$/.test(generateEntry)) {
    return;
  }
  for (const [name, command] of Object.entries(scripts)) {
    if (name === 'generate-entry' || typeof command !== 'string') {
      continue;
    }
    if (command.trim() === 'npm run generate-entry') {
      delete scripts[name];
    }
  }
  scripts['generate-entry'] = 'node -e ""';
}

function captureScaffoldTargetIdentity(targetDir) {
  try {
    const targetStat = lstatSync(targetDir, { bigint: true });
    if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
      throw usageError(`Refusing to scaffold through an unsafe target: ${targetDir}`);
    }
    if (readdirSync(targetDir).length > 0) {
      throw usageError(`App scaffold target must be empty: ${targetDir}`);
    }
    return { exists: true, dev: targetStat.dev, ino: targetStat.ino };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, dev: null, ino: null };
    throw error;
  }
}

/**
 * Drop `property: [ ... ]` from a notis.config.ts source.
 *
 * The scan tracks bracket depth while skipping string literals, so entries
 * whose text contains a bracket (alt text, selectors) cannot end the array
 * early. When the array cannot be resolved the source is returned untouched --
 * a stale screenshots list is a warning at verify time, a broken config is not.
 */
function removeConfigArrayProperty(source, property) {
  const start = source.search(new RegExp(`^[ \\t]*${property}[ \\t]*:[ \\t]*\\[`, 'm'));
  if (start === -1) {
    return source;
  }
  let index = source.indexOf('[', start);
  let depth = 0;
  let quote = null;
  for (; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '[') {
      depth += 1;
    } else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    }
  }
  if (depth !== 0) {
    return source;
  }
  let end = index + 1;
  if (source[end] === ',') {
    end += 1;
  }
  while (end < source.length && (source[end] === ' ' || source[end] === '\t')) {
    end += 1;
  }
  if (source[end] === '\n') {
    end += 1;
  }
  return source.slice(0, start) + source.slice(end);
}

/**
 * A new project starts its own release history: the scaffold's entries describe
 * releases of a different app.
 */
function resetScaffoldChangelog(projectDir, appName) {
  const changelogPath = join(projectDir, 'CHANGELOG.md');
  if (!existsSync(changelogPath)) {
    return;
  }
  writeFileSync(
    changelogPath,
    `# ${appName} Changelog\n\n## [Initial Release] - ${CHANGELOG_MERGE_DATE}\n\n- First Store release.\n`,
  );
}

function normalizeScaffoldLockfile(projectDir, pkg) {
  const lockPath = join(projectDir, 'package-lock.json');
  if (!existsSync(lockPath)) {
    return;
  }

  const lockfile = JSON.parse(readFileSync(lockPath, 'utf-8'));
  lockfile.name = pkg.name;
  if (lockfile.packages?.['']) {
    lockfile.packages[''].name = pkg.name;
  }
  writeFileSync(lockPath, JSON.stringify(lockfile, null, 2) + '\n');
}

function ensureScaffoldLocalSdk(projectDir, pkg) {
  let shouldInstallLocalSdk = false;
  for (const dependencyGroup of ['dependencies', 'devDependencies']) {
    const dependencyValue = pkg[dependencyGroup]?.['@notis/sdk'];
    if (typeof dependencyValue === 'string' && dependencyValue.startsWith('file:')) {
      pkg[dependencyGroup]['@notis/sdk'] = 'file:./packages/sdk';
      shouldInstallLocalSdk = true;
    }
  }

  if (!shouldInstallLocalSdk) {
    return;
  }

  const localSdkDir = join(projectDir, 'packages', 'sdk');
  if (existsSync(join(localSdkDir, 'package.json'))) {
    return;
  }
  if (!existsSync(join(TEMPLATE_SDK_DIR, 'package.json'))) {
    throw usageError(`SDK template not found at ${TEMPLATE_SDK_DIR}. Ensure @notis_ai/cli is installed correctly.`);
  }

  mkdirSync(dirname(localSdkDir), { recursive: true });
  cpSync(TEMPLATE_SDK_DIR, localSdkDir, { recursive: true, dereference: true });
}

// Registry bookkeeping shipped alongside a published app's source: the listing
// descriptor and the rendered Store gallery describe the published app, so a
// scaffold copy must not inherit them.
const REGISTRY_ARTIFACTS = /^(notis-listing\.json$|screenshots(\/|$))/;

function readStablePinnedFile(descriptor, expectedStat, label) {
  const before = fstatSync(descriptor, { bigint: true });
  if (
    !before.isFile()
    || before.dev !== expectedStat.dev
    || before.ino !== expectedStat.ino
  ) {
    throw usageError(`${label} changed before it could be read.`);
  }
  const content = readFileSync(descriptor);
  const after = fstatSync(descriptor, { bigint: true });
  if (
    after.dev !== before.dev
    || after.ino !== before.ino
    || after.size !== before.size
    || after.mtimeNs !== before.mtimeNs
    || after.ctimeNs !== before.ctimeNs
  ) {
    throw usageError(`${label} changed while it was being read.`);
  }
  return content;
}

function captureDirectoryRevision() {
  const stat = statSync('.', { bigint: true });
  return { dev: stat.dev, ino: stat.ino, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs };
}

function assertDirectoryRevisionUnchanged(before, label) {
  const after = captureDirectoryRevision();
  if (
    after.dev !== before.dev
    || after.ino !== before.ino
    || after.mtimeNs !== before.mtimeNs
    || after.ctimeNs !== before.ctimeNs
  ) {
    throw usageError(`${label} changed while it was being read.`);
  }
}

function copyScaffoldSource(sourceDir, targetDir) {
  function shouldCopy(path) {
    const name = path.split(/[\\/]/).pop();
    if (!name) return true;
    const relPath = relative(sourceDir, path).replace(/\\/g, '/');
    if (SCAFFOLD_LISTING_MEDIA.test(relPath) || REGISTRY_ARTIFACTS.test(relPath)) {
      return false;
    }
    return !SCAFFOLD_COPY_EXCLUDES.has(name)
      && !name.toLocaleLowerCase('en-US').startsWith('.notis-app-scaffold-')
      && !name.startsWith('.env')
      && !/\.(test|spec)\.[cm]?[jt]sx?$/i.test(name);
  }

  const canonicalSource = realpathSync(sourceDir);
  const sourceIdentity = capturePullTargetIdentity(canonicalSource);
  const previousCwd = process.cwd();
  const previousCwdIdentity = capturePullTargetIdentity(previousCwd);
  const destinationIdentity = capturePullTargetIdentity(targetDir);
  const snapshot = { directories: [], files: [] };

  function snapshotCurrent(sourcePath, node, expectedDirectoryIdentity) {
    if (!pullTargetIdentitiesMatch(expectedDirectoryIdentity, capturePullTargetIdentity('.'))) {
      throw usageError(`Scaffold source directory changed while copying: ${sourcePath}`);
    }
    const directoryRevision = captureDirectoryRevision();
    const parentIdentity = expectedDirectoryIdentity;
    for (const name of readdirSync('.')) {
      const logicalSourcePath = join(sourcePath, name);
      if (!shouldCopy(logicalSourcePath)) {
        continue;
      }
      const sourceStat = lstatSync(name, { bigint: true });
      if (sourceStat.isSymbolicLink()) {
        throw usageError(`Refusing symlinked scaffold source entry: ${logicalSourcePath}`);
      }
      if (sourceStat.isDirectory()) {
        const childNode = {
          name,
          mode: Number(sourceStat.mode & 0o777n),
          directories: [],
          files: [],
        };
        node.directories.push(childNode);
        process.chdir(name);
        const childIdentity = capturePullTargetIdentity('.');
        if (!pullTargetIdentitiesMatch(
          { exists: true, dev: sourceStat.dev, ino: sourceStat.ino },
          childIdentity,
        )) {
          throw usageError(`Scaffold source directory changed while copying: ${logicalSourcePath}`);
        }
        try {
          snapshotCurrent(logicalSourcePath, childNode, childIdentity);
        } finally {
          process.chdir('..');
          if (!pullTargetIdentitiesMatch(parentIdentity, capturePullTargetIdentity('.'))) {
            throw usageError(`Scaffold source directory changed while copying: ${sourcePath}`);
          }
        }
        continue;
      }
      if (!sourceStat.isFile()) {
        throw usageError(`Refusing unsupported scaffold source entry: ${logicalSourcePath}`);
      }
      const descriptor = openSync(name, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      try {
        node.files.push({
          name,
          mode: Number(sourceStat.mode & 0o777n),
          content: readStablePinnedFile(
            descriptor,
            sourceStat,
            `Scaffold source file ${logicalSourcePath}`,
          ),
        });
      } finally {
        closeSync(descriptor);
      }
    }
    assertDirectoryRevisionUnchanged(directoryRevision, `Scaffold source directory ${sourcePath}`);
  }

  try {
    process.chdir(canonicalSource);
    snapshotCurrent(canonicalSource, snapshot, sourceIdentity);
  } finally {
    process.chdir(previousCwd);
    if (!pullTargetIdentitiesMatch(previousCwdIdentity, capturePullTargetIdentity('.'))) {
      throw usageError(`Working directory changed while copying scaffold source: ${previousCwd}`);
    }
  }

  function writeSnapshot(node, logicalPath, expectedDirectoryIdentity) {
    if (!pullTargetIdentitiesMatch(expectedDirectoryIdentity, capturePullTargetIdentity('.'))) {
      throw usageError(`Scaffold destination changed while copying: ${logicalPath || '.'}`);
    }
    const parentIdentity = expectedDirectoryIdentity;
    for (const directory of node.directories) {
      mkdirSync(directory.name, { mode: directory.mode });
      const directoryStat = lstatSync(directory.name, { bigint: true });
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
        throw usageError(`Refusing unsafe scaffold destination: ${join(logicalPath, directory.name)}`);
      }
      process.chdir(directory.name);
      const childIdentity = capturePullTargetIdentity('.');
      if (!pullTargetIdentitiesMatch(
        { exists: true, dev: directoryStat.dev, ino: directoryStat.ino },
        childIdentity,
      )) {
        throw usageError(`Scaffold destination changed while copying: ${join(logicalPath, directory.name)}`);
      }
      try {
        writeSnapshot(directory, join(logicalPath, directory.name), childIdentity);
      } finally {
        process.chdir('..');
        if (!pullTargetIdentitiesMatch(parentIdentity, capturePullTargetIdentity('.'))) {
          throw usageError(`Scaffold destination changed while copying: ${logicalPath || '.'}`);
        }
      }
    }
    for (const file of node.files) {
      writeFileSync(file.name, file.content, { flag: 'wx', mode: file.mode });
    }
  }

  try {
    process.chdir(targetDir);
    if (!pullTargetIdentitiesMatch(destinationIdentity, capturePullTargetIdentity('.'))) {
      throw usageError(`Scaffold destination changed while copying: ${targetDir}`);
    }
    writeSnapshot(snapshot, '', destinationIdentity);
  } finally {
    process.chdir(previousCwd);
    if (!pullTargetIdentitiesMatch(previousCwdIdentity, capturePullTargetIdentity('.'))) {
      throw usageError(`Working directory changed while copying scaffold source: ${previousCwd}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Deploy helpers
// ---------------------------------------------------------------------------

/**
 * Collect all files from .notis/output/ as base64-encoded entries for upload.
 */
export function collectArtifactFiles(projectDir) {
  const outputDir = join(projectDir, OUTPUT_DIR);
  if (!existsSync(outputDir)) {
    throw usageError('No build output found. Run "notis apps build" first.');
  }

  validateArtifactBoundary(readArtifactFiles(projectDir));

  const files = {};

  function walk(dir, prefix) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else {
        files[relPath] = readFileSync(fullPath).toString('base64');
      }
    }
  }

  walk(outputDir, '');
  return files;
}

function shouldExcludeSourceEntry(name) {
  const casefolded = String(name || '').toLocaleLowerCase('en-US');
  return (
    SOURCE_COPY_EXCLUDES_CASEFOLDED.has(casefolded)
    || casefolded.startsWith('.notis-app-pull-')
    || casefolded.startsWith('.notis-app-scaffold-')
    || casefolded.startsWith('.env')
    || casefolded.endsWith('.pyc')
    || casefolded.endsWith('.pyo')
  );
}

function readSourceFiles(projectDir) {
  const files = {};
  const canonicalProjectDir = realpathSync(projectDir);
  const projectIdentity = capturePullTargetIdentity(canonicalProjectDir);
  const previousCwd = process.cwd();
  const previousCwdIdentity = capturePullTargetIdentity(previousCwd);

  function walkCurrent(prefix, expectedDirectoryIdentity) {
    if (!pullTargetIdentitiesMatch(expectedDirectoryIdentity, capturePullTargetIdentity('.'))) {
      throw usageError(`App source directory changed while packaging: ${prefix || '.'}`);
    }
    const directoryRevision = captureDirectoryRevision();
    const parentIdentity = expectedDirectoryIdentity;
    for (const name of readdirSync('.')) {
      if (shouldExcludeSourceEntry(name)) {
        continue;
      }
      const entryStat = lstatSync(name, { bigint: true });
      if (entryStat.isSymbolicLink()) {
        continue;
      }
      const relPath = prefix ? `${prefix}/${name}` : name;
      if (entryStat.isDirectory()) {
        process.chdir(name);
        const childIdentity = capturePullTargetIdentity('.');
        if (!pullTargetIdentitiesMatch(
          { exists: true, dev: entryStat.dev, ino: entryStat.ino },
          childIdentity,
        )) {
          throw usageError(`App source directory changed while packaging: ${relPath}`);
        }
        try {
          walkCurrent(relPath, childIdentity);
        } finally {
          process.chdir('..');
          if (!pullTargetIdentitiesMatch(parentIdentity, capturePullTargetIdentity('.'))) {
            throw usageError(`App source directory changed while packaging: ${prefix || '.'}`);
          }
        }
      } else if (entryStat.isFile()) {
        const descriptor = openSync(name, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        try {
          files[relPath] = readStablePinnedFile(
            descriptor,
            entryStat,
            `App source file ${relPath}`,
          );
        } finally {
          closeSync(descriptor);
        }
      }
    }
    assertDirectoryRevisionUnchanged(directoryRevision, `App source directory ${prefix || '.'}`);
  }

  try {
    process.chdir(canonicalProjectDir);
    walkCurrent('', projectIdentity);
  } finally {
    process.chdir(previousCwd);
    if (!pullTargetIdentitiesMatch(previousCwdIdentity, capturePullTargetIdentity('.'))) {
      throw usageError(`Working directory changed while packaging app source: ${previousCwd}`);
    }
  }
  return files;
}

export function collectSourceFiles(projectDir) {
  const files = readSourceFiles(projectDir);
  const encoded = {};
  for (const [relPath, content] of Object.entries(files)) {
    encoded[relPath] = content.toString('base64');
  }
  return encoded;
}

function cleanTarPath(name) {
  const cleaned = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (!parts.length || parts.includes('..')) {
    throw usageError(`Refusing to extract unsafe path from source archive: ${name}`);
  }
  return parts.join('/');
}

function parsePaxPath(data) {
  if (data.length === 0 || data.length > 64 * 1024) {
    throw usageError('Refusing to extract an invalid PAX source archive header.');
  }
  let offset = 0;
  let path = null;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space <= offset) {
      throw usageError('Refusing to extract a malformed PAX source archive header.');
    }
    const lengthText = data.subarray(offset, space).toString('ascii');
    if (!/^\d+$/.test(lengthText)) {
      throw usageError('Refusing to extract a malformed PAX source archive header.');
    }
    const recordLength = Number.parseInt(lengthText, 10);
    const recordEnd = offset + recordLength;
    if (recordLength <= space - offset + 3 || recordEnd > data.length || data[recordEnd - 1] !== 0x0a) {
      throw usageError('Refusing to extract a malformed PAX source archive header.');
    }
    const record = data.subarray(space + 1, recordEnd - 1);
    const equals = record.indexOf(0x3d);
    if (equals <= 0) {
      throw usageError('Refusing to extract a malformed PAX source archive header.');
    }
    const key = record.subarray(0, equals).toString('ascii');
    if (key === 'path') {
      try {
        path = new TextDecoder('utf-8', { fatal: true }).decode(record.subarray(equals + 1));
      } catch {
        throw usageError('Refusing to extract a PAX source path with invalid UTF-8.');
      }
      if (!path || Buffer.byteLength(path, 'utf-8') > 4096) {
        throw usageError('Refusing to extract an invalid PAX source path.');
      }
    }
    offset = recordEnd;
  }
  if (!path) {
    throw usageError('Refusing to extract a PAX source header without a path.');
  }
  return path;
}

function extractTarGz(buffer, targetDir) {
  const tar = gunzipSync(buffer);
  let offset = 0;
  let pendingPaxPath = null;
  const extractedPaths = new Map();
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = header.subarray(0, 100).toString('utf-8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf-8').replace(/\0.*$/, '');
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeRaw = header.subarray(124, 136).toString('utf-8').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeRaw || '0', 8);
    const typeFlag = header[156];
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > tar.length) {
      throw usageError('Refusing to extract a malformed source archive entry size.');
    }
    const data = tar.subarray(offset, offset + size);
    if (typeFlag === 120) {
      if (pendingPaxPath !== null) {
        throw usageError('Refusing to extract stacked PAX source archive headers.');
      }
      pendingPaxPath = parsePaxPath(data);
      offset += Math.ceil(size / 512) * 512;
      continue;
    }

    const relPath = cleanTarPath(pendingPaxPath || fullName);
    pendingPaxPath = null;
    const parts = relPath.split('/');
    for (let index = 1; index <= parts.length; index += 1) {
      const pathPrefix = parts.slice(0, index).join('/');
      const casefoldedPath = pathPrefix.toLocaleLowerCase('en-US');
      const priorPath = extractedPaths.get(casefoldedPath);
      if (priorPath && priorPath !== pathPrefix) {
        throw usageError(
          `Refusing to extract case-colliding source archive paths: ${priorPath} and ${pathPrefix}`,
        );
      }
      extractedPaths.set(casefoldedPath, pathPrefix);
    }
    if (relPath.split('/').some((part) => shouldExcludeSourceEntry(part))) {
      throw usageError(`Refusing to extract local-only path from source archive: ${relPath}`);
    }
    const outputPath = join(targetDir, relPath);

    if (typeFlag === 53) {
      mkdirSync(outputPath, { recursive: true });
    } else if (typeFlag === 0 || typeFlag === 48) {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, data);
    } else {
      throw usageError(`Refusing to extract unsupported source archive entry: ${relPath}`);
    }

    offset += Math.ceil(size / 512) * 512;
  }
  if (pendingPaxPath !== null) {
    throw usageError('Refusing to extract a dangling PAX source archive header.');
  }
}

function collectPullPreservedPaths(targetDir) {
  const paths = [];

  function walk(dir, prefix) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || shouldExcludeSourceEntry(entry.name)) {
        paths.push(relPath);
        continue;
      }
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), relPath);
      }
    }
  }

  if (existsSync(targetDir)) {
    walk(targetDir, '');
  }
  return paths;
}

function readPullLockOwner(lockDirectory) {
  try {
    return JSON.parse(readFileSync(join(lockDirectory, 'owner'), 'utf-8'));
  } catch {
    return null;
  }
}

function capturePullTargetIdentity(targetDir) {
  try {
    const targetStat = lstatSync(targetDir, { bigint: true });
    if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
      throw usageError(`Refusing to pull app source through an unsafe target: ${targetDir}`);
    }
    return { exists: true, dev: targetStat.dev, ino: targetStat.ino };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, dev: null, ino: null };
    throw error;
  }
}

function assertPullTargetIdentity(targetDir, expected) {
  const current = capturePullTargetIdentity(targetDir);
  if (!pullTargetIdentitiesMatch(current, expected)) {
    throw usageError(`App source pull target changed while the download was in progress: ${targetDir}`);
  }
}

function pullTargetIdentitiesMatch(left, right) {
  return (
    left.exists === right.exists
    && (!left.exists || (left.dev === right.dev && left.ino === right.ino))
  );
}

function assertPullParentIdentity(parentDir, canonicalParent, expectedIdentity) {
  let currentCanonicalParent;
  try {
    currentCanonicalParent = realpathSync(parentDir);
  } catch {
    throw usageError(`App source pull parent changed while the download was in progress: ${parentDir}`);
  }
  if (
    currentCanonicalParent !== canonicalParent
    || !pullTargetIdentitiesMatch(
      capturePullTargetIdentity(canonicalParent),
      expectedIdentity,
    )
  ) {
    throw usageError(`App source pull parent changed while the download was in progress: ${parentDir}`);
  }
}

async function withPullTargetLock(targetDir, callback) {
  const requestedTarget = resolve(targetDir);
  const parentDir = dirname(requestedTarget);
  mkdirSync(parentDir, { recursive: true });
  const canonicalParent = realpathSync(parentDir);
  const canonicalParentIdentity = capturePullTargetIdentity(canonicalParent);
  const initialRequestedIdentity = capturePullTargetIdentity(requestedTarget);
  const canonicalTarget = initialRequestedIdentity.exists
    ? realpathSync(requestedTarget)
    : join(canonicalParent, basename(requestedTarget));
  if (
    initialRequestedIdentity.exists
    && !pullTargetIdentitiesMatch(
      initialRequestedIdentity,
      capturePullTargetIdentity(canonicalTarget),
    )
  ) {
    throw usageError(`App source pull target changed before locking: ${requestedTarget}`);
  }
  const lockDirectory = join(canonicalParent, `.${basename(canonicalTarget)}.notis-pull-lock`);
  const ownerId = `${process.pid}.${randomUUID()}`;
  const deadline = Date.now() + PULL_LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      mkdirSync(lockDirectory, { mode: 0o700 });
      writeFileSync(
        join(lockDirectory, 'owner'),
        JSON.stringify({ id: ownerId, pid: process.pid, at: Date.now() }),
        { mode: 0o600 },
      );
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let lockStat;
      try {
        lockStat = lstatSync(lockDirectory);
      } catch (statError) {
        if (statError?.code === 'ENOENT') continue;
        throw statError;
      }
      if (lockStat.isSymbolicLink() || !lockStat.isDirectory()) {
        throw usageError(`Refusing to use unsafe app source pull lock: ${lockDirectory}`);
      }
      if (Date.now() >= deadline) {
        throw usageError(
          `Timed out waiting to pull app source into ${targetDir}. `
          + `If no pull process is running, remove the orphaned lock: ${lockDirectory}`,
        );
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, PULL_LOCK_POLL_MS));
    }
  }

  try {
    const assertOwnership = () => {
      if (readPullLockOwner(lockDirectory)?.id !== ownerId) {
        throw usageError(`Lost the app source pull lock for ${targetDir}.`);
      }
    };
    const assertParentIdentity = () => assertPullParentIdentity(
      parentDir,
      canonicalParent,
      canonicalParentIdentity,
    );
    assertParentIdentity();
    const lockedTargetIdentity = capturePullTargetIdentity(canonicalTarget);
    if (!pullTargetIdentitiesMatch(initialRequestedIdentity, lockedTargetIdentity)) {
      throw usageError(`App source pull target changed before locking: ${requestedTarget}`);
    }
    return await callback(
      assertOwnership,
      assertParentIdentity,
      canonicalTarget,
      lockedTargetIdentity,
    );
  } finally {
    try {
      if (readPullLockOwner(lockDirectory)?.id === ownerId) {
        rmSync(lockDirectory, { recursive: true, force: true });
      }
    } catch {
      // A reclaimed lock belongs to its new owner and must not be removed.
    }
  }
}

export async function pullAppSource(args) {
  const targetDir = resolve(args.targetDir);
  return withPullTargetLock(
    targetDir,
    (
      assertLockOwnership,
      assertParentIdentity,
      canonicalTarget,
      targetIdentity,
    ) => pullAppSourceUnlocked(
      { ...args, targetDir: canonicalTarget },
      assertLockOwnership,
      assertParentIdentity,
      targetIdentity,
    ),
  );
}

async function pullAppSourceUnlocked({
  apiBase,
  jwt,
  appId,
  targetDir,
  version = 'latest',
  force = false,
  profileKey = null,
}, assertLockOwnership, assertParentIdentity, initialTargetIdentity) {
  assertLockOwnership();
  assertParentIdentity();
  const targetWasNonEmpty = existsSync(targetDir) && readdirSync(targetDir).length > 0;
  if (targetWasNonEmpty) {
    if (!force) {
      throw usageError(`Target directory is not empty: ${targetDir}. Pass --force to overwrite it.`);
    }
  }

  const params = new URLSearchParams({ app_id: appId, version: String(version || 'latest') });
  const response = await fetch(`${apiBase.replace(/\/$/, '')}/portal_apps/source?${params.toString()}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw usageError(typeof data?.error === 'string' ? data.error : `Failed to pull app source (${response.status}).`);
  }

  const contentDisposition = response.headers.get('content-disposition') || '';
  const versionMatch = /-v(\d+)\.tar\.gz/i.exec(contentDisposition);
  const pulledVersion = versionMatch ? Number.parseInt(versionMatch[1], 10) : null;
  const requestedVersion = String(version || 'latest') === 'latest'
    ? null
    : Number.parseInt(String(version), 10);
  if (!Number.isInteger(pulledVersion) || pulledVersion <= 0) {
    throw usageError('The app source response did not identify a valid positive version.');
  }
  if (requestedVersion !== null && (!Number.isInteger(requestedVersion) || requestedVersion <= 0)) {
    throw usageError(`Invalid app source version: ${version}`);
  }
  if (
    requestedVersion !== null
    && pulledVersion !== requestedVersion
  ) {
    throw usageError(
      `Requested app source version ${requestedVersion}, but the server returned version ${pulledVersion}.`,
    );
  }
  const linkedVersion = pulledVersion;
  const archiveBuffer = Buffer.from(await response.arrayBuffer());
  assertParentIdentity();
  assertLockOwnership();

  // A failed download or malformed archive must never damage an existing
  // checkout. Extract into a transaction directory under the pinned target,
  // then replace
  // only source-managed entries. Local-only state such as .git, .env files,
  // dependencies, symlinks, build output, and .notis runtime directories is
  // moved aside recursively and restored into the new source tree.
  let cleanupTransaction = true;
  let cwdPinned = false;
  let transactionDir = null;
  let transactionDisplayPath = null;
  let operationError = null;
  const previousCwd = process.cwd();
  const previousCwdIdentity = capturePullTargetIdentity(previousCwd);
  try {
    const parentDir = dirname(targetDir);
    const targetName = basename(targetDir);
    const parentIdentity = capturePullTargetIdentity(parentDir);
    assertParentIdentity();
    process.chdir(parentDir);
    cwdPinned = true;
    assertPullTargetIdentity('.', parentIdentity);

    assertParentIdentity();
    assertPullTargetIdentity(targetName, initialTargetIdentity);
    if (!initialTargetIdentity.exists) {
      try {
        mkdirSync(targetName);
      } catch (error) {
        if (error?.code === 'EEXIST') {
          throw usageError(`App source pull target changed while the download was in progress: ${targetDir}`);
        }
        throw error;
      }
    }
    const activeTargetIdentity = capturePullTargetIdentity(targetName);
    if (
      initialTargetIdentity.exists
      && (
        activeTargetIdentity.dev !== initialTargetIdentity.dev
        || activeTargetIdentity.ino !== initialTargetIdentity.ino
      )
    ) {
      throw usageError(`App source pull target changed while the download was in progress: ${targetDir}`);
    }
    assertLockOwnership();
    process.chdir(targetName);
    assertPullTargetIdentity('.', activeTargetIdentity);
    const targetRoot = '.';
    assertLinkedStatePathSafe(targetRoot);
    const preservedPaths = collectPullPreservedPaths(targetRoot);

    const transactionName = basename(mkdtempSync(join('.', '.notis-app-pull-')));
    transactionDir = transactionName;
    transactionDisplayPath = join(targetDir, transactionName);
    const stageDir = join(transactionDir, 'stage');
    const backupDir = join(transactionDir, 'backup');
    const preservedDir = join(transactionDir, 'preserved');
    mkdirSync(stageDir, { recursive: true });
    mkdirSync(backupDir, { recursive: true });
    mkdirSync(preservedDir, { recursive: true });

    extractTarGz(archiveBuffer, stageDir);
    const stagedEntries = readdirSync(stageDir);
    if (stagedEntries.length === 0) {
      throw usageError('The app source archive did not contain any editable source files.');
    }

    const previousStatePath = join(targetRoot, STATE_FILE);
    const backupStatePath = join(backupDir, STATE_FILE);
    const hadPreviousState = existsSync(previousStatePath);
    if (hadPreviousState) {
      mkdirSync(dirname(backupStatePath), { recursive: true });
      cpSync(previousStatePath, backupStatePath);
    }

    const movedPreserved = [];
    const movedOriginal = [];
    const movedStaged = [];
    const restoredPreserved = [];
    try {
      for (const relPath of preservedPaths) {
        const preservedPath = join(preservedDir, relPath);
        mkdirSync(dirname(preservedPath), { recursive: true });
        renameSync(join(targetRoot, relPath), preservedPath);
        movedPreserved.push(relPath);
      }
      assertPullTargetIdentity(targetDir, activeTargetIdentity);
      assertLockOwnership();
      const managedTargetEntries = readdirSync(targetRoot)
        .filter((name) => name !== transactionName);
      for (const name of managedTargetEntries) {
        renameSync(join(targetRoot, name), join(backupDir, name));
        movedOriginal.push(name);
      }
      assertPullTargetIdentity(targetDir, activeTargetIdentity);
      assertLockOwnership();
      for (const name of stagedEntries) {
        renameSync(join(stageDir, name), join(targetRoot, name));
        movedStaged.push(name);
      }
      assertPullTargetIdentity(targetDir, activeTargetIdentity);
      assertLockOwnership();
      for (const relPath of movedPreserved) {
        const targetPath = join(targetRoot, relPath);
        try {
          lstatSync(targetPath);
          throw usageError(
            `Local-only path conflicts with pulled source: ${relPath}. Move it aside and retry.`,
          );
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
        mkdirSync(dirname(targetPath), { recursive: true });
        renameSync(join(preservedDir, relPath), targetPath);
        restoredPreserved.push(relPath);
      }
      assertPullTargetIdentity(targetDir, activeTargetIdentity);
      assertLockOwnership();
      writeLinkedState(targetRoot, {
        app_id: appId,
        ...(Number.isFinite(linkedVersion) ? { version: linkedVersion } : {}),
        linked_at: new Date().toISOString(),
      }, profileKey);
      assertPullTargetIdentity(targetDir, activeTargetIdentity);
      assertLockOwnership();
    } catch (error) {
      try {
        for (const relPath of restoredPreserved.reverse()) {
          const preservedPath = join(preservedDir, relPath);
          mkdirSync(dirname(preservedPath), { recursive: true });
          renameSync(join(targetRoot, relPath), preservedPath);
        }
        for (const name of movedStaged.reverse()) {
          renameSync(join(targetRoot, name), join(stageDir, name));
        }
        for (const name of movedOriginal.reverse()) {
          renameSync(join(backupDir, name), join(targetRoot, name));
        }
        for (const relPath of movedPreserved.reverse()) {
          const targetPath = join(targetRoot, relPath);
          mkdirSync(dirname(targetPath), { recursive: true });
          renameSync(join(preservedDir, relPath), targetPath);
        }
        if (hadPreviousState) {
          cpSync(backupStatePath, previousStatePath);
        } else {
          rmSync(previousStatePath, { force: true });
        }
      } catch (rollbackError) {
        cleanupTransaction = false;
        throw usageError(
          `${error instanceof Error ? error.message : String(error)} `
          + `Rollback failed; recovery files were retained at ${transactionDisplayPath}: `
          + `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      }
      throw error;
    }
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    let cleanupError = null;
    try {
      if (cleanupTransaction && transactionDir) {
        rmSync(transactionDir, { recursive: true, force: true });
      }
    } catch (error) {
      cleanupError = error;
    } finally {
      if (cwdPinned) {
        const cwdMatchesTarget = (
          previousCwdIdentity.exists
          && pullTargetIdentitiesMatch(previousCwdIdentity, capturePullTargetIdentity('.'))
        );
        if (!cwdMatchesTarget) {
          try {
            process.chdir(previousCwd);
          } catch {
            // The command is about to return; never trade recovered source for a cwd error.
          }
        }
      }
    }
    if (cleanupError) {
      const cleanupMessage = cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError);
      if (operationError) {
        throw usageError(
          `${operationError instanceof Error ? operationError.message : String(operationError)} `
          + `Transaction cleanup also failed; recovery files were retained at `
          + `${transactionDisplayPath}: ${cleanupMessage}`,
        );
      }
      throw usageError(
        `App source was updated, but transaction cleanup failed; recovery files were retained at `
        + `${transactionDisplayPath}: ${cleanupMessage}`,
      );
    }
  }

  return { projectDir: targetDir, version: pulledVersion || version };
}

function readArtifactFiles(projectDir) {
  const outputDir = join(projectDir, OUTPUT_DIR);
  if (!existsSync(outputDir)) {
    throw usageError('No build output found. Run "notis apps build" first.');
  }

  const files = {};

  function walk(dir, prefix) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else {
        files[relPath] = readFileSync(fullPath);
      }
    }
  }

  walk(outputDir, '');
  return files;
}

// ---------------------------------------------------------------------------
// Direct deploy (bypasses backend server)
// ---------------------------------------------------------------------------

/**
 * Resolve Supabase credentials from the server/.env file in the repo workspace.
 * Falls back to environment variables.
 */
function resolveSupabaseCredentials() {
  const envPaths = [
    resolve(process.cwd(), 'server/.env'),
    resolve(process.cwd(), '../server/.env'),
    resolve(process.cwd(), '../../server/.env'),
  ];

  let supabaseUrl = process.env.SUPABASE_URL;
  let supabaseSubdomain = process.env.SUPABASE_SUBDOMAIN;
  let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const eqIdx = trimmed.indexOf('=');
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (key === 'SUPABASE_URL' && !supabaseUrl) supabaseUrl = value;
        if (key === 'SUPABASE_SUBDOMAIN' && !supabaseSubdomain) supabaseSubdomain = value;
        if ((key === 'SUPABASE_SERVICE_ROLE_KEY' || key === 'SUPABASE_SERVICE_KEY') && !supabaseKey) supabaseKey = value;
      }
      break;
    }
  }

  // Derive URL from subdomain if needed
  if (!supabaseUrl && supabaseSubdomain) {
    supabaseUrl = `https://${supabaseSubdomain}.supabase.co`;
  }

  if (!supabaseUrl || !supabaseKey) {
    throw usageError(
      'Cannot resolve Supabase credentials for direct deploy. ' +
      'Ensure server/.env exists with SUPABASE_SUBDOMAIN (or SUPABASE_URL) and SUPABASE_SERVICE_KEY, ' +
      'or set them as environment variables.',
    );
  }

  return { supabaseUrl, supabaseKey };
}

/**
 * Upload a file to Supabase Storage with upsert.
 */
async function uploadToStorage(supabaseUrl, supabaseKey, bucket, storagePath, content, contentType) {
  const url = `${supabaseUrl}/storage/v1/object/${bucket}/${storagePath}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: content,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Storage upload failed (${response.status}): ${text}`);
  }
}

async function ensureStorageBucket(supabaseUrl, supabaseKey, bucket, options = {}) {
  const encodedBucket = encodeURIComponent(bucket);
  const headers = {
    'Authorization': `Bearer ${supabaseKey}`,
    'apikey': supabaseKey,
  };
  const inspectResponse = await fetch(`${supabaseUrl}/storage/v1/bucket/${encodedBucket}`, {
    headers,
  });
  if (inspectResponse.ok) {
    return;
  }
  if (inspectResponse.status !== 404) {
    const text = await inspectResponse.text().catch(() => '');
    throw new Error(`Failed to inspect storage bucket ${bucket} (${inspectResponse.status}): ${text}`);
  }

  const createResponse = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: Boolean(options.public),
    }),
  });
  if (createResponse.ok) {
    return;
  }

  const text = await createResponse.text().catch(() => '');
  if (createResponse.status === 409 || /already exists|duplicate/i.test(text)) {
    return;
  }
  throw new Error(`Failed to create storage bucket ${bucket} (${createResponse.status}): ${text}`);
}

/**
 * Get the current app manifest version from the apps table.
 */
async function getAppCurrentVersion(supabaseUrl, supabaseKey, appId) {
  const encodedAppId = encodeURIComponent(appId);
  const url = `${supabaseUrl}/rest/v1/apps?id=eq.${encodedAppId}&select=manifest`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'apikey': supabaseKey,
    },
  });
  if (!response.ok) throw new Error(`Failed to get app version: ${response.status}`);
  const rows = await response.json();
  if (!rows.length) throw usageError(`App ${appId} not found.`);
  const manifest = rows[0].manifest || {};
  return { currentVersion: manifest.version || 0, manifest };
}

/**
 * Update the app manifest in the apps table.
 */
async function updateAppVersion(supabaseUrl, supabaseKey, appId, newVersion, manifest) {
  const encodedAppId = encodeURIComponent(appId);
  const url = `${supabaseUrl}/rest/v1/apps?id=eq.${encodedAppId}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'apikey': supabaseKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      manifest: { ...manifest, version: newVersion },
      ...appRowFieldsFromManifest(manifest),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to update app version: ${response.status} ${text}`);
  }
}

const CONTENT_TYPE_MAP = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/**
 * Deploy app bundle directly to Supabase storage, bypassing the backend server.
 */
export async function directDeploy(projectDir, appId) {
  const { supabaseUrl, supabaseKey } = resolveSupabaseCredentials();
  const manifest = readManifest(projectDir);
  const artifactFiles = readArtifactFiles(projectDir);
  const sourceFiles = readSourceFiles(projectDir);
  validateArtifactBoundary(artifactFiles);

  // Get current version and increment
  const { currentVersion } = await getAppCurrentVersion(supabaseUrl, supabaseKey, appId);
  const newVersion = currentVersion + 1;

  // Upload all files from the output directory
  const bucket = 'app-code';
  await ensureStorageBucket(supabaseUrl, supabaseKey, bucket, { public: false });
  await ensureStorageBucket(supabaseUrl, supabaseKey, 'app-source', { public: false });

  async function uploadDir(dir, prefix) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await uploadDir(fullPath, relPath);
      } else {
        const ext = entry.name.includes('.') ? '.' + entry.name.split('.').pop() : '';
        const contentType = CONTENT_TYPE_MAP[ext] || 'application/octet-stream';
        const content = readFileSync(fullPath);
        const storagePath = `${appId}/v${newVersion}/${relPath}`;
        await uploadToStorage(supabaseUrl, supabaseKey, bucket, storagePath, content, contentType);
      }
    }
  }

  await uploadDir(join(projectDir, OUTPUT_DIR), '');

  for (const [relPath, content] of Object.entries(sourceFiles)) {
    const ext = relPath.includes('.') ? `.${relPath.split('.').pop()}` : '';
    const contentType = CONTENT_TYPE_MAP[ext] || 'application/octet-stream';
    const storagePath = `${appId}/v${newVersion}/${relPath}`;
    await uploadToStorage(supabaseUrl, supabaseKey, 'app-source', storagePath, content, contentType);
  }

  // Update the app record -- include storage_prefix so the portal can resolve bundle URLs
  const storagePrefix = `${appId}/v${newVersion}/`;
  const deployManifest = {
    ...manifest,
    version: newVersion,
    storage_bucket: bucket,
    storage_prefix: storagePrefix,
    source_storage_bucket: 'app-source',
    source_storage_prefix: storagePrefix,
  };
  await updateAppVersion(supabaseUrl, supabaseKey, appId, newVersion, deployManifest);

  return { version: newVersion };
}
