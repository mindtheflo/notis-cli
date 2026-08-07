import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { usageError } from './errors.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));

// Candidate locations for the app boundary rules, in priority order:
//  1. The monorepo server source (always fresh during local development).
//  2. The copy bundled into the published package at build time (see
//     scripts/copy-boundary-rules.js + package.json "files": config/). When the
//     CLI is installed via npm, candidate 1 escapes the package and is absent,
//     so the bundled copy is used. This is what was missing before: the package
//     shipped only the escaping path and crashed with ENOENT on any command.
export const RULES_PATH_CANDIDATES = [
  resolve(moduleDir, '../../../../server/config/notis_app_boundary_rules.json'),
  resolve(moduleDir, '../../config/notis_app_boundary_rules.json'),
];

export function resolveRulesPath() {
  for (const candidate of RULES_PATH_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  // Fall back to the bundled-copy path so any error message points inside the
  // package rather than at an escaping monorepo path.
  return RULES_PATH_CANDIDATES[RULES_PATH_CANDIDATES.length - 1];
}

const SOURCE_FILE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.sass', '.pcss']);
const IGNORED_SOURCE_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.notis',
  'dist',
  'build',
  'coverage',
]);

function compileRules(entries) {
  // Tolerate a rules object whose javascript/css field is a non-array (a corrupt
  // file can parse to {"javascript":"x"}); coerce anything non-array to [] so
  // getCompiledRules degrades to an empty rule set instead of throwing on .map.
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    regex: new RegExp(entry.pattern, 'm'),
    message: entry.message,
  }));
}

// Loaded lazily on first validation rather than at module import time: a
// missing rules file must not prevent the whole CLI from booting (every
// command imports this module transitively). The server re-validates on
// save/deploy, so an empty client-side rule set degrades gracefully.
let compiledRules = null;

function getCompiledRules() {
  if (compiledRules) {
    return compiledRules;
  }
  let boundaryRules = { javascript: [], css: [] };
  try {
    const parsed = JSON.parse(readFileSync(resolveRulesPath(), 'utf-8'));
    // Keep the safe default unless the file is a real rules object: a valid but
    // non-object payload (null, a number, an array) would otherwise throw on the
    // `.javascript`/`.css` deref below, reintroducing the boot crash this guards.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      boundaryRules = parsed;
    } else {
      process.stderr.write(
        'Warning: Notis app boundary rules are not a rules object; skipping local boundary checks.\n',
      );
    }
  } catch (error) {
    process.stderr.write(
      `Warning: could not load Notis app boundary rules (${error.message}); skipping local boundary checks.\n`,
    );
  }
  compiledRules = {
    javascript: compileRules(boundaryRules.javascript),
    css: compileRules(boundaryRules.css),
  };
  return compiledRules;
}

function collectProjectFiles(projectDir, dir, results) {
  if (!existsSync(dir)) {
    return;
  }

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      if (entry.name !== '.storybook') {
        continue;
      }
    }

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_SOURCE_DIRS.has(entry.name)) {
        continue;
      }
      collectProjectFiles(projectDir, fullPath, results);
      continue;
    }

    if (!SOURCE_FILE_EXTENSIONS.has(extname(entry.name))) {
      continue;
    }

    results.push({
      path: fullPath,
      relPath: fullPath.slice(projectDir.length + 1),
      content: readFileSync(fullPath, 'utf-8'),
    });
  }
}

function applyRules(content, rules, relPath) {
  const errors = [];
  for (const rule of rules) {
    if (rule.regex.test(content)) {
      errors.push(`${relPath}: ${rule.message}`);
    }
  }
  return errors;
}

function validateTextFile(relPath, content) {
  const extension = extname(relPath);
  const rules = getCompiledRules();
  if (extension === '.css' || extension === '.scss' || extension === '.sass' || extension === '.pcss') {
    return applyRules(content, rules.css, relPath);
  }
  if (extension === '.js' || extension === '.jsx' || extension === '.ts' || extension === '.tsx') {
    return applyRules(content, rules.javascript, relPath);
  }
  return [];
}

export function collectProjectBoundaryViolations(projectDir) {
  const files = [];
  collectProjectFiles(projectDir, projectDir, files);
  return files.flatMap((file) => validateTextFile(file.relPath, file.content));
}

export function collectArtifactBoundaryViolations(files) {
  return Object.entries(files).flatMap(([relPath, rawContent]) => {
    const extension = extname(relPath);
    if (!['.js', '.css', '.scss', '.sass', '.pcss'].includes(extension)) {
      return [];
    }

    const content = Buffer.isBuffer(rawContent)
      ? rawContent.toString('utf-8')
      : typeof rawContent === 'string'
        ? rawContent
        : String(rawContent ?? '');

    return validateTextFile(relPath, content);
  });
}

export function validateProjectBoundary(projectDir) {
  const violations = collectProjectBoundaryViolations(projectDir);
  if (violations.length > 0) {
    throw usageError(
      `Project violates the Notis app portal boundary:\n${violations.map((error) => `  - ${error}`).join('\n')}`,
    );
  }
}

export function validateArtifactBoundary(files) {
  const violations = collectArtifactBoundaryViolations(files);
  if (violations.length > 0) {
    throw usageError(
      `Built app violates the Notis app portal boundary:\n${violations.map((error) => `  - ${error}`).join('\n')}`,
    );
  }
}
