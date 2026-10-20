// The API index of the design system book (design review spec, section 1.1), and the entry table it shares with
// the inventory.
//
// Lists every export of every JS entry of packages/sdk/package.json with its kind, declaration file and line, the
// first line of its JSDoc and a sha256 of the declaration text. Uses the TypeScript JS API from
// portal/node_modules/typescript (6.x); packages/sdk carries TypeScript 7, which has no JS API.
//
// The entries come from the `exports` of packages/sdk/package.json, read once by `packageEntries()`: the inventory
// (`inventory.ts`) imports every JS entry from the same table, so a new export path reaches both or neither. Each JS
// entry is in exactly one list:
// - COMPONENT_ENTRIES: the entries whose components need specimens (a specimen's `from` is one of them);
// - NO_COMPONENT_ENTRIES: the entries that export no component. The inventory still classifies them, and a
//   component exported there is a problem.
// A JS export path in neither list, or a listed entry the package no longer exports, is a problem too.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, '..', '..', '..');

const PACKAGE_NAME = '@notis/sdk';
const JS_FILE = /\.(?:ts|tsx|mts|js|mjs|jsx)$/;

export const COMPONENT_ENTRIES = Object.freeze(['@notis/sdk', '@notis/sdk/ui', '@notis/sdk/interactions']);
export const NO_COMPONENT_ENTRIES = Object.freeze(['@notis/sdk/words', '@notis/sdk/config', '@notis/sdk/vite']);
/** The entries a specimen or fixture may import from `src/`: the component entries plus the words. */
export const SPECIMEN_IMPORT_ENTRIES = Object.freeze([...COMPONENT_ENTRIES, '@notis/sdk/words']);

function exportTarget(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    for (const key of ['import', 'default']) {
      const target = exportTarget(value[key]);
      if (target) return target;
    }
  }
  return null;
}

/**
 * Every JS export path of `<root>/packages/sdk/package.json`, in package order: `{name, subpath, file}`, with
 * `file` relative to `root` in forward slashes. CSS exports are left out.
 */
export function packageEntries({ root = DEFAULT_ROOT } = {}) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'packages', 'sdk', 'package.json'), 'utf8'));
  const exportsField = pkg.exports && typeof pkg.exports === 'object' && !Array.isArray(pkg.exports)
    ? pkg.exports
    : { '.': pkg.exports ?? pkg.main };
  const out = [];
  for (const [subpath, value] of Object.entries(exportsField)) {
    const target = exportTarget(value);
    if (!target || !JS_FILE.test(target)) continue;
    const name = subpath === '.' ? PACKAGE_NAME : `${PACKAGE_NAME}/${subpath.replace(/^\.\//, '')}`;
    out.push({ name, subpath, file: path.posix.join('packages', 'sdk', target) });
  }
  return out;
}

/** The two lists against the package exports, as inventory problems (`code: 'entry-list'`). */
export function entryListProblems(entries = packageEntries()) {
  const names = new Set(entries.map((entry) => entry.name));
  const problems = [];
  const problem = (name, message) => problems.push({ code: 'entry-list', export: name, file: 'design-system/api.mjs', message });
  for (const entry of entries) {
    const inComponents = COMPONENT_ENTRIES.includes(entry.name);
    const inNone = NO_COMPONENT_ENTRIES.includes(entry.name);
    if (!inComponents && !inNone) {
      problem(entry.name, `packages/sdk/package.json exports ${entry.name} (${entry.file}), which design-system/api.mjs does not list: add it to COMPONENT_ENTRIES when it exports components, else to NO_COMPONENT_ENTRIES.`);
    } else if (inComponents && inNone) {
      problem(entry.name, `${entry.name} is in both COMPONENT_ENTRIES and NO_COMPONENT_ENTRIES of design-system/api.mjs: keep it in one.`);
    }
  }
  for (const name of [...COMPONENT_ENTRIES, ...NO_COMPONENT_ENTRIES]) {
    if (!names.has(name)) problem(name, `design-system/api.mjs lists ${name}, which packages/sdk/package.json does not export as a JS entry: remove it there.`);
  }
  return problems;
}

/** Entry name to its file (relative to `root`), for every JS entry of the package. */
export function entryFiles({ root = DEFAULT_ROOT } = {}) {
  return Object.freeze(Object.fromEntries(packageEntries({ root }).map((entry) => [entry.name, entry.file])));
}

/** The entry files of the checkout holding this script (kept for callers of the old constant). */
export const ENTRY_FILES = entryFiles();

function loadTypeScript(root) {
  const require = createRequire(path.join(root, 'portal', 'package.json'));
  return require('typescript');
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function toPosix(file) {
  return file.split(path.sep).join('/');
}

function declarationNode(ts, decl) {
  if (ts.isVariableDeclaration(decl) && decl.parent && decl.parent.parent && ts.isVariableStatement(decl.parent.parent)) {
    return decl.parent.parent;
  }
  return decl;
}

function firstDocLine(ts, checker, symbol) {
  const text = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
  if (!text) return '';
  return text.split(/\r?\n/)[0].trim();
}

function staticKind(ts, name, symbol, decl) {
  const flags = symbol.flags;
  const SF = ts.SymbolFlags;
  if (flags & SF.Class) return 'class';
  if (!(flags & SF.Value)) return 'type';
  if (flags & SF.Function) {
    if (/^use[A-Z]/.test(name)) return 'hook';
    if (/^[A-Z]/.test(name)) return 'component';
    return 'helper';
  }
  if (flags & SF.Enum) return 'constant';
  if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
    let init = decl.initializer;
    while (ts.isAsExpression(init) || ts.isSatisfiesExpression?.(init) || ts.isParenthesizedExpression(init)) init = init.expression;
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
      if (/^use[A-Z]/.test(name)) return 'hook';
      if (/^[A-Z]/.test(name)) return 'component';
      return 'helper';
    }
  }
  if (/^use[A-Z]/.test(name)) return 'hook';
  return 'constant';
}

/**
 * Every export of every JS entry: `{name, entry, kind, file, line, doc, decl_sha256}`, sorted by entry then
 * name. `kind` is static (`component`, `hook`, `helper`, `class`, `constant`, `type`); the inventory's runtime
 * classification decides component versus not, and the book merges both. `file` is relative to `root`.
 */
export function readApi({ root = DEFAULT_ROOT } = {}) {
  const ts = loadTypeScript(root);
  const sdkDir = path.join(root, 'packages', 'sdk');
  const configPath = path.join(sdkDir, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, sdkDir);
  const files = entryFiles({ root });
  const rootNames = Object.values(files).map((file) => path.join(root, file));
  const program = ts.createProgram({
    rootNames,
    options: { ...parsed.options, noEmit: true, skipLibCheck: true, rootDir: undefined, ignoreDeprecations: '6.0' },
  });
  const checker = program.getTypeChecker();
  const out = [];
  for (const [entry, file] of Object.entries(files)) {
    const source = program.getSourceFile(path.join(root, file));
    if (!source) throw new Error(`api.mjs: cannot read ${file}`);
    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (!moduleSymbol) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const name = exported.getName();
      if (name === 'default' || name === '__esModule') continue;
      let symbol = exported;
      if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const decl = symbol.declarations?.[0] ?? exported.declarations?.[0];
      let fileRel = null;
      let line = null;
      let declSha = null;
      if (decl) {
        const declSource = decl.getSourceFile();
        fileRel = toPosix(path.relative(root, declSource.fileName));
        line = declSource.getLineAndCharacterOfPosition(decl.getStart(declSource)).line + 1;
        declSha = sha256(declarationNode(ts, decl).getText(declSource));
      }
      out.push({
        name,
        entry,
        kind: staticKind(ts, name, symbol, decl),
        file: fileRel,
        line,
        doc: firstDocLine(ts, checker, symbol) || firstDocLine(ts, checker, exported),
        decl_sha256: declSha,
        declared_as: symbol.getName(),
      });
    }
  }
  out.sort((a, b) => (a.entry === b.entry ? a.name.localeCompare(b.name) : a.entry.localeCompare(b.entry)));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg > 0 ? path.resolve(process.argv[rootArg + 1]) : DEFAULT_ROOT;
  process.stdout.write(`${JSON.stringify(readApi({ root }), null, 1)}\n`);
}
