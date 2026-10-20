/**
 * Builds the `@notis/sdk` copy a legacy Notis app vendors (`dist/sdk`).
 *
 * Legacy apps (`notis apps`) bundle the SDK into their own artifact, so their
 * copy is real source and passes the app boundary and design validators like
 * any other app file. They never use the Spaces toolkit (`src/ui/**`,
 * `src/words/**`, `toolkit.css`): that code is host-provided to Spaces only and
 * uses document-level layers the validators rightly refuse in an app. A legacy
 * copy therefore holds every SDK source file outside the toolkit, plus the few
 * toolkit files that this source imports, never the SDK's own tests and never
 * host-only mounting code (HOST_ONLY_SDK_FILES).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

import { HOST_ONLY_SDK_FILES } from '../src/runtime/retired-sdk-files.js';
import { stripComments } from './build-space-sdk.js';

// The Spaces toolkit and its words; reached only through an explicit import.
const TOOLKIT_DIRECTORIES = ['src/ui/', 'src/words/'];
// The entries legacy apps import. `./ui` stays the placeholder legacy apps always had.
const LEGACY_EXPORTS = ['.', './interactions', './config', './vite', './styles.css'];
const LEGACY_UI_PLACEHOLDER = 'src/ui.ts';
// The SDK's own test tooling; a legacy copy ships no tests.
const TEST_TOOLING = new Set(['jsdom', '@types/jsdom', 'tsx']);
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"]+)\1/g;
const SOURCE_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function isTest(file) {
  return /\.test\.tsx?$/.test(file);
}

function isToolkit(file) {
  return TOOLKIT_DIRECTORIES.some(directory => file.startsWith(directory));
}

function listFiles(sdkDir, directory = 'src', results = []) {
  for (const entry of readdirSync(join(sdkDir, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) listFiles(sdkDir, path, results);
    else results.push(path);
  }
  return results;
}

function resolveSource(sdkDir, importer, specifier) {
  const base = posix.normalize(posix.join(posix.dirname(importer), specifier.split(/[?#]/, 1)[0]));
  for (const suffix of SOURCE_SUFFIXES) {
    const candidate = base + suffix;
    if (/\.(tsx?|css)$/.test(candidate) && existsSync(join(sdkDir, candidate))) return candidate;
  }
  return null;
}

function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * The legacy file set and the packages it imports. Every relative import,
 * type-only ones included (legacy apps type-check this source), must resolve
 * inside the set; a toolkit file joins it only when legacy source imports it.
 */
export function legacySdkFiles(sdkDir) {
  const files = new Set();
  const packages = new Set();
  const queue = listFiles(sdkDir).filter(file => !isTest(file) && !isToolkit(file) && !HOST_ONLY_SDK_FILES.includes(file));
  while (queue.length) {
    const file = queue.shift();
    if (files.has(file)) continue;
    files.add(file);
    if (!/\.tsx?$/.test(file)) continue;
    for (const [, , specifier] of stripComments(readFileSync(join(sdkDir, file), 'utf8')).matchAll(SPECIFIER)) {
      if (specifier.startsWith('.')) {
        const target = resolveSource(sdkDir, file, specifier);
        if (!target) throw new Error(`The SDK file ${file} imports ${specifier}, which is not SDK source.`);
        if (isTest(target)) throw new Error(`The SDK file ${file} imports the test ${target}.`);
        queue.push(target);
      } else if (!specifier.startsWith('node:') && !specifier.startsWith('@notis/sdk') && /^[@a-z]/.test(specifier)) {
        packages.add(packageName(specifier));
      }
    }
  }
  return { files: [...files].sort(), packages };
}

function exportTarget(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return exportTarget(value.import ?? value.default ?? value.types);
  return null;
}

export function buildLegacySdk({ sdkDir, targetDir }) {
  const sdkPackage = JSON.parse(readFileSync(join(sdkDir, 'package.json'), 'utf8'));
  const { files, packages } = legacySdkFiles(sdkDir);
  const shipped = new Set(files);

  const exports = {};
  for (const subpath of LEGACY_EXPORTS) {
    const target = exportTarget(sdkPackage.exports?.[subpath]);
    if (!target?.startsWith('./src/')) throw new Error(`The SDK package does not export ${subpath}, which legacy apps import.`);
    if (!shipped.has(target.slice(2))) {
      throw new Error(`The legacy SDK export ${subpath} points at ${target}, which is not legacy source.`);
    }
    exports[subpath] = sdkPackage.exports[subpath];
  }
  if (shipped.has(LEGACY_UI_PLACEHOLDER)) exports['./ui'] = `./${LEGACY_UI_PLACEHOLDER}`;

  const dependencies = Object.fromEntries(Object.entries(sdkPackage.dependencies || {})
    .filter(([name]) => packages.has(name)));
  const devDependencies = Object.fromEntries(Object.entries(sdkPackage.devDependencies || {})
    .filter(([name]) => !TEST_TOOLING.has(name)));
  const { test: _test, ...scripts } = sdkPackage.scripts || {};

  rmSync(targetDir, { recursive: true, force: true });
  for (const file of files) {
    mkdirSync(dirname(join(targetDir, file)), { recursive: true });
    writeFileSync(join(targetDir, file), readFileSync(join(sdkDir, file)));
  }
  writeFileSync(join(targetDir, 'package.json'), JSON.stringify({
    ...sdkPackage, exports, scripts, dependencies, devDependencies,
  }, null, 2) + '\n');
  return { files, exports, dependencies };
}
