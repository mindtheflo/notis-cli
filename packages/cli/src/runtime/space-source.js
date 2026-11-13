/** Selected, reproducible source slices; never archive a sibling by tree position. */
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { collectSourceFiles, loadAppConfig } from './app-platform.js';
import { usageError } from './errors.js';
import { VIEW_DEFINITION_FIELDS, viewManifestFields } from './space-view-manifest.js';
import { editorOnlyColumns, editorsOnlyFlag, withoutMarker } from './space-audience.js';

const CONFIG_FIELDS = new Set(['name', 'description', 'icon', 'accent', 'entry', 'layout', 'readableContext', 'resources', 'actions', 'navigation', 'viewerReads', 'cloudComputer', 'agents', 'threadItems', 'collection', 'sourceIncludes', 'verificationFixtures', 'editorsOnly', ...VIEW_DEFINITION_FIELDS]);
/** Reads with each signed-in viewer's own authority (never an issuer grant); see docs/notis-spaces-platform.md. */
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

const CLOUD_COMPUTER_LEVELS = ['read', 'shell'];
const CLOUD_COMPUTER_FIELDS = ['access', 'services'];
const CLOUD_SERVICE_FIELDS = ['id', 'command', 'cwd', 'ready'];
const CLOUD_SERVICE_ID = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_CLOUD_SERVICES = 4;

/**
 * `cloudComputer` is 'read' | 'shell' | { access, services? }. The object is copied
 * into the manifest as-is, so every rule here matches the server's own check.
 */
export function validateCloudComputer(value) {
  const levels = "cloudComputer is 'read', 'shell' or { access: 'read' | 'shell', services? }: the page uses each signed-in viewer's own cloud computer once that viewer allows it.";
  if (typeof value === 'string') {
    if (!CLOUD_COMPUTER_LEVELS.includes(value)) throw usageError(levels);
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw usageError(levels);
  const unknown = Object.keys(value).filter(name => !CLOUD_COMPUTER_FIELDS.includes(name)).sort();
  if (unknown.length) throw usageError(`Unsupported cloudComputer fields: ${unknown.join(', ')}. Use access and services.`);
  if (!CLOUD_COMPUTER_LEVELS.includes(value.access)) throw usageError(levels);
  if (value.services === undefined) return;
  if (!Array.isArray(value.services)) throw usageError('cloudComputer.services is a list of { id, command, cwd?, ready? }.');
  if (value.services.length && value.access !== 'shell') throw usageError("cloudComputer.services needs access: 'shell'.");
  if (value.services.length > MAX_CLOUD_SERVICES) throw usageError(`cloudComputer declares at most ${MAX_CLOUD_SERVICES} services.`);
  const seen = new Set();
  for (const service of value.services) {
    if (!service || typeof service !== 'object' || Array.isArray(service)) throw usageError('Each cloudComputer service is { id, command, cwd?, ready? }.');
    const extra = Object.keys(service).filter(name => !CLOUD_SERVICE_FIELDS.includes(name)).sort();
    if (extra.length) throw usageError(`Unsupported cloudComputer service fields: ${extra.join(', ')}. Use id, command, cwd and ready.`);
    if (typeof service.id !== 'string' || !CLOUD_SERVICE_ID.test(service.id)) {
      throw usageError('A cloudComputer service id starts with a lowercase letter, then up to 39 lowercase letters, digits or dashes.');
    }
    if (seen.has(service.id)) throw usageError(`cloudComputer service ${service.id} is declared twice.`);
    seen.add(service.id);
    const label = `cloudComputer service ${service.id}`;
    if (typeof service.command !== 'string' || !service.command.trim() || service.command.length > 4096 || service.command.includes('\0')) {
      throw usageError(`${label} needs a command of 1 to 4096 characters.`);
    }
    if (service.cwd !== undefined) {
      if (typeof service.cwd === 'string') {
        if (!service.cwd || service.cwd.length > 1024 || service.cwd.includes('\0')
          || service.cwd.split('/').some(part => part === '..')
          || (service.cwd.startsWith('/') && service.cwd !== '/vercel/sandbox' && !service.cwd.startsWith('/vercel/sandbox/'))) {
          throw usageError(`${label} cwd is a cloud computer folder inside /vercel/sandbox, or { space: '<folder>' } inside the Space folder.`);
        }
      } else if (!service.cwd || typeof service.cwd !== 'object' || Array.isArray(service.cwd)
        || Object.keys(service.cwd).join(',') !== 'space' || typeof service.cwd.space !== 'string'
        || service.cwd.space.length > 1024 || service.cwd.space.startsWith('/') || service.cwd.space.includes('\0')
        || service.cwd.space.includes('\\') || service.cwd.space.split('/').some(part => part === '..')) {
        throw usageError(`${label} cwd { space } is a folder relative to the Space folder, without a leading / or .. ('' or '.' is the Space folder).`);
      }
    }
    if (service.ready !== undefined && (typeof service.ready !== 'string' || !service.ready.startsWith('/') || service.ready.length > 512)) {
      throw usageError(`${label} ready is a path starting with / of at most 512 characters.`);
    }
  }
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
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw usageError('Export a Space definition object with defineSpace.');
  }
  const unsupported = Object.keys(definition).filter(name => !CONFIG_FIELDS.has(name)).sort();
  if (unsupported.length) {
    const hint = unsupported.includes('settings') ? ' Define URL-visible controls with params.' : '';
    throw usageError(`Unsupported Space definition fields: ${unsupported.join(', ')}.${hint}`);
  }
  if (typeof definition.name !== 'string' || !definition.name.trim() || definition.name.length > 200) {
    throw usageError('Give the Space a name of 1 to 200 characters.');
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
  // Editor-only parts (SPC-074): the whole view here, its columns on each database resource below.
  if (editorsOnlyFlag(definition.editorsOnly, 'This view') && !entry) {
    throw usageError('A container has no page, so it cannot be editors-only. Mark the views inside it.');
  }
  for (const [alias, resource] of Object.entries(resources)) {
    key(alias, 'Resource alias');
    editorOnlyColumns(alias, resource);
    if (resource?.kind === 'database' && resource.create != null) {
      const value = resource.create;
      if (Object.keys(resource).some(name => !['kind', 'create', 'columns'].includes(name))
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
      || Object.keys(resource).some(name => !['kind', 'key', ...(resource.kind === 'database' ? ['columns'] : [])].includes(name))) {
      throw usageError(`Invalid resource reference: ${alias}`);
    }
  }
  if (definition.viewerReads != null && (!Array.isArray(definition.viewerReads)
    || definition.viewerReads.some(family => !VIEWER_READ_FAMILIES.includes(family))
    || new Set(definition.viewerReads).size !== definition.viewerReads.length)) {
    throw usageError("viewerReads lists 'databases' and/or 'skills' once each: the page reads what each signed-in viewer can open.");
  }
  if (definition.viewerReads?.length && !entry) throw usageError('A container has no page, so it cannot declare viewerReads.');
  if (definition.cloudComputer != null) validateCloudComputer(definition.cloudComputer);
  if (definition.cloudComputer != null && !entry) throw usageError('A container has no page, so it cannot use the cloud computer.');
  if (definition.agents != null) validateSpaceAgents(definition.agents, resources);
  if (definition.threadItems != null) validateThreadItems(definition.threadItems, definition.actions || {});
  if (definition.collection && (resources[definition.collection.database]?.kind !== 'database' || !definition.collection.titleProperty)) {
    throw usageError('A collection needs a declared database binding and title property.');
  }
  for (const [actionId, declared] of Object.entries(definition.actions || {})) {
    key(actionId, 'Action');
    editorsOnlyFlag(declared?.editorsOnly, `Action ${actionId}`);
    const template = withoutMarker(declared);
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
  for (const [name, dependency] of Object.entries({ ...projectPackage.dependencies, ...projectPackage.devDependencies })) {
    if (typeof dependency !== 'string' || !dependency.startsWith('file:')) continue;
    const directory = localPath(dependency.slice(5));
    add(`${directory}/package.json`);
    const metadata = JSON.parse(Buffer.from(files[`${directory}/package.json`], 'base64').toString('utf8'));
    // The SDK's `node` targets are its test runtime in dist/: never Space source, never uploaded.
    const declared = (value, condition) => {
      if (name === '@notis/sdk' && condition === 'node') return;
      if (typeof value === 'string' && value.startsWith('./')) add(`${directory}/${value.slice(2)}`);
      else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => declared(item, key));
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

const AGENT_FIELDS = ['id', 'on', 'thread', 'runtime', 'skill', 'wake', 'columns'];
const AGENT_COLUMNS = ['thread', 'scope', 'answer', 'author'];

/** The `agents` a Space's database changes wake (server/lib/space_agents.py repeats every check). */
export function validateSpaceAgents(agents, resources = {}) {
  if (!Array.isArray(agents) || agents.length < 1 || agents.length > 8) throw usageError('Declare agents as a list of 1 to 8 agents.');
  const seen = new Set();
  for (const agent of agents) {
    if (!agent || typeof agent !== 'object' || Array.isArray(agent) || Object.keys(agent).some(name => !AGENT_FIELDS.includes(name))) {
      throw usageError(`Each agent takes ${AGENT_FIELDS.join(', ')} only.`);
    }
    if (typeof agent.id !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(agent.id) || seen.has(agent.id)) {
      throw usageError('Each agent needs its own short id: lowercase letters, digits, - and _.');
    }
    seen.add(agent.id);
    const on = agent.on;
    if (!on || typeof on !== 'object' || Object.keys(on).some(name => !['database', 'event'].includes(name)) || resources[on.database]?.kind !== 'database') {
      throw usageError(`Agent ${agent.id} watches one of this Space's database resources: on: { database: '<alias>' }.`);
    }
    if (on.event != null && !['created', 'changed'].includes(on.event)) throw usageError(`Agent ${agent.id} wakes on 'created' or 'changed'.`);
    if (agent.thread != null && !['best_match', 'space'].includes(agent.thread)) throw usageError(`Agent ${agent.id} uses thread 'best_match' or 'space'.`);
    if (agent.runtime != null && !['notis', 'cloud_computer'].includes(agent.runtime)) throw usageError(`Agent ${agent.id} runs on 'notis' or 'cloud_computer'.`);
    if (agent.wake != null && !['all', 'sent'].includes(agent.wake)) throw usageError(`Agent ${agent.id} wakes for 'all' comments or only those 'sent' to it.`);
    if (agent.skill != null && resources[agent.skill]?.kind !== 'skill') throw usageError(`Agent ${agent.id} names a Skill this Space links.`);
    if (agent.columns != null && (typeof agent.columns !== 'object' || Array.isArray(agent.columns)
      || Object.entries(agent.columns).some(([name, value]) => !AGENT_COLUMNS.includes(name) || typeof value !== 'string' || !value || value.length > 100))) {
      throw usageError(`Agent ${agent.id} renames only the ${AGENT_COLUMNS.join(', ')} columns.`);
    }
  }
}

const THREAD_ITEM_FIELDS = ['label', 'description', 'inputs', 'read', 'title', 'url', 'states', 'checks', 'actions', 'page'];
const THREAD_ITEM_STATE_FIELDS = ['id', 'label', 'icon', 'when', 'needsYou', 'final'];
const THREAD_ITEM_ACTION_FIELDS = ['label', 'tool', 'arguments', 'confirm', 'states', 'primary'];
const REFUSED_ITEM_TOOL = /^(LOCAL_|COMPOSIO_|NOTIS_|CUSTOM_|MCP_)/;

function threadItemLabel(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && typeof value.en === 'string' && value.en.trim().length > 0
    && Object.keys(value).every(name => ['en', 'fr'].includes(name) && typeof value[name] === 'string' && value[name].trim());
}

/**
 * The live item kinds agents attach to threads (`threadItems`). The shape is checked here so a
 * mistake fails before the build; server/lib/space_thread_items.py repeats every check, including
 * placeholders and conditions, when the Space is published.
 */
export function validateThreadItems(threadItems, actions = {}) {
  const kinds = threadItems && typeof threadItems === 'object' && !Array.isArray(threadItems) ? Object.entries(threadItems) : null;
  if (!kinds || kinds.length < 1 || kinds.length > 8) throw usageError('Declare threadItems as 1 to 8 item kinds.');
  for (const [kind, spec] of kinds) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(kind)) throw usageError('Each thread item kind needs a short id: lowercase letters, digits and _.');
    if (!spec || typeof spec !== 'object' || Array.isArray(spec) || Object.keys(spec).some(name => !THREAD_ITEM_FIELDS.includes(name))) {
      throw usageError(`Thread item ${kind} takes ${THREAD_ITEM_FIELDS.join(', ')} only.`);
    }
    if (!threadItemLabel(spec.label)) throw usageError(`Thread item ${kind} needs a label.`);
    if (spec.inputs?.type !== 'object' || spec.inputs?.additionalProperties !== false || !spec.inputs.properties
      || !Array.isArray(spec.inputs.required) || !spec.inputs.required.length) {
      throw usageError(`Thread item ${kind} declares its inputs as a closed object with the fields an agent must give in required.`);
    }
    if (!spec.read || typeof spec.read.action !== 'string' || !Object.hasOwn(actions, spec.read.action)) {
      throw usageError(`Thread item ${kind} reads through one of this Space's actions: read: { action: '<id>' }.`);
    }
    if (typeof spec.title !== 'string' && !threadItemLabel(spec.title)) throw usageError(`Thread item ${kind} needs a title template.`);
    if (!Array.isArray(spec.states) || spec.states.length < 1 || spec.states.length > 12) {
      throw usageError(`Thread item ${kind} lists 1 to 12 states in the order they are checked.`);
    }
    const stateIds = new Set();
    for (const state of spec.states) {
      if (!state || typeof state !== 'object' || Object.keys(state).some(name => !THREAD_ITEM_STATE_FIELDS.includes(name))
        || typeof state.id !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(state.id) || stateIds.has(state.id)) {
        throw usageError(`Each state of thread item ${kind} has its own id and takes ${THREAD_ITEM_STATE_FIELDS.join(', ')} only.`);
      }
      stateIds.add(state.id);
      if (!threadItemLabel(state.label)) throw usageError(`State ${state.id} of thread item ${kind} needs a label.`);
      if (typeof state.icon !== 'string' || !/^phosphor:[a-z0-9]+(-[a-z0-9]+)*$/.test(state.icon)) {
        throw usageError(`State ${state.id} of thread item ${kind} needs a Phosphor icon, written phosphor:<name>.`);
      }
    }
    if (spec.states.at(-1).when != null) throw usageError(`The last state of thread item ${kind} has no condition, so every item has a state.`);
    for (const [actionId, action] of Object.entries(spec.actions || {})) {
      if (!action || typeof action !== 'object' || Object.keys(action).some(name => !THREAD_ITEM_ACTION_FIELDS.includes(name))) {
        throw usageError(`Action ${actionId} of thread item ${kind} takes ${THREAD_ITEM_ACTION_FIELDS.join(', ')} only.`);
      }
      if (!threadItemLabel(action.label)) throw usageError(`Action ${actionId} of thread item ${kind} needs a label.`);
      if (typeof action.tool !== 'string' || !/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(action.tool) || REFUSED_ITEM_TOOL.test(action.tool)) {
        throw usageError(`Action ${actionId} of thread item ${kind} runs one connected app tool, such as GITHUB_MERGE_A_PULL_REQUEST.`);
      }
      if (action.states != null && (!Array.isArray(action.states) || action.states.some(id => !stateIds.has(id)))) {
        throw usageError(`Action ${actionId} of thread item ${kind} lists states this item declares.`);
      }
    }
  }
}
