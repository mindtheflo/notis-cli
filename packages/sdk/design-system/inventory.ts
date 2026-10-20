/**
 * The export inventory of the design system book (design review spec, sections 5.1 to 5.3).
 *
 * Imports every JS entry of packages/sdk/package.json (the table of `api.mjs`), classifies every export, loads the
 * specimens and reports every coverage problem as data. `completeness.test.tsx` asserts there is none; `build.mjs`
 * runs the CLI and refuses an incomplete book.
 *
 * Coverage is by value: a component exported under several names (an alias) is one value with one specimen, and
 * one name exported as two different values is a problem. A specimen's covers resolve in its `from` entry only,
 * since the book prints `import { covers } from '<from>'`.
 *
 *   node --import tsx design-system/inventory.ts --json      (cwd packages/sdk)
 */
import { existsSync, statSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  COMPONENT_ENTRIES,
  DEFAULT_ROOT,
  NO_COMPONENT_ENTRIES,
  SPECIMEN_IMPORT_ENTRIES,
  entryListProblems,
  packageEntries,
  type ComponentEntry,
  type PackageEntry,
} from './api.mjs';
import type { Specimen } from './specimen';

/** The entries whose components need a specimen (`COMPONENT_ENTRIES` of `api.mjs`). */
export const ENTRY_NAMES: readonly ComponentEntry[] = COMPONENT_ENTRIES;
/** Any JS entry of the package; the component entries are the `ComponentEntry` subset. */
export type EntryName = string;
export const WORDS_ENTRY = '@notis/sdk/words';

/** Each recharts re-export of `@notis/sdk/ui`, mapped to its recharts name. */
export const THIRD_PARTY: Readonly<Record<string, string>> = Object.freeze({
  Area: 'Area',
  AreaChart: 'AreaChart',
  Bar: 'Bar',
  BarChart: 'BarChart',
  CartesianGrid: 'CartesianGrid',
  Cell: 'Cell',
  ChartTooltip: 'Tooltip',
  ComposedChart: 'ComposedChart',
  LabelList: 'LabelList',
  Legend: 'Legend',
  Line: 'Line',
  LineChart: 'LineChart',
  Pie: 'Pie',
  PieChart: 'PieChart',
  ReferenceDot: 'ReferenceDot',
  ReferenceLine: 'ReferenceLine',
  ResponsiveContainer: 'ResponsiveContainer',
  Scatter: 'Scatter',
  XAxis: 'XAxis',
  YAxis: 'YAxis',
});
export const THIRD_PARTY_ENTRY: ComponentEntry = '@notis/sdk/ui';

/**
 * Render helpers: functions an app passes to a recharts piece (`shape`, `label.content`), which recharts calls itself,
 * so they never commit as a component and the render smoke cannot see them. Each needs a specimen that imports it
 * from this entry and renders it (`unused-helper` otherwise).
 */
export const RENDER_HELPERS: Readonly<Record<string, ComponentEntry>> = Object.freeze({
  barLabel: '@notis/sdk/ui',
  barShape: '@notis/sdk/ui',
});

export type ExportKind = 'component' | 'third_party' | 'hook' | 'class' | 'context' | 'function' | 'value';

export interface ClassifiedExport {
  name: string;
  entry: EntryName;
  kind: ExportKind;
}

export interface ComponentValue {
  /** The canonical name (the declared name when it can be read from the value). */
  name: string;
  /** Every exported name of this value, canonical first. */
  names: string[];
  /** The component entries exporting each name. */
  entries: Record<string, EntryName[]>;
  value: unknown;
}

export interface InventoryProblem {
  code:
    | 'uncovered'
    | 'unknown-cover'
    | 'covered-twice'
    | 'bad-group'
    | 'bad-file-name'
    | 'bad-id'
    | 'duplicate-id'
    | 'bad-state'
    | 'no-states'
    | 'bad-module'
    | 'third-party'
    | 'entry-list'
    | 'duplicate-name'
    | 'bad-from'
    | 'bad-import'
    | 'unused-helper';
  export?: string;
  file?: string;
  message: string;
}

export interface LoadedSpecimen {
  /** Path relative to `packages/sdk/design-system`, with forward slashes. */
  file: string;
  specimen: Specimen;
}

export interface Group {
  key: string;
  title: string;
  owns: string[];
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DESIGN_SYSTEM_DIR = HERE;
export const SPECIMENS_DIR = path.join(HERE, 'specimens');
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const FORWARD_REF = Symbol.for('react.forward_ref');
const MEMO = Symbol.for('react.memo');
const LAZY = Symbol.for('react.lazy');
const CONTEXT_SYMBOLS = new Set([Symbol.for('react.context'), Symbol.for('react.provider'), Symbol.for('react.consumer')]);

function typeTag(value: unknown): symbol | undefined {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  const tag = (value as { $$typeof?: unknown }).$$typeof;
  return typeof tag === 'symbol' ? tag : undefined;
}

function isClassSource(value: Function): boolean {
  return /^class[\s{]/.test(Function.prototype.toString.call(value));
}

/** Whether an export is a React component under the rule of section 5.1. */
export function isComponent(name: string, value: unknown): boolean {
  if (typeof value === 'function') {
    if ((value as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent) return true;
    return /^[A-Z]/.test(name) && !/^use[A-Z]/.test(name) && !isClassSource(value);
  }
  const tag = typeTag(value);
  return tag === FORWARD_REF || tag === MEMO || tag === LAZY;
}

function classify(name: string, value: unknown, entry: EntryName): ExportKind {
  if (entry === THIRD_PARTY_ENTRY && Object.hasOwn(THIRD_PARTY, name)) return 'third_party';
  const tag = typeTag(value);
  if (tag && CONTEXT_SYMBOLS.has(tag)) return 'context';
  if (isComponent(name, value)) return 'component';
  if (typeof value === 'function') {
    if (/^use[A-Z]/.test(name)) return 'hook';
    if (isClassSource(value)) return 'class';
    return 'function';
  }
  return 'value';
}

/** Entry name to its module namespace, for every JS entry of the package, in package order. */
export type EntryModules = Record<EntryName, Record<string, unknown>>;

/** Loads every JS entry of packages/sdk/package.json (`packageEntries()` of `api.mjs`). */
export async function loadEntries(entries: readonly PackageEntry[] = packageEntries()): Promise<EntryModules> {
  const loaded = await Promise.all(entries.map(async (entry) => {
    const mod = (await import(pathToFileURL(path.join(DEFAULT_ROOT, entry.file)).href)) as Record<string, unknown>;
    return [entry.name, mod] as const;
  }));
  return Object.fromEntries(loaded);
}

function isComponentEntry(entry: string): entry is ComponentEntry {
  return (COMPONENT_ENTRIES as readonly string[]).includes(entry);
}

/** Every export of every loaded entry with its kind. */
export function classifyExports(entries: EntryModules): ClassifiedExport[] {
  const out: ClassifiedExport[] = [];
  for (const entry of Object.keys(entries)) {
    for (const name of Object.keys(entries[entry]).sort()) {
      out.push({ name, entry, kind: classify(name, entries[entry][name], entry) });
    }
  }
  return out;
}

/**
 * The entry table against the package (section 5.1): every JS export path is a component entry or a listed
 * no-component entry, and a no-component entry really exports no component.
 */
export function checkEntries(classified: readonly ClassifiedExport[], pkg: readonly PackageEntry[] = packageEntries()): InventoryProblem[] {
  const problems: InventoryProblem[] = entryListProblems([...pkg]).map((problem) => ({ ...problem }));
  for (const item of classified) {
    if (isComponentEntry(item.entry)) continue;
    if (item.kind !== 'component' && item.kind !== 'third_party') continue;
    const listed = (NO_COMPONENT_ENTRIES as readonly string[]).includes(item.entry);
    problems.push({ code: 'entry-list', export: item.name, file: 'design-system/api.mjs',
      message: `${item.entry} exports the component ${item.name}, but ${listed ? 'NO_COMPONENT_ENTRIES of design-system/api.mjs says it has none' : 'it is not a component entry'}: move ${item.entry} to COMPONENT_ENTRIES and give ${item.name} a specimen, or export it from a component entry instead.` });
  }
  return problems;
}

function declaredName(value: unknown): string | undefined {
  if (typeof value === 'function') return (value as { displayName?: string }).displayName || value.name || undefined;
  const inner = value as { displayName?: string; render?: Function; type?: unknown } | null;
  if (!inner) return undefined;
  if (inner.displayName) return inner.displayName;
  if (typeof inner.render === 'function' && inner.render.name) return inner.render.name;
  if (inner.type) return declaredName(inner.type);
  return undefined;
}

/** The component values, each once, with all its exported names (aliases) and entries. */
export function componentValues(entries: EntryModules, classified = classifyExports(entries)): ComponentValue[] {
  const byValue = new Map<unknown, ComponentValue>();
  for (const item of classified) {
    if (item.kind !== 'component' || !isComponentEntry(item.entry)) continue;
    const value = entries[item.entry][item.name];
    let found = byValue.get(value);
    if (!found) {
      found = { name: item.name, names: [], entries: {}, value };
      byValue.set(value, found);
    }
    if (!found.names.includes(item.name)) found.names.push(item.name);
    (found.entries[item.name] ??= []).push(item.entry);
  }
  for (const found of byValue.values()) {
    const declared = declaredName(found.value);
    const canonical = declared && found.names.includes(declared) ? declared : [...found.names].sort()[0];
    found.name = canonical;
    found.names = [canonical, ...found.names.filter((name) => name !== canonical).sort()];
  }
  return [...byValue.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** One exported name bound to two or more different component values (across entries): the book cannot tell them apart. */
export function duplicateNameProblems(values: readonly ComponentValue[]): InventoryProblem[] {
  const byName = new Map<string, ComponentValue[]>();
  for (const value of values) {
    for (const name of value.names) {
      const list = byName.get(name) ?? [];
      list.push(value);
      byName.set(name, list);
    }
  }
  const problems: InventoryProblem[] = [];
  for (const [name, list] of [...byName.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (list.length < 2) continue;
    const where = list.map((value) => (value.entries[name] ?? []).join(' and ')).join('; ');
    problems.push({ code: 'duplicate-name', export: name, file: 'design-system/inventory.ts',
      message: `${name} names ${list.length} different component values (${where}): export one value under that name from every entry, or rename one of them.` });
  }
  return problems;
}

/** Recharts drift: a mapped name gone or different, or a recharts export re-exported without a mapping. */
export function checkThirdParty(entries: EntryModules, recharts: Record<string, unknown>): InventoryProblem[] {
  const problems: InventoryProblem[] = [];
  const ui = entries[THIRD_PARTY_ENTRY];
  for (const [name, rechartsName] of Object.entries(THIRD_PARTY)) {
    if (!Object.hasOwn(ui, name)) {
      problems.push({ code: 'third-party', export: name, file: 'design-system/inventory.ts',
        message: `THIRD_PARTY lists ${name}, which ${THIRD_PARTY_ENTRY} no longer exports: remove it from THIRD_PARTY in design-system/inventory.ts.` });
    } else if (ui[name] !== recharts[rechartsName]) {
      problems.push({ code: 'third-party', export: name, file: 'design-system/inventory.ts',
        message: `${name} of ${THIRD_PARTY_ENTRY} is not recharts ${rechartsName}: fix its THIRD_PARTY mapping, or remove it there if it is now an SDK component (it then needs a specimen).` });
    }
  }
  const rechartsValues = new Map<unknown, string>();
  for (const [name, value] of Object.entries(recharts)) {
    if (value && (typeof value === 'function' || typeof value === 'object')) rechartsValues.set(value, name);
  }
  for (const entry of Object.keys(entries)) {
    for (const [name, value] of Object.entries(entries[entry])) {
      const rechartsName = rechartsValues.get(value);
      if (rechartsName === undefined) continue;
      if (entry === THIRD_PARTY_ENTRY && Object.hasOwn(THIRD_PARTY, name)) continue;
      problems.push({ code: 'third-party', export: name, file: 'design-system/inventory.ts',
        message: `${entry} re-exports recharts ${rechartsName} as ${name} without a THIRD_PARTY entry: add ${name}: '${rechartsName}' to THIRD_PARTY in design-system/inventory.ts.` });
    }
  }
  return problems;
}

/** The ordered groups of `groups.json`. */
export async function loadGroups(): Promise<Group[]> {
  return JSON.parse(await readFile(path.join(HERE, 'groups.json'), 'utf8')) as Group[];
}

/** The group owning a source file (path relative to `packages/sdk/src/`): the first prefix it starts with. */
export function groupOfSource(groups: readonly Group[], sourceFromSrc: string): string | undefined {
  return groups.find((group) => group.owns.some((prefix) => sourceFromSrc.startsWith(prefix)))?.key;
}

async function listSpecimenFiles(dir: string): Promise<string[]> {
  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listSpecimenFiles(full)));
    else if (entry.name.endsWith('.specimen.tsx')) files.push(full);
  }
  return files;
}

/** The specimen files under `specimens/`, relative to `design-system/`, sorted. */
export async function specimenFiles(): Promise<string[]> {
  return (await listSpecimenFiles(SPECIMENS_DIR)).map((file) => path.relative(HERE, file).split(path.sep).join('/'));
}

/** Imports every specimen; a file that fails to load or has no `specimen` export is a problem. */
export async function loadSpecimens(): Promise<{ specimens: LoadedSpecimen[]; problems: InventoryProblem[] }> {
  // `../../../src/ui` must reach `src/ui/index.ts` like the package export, not the placeholder `src/ui.ts`.
  (await import('./resolve.mjs')).registerSourceAliases();
  const specimens: LoadedSpecimen[] = [];
  const problems: InventoryProblem[] = [];
  for (const file of await specimenFiles()) {
    try {
      const mod = (await import(pathToFileURL(path.join(HERE, file)).href)) as { specimen?: Specimen };
      if (!mod.specimen || typeof mod.specimen !== 'object') {
        problems.push({ code: 'bad-module', file, message: `${file} has no \`export const specimen = defineSpecimen({...})\`: add it.` });
        continue;
      }
      specimens.push({ file, specimen: mod.specimen });
    } catch (error) {
      problems.push({ code: 'bad-module', file, message: `${file} failed to load: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return { specimens, problems };
}

export interface CoverageResult {
  problems: InventoryProblem[];
  /** Component value (the exported object itself) to the id and file of the specimen covering it. */
  coveredBy: Map<unknown, { id: string; file: string }>;
}

/**
 * Coverage and specimen shape (section 5.3). `sourceGroup` names the group of a component's source file when
 * known (from `api.mjs`), so an uncovered component says where its specimen goes.
 */
export function checkCoverage(
  entries: EntryModules,
  specimens: readonly LoadedSpecimen[],
  groups: readonly Group[],
  sourceGroup: (name: string) => string | undefined = () => undefined,
): CoverageResult {
  const problems: InventoryProblem[] = [];
  const classified = classifyExports(entries);
  const values = componentValues(entries, classified);
  const byValue = new Map<unknown, ComponentValue>(values.map((value) => [value.value, value]));
  const groupKeys = new Set(groups.map((group) => group.key));
  const coveredBy = new Map<unknown, { id: string; file: string }>();
  const ids = new Map<string, string>();

  for (const { file, specimen } of specimens) {
    const segments = file.split('/');
    const folder = segments.length >= 3 ? segments[segments.length - 2] : '';
    const baseName = segments[segments.length - 1];
    if (!groupKeys.has(specimen.group)) {
      problems.push({ code: 'bad-group', file, message: `${file}: group "${specimen.group}" is not a key of design-system/groups.json; use one of ${[...groupKeys].join(', ')}.` });
    }
    if (specimen.group !== folder) {
      problems.push({ code: 'bad-group', file, message: `${file}: group "${specimen.group}" does not match its folder "${folder}"; move the file to specimens/${specimen.group}/ or fix the group.` });
    }
    if (baseName !== `${specimen.name}.specimen.tsx`) {
      problems.push({ code: 'bad-file-name', file, message: `${file}: name "${specimen.name}" needs the file name ${specimen.name}.specimen.tsx; rename the file or fix the name.` });
    }
    if (typeof specimen.id !== 'string' || !KEBAB.test(specimen.id)) {
      problems.push({ code: 'bad-id', file, message: `${file}: id "${String(specimen.id)}" must be kebab case (^[a-z0-9-]+$).` });
    } else if (ids.has(specimen.id)) {
      problems.push({ code: 'duplicate-id', file, message: `${file}: id "${specimen.id}" is already used by ${ids.get(specimen.id)}; pick another id.` });
    } else {
      ids.set(specimen.id, file);
    }
    const states = Array.isArray(specimen.states) ? specimen.states : [];
    if (states.length === 0) {
      problems.push({ code: 'no-states', file, message: `${file}: the specimen has no states; add at least one.` });
    }
    const stateIds = new Set<string>();
    for (const state of states) {
      if (typeof state.id !== 'string' || !KEBAB.test(state.id)) {
        problems.push({ code: 'bad-state', file, message: `${file}: state id "${String(state.id)}" must match ^[a-z0-9-]+$ (kebab case).` });
      } else if (stateIds.has(state.id)) {
        problems.push({ code: 'bad-state', file, message: `${file}: state id "${state.id}" is used twice; make it unique in the specimen.` });
      }
      stateIds.add(state.id);
      if (typeof state.render !== 'function') {
        problems.push({ code: 'bad-state', file, message: `${file}: state "${state.id}" has no render function.` });
      }
    }
    const covers = Array.isArray(specimen.covers) ? specimen.covers : [];
    if (covers.length === 0) {
      problems.push({ code: 'unknown-cover', file, message: `${file}: covers is empty; list the component exports it shows.` });
    }
    // The book prints `import { ...covers } from '<from>'`, so every cover resolves in `from` and nowhere else.
    const from = specimen.from as string;
    const fromOk = isComponentEntry(from) && Boolean(entries[from]);
    if (!fromOk) {
      problems.push({ code: 'bad-from', file, message: `${file}: from "${String(from)}" is not a component entry; use one of ${COMPONENT_ENTRIES.join(', ')} (COMPONENT_ENTRIES of design-system/api.mjs), the entry its covers are imported from.` });
    }
    const seenHere = new Set<ComponentValue>();
    for (const name of covers) {
      let value: ComponentValue | undefined;
      if (fromOk && Object.hasOwn(entries[from], name)) {
        value = byValue.get(entries[from][name]);
        if (!value) {
          problems.push({ code: 'unknown-cover', export: name, file, message: `${file}: covers "${name}", which ${from} exports but which is not a component; remove it from covers.` });
          continue;
        }
      } else {
        const elsewhere = ENTRY_NAMES.filter((entry) => entries[entry] && Object.hasOwn(entries[entry], name) && byValue.has(entries[entry][name]));
        if (elsewhere.length === 0) {
          const third = Object.hasOwn(THIRD_PARTY, name) ? ' (a recharts re-export: show it inside a charts specimen without covering it)' : '';
          problems.push({ code: 'unknown-cover', export: name, file, message: `${file}: covers "${name}", which is not a component export of any entry${third}; remove it from covers.` });
          continue;
        }
        if (fromOk) {
          problems.push({ code: 'bad-from', export: name, file, message: `${file}: covers "${name}", which its from ${from} does not export, so the book would print a wrong import line: set from to ${elsewhere.join(' or ')}, or cover ${name} in a specimen whose from exports it.` });
        }
        // Still counted, so the same mistake is not also reported as an uncovered component.
        value = byValue.get(entries[elsewhere[0]][name]);
      }
      if (!value || seenHere.has(value)) continue;
      seenHere.add(value);
      const previous = coveredBy.get(value.value);
      if (previous) {
        problems.push({ code: 'covered-twice', export: name, file, message: `${value.name}${name !== value.name ? ` (as ${name})` : ''} is covered by ${previous.file} and ${file}; keep it in one specimen.` });
        continue;
      }
      coveredBy.set(value.value, { id: specimen.id, file });
    }
  }

  for (const value of values) {
    if (coveredBy.has(value.value)) continue;
    const group = sourceGroup(value.name);
    const where = group ? `specimens/${group}/${value.name}.specimen.tsx` : `specimens/<group>/${value.name}.specimen.tsx`;
    const aliases = value.names.length > 1 ? ` (also exported as ${value.names.slice(1).join(', ')})` : '';
    const entryList = [...new Set(Object.values(value.entries).flat())].join(', ');
    problems.push({ code: 'uncovered', export: value.name, file: where,
      message: `${value.name}${aliases} from ${entryList} has no specimen: add ${where}, or list it in the covers of an existing specimen of that group.` });
  }
  return { problems, coveredBy };
}

/** Minimal shape of the TypeScript JS API used by the import scan (portal/node_modules/typescript, as in `api.mjs`). */
interface ScanNode {
  kind: number;
  moduleSpecifier?: ScanNode & { text?: string };
  importClause?: { namedBindings?: { elements?: Array<{ name: { text: string }; propertyName?: { text: string } }> } };
}
interface ImportScanner {
  preProcessFile(text: string, readImportFiles?: boolean, detectJavaScriptImports?: boolean): { importedFiles: Array<{ fileName: string }> };
  createSourceFile(fileName: string, text: string, target: number, setParentNodes?: boolean, kind?: number): { statements: ScanNode[] };
  SyntaxKind: { ImportDeclaration: number; StringLiteral: number };
  ScriptTarget: { Latest: number };
  ScriptKind: { TSX: number };
}

let scanner: ImportScanner | undefined;
function importScanner(): ImportScanner {
  scanner ??= createRequire(path.join(DEFAULT_ROOT, 'portal', 'package.json'))('typescript') as ImportScanner;
  return scanner;
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx'];
const SDK_SRC = path.join(DEFAULT_ROOT, 'packages', 'sdk', 'src');

function isFile(file: string): boolean {
  return existsSync(file) && statSync(file).isFile();
}

/** The module files a relative specifier may reach: itself, with an extension, or its index. */
function candidates(target: string): string[] {
  const out = [target, ...SOURCE_EXTENSIONS.map((ext) => target + ext), ...SOURCE_EXTENSIONS.map((ext) => path.join(target, `index${ext}`))];
  if (/\.m?js$/.test(target)) out.push(target.replace(/\.m?js$/, '.ts'), target.replace(/\.m?js$/, '.tsx'));
  return out;
}

/**
 * Imports of `packages/sdk/src` modules other than the public entries (section 5.3), in every file a specimen
 * reaches (specimens, fixtures, the fake runtime, the specimen contract). A specimen documents the public API, so
 * it imports `src`, `src/ui`, `src/interactions` or `src/words` (each with or without `/index`), never an
 * internal file that could drift from what an app can import. Type-only and dynamic imports count too.
 */
/** The names a file imports by name (`import { a, b as c } from 'x'` gives a and b), with their specifier. */
function namedImports(file: string, text: string): Array<{ specifier: string; name: string }> {
  const ts = importScanner();
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const out: Array<{ specifier: string; name: string }> = [];
  for (const statement of source.statements) {
    if (statement.kind !== ts.SyntaxKind.ImportDeclaration) continue;
    const specifier = statement.moduleSpecifier;
    if (!specifier || specifier.kind !== ts.SyntaxKind.StringLiteral || typeof specifier.text !== 'string') continue;
    for (const element of statement.importClause?.namedBindings?.elements ?? []) {
      out.push({ specifier: specifier.text, name: (element.propertyName ?? element.name).text });
    }
  }
  return out;
}

/** Each `RENDER_HELPERS` name with the specimen files that import it from its entry. */
export async function helperImports(files: readonly string[]): Promise<Map<string, string[]>> {
  const entryFile = new Map(packageEntries().map((entry) => [entry.name, path.join(DEFAULT_ROOT, entry.file)]));
  const found = new Map<string, string[]>(Object.keys(RENDER_HELPERS).map((name) => [name, []]));
  for (const file of files) {
    const full = path.join(HERE, file);
    for (const { specifier, name } of namedImports(full, await readFile(full, 'utf8'))) {
      const entry = RENDER_HELPERS[name];
      if (!entry) continue;
      const reaches = specifier === entry
        || (specifier.startsWith('.') && candidates(path.resolve(path.dirname(full), specifier)).includes(entryFile.get(entry) ?? ''));
      if (reaches && !found.get(name)!.includes(file)) found.get(name)!.push(file);
    }
  }
  return found;
}

/** A render helper no specimen imports from its entry, or one its entry no longer exports. */
export async function checkHelpers(entries: EntryModules, files: readonly string[]): Promise<InventoryProblem[]> {
  const problems: InventoryProblem[] = [];
  const found = await helperImports(files);
  for (const [name, entry] of Object.entries(RENDER_HELPERS)) {
    if (typeof entries[entry]?.[name] !== 'function') {
      problems.push({ code: 'unused-helper', export: name,
        message: `RENDER_HELPERS lists ${name}, which ${entry} no longer exports as a function: remove it from RENDER_HELPERS in design-system/inventory.ts.` });
      continue;
    }
    if (found.get(name)!.length === 0) {
      problems.push({ code: 'unused-helper', export: name,
        message: `${name} of ${entry} is a render helper no specimen shows: import it in a specimen (from ${entry}) and render it in a state.` });
    }
  }
  return problems;
}

export async function checkImports(files: readonly string[]): Promise<InventoryProblem[]> {
  const allowedFiles = new Set(packageEntries()
    .filter((entry) => (SPECIMEN_IMPORT_ENTRIES as readonly string[]).includes(entry.name))
    .map((entry) => path.join(DEFAULT_ROOT, entry.file)));
  const allowedNames = new Set<string>(SPECIMEN_IMPORT_ENTRIES);
  const problems: InventoryProblem[] = [];
  const queue = files.map((file) => path.join(HERE, file));
  const seen = new Set<string>(queue);
  const relative = (file: string) => path.relative(HERE, file).split(path.sep).join('/');
  while (queue.length > 0) {
    const file = queue.shift()!;
    const text = await readFile(file, 'utf8');
    const specifiers = [...new Set(importScanner().preProcessFile(text, true, true).importedFiles.map((item) => item.fileName))];
    for (const specifier of specifiers) {
      if (specifier.startsWith('@notis/sdk')) {
        if (!allowedNames.has(specifier)) {
          problems.push({ code: 'bad-import', export: specifier, file: relative(file),
            message: `${relative(file)} imports '${specifier}', which is not a public entry a specimen may use: import from ${[...allowedNames].join(', ')}.` });
        }
        continue;
      }
      if (!specifier.startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), specifier);
      if (target === SDK_SRC || target.startsWith(SDK_SRC + path.sep)) {
        if (candidates(target).some((candidate) => allowedFiles.has(candidate))) continue;
        const reached = candidates(target).find(isFile);
        const shown = reached ? path.relative(DEFAULT_ROOT, reached).split(path.sep).join('/') : path.relative(DEFAULT_ROOT, target).split(path.sep).join('/');
        problems.push({ code: 'bad-import', export: specifier, file: relative(file),
          message: `${relative(file)} imports '${specifier}' (${shown}), an internal SDK module: import it from a public entry (src, src/ui, src/interactions or src/words), or export it there first if an app needs it.` });
        continue;
      }
      if (!target.startsWith(HERE + path.sep)) continue;
      const next = candidates(target).find(isFile);
      if (next && SOURCE_EXTENSIONS.includes(path.extname(next)) && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return problems;
}

/** One `*_WORDS` table as rows. `{en, fr}` leaves become rows; other leaves keep their JSON text. */
export interface WordsTable {
  entry: string;
  name: string;
  rows: Array<{ key: string; en: string; fr: string; raw?: boolean }>;
}

function wordRows(value: unknown, prefix: string, rows: WordsTable['rows']): void {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.en === 'string' && typeof record.fr === 'string') {
      rows.push({ key: prefix || '(value)', en: record.en, fr: record.fr });
      return;
    }
    for (const key of Object.keys(record)) wordRows(record[key], prefix ? `${prefix}.${key}` : key, rows);
    return;
  }
  const text = typeof value === 'function' ? `(function ${value.name || 'anonymous'})` : JSON.stringify(value) ?? String(value);
  rows.push({ key: prefix || '(value)', en: text, fr: text, raw: true });
}

/**
 * Every exported `*_WORDS` value of every loaded entry, each table once (by value), under its first entry: the
 * component entries first, then the others in package order (so a table keeps its entry when an entry is added).
 */
export async function collectWords(entries: EntryModules): Promise<WordsTable[]> {
  const order = [...ENTRY_NAMES.filter((entry) => entries[entry]), ...Object.keys(entries).filter((entry) => !isComponentEntry(entry))];
  const all = order.map((entry) => [entry, entries[entry]] as const);
  const seen = new Set<unknown>();
  const tables: WordsTable[] = [];
  for (const [entry, mod] of all) {
    for (const name of Object.keys(mod).sort()) {
      if (!/_WORDS$/.test(name)) continue;
      const value = mod[name];
      if (seen.has(value)) continue;
      seen.add(value);
      const rows: WordsTable['rows'] = [];
      wordRows(value, '', rows);
      tables.push({ entry, name, rows });
    }
  }
  return tables;
}

export interface InventoryReport {
  ok: boolean;
  problems: InventoryProblem[];
  exports: ClassifiedExport[];
  /** Every component name (79 today), with its canonical value name and the covering specimen. */
  components: Array<{ name: string; of: string; entries: EntryName[]; specimen: string | null; specimen_file: string | null }>;
  aliases: Array<{ name: string; of: string; entry: EntryName }>;
  third_party: Array<{ name: string; entry: EntryName; from: 'recharts'; as: string }>;
  specimens: Array<{ file: string; id: string; name: string; group: string; from: string; covers: string[]; summary: string;
    states: Array<{ id: string; label: string; width: number | null; height: number | null; theme: string | null; interact: boolean }> }>;
  words: WordsTable[];
}

/**
 * Everything the book and the completeness test need, with every problem as data. Pass `sourceGroup` (from
 * `api.mjs`) so an uncovered component names the folder its specimen belongs in.
 */
export async function checkInventory(options: { sourceGroup?: (name: string) => string | undefined; words?: boolean } = {}): Promise<InventoryReport> {
  const pkg = packageEntries();
  const entries = await loadEntries(pkg);
  const recharts = (await import('recharts')) as Record<string, unknown>;
  const groups = await loadGroups();
  const loaded = await loadSpecimens();
  const classified = classifyExports(entries);
  const values = componentValues(entries, classified);
  const coverage = checkCoverage(entries, loaded.specimens, groups, options.sourceGroup);
  const problems = [
    ...checkEntries(classified, pkg),
    ...loaded.problems,
    ...checkThirdParty(entries, recharts),
    ...duplicateNameProblems(values),
    ...coverage.problems,
    ...(await checkImports(await specimenFiles())),
    ...(await checkHelpers(entries, await specimenFiles())),
  ];

  const components: InventoryReport['components'] = [];
  const aliases: InventoryReport['aliases'] = [];
  for (const value of values) {
    const covering = coverage.coveredBy.get(value.value) ?? null;
    for (const name of value.names) {
      components.push({ name, of: value.name, entries: value.entries[name], specimen: covering?.id ?? null, specimen_file: covering?.file ?? null });
      if (name !== value.name) for (const entry of value.entries[name]) aliases.push({ name, of: value.name, entry });
    }
  }
  components.sort((a, b) => a.name.localeCompare(b.name));
  const thirdParty = Object.entries(THIRD_PARTY)
    .filter(([name]) => Object.hasOwn(entries[THIRD_PARTY_ENTRY], name))
    .map(([name, as]) => ({ name, entry: THIRD_PARTY_ENTRY, from: 'recharts' as const, as }));

  return {
    ok: problems.length === 0,
    problems,
    exports: classified,
    components,
    aliases,
    third_party: thirdParty,
    specimens: loaded.specimens.map(({ file, specimen }) => ({
      file,
      id: specimen.id,
      name: specimen.name,
      group: specimen.group,
      from: specimen.from,
      covers: [...(specimen.covers ?? [])],
      summary: specimen.summary,
      states: (specimen.states ?? []).map((state) => ({
        id: state.id,
        label: state.label,
        width: state.width ?? null,
        height: state.height ?? null,
        theme: state.theme ?? null,
        interact: typeof state.interact === 'function',
      })),
    })),
    words: options.words === false ? [] : await collectWords(entries),
  };
}

/** The group of each component's declaration file (from `api.mjs`), or undefined when the API index cannot be read. */
export async function sourceGroupFromApi(): Promise<((name: string) => string | undefined) | undefined> {
  try {
    const api = (await import('./api.mjs')) as typeof import('./api.mjs');
    const groups = await loadGroups();
    const index = api.readApi();
    return (name) => {
      const found = index.find((item) => item.name === name && item.file?.startsWith('packages/sdk/src/'));
      return found?.file ? groupOfSource(groups, found.file.slice('packages/sdk/src/'.length)) : undefined;
    };
  } catch {
    return undefined;
  }
}

async function main(argv: string[]): Promise<void> {
  const report = await checkInventory({ sourceGroup: await sourceGroupFromApi() });
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }
  const values = new Set(report.components.map((item) => item.of));
  process.stdout.write(`${report.components.length} component names, ${values.size} values, ${report.specimens.length} specimens\n`);
  for (const problem of report.problems) process.stdout.write(`PROBLEM ${problem.message}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
