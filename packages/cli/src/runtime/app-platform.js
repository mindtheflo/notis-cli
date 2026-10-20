/**
 * App platform utilities for the Notis CLI.
 *
 * Handles project scaffolding, validation, building, and Space source pulls.
 * This is the CLI-side counterpart to @notis/sdk -- it reads notis.config.ts,
 * runs the Vite build, and packages the bundle for deployment.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants as fsConstants, copyFileSync, cpSync, existsSync, fstatSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { usageError } from './errors.js';
import { validateArtifactBoundary } from './app-boundary-validator.js';
import { HOST_ONLY_SDK_FILES, RETIRED_SDK_FILES } from './retired-sdk-files.js';
import { assertSourceRoot } from './source-root.js';

const NOTIS_DIR = '.notis';
const SPACE_SOURCE_FILE = join(NOTIS_DIR, 'space-source.json');
const OUTPUT_DIR = join(NOTIS_DIR, 'output');
const BUNDLE_DIR = join(OUTPUT_DIR, 'bundle');
const MANIFEST_FILE = join(OUTPUT_DIR, 'manifest.json');
const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE_SDK_DIR = join(CLI_ROOT, 'dist', 'sdk');
// Spaces install only types and build-time entries; the host provides the SDK
// at runtime (scripts/build-space-sdk.js).
const SPACE_SDK_DIR = join(CLI_ROOT, 'dist', 'space-sdk');
const SOURCE_COPY_EXCLUDES = new Set([
  'node_modules',
  '.notis',
  '.git',
  '.context',
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
  // The CLI reads its own template/.harness theme; projects never use a copy.
  '.harness',
]);
const PULL_LOCK_TIMEOUT_MS = 30_000;
const PULL_LOCK_POLL_MS = 25;
let appConfigImportNonce = 0;

// ---------------------------------------------------------------------------
// Project directory resolution
// ---------------------------------------------------------------------------

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
    // Keep defaults on both the Portal shadow host and the app root used
    // by the standalone harness. Removing :root erases Tailwind v4 theme
    // variables in previews, collapsing spacing, type sizes and controls.
    .replace(/(?:html|:root)\s*,\s*:host\s*\{/g, '[data-notis-app-root],:host{')
    .replace(/:root\s*\{/g, '[data-notis-app-root],:host{')
    .replace(/html\s*\{/g, '[data-notis-app-root],:host{')
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
    .replace(/import\s*{([^}]+)}\s+from\s+['"]@notis\/sdk\/config['"]\s*;?/g, (_statement, names) => {
      const declarations = [];
      for (const imported of names.split(',').map(value => value.trim()).filter(Boolean)) {
        if (imported.startsWith('type ')) continue;
        const match = imported.match(/^(defineNotisApp|defineSpace|defineSpaces)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (!match) throw usageError(`Unsupported configuration helper: ${imported}`);
        declarations.push(`const ${match[2] || match[1]} = (value) => value;`);
      }
      return declarations.join('\n');
    });
}

function transpileTsConfigSource(source, configPath) {
  // Strip the @notis/sdk/config import unconditionally. The SDK package often
  // points its `exports` at raw .ts source, which Node cannot import from the
  // temp .mjs file we emit below. The config helpers are identity functions,
  // so replacing the import with local identity functions preserves the
  // config value without ever resolving the SDK.
  const stripped = stripNotisSdkImports(source);
  try {
    const { transformSync } = createRequire(import.meta.url)('esbuild');
    return transformSync(stripped, { loader: 'ts', format: 'esm', target: 'es2020', sourcefile: configPath }).code;
  } catch (error) {
    throw usageError(`Failed to parse ${configPath}: ${error.message}`);
  }
}

export async function loadAppConfig(projectDir, { file = null } = {}) {
  const configPaths = file ? [file] : ['notis.config.ts', 'notis.config.js', 'notis.config.mjs'];
  if (file && (!Object.hasOwn(collectSourceFiles(projectDir), file) || !/\.(?:ts|js|mjs)$/.test(file))) {
    throw usageError('Choose an existing configuration file inside this source project.');
  }
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

  // Identity config helpers work for every extension without asking Node to
  // execute raw TypeScript from an embedded SDK package.
  {
    const source = readFileSync(configPath, 'utf-8');
    const jsSource = configPath.endsWith('.ts') ? transpileTsConfigSource(source, configPath) : stripNotisSdkImports(source);

    const tmpPath = join(dirname(configPath), `._notis_config_${randomUUID()}.mjs`);
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

}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export async function runProjectScript({ projectDir, scriptName, args = [], env = {}, stdio = 'inherit' }) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('npm', ['run', scriptName, ...(args.length ? ['--', ...args] : [])], {
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
 * Build a bundle in place: `prepare` writes the entry file and manifest, the
 * build script packages into .notis/output/, then the build receipt is saved.
 * Space builds supply `prepare` (see space-platform.js).
 */
export async function buildArtifact(projectDir, { stdio = 'inherit', prepare,
  finalize = null, executable = true, refreshSdk = true, runBuild = runProjectScript } = {}) {
  if (typeof prepare !== 'function') {
    throw new TypeError('buildArtifact needs a prepare step that writes the entry file and manifest.');
  }
  projectDir = realpathSync(assertSourceRoot(projectDir));
  const workspace = withAppReleaseWorkspace(projectDir, (identity) => {
    rmSync('build-receipt.json', { force: true });
    return identity;
  }, { create: true });
  // SDK refresh is intentional source preparation, before the immutable build receipt.
  if (refreshSdk) syncEmbeddedSdk(projectDir);
  const sourceHash = appFilesDigest(collectSourceFiles(projectDir));
  await prepare(projectDir);

  // Historical source must round-trip byte-for-byte. Supply the compatible
  // config loader at execution for the old canonical script, without editing
  // pulled package.json files or interpreting custom shell commands.
  const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
  const args = String(pkg.scripts?.build || '').trim() === 'vite build'
    ? ['--configLoader', 'runner']
    : [];
  // runBuild defaults to the PATH npm script. A confined caller supplies a pinned runner instead.
  if (executable) await runBuild({ projectDir, scriptName: 'build', args, stdio });

  withAppReleaseWorkspace(projectDir, () => {}, { expected: workspace });

  // Verify the canonical `.notis/output/bundle` packaging contract.
  const builtBundleDir = resolveBuiltBundleDir(projectDir);
  if (executable && !builtBundleDir) {
    throw usageError(
      'Vite build did not produce app.js in .notis/output/bundle. Check your vite.config.ts.',
    );
  }
  normalizeBundleStylesheets(projectDir);
  if (finalize) await finalize(projectDir);
  withAppReleaseWorkspace(projectDir, () => {}, { expected: workspace });

  validateArtifactBoundary(readArtifactFiles(projectDir));

  const manifest = readManifest(projectDir);

  if (sourceHash !== appFilesDigest(collectSourceFiles(projectDir))) {
    throw usageError('App source changed during the build. Build again before deploying.');
  }
  const receipt = JSON.stringify({
    source_hash: sourceHash,
    artifact_hash: appFilesDigest(collectArtifactFiles(projectDir)),
  });
  withAppReleaseWorkspace(projectDir, () => {
    const temporary = `.build-receipt-${randomUUID()}`;
    try {
      writeFileSync(temporary, receipt, { flag: 'wx' });
      renameSync(temporary, 'build-receipt.json');
    } finally { rmSync(temporary, { force: true }); }
  }, { expected: workspace });
  return { manifest, outputDir: join(projectDir, OUTPUT_DIR) };
}

/**
 * Read the manifest from a built project.
 */
export function readManifest(projectDir) {
  const manifestPath = join(projectDir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw usageError('No manifest found. Run "notis spaces build" first.');
  }
  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

// ---------------------------------------------------------------------------
// Scaffolding
// ---------------------------------------------------------------------------

/**
 * Scaffold a new project from the SDK template.
 */
export async function scaffoldProject({ projectDir, appName }) {
  return scaffoldProjectFromDir({
    projectDir,
    appName,
    templateDir: join(CLI_ROOT, 'template'),
  });
}

function scaffoldProjectFromDir({ projectDir, appName, templateDir }) {
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
      throw usageError(`Scaffold target changed before copying: ${requestedProjectDir}`);
    }
    if (!lockedTargetIdentity.exists) {
      try {
        mkdirSync(targetName);
      } catch (error) {
        if (error?.code === 'EEXIST') {
          throw usageError(`Scaffold target changed before copying: ${requestedProjectDir}`);
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
      throw usageError(`Scaffold target changed before copying: ${requestedProjectDir}`);
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
      ensureScaffoldLocalSdk(projectDir, pkg);
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      normalizeScaffoldLockfile(projectDir, pkg);
    }

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
          throw usageError(`Scaffold destination changed during installation: ${relativePath}`);
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
            throw usageError(`Scaffold destination changed during installation: ${parentRelativePath || '.'}`);
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
        `Scaffold was installed, but staging cleanup failed; recovery files were retained at `
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

function captureScaffoldTargetIdentity(targetDir) {
  try {
    const targetStat = lstatSync(targetDir, { bigint: true });
    if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
      throw usageError(`Refusing to scaffold through an unsafe target: ${targetDir}`);
    }
    if (readdirSync(targetDir).length > 0) {
      throw usageError(`Scaffold target must be empty: ${targetDir}`);
    }
    return { exists: true, dev: targetStat.dev, ino: targetStat.ino };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, dev: null, ino: null };
    throw error;
  }
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
  if (!existsSync(join(TEMPLATE_SDK_DIR, 'package.json'))) {
    throw usageError(`SDK template not found at ${TEMPLATE_SDK_DIR}. Ensure @notis_ai/cli is installed correctly.`);
  }

  mkdirSync(dirname(localSdkDir), { recursive: true });
  cpSync(TEMPLATE_SDK_DIR, localSdkDir, { recursive: true, dereference: true,
    filter: (source) => !HOST_ONLY_SDK_FILES.includes(relative(TEMPLATE_SDK_DIR, source).split(sep).join('/')) });
}

function listFilesRecursive(dir, base = dir, results = []) {
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      listFilesRecursive(fullPath, base, results);
    } else {
      results.push(relative(base, fullPath).split(sep).join('/'));
    }
  }
  return results;
}

/**
 * Keep an app's embedded public SDK identical to the SDK this CLI ships,
 * excluding host-only mounting code. The copy is a mirror by contract (the parity test in the CLI keeps
 * the bundled artifact generated from packages/sdk), so an app never edits it; before
 * this sync existed every app silently ran whatever SDK snapshot it was
 * scaffolded with and never received hook or style updates.
 *
 * Files that exist locally but not in the template are left alone with a
 * warning so a deliberate local addition is never destroyed. The refresh owns
 * only packages/sdk/{package.json,tsconfig.json,src/<template files>} and the
 * exact retired copies of a real source; a folder without a source marker
 * (the Notis repository's own packages/sdk, for one) is refused untouched.
 *
 * `prune` (Spaces) makes the mirror exact instead: every owned file the
 * template does not ship (packages/sdk/tsconfig.json, src/* and dist/*, the
 * Space SDK's Node test runtime) is removed.
 */
export function syncEmbeddedSdk(projectDir, { log = null, templateSdkDir = TEMPLATE_SDK_DIR, retiredFiles = RETIRED_SDK_FILES, prune = false } = {}) {
  const canonicalProjectDir = realpathSync(assertSourceRoot(projectDir));
  const canonicalTemplateDir = resolve(templateSdkDir);
  if (!existsSync(join(canonicalTemplateDir, 'package.json'))) {
    return { updated: false, reason: 'no-template-sdk' };
  }
  const previousCwd = process.cwd();
  const previousIdentity = capturePullTargetIdentity(previousCwd);
  const projectIdentity = capturePullTargetIdentity(canonicalProjectDir);
  // listFilesRecursive skips every dist/ folder; an exact mirror owns the top-level one.
  const listOwned = (dir) => [...listFilesRecursive(dir),
    ...(prune ? listFilesRecursive(join(dir, 'dist')).map((relPath) => `dist/${relPath}`) : [])];
  const templateFiles = listOwned(canonicalTemplateDir).filter(
    (relPath) => !HOST_ONLY_SDK_FILES.includes(relPath)
      && (relPath === 'package.json' || relPath === 'tsconfig.json' || relPath.startsWith('src/') || relPath.startsWith('dist/')),
  );
  const changed = [];
  let foreign = [];

  // Pin each app-controlled parent as cwd before touching a child. Absolute
  // path writes would follow a replaced packages/sdk or src directory link.
  function inDirectory(name, callback, { create = false } = {}) {
    const parentIdentity = capturePullTargetIdentity('.');
    let identity = capturePullTargetIdentity(name);
    if (!identity.exists) {
      if (!create) return { updated: false, reason: 'no-embedded-sdk' };
      mkdirSync(name);
      identity = capturePullTargetIdentity(name);
    }
    process.chdir(name);
    try {
      assertPullTargetIdentity('.', identity);
      return callback();
    } finally {
      process.chdir('..');
      assertPullTargetIdentity('.', parentIdentity);
    }
  }

  function mirrorFile(segments, source) {
    if (segments.length > 1) {
      return inDirectory(segments[0], () => mirrorFile(segments.slice(1), source), { create: true });
    }
    const name = segments[0];
    let before;
    try { before = lstatSync(name, { bigint: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (before) {
      if (before.isSymbolicLink() || !before.isFile()) {
        throw usageError(`Refusing to refresh the SDK through an unsafe target: ${name}`);
      }
      const descriptor = openSync(name, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      try {
        if (Buffer.compare(readStablePinnedFile(descriptor, before, `SDK file ${name}`), source) === 0) return false;
      } finally { closeSync(descriptor); }
    }
    // Replace, never truncate: an app-controlled hard link must not modify
    // another file. O_EXCL staging and rename are relative to the pinned cwd.
    const temporary = `.notis-sdk-sync-${randomUUID()}`;
    try {
      writeFileSync(temporary, source, { flag: 'wx' });
      renameSync(temporary, name);
    } finally { rmSync(temporary, { force: true }); }
    return true;
  }

  function retireFile(segments, digests) {
    if (segments.length > 1) return inDirectory(segments[0], () => retireFile(segments.slice(1), digests));
    const name = segments[0];
    let before;
    try { before = lstatSync(name, { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    if (!before.isFile() || before.isSymbolicLink()) throw usageError(`Refusing an unsafe retired SDK target: ${name}`);
    const descriptor = openSync(name, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const bytes = readStablePinnedFile(descriptor, before, `Retired SDK file ${name}`);
      if (!digests.includes(createHash('sha256').update(bytes).digest('hex'))) return false;
      // Capture the exact directory entry before removing anything. A newly
      // created replacement at the original path is never overwritten.
      const temporary = `.notis-sdk-retired-${randomUUID()}`;
      renameSync(name, temporary);
      try {
        const captured = lstatSync(temporary, { bigint: true });
        if (captured.dev !== before.dev || captured.ino !== before.ino) {
          throw usageError(`SDK file changed during retirement: ${name}`);
        }
        const capturedDescriptor = openSync(temporary, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        try {
          if (!readStablePinnedFile(capturedDescriptor, captured, `Retired SDK file ${name}`).equals(bytes)) {
            throw usageError(`SDK file changed during retirement: ${name}`);
          }
        } finally { closeSync(capturedDescriptor); }
        unlinkSync(temporary);
      } catch (error) {
        // O_EXCL hard-link restoration preserves an independently-created
        // replacement as well as the captured local bytes.
        try { linkSync(temporary, name); unlinkSync(temporary); } catch { /* Retain the captured file for reconciliation. */ }
        throw error;
      }
      return true;
    } finally { closeSync(descriptor); }
  }

  // Unlink one directory entry relative to the pinned cwd; never follows a link.
  function removeFile(segments) {
    if (segments.length > 1) return inDirectory(segments[0], () => removeFile(segments.slice(1)));
    try { unlinkSync(segments[0]); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }

  function removeEmptyDirectories() {
    for (const entry of readdirSync('.', { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      inDirectory(entry.name, removeEmptyDirectories);
      try { rmdirSync(entry.name); }
      catch (error) { if (error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST' && error.code !== 'ENOENT') throw error; }
    }
  }

  try {
    process.chdir(canonicalProjectDir);
    assertPullTargetIdentity('.', projectIdentity);
    const result = inDirectory('packages', () => inDirectory('sdk', () => {
      let packageStat;
      try { packageStat = lstatSync('package.json'); }
      catch (error) {
        if (error.code === 'ENOENT') return { updated: false, reason: 'no-embedded-sdk' };
        throw error;
      }
      if (packageStat.isSymbolicLink() || !packageStat.isFile()) {
        throw usageError('Refusing to refresh the SDK through an unsafe package.json target.');
      }
      for (const relPath of templateFiles) {
        const source = readFileSync(join(canonicalTemplateDir, relPath));
        if (mirrorFile(relPath.split('/'), source)) changed.push(relPath);
      }
      const templateSet = new Set(templateFiles);
      for (const [relPath, digests] of Object.entries(retiredFiles)) {
        if (!templateSet.has(relPath) && retireFile(relPath.split('/'), digests) === true) changed.push(relPath);
      }
      foreign = listOwned('.').filter((relPath) => (relPath.startsWith('src/') || (prune && (relPath === 'tsconfig.json' || relPath.startsWith('dist/'))))
        && !templateSet.has(relPath));
      if (prune) {
        for (const relPath of foreign) {
          if (removeFile(relPath.split('/'))) changed.push(relPath);
        }
        foreign = [];
        inDirectory('src', removeEmptyDirectories);
        inDirectory('dist', removeEmptyDirectories);
        try { rmdirSync('dist'); }
        catch (error) { if (error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST' && error.code !== 'ENOENT') throw error; }
      }
      return null;
    }));
    if (result) return result;
    assertPullTargetIdentity('.', projectIdentity);
  } finally {
    process.chdir(previousCwd);
    assertPullTargetIdentity('.', previousIdentity);
  }

  const templateVersion = JSON.parse(readFileSync(join(canonicalTemplateDir, 'package.json'), 'utf-8')).version;
  const emit = typeof log === 'function' ? log : (message) => process.stderr.write(`${message}\n`);
  if (changed.length > 0) {
    emit(`Updated embedded @notis/sdk to ${templateVersion} (${changed.length} file${changed.length === 1 ? '' : 's'}).`);
  }
  for (const relPath of foreign) {
    emit(`Warning: packages/sdk/${relPath} is not part of the @notis/sdk template and was left unchanged.`);
  }
  return { updated: changed.length > 0, changed, foreign, templateVersion };
}

/**
 * A Space's packages/sdk is exactly the package this CLI ships for Spaces
 * (dist/space-sdk): host-module types, the build-time and pure entries, and a
 * Node-only runtime for the Space's own tests. A Space view never loads SDK
 * code of its own, so the mirror is pruned, not merged.
 */
export function syncSpaceSdk(projectDir, { log = null, templateSdkDir = SPACE_SDK_DIR, updateLock = updatePackageLock } = {}) {
  if (!existsSync(join(templateSdkDir, 'package.json'))) {
    throw usageError(`Space SDK not found at ${templateSdkDir}. Ensure @notis_ai/cli is installed correctly.`);
  }
  const result = syncEmbeddedSdk(projectDir, { log, templateSdkDir, retiredFiles: {}, prune: true });
  if (result.reason) return result;
  const manifest = JSON.parse(readFileSync(join(templateSdkDir, 'package.json'), 'utf-8'));
  return { ...result, lockfile: reconcileSdkLockfile(realpathSync(projectDir), { manifest, log, updateLock }) };
}

// The package.json fields npm records for a linked package. `npm ci` checks a
// lock against the linked package.json, so a changed SDK dependency makes it
// refuse a lock written for the previous SDK.
const LOCKED_MANIFEST_FIELDS = ['name', 'version', 'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta'];

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** True when a lock entry records exactly this manifest (an absent map equals an empty one). */
export function lockRecordsManifest(entry, manifest) {
  if (!entry || typeof entry !== 'object') return false;
  return LOCKED_MANIFEST_FIELDS.every((field) => {
    const absent = field === 'name' || field === 'version' ? null : {};
    return canonicalJson(entry[field] ?? absent) === canonicalJson(manifest[field] ?? absent);
  });
}

// The lock only: no install scripts, node_modules untouched. One quick retry
// keeps an offline machine from waiting out npm's minute-long default backoff,
// and npm still answers from its cache when the network is down.
const LOCK_UPDATE_ARGS = Object.freeze(['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund',
  '--fetch-retries=1', '--fetch-retry-mintimeout=1000']);

function updatePackageLock(projectDir) {
  const result = spawnSync('npm', [...LOCK_UPDATE_ARGS], {
    cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000, shell: process.platform === 'win32',
  });
  if (result.error) {
    return { ok: false, detail: result.error.code === 'ETIMEDOUT' ? 'npm did not finish within 3 minutes' : result.error.message };
  }
  if (result.status === 0) return { ok: true };
  return { ok: false, detail: npmFailureReason(`${result.stderr || ''}\n${result.stdout || ''}`) || `npm exited with code ${result.status}` };
}

/** npm's reason in one line: its first error line that is not code/syscall/errno metadata, a stack frame or the log pointer. */
export function npmFailureReason(output) {
  const lines = String(output || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const meaningful = (line) => line && !/^(code|syscall|errno)\s/.test(line) && !/^at\s/.test(line) && !/complete log of this run/i.test(line);
  const errors = lines.filter((line) => /^npm (error|ERR!)/.test(line)).map((line) => line.replace(/^npm (error|ERR!)\s*/, ''));
  return errors.find(meaningful) || lines.find(meaningful) || '';
}

/**
 * Keep package-lock.json in step with the mirrored @notis/sdk so `npm ci`
 * accepts it. npm runs only when the lock's packages/sdk record differs from
 * the mirrored manifest (`npm install --package-lock-only`: the lock only,
 * no scripts, node_modules untouched). A failure, such as an offline
 * machine, is a warning: the sync and the build or pull that ran it continue,
 * and the next sync retries.
 */
export function reconcileSdkLockfile(projectDir, { manifest, log = null, updateLock = updatePackageLock } = {}) {
  const emit = typeof log === 'function' ? log : (message) => process.stderr.write(`${message}\n`);
  const lockPath = join(projectDir, 'package-lock.json');
  const readLock = () => JSON.parse(readFileSync(lockPath, 'utf-8'));
  let project, lock;
  try {
    project = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'));
    lock = readLock();
  } catch {
    return 'absent'; // No npm lock to keep, or one npm itself reports as unreadable.
  }
  const spec = project?.dependencies?.['@notis/sdk'] ?? project?.devDependencies?.['@notis/sdk'];
  if (typeof spec !== 'string' || !/^file:(\.\/)?packages\/sdk\/?$/.test(spec)) return 'unlinked';
  if (!lock?.packages || typeof lock.packages !== 'object') return 'unsupported'; // lockfileVersion 1
  if (lockRecordsManifest(lock.packages['packages/sdk'], manifest)) return 'current';
  const outcome = updateLock(projectDir);
  let current = false;
  try { current = lockRecordsManifest(readLock().packages?.['packages/sdk'], manifest); } catch { /* Reported below. */ }
  if (outcome.ok && current) {
    emit(`Updated package-lock.json for @notis/sdk ${manifest.version}. Run npm install to bring node_modules up to date.`);
    return 'updated';
  }
  emit(`Warning: package-lock.json still records the previous @notis/sdk dependencies, so npm ci will refuse it${outcome.detail ? ` (${outcome.detail})` : ''}. `
    + 'Everything else continues; run npm install in this project once the npm registry is reachable.');
  return 'stale';
}

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
    throw usageError('No build output found. Run "notis spaces build" first.');
  }

  validateArtifactBoundary(readArtifactFiles(projectDir));

  const files = {};

  function walk(dir, prefix) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || (!prefix && entry.name === 'verify.json')) continue;
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
    || casefolded.startsWith('._notis_config_')
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
  // Source snapshots allow 256 MiB of files plus bounded tar/PAX metadata.
  const tar = gunzipSync(buffer, { maxOutputLength: 320 * 1024 * 1024 });
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
      throw usageError(`Refusing to pull Space source through an unsafe target: ${targetDir}`);
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
    throw usageError(`Space source pull target changed while the download was in progress: ${targetDir}`);
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
    throw usageError(`Space source pull parent changed while the download was in progress: ${parentDir}`);
  }
  if (
    currentCanonicalParent !== canonicalParent
    || !pullTargetIdentitiesMatch(
      capturePullTargetIdentity(canonicalParent),
      expectedIdentity,
    )
  ) {
    throw usageError(`Space source pull parent changed while the download was in progress: ${parentDir}`);
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
    throw usageError(`Space source pull target changed before locking: ${requestedTarget}`);
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
        throw usageError(`Refusing to use unsafe Space source pull lock: ${lockDirectory}`);
      }
      if (Date.now() >= deadline) {
        throw usageError(
          `Timed out waiting to pull Space source into ${targetDir}. `
          + `If no pull process is running, remove the orphaned lock: ${lockDirectory}`,
        );
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, PULL_LOCK_POLL_MS));
    }
  }

  try {
    const assertOwnership = () => {
      if (readPullLockOwner(lockDirectory)?.id !== ownerId) {
        throw usageError(`Lost the Space source pull lock for ${targetDir}.`);
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
      throw usageError(`Space source pull target changed before locking: ${requestedTarget}`);
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

function assertPullStatePathSafe(projectDir) {
  const notisDir = join(projectDir, NOTIS_DIR);
  try {
    const directoryStat = lstatSync(notisDir);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw usageError(`Refusing to use unsafe Notis state directory: ${notisDir}`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const statePath = join(projectDir, SPACE_SOURCE_FILE);
  try {
    const stateStat = lstatSync(statePath);
    if (stateStat.isSymbolicLink() || !stateStat.isFile()) {
      throw usageError(`Refusing to use unsafe Notis state file: ${statePath}`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
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
  targetDir,
  version = 'latest',
  force = false,
  downloadSource,
  sourceLink,
}, assertLockOwnership, assertParentIdentity, initialTargetIdentity) {
  assertLockOwnership();
  assertParentIdentity();
  const targetWasNonEmpty = existsSync(targetDir) && readdirSync(targetDir).length > 0;
  if (targetWasNonEmpty) {
    if (!force) {
      throw usageError(`Target directory is not empty: ${targetDir}. Pull into a new or empty directory.`);
    }
  }

  const { archiveBuffer, revision: pulledVersion } = await downloadSource();
  const requestedVersion = String(version || 'latest') === 'latest'
    ? null
    : Number.parseInt(String(version), 10);
  if (!Number.isInteger(pulledVersion) || pulledVersion <= 0) {
    throw usageError('The Space source response did not identify a valid positive version.');
  }
  if (requestedVersion !== null && (!Number.isInteger(requestedVersion) || requestedVersion <= 0)) {
    throw usageError(`Invalid Space source version: ${version}`);
  }
  if (
    requestedVersion !== null
    && pulledVersion !== requestedVersion
  ) {
    throw usageError(
      `Requested Space source version ${requestedVersion}, but the server returned version ${pulledVersion}.`,
    );
  }
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
          throw usageError(`Space source pull target changed while the download was in progress: ${targetDir}`);
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
      throw usageError(`Space source pull target changed while the download was in progress: ${targetDir}`);
    }
    assertLockOwnership();
    process.chdir(targetName);
    assertPullTargetIdentity('.', activeTargetIdentity);
    const targetRoot = '.';
    assertPullStatePathSafe(targetRoot);
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
      throw usageError('The Space source archive did not contain any editable source files.');
    }

    const previousStatePath = join(targetRoot, SPACE_SOURCE_FILE);
    const backupStatePath = join(backupDir, SPACE_SOURCE_FILE);
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
      withAppReleaseWorkspace(targetRoot, () => {
        const temporary = `.space-source-${randomUUID()}.json`;
        try {
          writeFileSync(temporary, JSON.stringify({ ...sourceLink, revision: pulledVersion }), { flag: 'wx', mode: 0o600 });
          renameSync(temporary, basename(SPACE_SOURCE_FILE));
        } finally { rmSync(temporary, { force: true }); }
      }, { create: true });
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
        `Space source was updated, but transaction cleanup failed; recovery files were retained at `
        + `${transactionDisplayPath}: ${cleanupMessage}`,
      );
    }
  }

  return { projectDir: targetDir, version: pulledVersion };
}

function readArtifactFiles(projectDir) {
  const outputDir = join(projectDir, OUTPUT_DIR);
  if (!existsSync(outputDir)) {
    throw usageError('No build output found. Run "notis spaces build" first.');
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

/** Fingerprint exact source/artifact bytes, independent of directory enumeration order. */
export function appFilesDigest(files) {
  return createHash('sha256').update(JSON.stringify(Object.keys(files).sort().map((key) => [key, files[key]]))).digest('hex');
}

/** Run synchronous release bookkeeping relative to a pinned, real .notis directory. */
function withAppReleaseWorkspace(projectDir, operation, { create = false, expected = null } = {}) {
  const canonicalProjectDir = expected?.projectDir || realpathSync(projectDir);
  const projectIdentity = expected?.projectIdentity || capturePullTargetIdentity(canonicalProjectDir);
  const previousCwd = process.cwd();
  const previousIdentity = capturePullTargetIdentity(previousCwd);
  try {
    process.chdir(canonicalProjectDir);
    assertPullTargetIdentity('.', projectIdentity);
    let notisIdentity = capturePullTargetIdentity(NOTIS_DIR);
    if (!notisIdentity.exists && create) {
      mkdirSync(NOTIS_DIR);
      notisIdentity = capturePullTargetIdentity(NOTIS_DIR);
    }
    if (!notisIdentity.exists) throw usageError('No build workspace found. Run notis spaces build first.');
    if (expected) assertPullTargetIdentity(NOTIS_DIR, expected.notisIdentity);
    process.chdir(NOTIS_DIR);
    assertPullTargetIdentity('.', notisIdentity);
    const value = operation({ projectDir: canonicalProjectDir, projectIdentity, notisIdentity });
    assertPullTargetIdentity('.', notisIdentity);
    assertPullTargetIdentity(canonicalProjectDir, projectIdentity);
    assertPullTargetIdentity(join(canonicalProjectDir, NOTIS_DIR), notisIdentity);
    return value;
  } finally {
    process.chdir(previousCwd);
    assertPullTargetIdentity('.', previousIdentity);
  }
}

function freezePinnedArtifactSnapshot(workspace, files, sourceFiles) {
  for (const [source, entries] of [[true, sourceFiles], [false, files]]) {
    for (const [path, encoded] of Object.entries(entries)) {
      const segments = path.split('/');
      if (!path || path.includes('\\') || path.includes('\0') || segments.some(part => !part || part === '.' || part === '..')
        || (source && segments.some(part => ['.notis', '.context', '.git', 'node_modules'].includes(part) || part.startsWith('.env')))
        || typeof encoded !== 'string') throw usageError('Unsafe frozen source or artifact path.');
    }
  }
  // Nest under the source project so imports resolve its installed dependencies.
  // Every staging write is relative to pinned directories, never a replaced parent path.
  const frozenName = mkdtempSync('release-');
  const frozenIdentity = capturePullTargetIdentity(frozenName);
  const frozenDir = join(workspace.projectDir, NOTIS_DIR, frozenName);
  let closed = false;
  const close = () => {
    process.removeListener('exit', close);
    if (closed) return;
    withAppReleaseWorkspace(workspace.projectDir, () => {
      assertPullTargetIdentity(frozenName, frozenIdentity);
      rmSync(frozenName, { recursive: true, force: true });
    }, { expected: workspace });
    closed = true;
  };
  function writeEntry(segments, content) {
    const name = segments[0];
    if (segments.length === 1) {
      writeFileSync(name, content, { flag: 'wx' });
      return;
    }
    const parentIdentity = capturePullTargetIdentity('.');
    let identity = capturePullTargetIdentity(name);
    if (!identity.exists) {
      mkdirSync(name);
      identity = capturePullTargetIdentity(name);
    }
    process.chdir(name);
    try {
      assertPullTargetIdentity('.', identity);
      writeEntry(segments.slice(1), content);
    } finally {
      process.chdir('..');
      assertPullTargetIdentity('.', parentIdentity);
    }
  }
  try {
    process.chdir(frozenName);
    try {
      assertPullTargetIdentity('.', frozenIdentity);
      for (const [path, encoded] of Object.entries(sourceFiles)) {
        writeEntry(path.split('/'), Buffer.from(encoded, 'base64'));
      }
      for (const [path, encoded] of Object.entries(files)) {
        writeEntry([NOTIS_DIR, 'output', ...path.split('/')], Buffer.from(encoded, 'base64'));
      }
    } finally {
      process.chdir('..');
      assertPullTargetIdentity('.', workspace.notisIdentity);
    }
    const manifest = files['manifest.json'] ? JSON.parse(Buffer.from(files['manifest.json'], 'base64').toString('utf8')) : null;
    process.once('exit', close);
    return { projectDir: frozenDir, files, sourceFiles, manifest, close };
  } catch (error) {
    try { close(); } catch { /* Retain owned staging if its parent identity changed. */ }
    throw error;
  }
}

/** Freeze a selected source slice using the same pinned-directory writer as releases. */
export function freezeSourceWorkspace(projectDir, sourceFiles) {
  return withAppReleaseWorkspace(projectDir, workspace => freezePinnedArtifactSnapshot(workspace, {}, sourceFiles), { create: true });
}

function selectedBuildName(key) {
  if (typeof key !== 'string' || !/^[a-z][a-z0-9_-]{0,99}$/.test(key)) throw usageError('Choose a valid selected build key.');
  return `space-build-${key}.json`;
}

/** Immutable bytes, not another authoring project or installed dependency tree. */
export function saveSelectedBuild(projectDir, key, release) {
  return withAppReleaseWorkspace(projectDir, () => {
    const name = selectedBuildName(key), temporary = `.${name}-${randomUUID()}`;
    const snapshot = { version: 1, key, files: release.files, sourceFiles: release.sourceFiles,
      source_hash: appFilesDigest(release.sourceFiles), artifact_hash: appFilesDigest(release.files) };
    try {
      writeFileSync(temporary, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, name);
    } finally { rmSync(temporary, { force: true }); }
    return join(projectDir, NOTIS_DIR, name);
  }, { create: true });
}

export function prepareSelectedBuild(projectDir, key, sourceFiles) {
  return withAppReleaseWorkspace(projectDir, workspace => {
    const name = selectedBuildName(key);
    let before;
    try { before = lstatSync(name, { bigint: true }); } catch (error) {
      if (error.code === 'ENOENT') throw usageError('Selected Space build is missing or stale. Build it again.');
      throw error;
    }
    if (!before.isFile() || before.isSymbolicLink()) throw usageError('Unsafe selected build receipt.');
    const descriptor = openSync(name, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    let snapshot;
    try { snapshot = JSON.parse(readStablePinnedFile(descriptor, before, 'Selected build receipt').toString('utf8')); }
    finally { closeSync(descriptor); }
    if (snapshot.version !== 1 || snapshot.key !== key || !snapshot.files || !snapshot.sourceFiles
      || snapshot.source_hash !== appFilesDigest(sourceFiles) || snapshot.source_hash !== appFilesDigest(snapshot.sourceFiles)
      || snapshot.artifact_hash !== appFilesDigest(snapshot.files)) throw usageError('Selected Space build is missing or stale. Build it again.');
    validateArtifactBoundary(Object.fromEntries(Object.entries(snapshot.files).map(([path, encoded]) => [path, Buffer.from(encoded, 'base64')])));
    return freezePinnedArtifactSnapshot(workspace, snapshot.files, snapshot.sourceFiles);
  });
}

/** A diagnostic, never an approval stamp or a replacement for exact-byte checks. */
export function saveSpaceVerification(projectDir, diagnostic) {
  return withAppReleaseWorkspace(projectDir, (workspace) => {
    const name = `space-verification-${randomUUID()}.json`;
    writeFileSync(name, JSON.stringify(diagnostic, null, 2), { flag: 'wx', mode: 0o600 });
    return join(workspace.projectDir, '.notis', name);
  });
}

/** Retain the original CAS after an uncertain publish response, across CLI exits. */
export function spacePublicationIntent(projectDir, identity, create = null) {
  const name = `space-publish-${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}.json`;
  return withAppReleaseWorkspace(projectDir, () => {
    if (create) {
      const temporary = `.${name}-${randomUUID()}`;
      try {
        writeFileSync(temporary, JSON.stringify(create), { flag: 'wx', mode: 0o600 });
        try { linkSync(temporary, name); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      } finally { rmSync(temporary, { force: true }); }
    }
    let before;
    try { before = lstatSync(name, { bigint: true }); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!before.isFile() || before.isSymbolicLink()) throw usageError('Unsafe Space publication receipt.');
    const descriptor = openSync(name, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try { return JSON.parse(readStablePinnedFile(descriptor, before, 'Space publication receipt').toString('utf8')); }
    finally { closeSync(descriptor); }
  });
}

function spaceStateFileName(name) {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9-]*\.json$/.test(name)) throw usageError('Unsafe local Space state file name.');
  return name;
}

/** Read one local-only JSON state file under the pinned .notis directory; null when absent. */
export function readSpaceStateFile(projectDir, name) {
  spaceStateFileName(name);
  if (!existsSync(join(resolve(projectDir), NOTIS_DIR))) return null;
  return withAppReleaseWorkspace(projectDir, () => {
    let before;
    try { before = lstatSync(name, { bigint: true }); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!before.isFile() || before.isSymbolicLink()) throw usageError(`Unsafe local Space state file: ${name}.`);
    const descriptor = openSync(name, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try { return JSON.parse(readStablePinnedFile(descriptor, before, `Space state file ${name}`).toString('utf8')); }
    finally { closeSync(descriptor); }
  });
}

/** Replace one local-only JSON state file atomically inside the pinned .notis directory. */
export function writeSpaceStateFile(projectDir, name, value) {
  spaceStateFileName(name);
  return withAppReleaseWorkspace(projectDir, (workspace) => {
    const temporary = `.${name}-${randomUUID()}`;
    try {
      writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      renameSync(temporary, name);
    } finally { rmSync(temporary, { force: true }); }
    return join(workspace.projectDir, NOTIS_DIR, name);
  }, { create: true });
}

/** Capture one checked build. Verification and upload must use these same bytes. */
export function prepareAppRelease(projectDir) {
  let release;
  try {
    return withAppReleaseWorkspace(projectDir, (workspace) => {
      const sourceFiles = collectSourceFiles(workspace.projectDir);
      const files = collectArtifactFiles(workspace.projectDir);
      let receipt;
      try {
        const before = lstatSync('build-receipt.json', { bigint: true });
        if (!before.isFile() || before.isSymbolicLink()) throw usageError('Unsafe build receipt.');
        const descriptor = openSync('build-receipt.json', fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        try { receipt = JSON.parse(readStablePinnedFile(descriptor, before, 'Build receipt').toString('utf8')); }
        finally { closeSync(descriptor); }
      } catch (error) {
        if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      if (receipt?.source_hash !== appFilesDigest(sourceFiles) || receipt?.artifact_hash !== appFilesDigest(files)) {
        throw usageError('Build output is missing or stale. Run notis spaces build before deploying.');
      }
      return release = freezePinnedArtifactSnapshot(workspace, files, sourceFiles);
    });
  } catch (error) {
    try { release?.close(); } catch { /* Parent replacement retains staging, never follows it. */ }
    throw error;
  }
}
