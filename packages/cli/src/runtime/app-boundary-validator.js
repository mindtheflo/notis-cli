import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { usageError } from './errors.js';
import { maskSerializedJsonData } from './app-data-literals.js';

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
    // A comment that mentions html, body or :root is not a selector. Blanking
    // comments keeps offsets and line numbers; every rule still runs unchanged.
    return applyRules(maskComments(content, '.css'), rules.css, relPath);
  }
  if (extension === '.js' || extension === '.jsx' || extension === '.ts' || extension === '.tsx') {
    return applyRules(maskSerializedJsonData(content, extension), rules.javascript, relPath);
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

const REGEX_PRECEDERS = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '>', '~', '^']);

function blankRange(chars, start, end) {
  for (let index = start; index < end; index += 1) {
    if (chars[index] !== '\n') chars[index] = ' ';
  }
}

/**
 * Blank out comments so the design rules never match words inside them. Every
 * character keeps its offset and newlines stay, so line numbers do not move.
 * CSS has only block comments; JS and TS also have line comments. Quoted
 * strings end at a newline so an apostrophe in JSX text cannot swallow a file,
 * and "scheme://" is never a comment. Mirrored by mask_comments in
 * server/lib/app_boundary_validator.py.
 */
export function maskComments(content, extension) {
  const isCss = extension === '.css';
  const chars = content.split('');
  const length = chars.length;
  let index = 0;
  let previous = '';
  while (index < length) {
    const char = chars[index];
    const next = chars[index + 1];
    if (char === '/' && next === '*') {
      const close = content.indexOf('*/', index + 2);
      const end = close === -1 ? length : close + 2;
      blankRange(chars, index, end);
      index = end;
      continue;
    }
    if (!isCss && char === '/' && next === '/' && !(chars[index - 1] === ':' && /[A-Za-z0-9]/.test(chars[index - 2] || ''))) {
      let end = content.indexOf('\n', index);
      if (end === -1) end = length;
      blankRange(chars, index, end);
      index = end;
      continue;
    }
    if (char === '"' || char === "'" || (!isCss && char === '`')) {
      let cursor = index + 1;
      while (cursor < length) {
        const inner = chars[cursor];
        if (inner === '\\') { cursor += 2; continue; }
        if (inner === char) { cursor += 1; break; }
        if (inner === '\n' && char !== '`') break;
        cursor += 1;
      }
      previous = char;
      index = cursor;
      continue;
    }
    if (!isCss && char === '/' && REGEX_PRECEDERS.has(previous)) {
      let cursor = index + 1;
      let inClass = false;
      while (cursor < length && chars[cursor] !== '\n') {
        const inner = chars[cursor];
        if (inner === '\\') { cursor += 2; continue; }
        if (inner === '[') inClass = true;
        else if (inner === ']') inClass = false;
        else if (inner === '/' && !inClass) { cursor += 1; break; }
        cursor += 1;
      }
      previous = '/';
      index = cursor;
      continue;
    }
    if (!/\s/.test(char)) previous = char;
    index += 1;
  }
  return chars.join('');
}

const compiledDesignRules = new Map();

/**
 * Load the design rules for one profile. The default profile ("app") keeps the
 * file's top-level include/exclude. A named profile (for example "space")
 * replaces the include with its own, adds its excludes, and turns on the rules
 * that list it in `profiles`. Rules naming a `toolkit_piece` stay warnings until
 * that piece appears in `toolkit_live_pieces`, then they refuse like errors.
 */
export function loadDesignRules({ rulesPath = resolveDesignRulesPath(), profile = 'app' } = {}) {
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
    return { profile, include: [], exclude: [], extensions: DEFAULT_DESIGN_EXTENSIONS, rules: [], icons: null, allowDirective: 'notis-design-allow', allowReasonMinLength: 12 };
  }
  const profiles = payload.profiles && typeof payload.profiles === 'object' && !Array.isArray(payload.profiles) ? payload.profiles : {};
  const selected = profile !== 'app' && profiles[profile] && typeof profiles[profile] === 'object' ? profiles[profile] : null;
  const baseInclude = Array.isArray(payload.include) ? payload.include : ['app/**', 'components/**'];
  const baseExclude = Array.isArray(payload.exclude) ? payload.exclude : [];
  const livePieces = new Set(Array.isArray(payload.toolkit_live_pieces) ? payload.toolkit_live_pieces : []);
  return {
    profile,
    include: Array.isArray(selected?.include) ? selected.include : baseInclude,
    exclude: [...baseExclude, ...(Array.isArray(selected?.exclude) ? selected.exclude : [])],
    extensions: Array.isArray(payload.extensions) ? payload.extensions : DEFAULT_DESIGN_EXTENSIONS,
    allowDirective: typeof payload.allow_directive === 'string' ? payload.allow_directive : 'notis-design-allow',
    allowReasonMinLength: Number.isInteger(payload.allow_reason_min_length) ? payload.allow_reason_min_length : 12,
    icons: loadIconCheck(payload.icons, profile),
    rules: (Array.isArray(payload.rules) ? payload.rules : [])
      .filter((rule) => !Array.isArray(rule.profiles) || rule.profiles.includes(profile))
      .map((rule) => ({
        id: rule.id,
        severity: typeof rule.toolkit_piece === 'string'
          ? (livePieces.has(rule.toolkit_piece) ? 'error' : 'warn')
          // profile_severity.<profile> overrides severity for that profile only.
          : (rule.profile_severity?.[profile] ?? rule.severity) === 'warn' ? 'warn' : 'error',
        toolkitPiece: typeof rule.toolkit_piece === 'string' ? rule.toolkit_piece : null,
        scope: rule.scope === 'file' ? 'file' : 'line',
        regex: new RegExp(rule.pattern, rule.scope === 'file' ? '' : 'gm'),
        message: typeof rule.profile_messages?.[profile] === 'string' ? rule.profile_messages[profile] : rule.message,
        include: Array.isArray(rule.include) ? rule.include : null,
        exclude: Array.isArray(rule.exclude) ? rule.exclude : [],
      })),
  };
}

// ---------------------------------------------------------------------------
// Icon names
//
// The toolkit's Icon draws a fixed set of names (`icons.names` in the rules
// file, kept equal to the SDK's ICON_NAMES by packages/sdk/src/ui/icons.test.tsx)
// and an unknown one draws nothing, so a guessed Phosphor name ships an empty
// button. Only toolkit inputs are checked, and only when the whole value is one
// kebab-case string literal:
// - `name` on the SDK's Icon and `icon` on any other SDK component, the tag
//   resolved through the file's @notis/sdk imports (aliases and namespaces);
// - an `icon` field of an object that also has a `label` (reader actions,
//   view menu items, tabs: the toolkit's labelled items).
// Text inside strings and comments is never read. Mirrored by
// _icon_candidates in server/lib/app_boundary_validator.py.
// ---------------------------------------------------------------------------

const ICON_NAME_SHAPE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SDK_IMPORTS = /(?<![\w$.])import\s+([\w$\s{},*]+?)\s+from\s*(["'])@notis\/sdk(?:\/[^"'\s]*)?\2/g;
const JSX_TAG = /<([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)(?=[\s/>])/g;
const JSX_ATTRIBUTE = /(?<![\w$.-])(icon|name)\s*=\s*/g;
const ICON_FIELD = /(?<![\w$.-])icon\s*:\s*/g;
const LABEL_KEY = /(?<![\w$.-])label\s*[:,}]/g;
// What a JSX opening tag holds at its own level besides strings and braced values.
const TAG_TEXT = /[\w$\-:.=\t\n\v\f\r /]/;

/** Local component names bound to @notis/sdk (local -> exported) and namespace names. Type-only imports bind nothing. */
function sdkBindings(text) {
  const components = new Map(), namespaces = new Set();
  for (const match of text.matchAll(SDK_IMPORTS)) {
    const clause = match[1].trim();
    if (/^type\s/.test(clause)) continue;
    const namespace = clause.match(/\*\s*as\s+([\w$]+)/);
    if (namespace) namespaces.add(namespace[1]);
    const named = clause.match(/\{([^}]*)\}/);
    for (const part of named ? named[1].split(',') : []) {
      const item = part.trim();
      if (!item || /^type\s/.test(item)) continue;
      const [exported, local = exported] = item.split(/\s+as\s+/).map((value) => value.trim());
      components.set(local, exported);
    }
  }
  return { components, namespaces };
}

/**
 * One pass over comment-masked source: which characters sit inside a string, the innermost open
 * brace around each character, and where each brace closes. A quote left open at the end of its
 * line is JSX text (an apostrophe), not a string.
 */
function sourceShape(text) {
  const length = text.length;
  const inString = new Uint8Array(length), owner = new Int32Array(length).fill(-1), closes = new Map(), stack = [];
  let index = 0;
  while (index < length) {
    const char = text[index];
    const top = stack.length ? stack[stack.length - 1] : -1;
    if (char === '"' || char === "'" || char === '`') {
      let cursor = index + 1, closed = false;
      while (cursor < length) {
        const inner = text[cursor];
        if (inner === '\\') { cursor += 2; continue; }
        if (inner === char) { cursor += 1; closed = true; break; }
        if (inner === '\n' && char !== '`') break;
        cursor += 1;
      }
      if (closed) {
        for (let at = index; at < cursor; at += 1) { inString[at] = 1; owner[at] = top; }
        index = cursor;
        continue;
      }
    }
    owner[index] = top;
    if (char === '{') stack.push(index);
    else if (char === '}' && stack.length) closes.set(stack.pop(), index);
    index += 1;
  }
  return { inString, owner, closes };
}

/** The literal at `at` when it is the whole value: 'x', "x", `x` (no ${}), or {'x'} in JSX. */
function literalAt(text, shape, at, { braced = false } = {}) {
  let start = at;
  if (braced && text[at] === '{' && shape.closes.has(at)) {
    const inner = text.slice(at + 1, shape.closes.get(at));
    const match = inner.match(/^\s*(["'`])([^"'`\n\\$]*)\1\s*$/);
    if (!match) return null;
    start = at + 1 + inner.indexOf(match[1]);
    return { name: match[2], index: start + 1 };
  }
  const match = text.slice(start).match(/^(["'`])([^"'`\n\\$]*)\1/);
  return match ? { name: match[2], index: start + 1, end: start + match[0].length } : null;
}

/**
 * Where a JSX opening tag ends: its `>` at the tag's own brace level, outside strings, jumping over
 * braced values. Any other character at that level means this is not a tag (`a <B && c`): stop there.
 */
function tagEnd(text, shape, from) {
  const level = shape.owner[from];
  let index = from + 1;
  while (index < text.length) {
    const char = text[index];
    if (shape.inString[index]) { index += 1; continue; }
    if (char === '>') return index;
    if (char === '{') {
      if (!shape.closes.has(index)) return index;
      index = shape.closes.get(index) + 1;
      continue;
    }
    if (shape.owner[index] !== level || !TAG_TEXT.test(char)) return index;
    index += 1;
  }
  return text.length;
}

/** True when the key at `at` sits where an object key does: right after `{` or `,`, outside strings. */
function keyPosition(text, shape, at) {
  let index = at - 1;
  while (index >= 0 && ' \t\n\v\f\r'.includes(text[index])) index -= 1;
  return index >= 0 && !shape.inString[index] && (text[index] === '{' || text[index] === ',');
}

/** `{ index, name }` for every literal handed to a toolkit icon input in this comment-masked file. */
function iconCandidates(text) {
  const { components, namespaces } = sdkBindings(text);
  if (!components.size && !namespaces.size) return [];
  const shape = sourceShape(text), found = [];
  for (const match of text.matchAll(JSX_TAG)) {
    if (shape.inString[match.index]) continue;
    const [first, second] = match[1].split('.');
    const exported = second === undefined ? components.get(first) : namespaces.has(first) ? second : undefined;
    if (!exported) continue;
    const wanted = exported === 'Icon' ? 'name' : 'icon';
    const end = tagEnd(text, shape, match.index);
    const level = shape.owner[match.index];
    JSX_ATTRIBUTE.lastIndex = match.index + match[0].length;
    let attribute;
    while ((attribute = JSX_ATTRIBUTE.exec(text)) !== null && attribute.index < end) {
      if (attribute[1] !== wanted || shape.inString[attribute.index] || shape.owner[attribute.index] !== level) continue;
      const literal = literalAt(text, shape, attribute.index + attribute[0].length, { braced: true });
      if (literal) found.push(literal);
    }
  }
  for (const match of text.matchAll(ICON_FIELD)) {
    if (shape.inString[match.index] || !keyPosition(text, shape, match.index)) continue;
    const literal = literalAt(text, shape, match.index + match[0].length);
    if (!literal || !/^\s*[,}]/.test(text.slice(literal.end))) continue;
    const object = shape.owner[match.index];
    if (object < 0 || !shape.closes.has(object)) continue;
    const body = text.slice(object, shape.closes.get(object) + 1);
    const labelled = [...body.matchAll(LABEL_KEY)].some((key) => !shape.inString[object + key.index]
      && shape.owner[object + key.index] === object && keyPosition(text, shape, object + key.index));
    if (labelled) found.push(literal);
  }
  return found;
}

function loadIconCheck(icons, profile) {
  if (!icons || typeof icons !== 'object' || !Array.isArray(icons.names) || icons.names.length === 0) return null;
  if (Array.isArray(icons.profiles) && !icons.profiles.includes(profile)) return null;
  const names = icons.names.filter((name) => typeof name === 'string');
  return {
    id: typeof icons.id === 'string' ? icons.id : 'space-unknown-icon',
    message: typeof icons.message === 'string' ? icons.message : 'Unknown icon "{name}". Closest names: {suggestions}.',
    suggestions: Number.isInteger(icons.suggestions) && icons.suggestions > 0 ? icons.suggestions : 3,
    exclude: Array.isArray(icons.exclude) ? icons.exclude : [],
    names,
    known: new Set(names),
  };
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * The names the refusal suggests: those sharing a word with the unknown name first ("funnel" finds
 * funnel-simple), then by edit distance, ties by name.
 */
export function closestIconNames(name, names, count = 3) {
  const words = new Set(name.split('-'));
  return names
    .map((candidate) => ({
      candidate,
      shared: candidate.split('-').some((word) => words.has(word)) ? 0 : 1,
      distance: editDistance(name, candidate),
    }))
    .sort((left, right) => left.shared - right.shared || left.distance - right.distance
      || (left.candidate < right.candidate ? -1 : left.candidate > right.candidate ? 1 : 0))
    .slice(0, count)
    .map((entry) => entry.candidate);
}

function iconViolations(normalized, content, checked, lines, config) {
  const icons = config.icons;
  if (!icons || matchesAny(normalized, icons.exclude)) return [];
  const found = new Map(), suggestions = new Map(), lineStarts = [0];
  for (let cursor = 0; cursor < content.length; cursor += 1) if (content.charCodeAt(cursor) === 10) lineStarts.push(cursor + 1);
  const lineAt = (index) => {
    let low = 0, high = lineStarts.length - 1;
    while (low < high) { const middle = (low + high + 1) >> 1; if (lineStarts[middle] <= index) low = middle; else high = middle - 1; }
    return low + 1;
  };
  for (const { index, name } of iconCandidates(checked)) {
    if (!ICON_NAME_SHAPE.test(name) || icons.known.has(name)) continue;
    const line = lineAt(index);
    const key = `${line}:${name}`;
    if (!found.has(key)) found.set(key, { line, name });
  }
  return [...found.values()].sort((left, right) => left.line - right.line).map(({ line, name }) => {
    const message = icons.message
      .replace('{name}', name)
      .replace('{suggestions}', suggestions.get(name) ?? suggestions.set(name, closestIconNames(name, icons.names, icons.suggestions).join(', ')).get(name));
    const reason = findAllowDirective(lines, line, icons.id, config.allowDirective);
    const allowed = reason !== null && reason.length >= config.allowReasonMinLength;
    return {
      file: normalized,
      line,
      ruleId: icons.id,
      severity: allowed ? 'warn' : 'error',
      message: reason !== null && !allowed
        ? `${message} (a notis-design-allow directive needs a reason of at least ${config.allowReasonMinLength} characters)`
        : message,
      allowed,
      reason: allowed ? reason : null,
    };
  });
}

function getCompiledDesignRules(profile = 'app') {
  if (!compiledDesignRules.has(profile)) {
    compiledDesignRules.set(profile, loadDesignRules({ profile }));
  }
  return compiledDesignRules.get(profile);
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

  const extension = extname(normalized);
  // Data is masked first so it can neither break a rule nor supply an allow
  // directive; comments are masked after, for matching only, so a real
  // directive comment is still read from `lines`.
  const unserialized = ['.js', '.jsx', '.ts', '.tsx'].includes(extension)
    ? maskSerializedJsonData(content, extension) : content;
  const checked = maskComments(unserialized, extension);
  const lines = unserialized.split('\n');
  const violations = [];
  for (const rule of config.rules) {
    if (rule.include && !matchesAny(normalized, rule.include)) continue;
    if (matchesAny(normalized, rule.exclude)) continue;

    const matches = [];
    if (rule.scope === 'file') {
      const match = rule.regex.exec(checked);
      if (match) matches.push(match.index);
    } else {
      rule.regex.lastIndex = 0;
      let match;
      while ((match = rule.regex.exec(checked)) !== null) {
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
  if (extension !== '.css') violations.push(...iconViolations(normalized, content, checked, lines, config));
  return violations;
}

export function collectProjectDesignViolations(projectDir, config = getCompiledDesignRules()) {
  const files = [];
  collectProjectFiles(projectDir, projectDir, files);
  return files.flatMap((file) => collectDesignViolationsForFile(file.relPath, file.content, config));
}

export function collectSourceDesignViolations(files, config = getCompiledDesignRules(), { encoding = 'utf-8' } = {}) {
  return Object.entries(files).flatMap(([relPath, rawContent]) => {
    const content = Buffer.isBuffer(rawContent)
      ? rawContent.toString('utf-8')
      : typeof rawContent === 'string'
        ? (encoding === 'base64' ? Buffer.from(rawContent, 'base64').toString('utf-8') : rawContent)
        : String(rawContent ?? '');
    return collectDesignViolationsForFile(relPath, content, config);
  });
}

export function formatDesignViolation(violation) {
  const prefix = violation.allowed ? 'allowed' : violation.severity;
  const suffix = violation.allowed ? ` (${violation.reason})` : '';
  return `${violation.file}:${violation.line} [${violation.ruleId}] ${prefix}: ${violation.message}${suffix}`;
}

function enforceDesign(violations, { enforce, log, subject }) {
  const blocking = violations.filter((violation) => !violation.allowed && violation.severity === 'error');
  const nonBlocking = violations.filter((violation) => !blocking.includes(violation));
  if (typeof log === 'function') {
    for (const violation of nonBlocking) log(`[design] ${formatDesignViolation(violation)}`);
    if (!enforce) for (const violation of blocking) log(`[design] ${formatDesignViolation(violation)}`);
  }
  if (enforce && blocking.length > 0) {
    throw usageError(
      `${subject} violates the Notis ${subject === 'Space' ? 'Spaces' : 'app'} design bar (${blocking.length} issue${blocking.length === 1 ? '' : 's'}). `
      + 'Fix each line below; the only override is an inline "// notis-design-allow: <rule-id> <reason>" comment on the line before.\n'
      + blocking.map((violation) => `  - ${formatDesignViolation(violation)}`).join('\n'),
    );
  }
  return violations;
}

/**
 * Enforce the design rules on an app's or a Space's source tree.
 *
 * Returns every violation (allowed ones included) so callers can print
 * warnings. When `enforce` is true (build, verify, screenshot, deploy) any
 * unallowed error-severity violation aborts with a usage error that lists the
 * exact file and line to fix. Dev servers pass `enforce: false` so a
 * half-edited page still reloads. Spaces pass `profile: 'space'`.
 */
export function validateProjectDesign(projectDir, { enforce = true, log = null, profile = 'app' } = {}) {
  const violations = collectProjectDesignViolations(projectDir, getCompiledDesignRules(profile));
  return enforceDesign(violations, { enforce, log, subject: profile === 'space' ? 'Space' : 'Project' });
}

/**
 * The same check on an in-memory source snapshot (the exact bytes a Space
 * release uploads). The server re-runs it with the same rules file on
 * source-verify, source-stage and source-publish.
 */
export function validateSourceDesign(files, { enforce = true, log = null, profile = 'space', encoding = 'utf-8' } = {}) {
  const violations = collectSourceDesignViolations(files, getCompiledDesignRules(profile), { encoding });
  return enforceDesign(violations, { enforce, log, subject: profile === 'space' ? 'Space' : 'Project' });
}
