/** Selected, reproducible source slices; never archive a sibling by tree position. */
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { collectSourceFiles, loadAppConfig } from './app-platform.js';
import { usageError } from './errors.js';
import { VIEW_DEFINITION_FIELDS, viewManifestFields } from './space-view-manifest.js';

const CONFIG_FIELDS = new Set(['name', 'description', 'icon', 'accent', 'entry', 'layout', 'readableContext', 'resources', 'actions', 'navigation', 'viewerReads', 'cloudComputer', 'collection', 'sourceIncludes', 'verificationFixtures', ...VIEW_DEFINITION_FIELDS]);
/** Reads with each signed-in viewer's own authority (never an issuer grant); see docs/notis-apps-platform.md. */
export const VIEWER_READ_FAMILIES = Object.freeze(['databases', 'skills']);
const WORKSPACE_INDEXES = new Set(['notis.config.ts', 'notis.config.js', 'notis.config.mjs']);
const ROOT_CONFIGS = ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js', 'vite.config.mjs',
  'postcss.config.js', 'postcss.config.cjs', 'postcss.config.mjs', 'tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.mjs'];

function sourceCompiler(projectDir, files) {
  const require = createRequire(join(projectDir, 'package.json'));
  let ts;
  try { ts = require('typescript'); }
  catch { throw usageError('Install this workspace\'s TypeScript dependency before packaging Space source.'); }
  const codeFiles = Object.keys(files).filter(path => /\.[cm]?[jt]sx?$/.test(path)).map(path => join(projectDir, path));
  let source, checker, syntax, close = () => {};
  if (typeof ts.createProgram === 'function') {
    let options = { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true };
    if (files['tsconfig.json']) {
      const config = ts.readConfigFile(join(projectDir, 'tsconfig.json'), ts.sys.readFile);
      if (config.error) throw usageError('Fix tsconfig.json before building this Space.');
      options = { ...options, ...ts.parseJsonConfigFileContent(config.config, ts.sys, projectDir).options, allowJs: true };
    }
    const program = ts.createProgram(codeFiles, options), projectChecker = program.getTypeChecker();
    source = file => program.getSourceFile(join(projectDir, file));
    checker = () => projectChecker;
    syntax = ts.SyntaxKind;
  } else {
    // TypeScript 7 ships the native compiler and moves JS APIs under unstable/.
    // Keep one scoped API process, rather than falling back to regex parsing or
    // assuming the old typescript package exports a parser.
    const { API } = require('typescript/unstable/sync');
    syntax = require('typescript/unstable/ast').SyntaxKind;
    const api = new API({ cwd: projectDir });
    try {
      const snapshot = api.updateSnapshot({ openFiles: codeFiles });
      const project = file => snapshot.getDefaultProjectForFile(join(projectDir, file));
      source = file => project(file)?.program.getSourceFile(join(projectDir, file));
      checker = file => project(file)?.checker;
      close = () => { try { snapshot.dispose(); } finally { api.close(); } };
    } catch (error) { api.close(); throw error; }
  }
  return {
    close,
    inspect(file) {
      const tree = source(file);
      if (!tree) throw usageError(`The compiler could not inspect ${file}. Include it in this project's TypeScript configuration.`);
      let dynamic = false;
      const assets = [];
      const visit = node => {
        if (node.kind === syntax.CallExpression && node.expression.kind === syntax.ImportKeyword
          && ![syntax.StringLiteral, syntax.NoSubstitutionTemplateLiteral].includes(node.arguments[0]?.kind)) dynamic = true;
        if (node.kind === syntax.NewExpression && node.expression.getText() === 'URL' && node.arguments?.[1]?.getText() === 'import.meta.url') {
          if ([syntax.StringLiteral, syntax.NoSubstitutionTemplateLiteral].includes(node.arguments[0]?.kind)) assets.push(node.arguments[0].text);
          else dynamic = true;
        }
        if (node.kind === syntax.CallExpression && node.expression.getText().startsWith('import.meta.glob')) dynamic = true;
        node.forEachChild(visit);
      };
      visit(tree);
      return { dynamic, assets, references: (tree.referencedFiles || []).map(item => item.fileName),
        imports: (tree.imports || []).map(node => {
          const symbol = checker(file)?.getSymbolAtLocation(node);
          const declaration = symbol?.declarations?.[0];
          const resolved = declaration?.resolve ? declaration.resolve() : declaration;
          return { specifier: node.text, resolved: resolved?.getSourceFile().fileName };
        }) };
    },
  };
}

function key(value, label) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]{0,99}$/.test(value)) throw usageError(`${label} must be a stable lowercase source key.`);
  return value;
}

function localPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || value.includes('\0')
    || value.split('/').some(part => part === '..') || value.startsWith('.notis/') || value.startsWith('.env')) {
    throw usageError('Use a source path inside this workspace, without private profile state.');
  }
  return value.replace(/^\.\//, '').replace(/\/$/, '');
}

export async function loadSelectedSpace(projectDir, selectedKey) {
  projectDir = realpathSync(projectDir);
  selectedKey = key(selectedKey, 'Space');
  const workspace = await loadAppConfig(projectDir);
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace) || !workspace.spaces
    || typeof workspace.spaces !== 'object' || Object.keys(workspace).some(name => !['spaces', 'resources', 'defaultSpace'].includes(name))) {
    throw usageError('Use defineSpaces with an explicit workspace Space index.');
  }
  if (!Object.hasOwn(workspace.spaces, selectedKey)) throw usageError('Choose a Space declared in this source workspace.');
  const reference = workspace.spaces[selectedKey];
  if (!reference || typeof reference !== 'object' || Object.keys(reference).some(name => !['definition', 'parent', 'defaultChild'].includes(name))) {
    throw usageError('A workspace Space entry declares a definition file and optional composition.');
  }
  const definitionPath = localPath(reference.definition);
  const definition = await loadAppConfig(projectDir, { file: definitionPath });
  if (!definition || typeof definition !== 'object' || Array.isArray(definition) || Object.keys(definition).some(name => !CONFIG_FIELDS.has(name))
    || typeof definition.name !== 'string' || !definition.name.trim() || definition.name.length > 200) {
    throw usageError('Use a named Space definition with explicit entry, resources and actions.');
  }
  const resolveDefinitionPath = value => {
    if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.includes('\0')) throw usageError('Use a workspace-relative source path.');
    return localPath(relative(projectDir, resolve(projectDir, dirname(definitionPath), value)).split(sep).join('/'));
  };
  const entry = definition.entry ? resolveDefinitionPath(definition.entry) : null;
  const layout = definition.layout ? resolveDefinitionPath(definition.layout) : null;
  if (!entry && layout) throw usageError('A container has no executable layout.');
  const resources = definition.resources || {};
  if (definition.navigation != null && (typeof definition.navigation !== 'object' || Array.isArray(definition.navigation))) {
    throw usageError('Declare portable named Space destinations.');
  }
  for (const [alias, target] of Object.entries(definition.navigation || {})) {
    key(alias, 'Navigation alias');
    if (!target || typeof target !== 'object' || Object.keys(target).join(',') !== 'key') throw usageError('A navigation reference needs one portable key.');
    key(target.key, 'Navigation target');
  }
  for (const [alias, resource] of Object.entries(resources)) {
    key(alias, 'Resource alias');
    if (resource?.kind === 'database' && resource.create != null) {
      const value = resource.create;
      if (Object.keys(resource).some(name => !['kind', 'create'].includes(name))
        || !value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(name => !['name', 'schema', 'starterRows'].includes(name))
        || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200
        || !value.schema || typeof value.schema !== 'object' || Array.isArray(value.schema)
        || (value.starterRows !== undefined && (!Array.isArray(value.starterRows) || value.starterRows.length > 100
          || value.starterRows.some(row => !row || typeof row !== 'object' || Array.isArray(row))))) {
        throw usageError(`Database ${alias} needs create:{name,schema,starterRows?}, without an existing key.`);
      }
      if (!Object.values(definition.params || {}).some(param => param?.type === 'record' && param.database === alias && param.main === true)) {
        throw usageError(`New database ${alias} needs a record param marked main in this view.`);
      }
      continue;
    }
    if (!resource || !['database', 'document', 'skill', 'automation'].includes(resource.kind) || typeof resource.key !== 'string'
      || Object.keys(resource).some(name => !['kind', 'key'].includes(name))) throw usageError(`Invalid resource reference: ${alias}`);
  }
  if (definition.viewerReads != null && (!Array.isArray(definition.viewerReads)
    || definition.viewerReads.some(family => !VIEWER_READ_FAMILIES.includes(family))
    || new Set(definition.viewerReads).size !== definition.viewerReads.length)) {
    throw usageError("viewerReads lists 'databases' and/or 'skills' once each: the page reads what each signed-in viewer can open.");
  }
  if (definition.viewerReads?.length && !entry) throw usageError('A container has no page, so it cannot declare viewerReads.');
  if (definition.cloudComputer != null && !['read', 'shell'].includes(definition.cloudComputer)) {
    throw usageError("cloudComputer is 'read' or 'shell': the page uses each signed-in viewer's own cloud computer once that viewer allows it.");
  }
  if (definition.cloudComputer != null && !entry) throw usageError('A container has no page, so it cannot use the cloud computer.');
  if (definition.collection && (resources[definition.collection.database]?.kind !== 'database' || !definition.collection.titleProperty)) {
    throw usageError('A collection needs a declared database binding and title property.');
  }
  for (const [actionId, template] of Object.entries(definition.actions || {})) {
    key(actionId, 'Action');
    if (!template || typeof template.tool !== 'string' || !template.tool || Object.keys(template).sort().join(',') !== 'arguments,inputs,tool'
      || template.inputs?.type !== 'object' || template.inputs?.additionalProperties !== false || !template.arguments || Array.isArray(template.arguments)) {
      throw usageError(`Action ${actionId} needs the canonical closed inputs/tool/arguments template.`);
    }
    const scan = value => {
      if (Array.isArray(value)) { value.forEach(scan); return; }
      if (!value || typeof value !== 'object' || Object.hasOwn(value, '$literal')) return;
      if (Object.hasOwn(value, '$asset') && !Object.hasOwn(resources, value.$asset)) throw usageError(`Action ${actionId} uses an undeclared resource alias.`);
      Object.values(value).forEach(scan);
    };
    scan(template.arguments);
  }
  // V4 view manifest (path, params, shows, memory, chrome, markdown); required with specVersion 2.
  viewManifestFields(definition, { entry, resources });
  const markdown = definition.markdown ? resolveDefinitionPath(definition.markdown) : null;
  const fixturePath = definition.verificationFixtures ? resolveDefinitionPath(definition.verificationFixtures) : null;
  return { key: selectedKey, workspace, definition, definitionPath, entry, layout, markdown, fixturePath, resolveDefinitionPath };
}


/** Include type-only/local declarations too; bundle chunks alone omit them. */
export function collectSelectedSpaceSource(projectDir, selection, { buildInputs = [] } = {}) {
  projectDir = realpathSync(projectDir);
  const files = collectSourceFiles(projectDir), selected = new Set(), queued = [];
  const compiler = sourceCompiler(projectDir, files);
  try {
  function add(path) {
    path = localPath(path);
    if (path === 'resources.json' || path === 'skills' || path.startsWith('skills/')) {
      throw usageError('Resource lists and Skill folders use native Space transport, not sourceIncludes or view imports.');
    }
    // This is a synthesized input in the frozen workspace. Its original imports
    // describe unrelated composition, not dependencies of the selected Space.
    if (WORKSPACE_INDEXES.has(path)) return;
    if (!Object.hasOwn(files, path)) throw usageError(`Source dependency is missing, private or linked: ${path}`);
    if (!selected.has(path)) { selected.add(path); queued.push(path); }
  }
  function dependency(specifier, importer, resolved) {
    if (typeof specifier !== 'string' || specifier.startsWith('node:')) return;
    if (resolved) {
      const path = relative(projectDir, resolved).split(sep).join('/');
      const external = path.includes('/node_modules/') || path.startsWith('node_modules/');
      if (!external) { add(path); return; }
      // A relative import is always project source. An ambient declaration such as
      // vite/client's `*.css` module can claim it depending on the working directory.
      if (!specifier.startsWith('.')) return;
    }
    const raw = specifier.split(/[?#]/, 1)[0];
    const path = relative(projectDir, resolve(dirname(join(projectDir, importer)), raw)).split(sep).join('/');
    const candidate = [path, ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.d.ts', '/index.ts', '/index.tsx', '/index.js'].map(suffix => path + suffix)]
      .find(name => Object.hasOwn(files, name));
    if (candidate) { add(candidate); return; }
    if (specifier.startsWith('.') || specifier.startsWith('@/') || specifier.startsWith('#')) throw usageError(`Unresolved source dependency ${specifier} in ${importer}.`);
  }
  ROOT_CONFIGS.filter(path => Object.hasOwn(files, path)).forEach(add);
  const projectPackage = JSON.parse(Buffer.from(files['package.json'] || '', 'base64').toString('utf8'));
  for (const dependency of Object.values({ ...projectPackage.dependencies, ...projectPackage.devDependencies })) {
    if (typeof dependency !== 'string' || !dependency.startsWith('file:')) continue;
    const directory = localPath(dependency.slice(5));
    add(`${directory}/package.json`);
    const metadata = JSON.parse(Buffer.from(files[`${directory}/package.json`], 'base64').toString('utf8'));
    const declared = value => {
      if (typeof value === 'string' && value.startsWith('./')) add(`${directory}/${value.slice(2)}`);
      else if (value && typeof value === 'object') Object.values(value).forEach(declared);
    };
    declared(metadata.exports);
    for (const value of [metadata.main, metadata.module, metadata.types]) if (typeof value === 'string') add(`${directory}/${value.replace(/^\.\//, '')}`);
  }
  add(selection.definitionPath);
  if (selection.entry) add(selection.entry);
  if (selection.layout) add(selection.layout);
  if (selection.markdown) add(selection.markdown);
  if (selection.fixturePath) add(selection.fixturePath);
  for (const include of selection.definition.sourceIncludes || []) {
    const path = selection.resolveDefinitionPath(include);
    const matches = Object.keys(files).filter(name => name === path || name.startsWith(path + '/'));
    if (!matches.length) throw usageError(`No source files match explicit inclusion ${path}.`);
    matches.forEach(add);
  }
  for (const reference of Object.values(selection.definition.resources || {})) {
    if (reference.create || reference.kind === 'skill') continue;
    const resource = selection.workspace.resources?.[reference.key];
    if (resource) {
      if (resource.kind !== reference.kind) throw usageError(`Resource kind changed for ${reference.key}.`);
      const path = localPath(resource.source);
      const matches = Object.keys(files).filter(name => name === path || name.startsWith(path + '/'));
      if (!matches.length) throw usageError(`Missing declared resource source ${path}.`);
      matches.forEach(add);
    }
  }
  for (const input of buildInputs) {
    const path = relative(projectDir, input.split(/[?#]/, 1)[0]).split(sep).join('/');
    if (path.startsWith('.notis/') || path.includes('/node_modules/') || path.startsWith('node_modules/')) continue;
    add(path);
  }
  while (queued.length) {
    const file = queued.shift(), source = Buffer.from(files[file], 'base64').toString('utf8');
    if (/\.[cm]?[jt]sx?$/.test(file)) {
      const parsed = compiler.inspect(file);
      for (const entry of parsed.imports) dependency(entry.specifier, file, entry.resolved);
      for (const reference of parsed.references) dependency(reference, file);
      for (const asset of parsed.assets) dependency(asset, file);
      if (parsed.dynamic && !(selection.definition.sourceIncludes || []).length) throw usageError(`Declare sourceIncludes for dynamic source dependencies in ${file}.`);
    } else if (extname(file) === '.css') {
      for (const match of source.matchAll(/@(import|config)\s+(?:url\(\s*)?['"]([^'"]+)['"]/g)) {
        if (match[2].startsWith('.')) dependency(match[2], file);
      }
      for (const match of source.matchAll(/url\(\s*['"]?(\.[^'"\s)]+)['"]?\s*\)/g)) dependency(match[1], file);
    }
  }
  const result = Object.fromEntries([...selected].sort().map(path => [path, files[path]]));
  // The exported index describes this target only. Composition is not a source
  // permission and publishing one definition never applies siblings or parents.
  for (const path of WORKSPACE_INDEXES) delete result[path];
  const resourceKeys = new Set(Object.values(selection.definition.resources || {}).map(resource => resource.key));
  const resources = Object.fromEntries(Object.entries(selection.workspace.resources || {}).filter(([name]) => resourceKeys.has(name)));
  result['notis.config.ts'] = Buffer.from(`import { defineSpaces } from '@notis/sdk/config';\nexport default defineSpaces(${JSON.stringify({ spaces: { [selection.key]: { definition: selection.definitionPath } }, resources, defaultSpace: selection.key }, null, 2)});\n`).toString('base64');
  return result;
  } finally { compiler.close(); }
}
