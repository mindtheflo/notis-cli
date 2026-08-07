/**
 * App platform utilities for the Notis CLI.
 *
 * Handles project scaffolding, validation, building, and linking. This is the
 * CLI-side counterpart to @notis/sdk -- it reads notis.config.ts, runs the
 * Vite build, and packages the bundle for deployment.
 */

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { usageError } from './errors.js';
import { validateArtifactBoundary, validateProjectBoundary } from './app-boundary-validator.js';
import { readAppChangelog } from './app-changelog.js';

const NOTIS_DIR = '.notis';
const STATE_FILE = join(NOTIS_DIR, 'state.json');
const OUTPUT_DIR = join(NOTIS_DIR, 'output');
const BUNDLE_DIR = join(OUTPUT_DIR, 'bundle');
const MANIFEST_FILE = join(OUTPUT_DIR, 'manifest.json');
const METADATA_DIR = 'metadata';
const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MONOREPO_SCAFFOLDS_DIR = resolve(CLI_ROOT, '../..', 'scaffolds');
const DIST_DIR = join(CLI_ROOT, 'dist');
const SCAFFOLD_CATALOG_FILE = join(DIST_DIR, 'scaffolds.json');
const SCAFFOLD_SOURCE_DIR = join(DIST_DIR, 'scaffolds');
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
]);
const SCAFFOLD_COPY_EXCLUDES = new Set([
  ...SOURCE_COPY_EXCLUDES,
  'coverage',
  '.next',
  '.turbo',
]);
let appConfigImportNonce = 0;

// ---------------------------------------------------------------------------
// Project directory resolution
// ---------------------------------------------------------------------------

export function resolveProjectDir(inputDir = '.') {
  return resolve(process.cwd(), inputDir);
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
    path: String(skill.path || '').replace(/^\.\/+/, ''),
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
    skills,
    onboarding: appConfig.onboarding || null,
  };
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
  return normalized;
}

export function resolveConfiguredAppSkills(appConfig, projectDir) {
  const configured = Array.isArray(appConfig.skills) ? appConfig.skills : [];
  const projectRoot = resolve(projectDir);
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
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      throw usageError(`App skill entrypoint not found: ${sourcePath}`);
    }

    return {
      key,
      path: relativePath,
      name,
      description: typeof skill.description === 'string' ? skill.description.trim() : null,
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

export function readLinkedState(projectDir) {
  const statePath = join(projectDir, STATE_FILE);
  if (!existsSync(statePath)) return null;
  return JSON.parse(readFileSync(statePath, 'utf-8'));
}

export function writeLinkedState(projectDir, state) {
  const statePath = join(projectDir, STATE_FILE);
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
}

export function requireLinkedAppId(projectDir, explicitAppId) {
  if (explicitAppId) return explicitAppId;
  const state = readLinkedState(projectDir);
  if (state?.app_id) return state.app_id;
  throw usageError('This project is not linked to a Notis app. Run "notis apps link <app-id> ." first.');
}

// ---------------------------------------------------------------------------
// Scaffolding
// ---------------------------------------------------------------------------

/**
 * Scaffold a new Notis app project from the SDK template.
 */
export function loadScaffoldCatalog() {
  if (existsSync(SCAFFOLD_CATALOG_FILE)) {
    const parsed = JSON.parse(readFileSync(SCAFFOLD_CATALOG_FILE, 'utf-8'));
    const scaffolds = Array.isArray(parsed?.scaffolds) ? parsed.scaffolds : parsed;
    return Array.isArray(scaffolds)
      ? scaffolds.filter((entry) => entry && typeof entry.slug === 'string')
      : [];
  }
  return loadMonorepoScaffoldCatalog();
}

export function scaffoldProject({ projectDir, appName, fromSlug = null }) {
  const templateDir = fromSlug ? resolveScaffoldSourceDir(fromSlug) : join(CLI_ROOT, 'template');

  if (!existsSync(templateDir)) {
    if (fromSlug) {
      const known = loadScaffoldCatalog().map((entry) => entry.slug).join(', ') || 'none';
      throw usageError(`Unknown scaffold "${fromSlug}". Available scaffolds: ${known}.`);
    }
    throw usageError(`SDK template not found at ${templateDir}. Ensure @notis_ai/cli is installed correctly.`);
  }

  mkdirSync(projectDir, { recursive: true });
  copyScaffoldSource(templateDir, projectDir);

  // Update package.json with the app name
  const pkgPath = join(projectDir, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    pkg.name = appName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    // A scaffold creates a new app identity, even when its source comes from a
    // versioned Store example. New apps must therefore start their own release
    // history instead of inheriting the example app's registry version.
    pkg.notisAppVersion = '0.1.0';
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
    writeFileSync(configPath, config);
  }

  return { projectDir };
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

function resolveScaffoldSourceDir(fromSlug) {
  const bundledDir = join(SCAFFOLD_SOURCE_DIR, fromSlug);
  if (existsSync(bundledDir)) {
    return bundledDir;
  }
  const monorepoDir = join(MONOREPO_SCAFFOLDS_DIR, fromSlug);
  if (existsSync(join(monorepoDir, 'notis.config.ts'))) {
    return monorepoDir;
  }
  return bundledDir;
}

function loadMonorepoScaffoldCatalog() {
  if (!existsSync(MONOREPO_SCAFFOLDS_DIR)) {
    return [];
  }
  const scaffolds = [];
  for (const entry of readdirSync(MONOREPO_SCAFFOLDS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) {
      continue;
    }
    const configPath = join(MONOREPO_SCAFFOLDS_DIR, entry.name, 'notis.config.ts');
    if (!existsSync(configPath)) {
      continue;
    }
    const configSource = readFileSync(configPath, 'utf-8');
    const description = readTsStringProperty(configSource, 'description') || '';
    scaffolds.push({
      slug: entry.name,
      name: readTsStringProperty(configSource, 'title') || readTsStringProperty(configSource, 'name') || entry.name,
      description,
      icon: readTsStringProperty(configSource, 'icon') || 'phosphor:squares-four',
      categories: readTsStringArrayProperty(configSource, 'categories'),
      tagline: readTsStringProperty(configSource, 'tagline') || description,
    });
  }
  return scaffolds.sort((a, b) => a.slug.localeCompare(b.slug));
}

function readTsStringProperty(source, propertyName) {
  const match = source.match(new RegExp(`\\b${propertyName}\\s*:\\s*(['"\`])([\\s\\S]*?)\\1`));
  return match ? match[2] : null;
}

function readTsStringArrayProperty(source, propertyName) {
  const match = source.match(new RegExp(`\\b${propertyName}\\s*:\\s*\\[([\\s\\S]*?)\\]`));
  if (!match) {
    return [];
  }
  return Array.from(match[1].matchAll(/(['"`])([\s\S]*?)\1/g), (entry) => entry[2].trim()).filter(Boolean);
}

function copyScaffoldSource(sourceDir, targetDir) {
  function shouldCopy(path) {
    const name = path.split(/[\\/]/).pop();
    if (!name) return true;
    return !SCAFFOLD_COPY_EXCLUDES.has(name)
      && !name.startsWith('.env')
      && !/\.(test|spec)\.[cm]?[jt]sx?$/i.test(name);
  }

  function walk(src, dest) {
    if (!shouldCopy(src)) {
      return;
    }
    const stat = statSync(src);
    if (stat.isDirectory()) {
      mkdirSync(dest, { recursive: true });
      for (const entry of readdirSync(src)) {
        walk(join(src, entry), join(dest, entry));
      }
      return;
    }
    if (stat.isFile()) {
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(src, dest);
    }
  }

  walk(sourceDir, targetDir);
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
  return SOURCE_COPY_EXCLUDES.has(name) || name.startsWith('.env');
}

function readSourceFiles(projectDir) {
  const files = {};

  function walk(dir, prefix) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldExcludeSourceEntry(entry.name) || entry.isSymbolicLink()) {
        continue;
      }
      const fullPath = join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        files[relPath] = readFileSync(fullPath);
      }
    }
  }

  walk(projectDir, '');
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

function extractTarGz(buffer, targetDir) {
  const tar = gunzipSync(buffer);
  let offset = 0;
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
    const relPath = cleanTarPath(fullName);
    const outputPath = join(targetDir, relPath);

    if (typeFlag === 53) {
      mkdirSync(outputPath, { recursive: true });
    } else {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, tar.subarray(offset, offset + size));
    }

    offset += Math.ceil(size / 512) * 512;
  }
}

export async function pullAppSource({
  apiBase,
  jwt,
  appId,
  targetDir,
  version = 'latest',
  force = false,
}) {
  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    if (!force) {
      throw usageError(`Target directory is not empty: ${targetDir}. Pass --force to overwrite it.`);
    }
    rmSync(targetDir, { recursive: true, force: true });
  }
  mkdirSync(targetDir, { recursive: true });

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
  extractTarGz(Buffer.from(await response.arrayBuffer()), targetDir);
  const linkedVersion = pulledVersion || (
    String(version || 'latest') === 'latest'
      ? undefined
      : Number.parseInt(String(version), 10)
  );
  writeLinkedState(targetDir, {
    app_id: appId,
    ...(Number.isFinite(linkedVersion) ? { version: linkedVersion } : {}),
    linked_at: new Date().toISOString(),
  });

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
      accent: manifest?.app?.accent ?? null,
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
