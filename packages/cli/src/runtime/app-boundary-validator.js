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

// ---------------------------------------------------------------------------
// Design rules
//
// The portal boundary rules above keep an app inside its surface. The design
// rules below keep it looking like a native, flat Notis page: no bordered
// boxes around items, no dividers, no palette colors, no eyebrows, no loading
// text. They are path-scoped, report line numbers, and only ever run on the
// app's own source files (never on the bundled artifact, where every
// dependency legitimately contains the word "border").
//
// The only override is an inline directive on the same line or the line
// before the match:
//   // notis-design-allow: <rule-id> <reason of at least N characters>
// Allowed matches are reported with `allowed: true` so they stay visible.
// ---------------------------------------------------------------------------

export const DESIGN_RULES_PATH_CANDIDATES = [
  resolve(moduleDir, '../../../../server/config/notis_app_design_rules.json'),
  resolve(moduleDir, '../../config/notis_app_design_rules.json'),
];

export function resolveDesignRulesPath() {
  for (const candidate of DESIGN_RULES_PATH_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return DESIGN_RULES_PATH_CANDIDATES[DESIGN_RULES_PATH_CANDIDATES.length - 1];
}

const DEFAULT_DESIGN_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.css'];

function globToRegExp(glob) {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*') {
      if (glob[index + 1] === '*') {
        index += 1;
        if (glob[index + 1] === '/') {
          index += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

function matchesAny(relPath, globs) {
  return (globs || []).some((glob) => globToRegExp(glob).test(relPath));
}

let compiledDesignRules = null;

export function loadDesignRules({ rulesPath = resolveDesignRulesPath() } = {}) {
  let payload = null;
  try {
    const parsed = JSON.parse(readFileSync(rulesPath, 'utf-8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed;
    }
  } catch (error) {
    process.stderr.write(
      `Warning: could not load Notis app design rules (${error.message}); skipping design checks.\n`,
    );
  }
  if (!payload) {
    return { include: [], exclude: [], extensions: DEFAULT_DESIGN_EXTENSIONS, rules: [], allowDirective: 'notis-design-allow', allowReasonMinLength: 12 };
  }
  return {
    include: Array.isArray(payload.include) ? payload.include : ['app/**', 'components/**'],
    exclude: Array.isArray(payload.exclude) ? payload.exclude : [],
    extensions: Array.isArray(payload.extensions) ? payload.extensions : DEFAULT_DESIGN_EXTENSIONS,
    allowDirective: typeof payload.allow_directive === 'string' ? payload.allow_directive : 'notis-design-allow',
    allowReasonMinLength: Number.isInteger(payload.allow_reason_min_length) ? payload.allow_reason_min_length : 12,
    rules: (Array.isArray(payload.rules) ? payload.rules : []).map((rule) => ({
      id: rule.id,
      severity: rule.severity === 'warn' ? 'warn' : 'error',
      scope: rule.scope === 'file' ? 'file' : 'line',
      regex: new RegExp(rule.pattern, rule.scope === 'file' ? '' : 'gm'),
      message: rule.message,
      include: Array.isArray(rule.include) ? rule.include : null,
      exclude: Array.isArray(rule.exclude) ? rule.exclude : [],
    })),
  };
}

function getCompiledDesignRules() {
  if (!compiledDesignRules) {
    compiledDesignRules = loadDesignRules();
  }
  return compiledDesignRules;
}

function lineNumberAt(content, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (content.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function findAllowDirective(lines, lineNumber, ruleId, directive) {
  const pattern = new RegExp(`${directive}:\\s*${ruleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b\\s*(.*)$`);
  for (const candidate of [lines[lineNumber - 1], lines[lineNumber - 2]]) {
    if (typeof candidate !== 'string') continue;
    const match = candidate.match(pattern);
    if (match) {
      return match[1].replace(/\*\/\s*}?\s*$/, '').replace(/-->\s*$/, '').trim();
    }
  }
  return null;
}

export function collectDesignViolationsForFile(relPath, content, config = getCompiledDesignRules()) {
  const normalized = relPath.split('\\').join('/');
  if (!config.extensions.includes(extname(normalized))) return [];
  if (!matchesAny(normalized, config.include)) return [];
  if (matchesAny(normalized, config.exclude)) return [];

  const lines = content.split('\n');
  const violations = [];
  for (const rule of config.rules) {
    if (rule.include && !matchesAny(normalized, rule.include)) continue;
    if (matchesAny(normalized, rule.exclude)) continue;

    const matches = [];
    if (rule.scope === 'file') {
      const match = rule.regex.exec(content);
      if (match) matches.push(match.index);
    } else {
      rule.regex.lastIndex = 0;
      let match;
      while ((match = rule.regex.exec(content)) !== null) {
        matches.push(match.index);
        if (match[0].length === 0) rule.regex.lastIndex += 1;
      }
    }

    const seenLines = new Set();
    for (const index of matches) {
      const line = lineNumberAt(content, index);
      if (seenLines.has(line)) continue;
      seenLines.add(line);
      const reason = findAllowDirective(lines, line, rule.id, config.allowDirective);
      const allowed = reason !== null && reason.length >= config.allowReasonMinLength;
      violations.push({
        file: normalized,
        line,
        ruleId: rule.id,
        severity: allowed ? 'warn' : rule.severity,
        message: reason !== null && !allowed
          ? `${rule.message} (a notis-design-allow directive needs a reason of at least ${config.allowReasonMinLength} characters)`
          : rule.message,
        allowed,
        reason: allowed ? reason : null,
      });
    }
  }
  return violations;
}

export function collectProjectDesignViolations(projectDir, config = getCompiledDesignRules()) {
  const files = [];
  collectProjectFiles(projectDir, projectDir, files);
  return files.flatMap((file) => collectDesignViolationsForFile(file.relPath, file.content, config));
}

export function collectSourceDesignViolations(files, config = getCompiledDesignRules()) {
  return Object.entries(files).flatMap(([relPath, rawContent]) => {
    const content = Buffer.isBuffer(rawContent)
      ? rawContent.toString('utf-8')
      : typeof rawContent === 'string'
        ? rawContent
        : String(rawContent ?? '');
    return collectDesignViolationsForFile(relPath, content, config);
  });
}

export function formatDesignViolation(violation) {
  const prefix = violation.allowed ? 'allowed' : violation.severity;
  const suffix = violation.allowed ? ` (${violation.reason})` : '';
  return `${violation.file}:${violation.line} [${violation.ruleId}] ${prefix}: ${violation.message}${suffix}`;
}

/**
 * Enforce the design rules on an app's source tree.
 *
 * Returns every violation (allowed ones included) so callers can print
 * warnings. When `enforce` is true (build, verify, screenshot, deploy) any
 * unallowed error-severity violation aborts with a usage error that lists the
 * exact file and line to fix. Dev servers pass `enforce: false` so a
 * half-edited page still reloads.
 */
export function validateProjectDesign(projectDir, { enforce = true, log = null } = {}) {
  const violations = collectProjectDesignViolations(projectDir);
  const blocking = violations.filter((violation) => !violation.allowed && violation.severity === 'error');
  const nonBlocking = violations.filter((violation) => !blocking.includes(violation));
  if (typeof log === 'function') {
    for (const violation of nonBlocking) log(`[design] ${formatDesignViolation(violation)}`);
    if (!enforce) for (const violation of blocking) log(`[design] ${formatDesignViolation(violation)}`);
  }
  if (enforce && blocking.length > 0) {
    throw usageError(
      `Project violates the Notis app design bar (${blocking.length} issue${blocking.length === 1 ? '' : 's'}). `
      + 'Fix each line below; the only override is an inline "// notis-design-allow: <rule-id> <reason>" comment on the line before.\n'
      + blocking.map((violation) => `  - ${formatDesignViolation(violation)}`).join('\n'),
    );
  }
  return violations;
}
