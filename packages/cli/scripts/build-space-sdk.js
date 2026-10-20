/**
 * Builds the `@notis/sdk` package a Space project installs (`dist/space-sdk`).
 *
 * Spaces never bundle the SDK: their build externalizes the host modules
 * (`@notis/sdk`, `@notis/sdk/ui`) and the host provides them at runtime
 * (packages/sdk/src/runtimeModules.ts). A Space therefore receives only:
 * - type declarations for the host modules (their `types` export condition),
 * - real source for the build-time and pure entries (`/config`, `/vite`,
 *   `/words`, NOTIS_SDK_BUNDLED_MODULES) and their value-import closure,
 * - no CSS: the host adopts `toolkit.css` into every Space shadow root,
 * - one comment-only declaration listing the class names the host SDK renders,
 *   so the Space's Tailwind build still emits them inside its shadow root,
 * - a Node-only runtime of the host modules (`dist/`) for the Space's own
 *   tests; see buildTestRuntime.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build, transform } from 'esbuild';

const RELATIVE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;
const REFERENCE_PATH = /\/\/\/\s*<reference\s+path=(['"])([^'"]+)\1/g;
const STRING_LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const SOURCE_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
const CANDIDATES_FILE = 'src/tailwind-candidates.d.ts';
// Outside src/: Tailwind scans only packages/sdk/src, and Space source collection,
// the boundary validators and the template tsconfig never read a dist/ folder.
const TEST_RUNTIME_DIR = 'dist';

/** The host module table, read from the SDK's own contract module. */
export async function readHostModules(sdkDir) {
  const { code } = await transform(readFileSync(join(sdkDir, 'src/runtimeModules.ts'), 'utf8'), { loader: 'ts', format: 'esm' });
  const module = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  return { hostModules: module.NOTIS_SDK_HOST_MODULES, bundledModules: module.NOTIS_SDK_BUNDLED_MODULES };
}

function subpathOf(specifier) {
  return specifier === '@notis/sdk' ? '.' : `./${specifier.slice('@notis/sdk/'.length)}`;
}

function exportTarget(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return exportTarget(value.types ?? value.import ?? value.default);
  return null;
}

/** `src/x.ts` for a relative specifier written in `src/y.ts`, or null when it is not an SDK source file. */
function resolveSource(sdkDir, importer, specifier) {
  const base = posix.normalize(posix.join(posix.dirname(importer), specifier.split(/[?#]/, 1)[0]));
  for (const suffix of SOURCE_SUFFIXES) {
    const candidate = base + suffix;
    if (/\.tsx?$/.test(candidate) && existsSync(join(sdkDir, candidate))) return candidate;
  }
  return null;
}

function declarationOf(sourcePath) {
  return sourcePath.replace(/\.tsx?$/, '.d.ts');
}

/** Source text without comments, so documentation examples are never read as imports. */
export function stripComments(source) {
  let output = '';
  for (let index = 0; index < source.length; index++) {
    const char = source[index], next = source[index + 1];
    if (char === '/' && next === '/') { while (index < source.length && source[index] !== '\n') index++; output += '\n'; continue; }
    if (char === '/' && next === '*') { index = source.indexOf('*/', index + 2); if (index < 0) break; index++; output += ' '; continue; }
    if (char === '\'' || char === '"' || char === '`') {
      let end = index + 1;
      while (end < source.length && source[end] !== char) end += source[end] === '\\' ? 2 : 1;
      output += source.slice(index, end + 1); index = end; continue;
    }
    output += char;
  }
  return output;
}

/**
 * Every SDK source file the given entries reach at runtime. esbuild drops
 * type-only imports exactly as the Space's own Vite build does.
 */
async function valueClosure(sdkDir, entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const { code } = await transform(readFileSync(join(sdkDir, file), 'utf8'), { loader: file.endsWith('.tsx') ? 'tsx' : 'ts', format: 'esm' });
    for (const match of code.matchAll(RELATIVE_SPECIFIER)) {
      const specifier = match[2];
      const target = resolveSource(sdkDir, file, specifier);
      if (!target) throw new Error(`The SDK file ${file} imports ${specifier}, which is not SDK source.`);
      queue.push(target);
    }
  }
  return seen;
}

function emitDeclarations(sdkDir) {
  const tsc = join(sdkDir, 'node_modules/typescript/bin/tsc');
  if (!existsSync(tsc)) {
    throw new Error(`Install packages/sdk dependencies (npm ci in ${sdkDir}) before building the CLI: the Space SDK types are emitted with its TypeScript.`);
  }
  const outDir = mkdtempSync(join(tmpdir(), 'notis-space-sdk-'));
  try {
    execFileSync(process.execPath, [tsc, '-p', sdkDir, '--emitDeclarationOnly', '--declaration', '--noEmit', 'false', '--outDir', outDir],
      { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    rmSync(outDir, { recursive: true, force: true });
    throw new Error(`The SDK does not type-check, so its Space types cannot be emitted:\n${error.stdout || ''}${error.stderr || ''}`);
  }
  return outDir;
}

// Utility classes only: a property path such as `document.body` (a letter on
// both sides of a dot outside an arbitrary value) is code, not a class.
function isClassCandidate(word) {
  if (word.length < 2 || word.length > 120 || !/[a-z]/.test(word) || word.includes('*/') || word.includes('${')) return false;
  return !/[A-Za-z_$]\.[A-Za-z_$]/.test(word.replace(/\[[^\]]*\]/g, ''));
}

/** The class-like words of every SDK string literal, so a Space's Tailwind scan sees what the host renders. */
function classCandidates(sdkDir, files) {
  const words = new Set();
  for (const file of files) {
    for (const [literal] of readFileSync(join(sdkDir, file), 'utf8').matchAll(STRING_LITERAL)) {
      for (const word of literal.slice(1, -1).split(/[\s`'"]+/)) {
        if (isClassCandidate(word)) words.add(word);
      }
    }
  }
  return [...words].sort();
}

function listSource(sdkDir, directory = 'src', results = []) {
  for (const name of readdirSorted(join(sdkDir, directory))) {
    const path = `${directory}/${name.name}`;
    if (name.isDirectory()) listSource(sdkDir, path, results);
    else if (/\.tsx?$/.test(name.name) && !/\.test\.tsx?$/.test(name.name) && !name.name.endsWith('.d.ts')) results.push(path);
  }
  return results;
}

function readdirSorted(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
}

function packageNameOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * The host modules as plain ES modules for the Space's own Node tests
 * (`tsx --test`, `node --test`), exported under the `node` condition only.
 * TypeScript reads `types` (listed first), a Space build externalizes these
 * modules so the host's copy wins at view time, and no browser resolver
 * matches `node`. Code splitting gives both entries one shared copy of the
 * modules they have in common; packages stay bare imports that resolve from
 * the Space's own node_modules, so each must be a declared dependency.
 */
async function buildTestRuntime({ sdkDir, targetDir, entries, sdkPackage }) {
  const result = await build({
    absWorkingDir: sdkDir,
    entryPoints: entries.map(({ name, file }) => ({ in: file, out: name })),
    outdir: join(targetDir, TEST_RUNTIME_DIR),
    bundle: true, splitting: true, format: 'esm', platform: 'node', target: 'es2022',
    jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' },
    // Identifiers stay readable: React warnings and stack traces in a Space test name SDK components.
    minifyWhitespace: true, minifySyntax: true, legalComments: 'none', chunkNames: 'chunk-[hash]', metafile: true, logLevel: 'warning',
    banner: { js: '// Generated by packages/cli/scripts/build-space-sdk.js for Node tests only. A Space view always uses the Notis host SDK.' },
  });
  const declared = new Set(Object.keys({ ...sdkPackage.dependencies, ...sdkPackage.optionalDependencies, ...sdkPackage.peerDependencies }));
  const files = [], undeclared = new Set();
  for (const [output, info] of Object.entries(result.metafile.outputs)) {
    files.push(relative(targetDir, resolve(sdkDir, output)).split(sep).join('/'));
    for (const { path, external } of info.imports) {
      if (external && !path.startsWith('node:') && !declared.has(packageNameOf(path))) undeclared.add(packageNameOf(path));
    }
  }
  if (undeclared.size) {
    throw new Error(`The SDK imports ${[...undeclared].sort().join(', ')} without declaring ${undeclared.size === 1 ? 'it' : 'them'} in dependencies or peerDependencies, so a Space test could not load the SDK.`);
  }
  return files.sort();
}

export async function buildSpaceSdk({ sdkDir, targetDir }) {
  const sdkPackage = JSON.parse(readFileSync(join(sdkDir, 'package.json'), 'utf8'));
  const { hostModules, bundledModules } = await readHostModules(sdkDir);
  const hostSubpaths = new Set(Object.keys(hostModules).map(subpathOf));
  const bundledSubpaths = new Set(bundledModules.map(subpathOf));
  const exports = {};
  const hostEntries = [];
  const sourceEntries = [];
  for (const [subpath, value] of Object.entries(sdkPackage.exports || {})) {
    const target = exportTarget(value);
    if (!target?.startsWith('./src/')) throw new Error(`Unsupported SDK export ${subpath}.`);
    const file = target.slice(2);
    if (!existsSync(join(sdkDir, file))) throw new Error(`The SDK export ${subpath} points at a missing file ${file}.`);
    if (file.endsWith('.css')) continue; // Host-adopted; a Space never imports SDK CSS.
    if (hostSubpaths.has(subpath)) {
      const name = subpath === '.' ? 'index' : subpath.slice(2).replaceAll('/', '-');
      hostEntries.push({ file, name });
      // Key order matters: `types` first for TypeScript, then the Node-only test runtime.
      exports[subpath] = { types: `./${declarationOf(file)}`, node: `./${TEST_RUNTIME_DIR}/${name}.js` };
    }
    else if (bundledSubpaths.has(subpath)) { sourceEntries.push(file); exports[subpath] = target; }
    // Any other entry is not part of the Space contract and is not shipped.
  }
  for (const subpath of [...hostSubpaths, ...bundledSubpaths]) {
    if (!Object.hasOwn(exports, subpath)) throw new Error(`The SDK package does not export ${subpath}, which Spaces depend on.`);
  }

  const shippedSource = await valueClosure(sdkDir, sourceEntries);
  const declarations = emitDeclarations(sdkDir);
  try {
    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(targetDir, { recursive: true });
    const write = (path, content) => {
      mkdirSync(dirname(join(targetDir, path)), { recursive: true });
      writeFileSync(join(targetDir, path), content);
    };
    // Declarations reachable from the host entries and from shipped source;
    // a module that ships as source is never shadowed by its declaration.
    const written = new Set();
    const queue = [...hostEntries.map(({ file }) => declarationOf(file)), ...shippedSource];
    while (queue.length) {
      const file = queue.shift();
      if (written.has(file)) continue;
      written.add(file);
      const isSource = shippedSource.has(file);
      const content = readFileSync(isSource ? join(sdkDir, file) : join(declarations, file.slice('src/'.length)), 'utf8');
      write(file, content);
      const references = [...stripComments(content).matchAll(RELATIVE_SPECIFIER)].map(match => match[2]);
      for (const specifier of references) {
        const source = resolveSource(sdkDir, file.endsWith('.d.ts') ? file.replace(/\.d\.ts$/, '.ts') : file, specifier);
        if (!source) throw new Error(`${file} references ${specifier}, which is not SDK source.`);
        queue.push(shippedSource.has(source) ? source : declarationOf(source));
      }
      for (const [, , path] of content.matchAll(REFERENCE_PATH)) queue.push(posix.normalize(posix.join(posix.dirname(file), path)));
    }

    const candidates = classCandidates(sdkDir, listSource(sdkDir).filter(file => !shippedSource.has(file)));
    write(CANDIDATES_FILE, [
      '// Generated by packages/cli/scripts/build-space-sdk.js. Do not edit.',
      '// The host renders the SDK inside this Space; its stylesheet must still contain these classes.',
      '/*', ...candidates, '*/', 'export {};', '',
    ].join('\n'));
    const rootDeclaration = 'src/index.d.ts';
    if (!written.has(rootDeclaration)) throw new Error('The SDK root module must be host-provided.');
    const rootPath = join(targetDir, rootDeclaration);
    writeFileSync(rootPath, `/// <reference path="./${posix.relative(posix.dirname(rootDeclaration), CANDIDATES_FILE)}" />\n${readFileSync(rootPath, 'utf8')}`);
    const runtime = await buildTestRuntime({ sdkDir, targetDir, entries: hostEntries, sdkPackage });

    const { scripts, devDependencies, files, main, module, types, ...metadata } = sdkPackage;
    write('package.json', JSON.stringify({
      ...metadata,
      description: 'Notis SDK types for Spaces. The Notis host provides @notis/sdk and @notis/sdk/ui at runtime; dist/ serves Node tests only.',
      types: `./${rootDeclaration}`,
      exports,
    }, null, 2) + '\n');
    return { exports, files: [...written].sort(), runtime, candidates: candidates.length };
  } finally {
    rmSync(declarations, { recursive: true, force: true });
  }
}
