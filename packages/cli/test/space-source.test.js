import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { collectSelectedSpaceSource, loadSelectedSpace } from '../src/runtime/space-source.js';
import { loadAppConfig, prepareSelectedBuild } from '../src/runtime/app-platform.js';
import { buildSpaceArtifact, prepareSpaceRelease } from '../src/runtime/space-platform.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const VIEW_DECLARATION = `path:'contract',description:'A source contract fixture.',memory:{markdown:false,attachments:false,screenshot:false,snapshots:[]}`;

test('every presentation requires V4 declarations before build, with or without the version marker', async () => {
  const { viewManifestFields } = await import('../src/runtime/space-view-manifest.js');
  const valid = { name: 'Contract', path: 'contract', description: 'The selected fixture.',
    memory: {markdown:false,attachments:false,screenshot:false,snapshots:[]} };
  for (const version of [undefined, 2]) {
    const definition = { ...valid, ...(version === undefined ? {} : {specVersion:version}) };
    const fields = viewManifestFields(definition, {entry:'view.tsx',resources:{}});
    assert.equal(fields.path, 'contract');
    for (const field of ['path', 'description', 'memory']) {
      const missing = {...definition};delete missing[field];
      assert.throws(() => viewManifestFields(missing, {entry:'view.tsx',resources:{}}), new RegExp(`needs ${field}`));
    }
    for (const description of ['', ' ', '\n', 'x'.repeat(301)]) {
      assert.throws(() => viewManifestFields({...definition,description}, {entry:'view.tsx',resources:{}}), /description|Describe/);
    }
  }
  assert.deepEqual(viewManifestFields({name:'Container'}, {entry:null,resources:{}}), {});
  for (const [field,value] of Object.entries({params:{},shows:{},memory:valid.memory,chrome:'portal',markdown:'markdown.ts'})) {
    assert.throws(() => viewManifestFields({name:'Container',[field]:value}, {entry:null,resources:{}}), /container has no page/);
  }
  for (const version of [null, 1, true]) {
    assert.throws(() => viewManifestFields({...valid,specVersion:version}, {entry:'view.tsx',resources:{}}), /specVersion is 2/);
  }
  const root = fixture();
  try {
    writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default {name:'Undeclared',entry:'./view.tsx'};`);
    await assert.rejects(buildSpaceArtifact(root, 'a', {stdio:'pipe',refreshSdk:false}), /needs path, description, memory/);
    assert.equal(existsSync(join(root, '.notis/output/manifest.json')), false, 'No artifact is built from an undeclared view');
  } finally { rmSync(root, {recursive:true,force:true}); }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'notis-space-source-'));
  for (const dir of ['spaces/a', 'spaces/b', 'shared', 'node_modules', 'private']) mkdirSync(join(root, dir), { recursive: true });
  symlinkSync(join(repo, 'packages/sdk/node_modules/typescript'), join(root, 'node_modules/typescript'), 'dir');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'space-source-fixture', type: 'module' }));
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { moduleResolution: 'bundler', module: 'ESNext', jsx: 'react-jsx' } }));
  writeFileSync(join(root, 'notis.config.ts'), `import { defineSpaces } from '@notis/sdk/config';
export default defineSpaces({ spaces: { a: { definition: 'spaces/a/space.config.ts' }, b: { definition: 'spaces/b/space.config.ts', parent: 'a' } } });`);
  writeFileSync(join(root, 'spaces/a/space.config.ts'), `import { defineSpace as space } from '@notis/sdk/config';
export default space({ name: 'A', ${VIEW_DECLARATION}, entry: './view.tsx', layout: '../../shared/layout.tsx' });`);
  writeFileSync(join(root, 'spaces/a/view.tsx'), `import type { Value } from '../../shared/value'; import '../../shared/style.css'; export default function View() { return null; }`);
  writeFileSync(join(root, 'shared/value.ts'), 'export interface Value { text: string }');
  writeFileSync(join(root, 'shared/layout.tsx'), 'export default function Layout() { return null; }');
  writeFileSync(join(root, 'shared/style.css'), 'main { color: red }');
  writeFileSync(join(root, 'spaces/b/space.config.ts'), `throw new Error('Do not load sibling definitions');`);
  writeFileSync(join(root, 'spaces/b/view.tsx'), 'export const privateSibling = "not-shared";');
  writeFileSync(join(root, '.env'), 'PRIVATE_SOURCE=must-not-export');
  return root;
}

test('selected source includes shared/type/style dependencies but no sibling definition or private state', async () => {
  const root = fixture();
  try {
    const selection = await loadSelectedSpace(root, 'a');
    const source = collectSelectedSpaceSource(root, selection);
    for (const file of ['spaces/a/space.config.ts', 'spaces/a/view.tsx', 'shared/layout.tsx', 'shared/value.ts', 'shared/style.css', 'package.json', 'tsconfig.json']) assert.ok(source[file], file);
    for (const file of ['spaces/b/space.config.ts', 'spaces/b/view.tsx', '.env']) assert.equal(source[file], undefined);
    const projected = Buffer.from(source['notis.config.ts'], 'base64').toString('utf8');
    assert.ok(projected.includes('spaces/a/space.config.ts')); assert.ok(!projected.includes('spaces/b'));
    assert.equal(Buffer.from(source['shared/value.ts'], 'base64').toString('utf8'), readFileSync(join(root, 'shared/value.ts'), 'utf8'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('linked Skill files stay on native transport rather than entering the view archive', async () => {
  const root = fixture();
  try {
    mkdirSync(join(root, 'skills/guide'), { recursive: true });
    writeFileSync(join(root, 'skills/guide/SKILL.md'), '# Current native Skill');
    writeFileSync(join(root, 'notis.config.ts'), `export default {spaces:{a:{definition:'spaces/a/space.config.ts'}},resources:{guide:{kind:'skill',source:'skills/guide/SKILL.md'}}};`);
    writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default {name:'A',${VIEW_DECLARATION},entry:'./view.tsx',resources:{guide:{kind:'skill',key:'guide'}}};`);
    const selection = await loadSelectedSpace(root, 'a');
    assert.equal(collectSelectedSpaceSource(root, selection)['skills/guide/SKILL.md'], undefined);
    selection.definition.sourceIncludes = ['../../skills/guide'];
    assert.throws(() => collectSelectedSpaceSource(root, selection), /native Space transport/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('portable navigation keeps target keys but never pulls sibling executable source', async () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default {name:'A',${VIEW_DECLARATION},entry:'./view.tsx',navigation:{history:{key:'b'}}};`);
    const selection = await loadSelectedSpace(root, 'a');
    assert.deepEqual(selection.definition.navigation, { history: { key: 'b' } });
    const source = collectSelectedSpaceSource(root, selection);
    assert.equal(source['spaces/b/space.config.ts'], undefined);
    assert.ok(Buffer.from(source['spaces/a/space.config.ts'], 'base64').toString().includes("key:'b'"));
    for (const target of [{ space_id: 'uuid' }, { key: 'https://example.com' }, { key: 'b', token: 'secret' }]) {
      writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default ${JSON.stringify({ name: 'A', navigation: { history: target } })};`);
      await assert.rejects(loadSelectedSpace(root, 'a'), /portable|source key/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('source-created databases require their main record param and preserve creation structure', async () => {
  const root = fixture();
  try {
    const definition = { name: 'A', specVersion: 2, path: 'contract', description: 'Contract records', entry: './view.tsx',
      resources: { rows: { kind: 'database', create: { name: 'Tasks', schema: { properties: {} }, starterRows: [{ title: 'First' }] } } },
      params: { item: { type: 'record', database: 'rows', description: 'Open one row', main: true } },
      memory: { markdown: false, attachments: false, screenshot: false, snapshots: [] } };
    const save = value => writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default ${JSON.stringify(value)};`);
    save(definition);
    const selection = await loadSelectedSpace(root, 'a');
    assert.deepEqual(selection.definition.resources.rows.create, definition.resources.rows.create);
    assert.ok(collectSelectedSpaceSource(root, selection)['spaces/a/space.config.ts']);
    save({ ...definition, params: {} });
    await assert.rejects(loadSelectedSpace(root, 'a'), /record param marked main/);
    save({ ...definition, resources: { rows: { ...definition.resources.rows, key: 'ambiguous' } } });
    await assert.rejects(loadSelectedSpace(root, 'a'), /without an existing key/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('definitions cannot declare parent traversal, missing aliases or undeclared executable dependencies', async () => {
  const root = fixture();
  try {
    const selection = await loadSelectedSpace(root, 'a');
    writeFileSync(join(root, 'spaces/a/view.tsx'), `const moduleName = './hidden'; export const load = () => import(moduleName);`);
    assert.throws(() => collectSelectedSpaceSource(root, selection), /sourceIncludes/);
    writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default {name:'A', entry:'../../../outside.tsx'};`);
    await assert.rejects(loadSelectedSpace(root, 'a'), /workspace|source path/);
    writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default {name:'A',${VIEW_DECLARATION},entry:'./view.tsx',actions:{query:{tool:'TOOL',inputs:{type:'object',additionalProperties:false},arguments:{db:{$asset:'missing'}}}}};`);
    await assert.rejects(loadSelectedSpace(root, 'a'), /undeclared resource/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('projected workspace index does not export helpers containing sibling composition', async () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'index-only.mjs'), `export const spaces = { a: { definition: 'spaces/a/space.config.ts' }, b: { definition: 'spaces/b/space.config.ts' } };`);
    writeFileSync(join(root, 'notis.config.ts'), `import { spaces } from './index-only.mjs'; export default { spaces };`);
    writeFileSync(join(root, 'vite.config.ts'), `import workspace from './notis.config'; export default { workspace };`);
    const selection = await loadSelectedSpace(root, 'a');
    const source = collectSelectedSpaceSource(root, selection);
    assert.ok(source['vite.config.ts']);
    assert.equal(source['index-only.mjs'], undefined);
    assert.equal(source['spaces/b/space.config.ts'], undefined);
    assert.ok(!Buffer.from(source['notis.config.ts'], 'base64').toString().includes('spaces/b'));
    // Explicitly importing a shared helper still makes it a real dependency.
    writeFileSync(join(root, 'spaces/a/view.tsx'), `import { spaces } from '../../index-only.mjs'; export default () => spaces.a.definition;`);
    assert.ok(collectSelectedSpaceSource(root, selection)['index-only.mjs']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('config helper aliases work without changing matching text or loading the SDK', async () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'plain.mjs'), `import { defineSpace as value } from '@notis/sdk/config'; export default value({name:'defineSpace() remains text'});`);
    assert.deepEqual(await loadAppConfig(root, { file: 'plain.mjs' }), { name: 'defineSpace() remains text' });
    writeFileSync(join(root, 'typed.ts'), `import { defineSpace, type SpaceDefinition } from '@notis/sdk/config';
const value: SpaceDefinition = {name:'Typed'}; export default defineSpace(value satisfies SpaceDefinition);`);
    assert.deepEqual(await loadAppConfig(root, { file: 'typed.ts' }), { name: 'Typed' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('one selected real Vite build freezes only its source and does not go stale when an unshared sibling changes', async () => {
  const root = fixture();
  try {
    mkdirSync(join(root, 'packages/sdk'), { recursive: true });
    cpSync(join(repo, 'packages/sdk/src'), join(root, 'packages/sdk/src'), { recursive: true });
    cpSync(join(repo, 'packages/sdk/package.json'), join(root, 'packages/sdk/package.json'));
    mkdirSync(join(root, 'node_modules/@notis'), { recursive: true });
    symlinkSync(join(root, 'packages/sdk'), join(root, 'node_modules/@notis/sdk'), 'dir');
    for (const name of ['vite', 'react', 'react-dom']) symlinkSync(join(repo, 'packages/sdk/node_modules', name), join(root, 'node_modules', name), 'dir');
    mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
    symlinkSync(join(root, 'node_modules/vite/bin/vite.js'), join(root, 'node_modules/.bin/vite'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'space-build-fixture', type: 'module',
      scripts: { build: 'vite build' }, dependencies: { '@notis/sdk': 'file:./packages/sdk' } }));
    writeFileSync(join(root, 'vite.config.ts'), `import { notisViteConfig } from '@notis/sdk/vite'; import workspace from './notis.config'; export default notisViteConfig(workspace);`);
    const built = await buildSpaceArtifact(root, 'a', { stdio: 'pipe', refreshSdk: false });
    assert.equal(built.manifest.schema, 'notis-space/v1');
    assert.ok(existsSync(built.receiptPath));
    writeFileSync(join(root, 'spaces/b/view.tsx'), 'export const changed = true;');
    const release = await prepareSpaceRelease(root, 'a');
    try {
      assert.ok(release.files['bundle/app.js']);
      assert.equal(Object.keys(release.sourceFiles).some(file => file.startsWith('spaces/b/')), false);
      assert.equal(release.manifest.local_key, 'a');
      assert.equal(existsSync(join(release.projectDir, 'spaces/b/view.tsx')), false);
    } finally { release.close(); }
    // Vite emits no stylesheet for an inline-only presentation. Its immutable
    // manifest/receipt must reflect those actual output bytes.
    writeFileSync(join(root, 'spaces/a/view.tsx'), 'export default function View() { return "CSS-free presentation"; }');
    const cssFree = await buildSpaceArtifact(root, 'a', { stdio: 'pipe', refreshSdk: false });
    assert.equal(cssFree.manifest.bundle.css, undefined);
    const cssFreeRelease = await prepareSpaceRelease(root, 'a');
    try {
      assert.equal(cssFreeRelease.files['bundle/app.css'], undefined);
      assert.equal(cssFreeRelease.manifest.bundle.css, undefined);
      assert.deepEqual(JSON.parse(Buffer.from(cssFreeRelease.files['manifest.json'], 'base64').toString()), cssFreeRelease.manifest);
    } finally { cssFreeRelease.close(); }
    writeFileSync(join(root, 'shared/layout.tsx'), 'export default function Layout() { return "changed shared source"; }');
    await assert.rejects(prepareSpaceRelease(root, 'a'), /stale/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('container builds have source provenance without a JavaScript bundle', async () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default {name:'Container', actions:{read:{tool:'FIXTURE_READ',inputs:{type:'object',properties:{},additionalProperties:false},arguments:{fixed:'value'}}}};`);
    const built = await buildSpaceArtifact(root, 'a', { stdio: 'pipe', refreshSdk: false });
    assert.equal(built.manifest.kind, 'container');
    assert.equal(built.manifest.actions.read.tool, 'FIXTURE_READ');
    const release = await prepareSpaceRelease(root, 'a');
    try { assert.deepEqual(Object.keys(release.files), ['manifest.json']); }
    finally { release.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('deploying a Space whose selected build receipt is missing asks for a build instead of crashing', () => {
  const root = mkdtempSync(join(tmpdir(), 'notis-space-missing-build-'));
  try {
    mkdirSync(join(root, '.notis'));
    assert.throws(() => prepareSelectedBuild(root, 'day', {}), (error) => {
      assert.equal(error.code, 'usage_error');
      assert.match(error.message, /Selected Space build is missing or stale\. Build it again\./);
      return true;
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a relative style import stays in the source when an ambient module declaration matches it', async () => {
  const root = fixture();
  try {
    // Like vite/client: `declare module '*.css'` lets the checker resolve './style.css' to node_modules.
    mkdirSync(join(root, 'node_modules/ambient-styles'), { recursive: true });
    writeFileSync(join(root, 'node_modules/ambient-styles/package.json'), JSON.stringify({ name: 'ambient-styles', types: 'index.d.ts' }));
    writeFileSync(join(root, 'node_modules/ambient-styles/index.d.ts'), "declare module '*.css' { const value: string; export default value; }\n");
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { moduleResolution: 'bundler', module: 'ESNext', jsx: 'react-jsx',
      types: ['ambient-styles'] } }));
    const selection = await loadSelectedSpace(root, 'a');
    const source = collectSelectedSpaceSource(root, selection);
    assert.ok(source['shared/style.css']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('viewerReads is a reviewable page declaration: known families once each, emitted sorted, absent when none', async () => {
  const { generateSpaceManifest } = await import('../src/runtime/space-platform.js');
  const root = fixture();
  try {
    writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default {name:'A',${VIEW_DECLARATION},entry:'./view.tsx',viewerReads:['skills','databases']};`);
    const selection = await loadSelectedSpace(root, 'a');
    assert.deepEqual(generateSpaceManifest(selection).viewer_reads, ['databases', 'skills']);
    writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default {name:'A',${VIEW_DECLARATION},entry:'./view.tsx'};`);
    assert.equal(Object.hasOwn(generateSpaceManifest(await loadSelectedSpace(root, 'a')), 'viewer_reads'), false);
    writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default {name:'A',${VIEW_DECLARATION},entry:'./view.tsx',viewerReads:[]};`);
    assert.equal(Object.hasOwn(generateSpaceManifest(await loadSelectedSpace(root, 'a')), 'viewer_reads'), false);
    for (const value of [`['rows']`, `['databases','databases']`, `'databases'`, `[{family:'skills'}]`]) {
      writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default {name:'A',${VIEW_DECLARATION},entry:'./view.tsx',viewerReads:${value}};`);
      await assert.rejects(loadSelectedSpace(root, 'a'), /viewerReads/);
    }
    writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default {name:'A',viewerReads:['databases']};`);
    await assert.rejects(loadSelectedSpace(root, 'a'), /container/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('cloudComputer is a reviewable page declaration: read or shell, absent when undeclared, never on a container', async () => {
  const { generateSpaceManifest } = await import('../src/runtime/space-platform.js');
  const root = fixture();
  try {
    writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default {name:'A',${VIEW_DECLARATION},entry:'./view.tsx',cloudComputer:'shell'};`);
    assert.equal(generateSpaceManifest(await loadSelectedSpace(root, 'a')).cloud_computer, 'shell');
    writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default {name:'A',${VIEW_DECLARATION},entry:'./view.tsx'};`);
    assert.equal(Object.hasOwn(generateSpaceManifest(await loadSelectedSpace(root, 'a')), 'cloud_computer'), false);
    for (const value of [`'root'`, `true`, `['shell']`]) {
      writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default {name:'A',${VIEW_DECLARATION},entry:'./view.tsx',cloudComputer:${value}};`);
      await assert.rejects(loadSelectedSpace(root, 'a'), /cloudComputer/);
    }
    writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default {name:'A',cloudComputer:'read'};`);
    await assert.rejects(loadSelectedSpace(root, 'a'), /container/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('V4 view manifest: specVersion 2 declares path, described params, shows, memory, chrome and a Markdown module', async () => {
  const { generateSpaceManifest } = await import('../src/runtime/space-platform.js');
  const root = fixture();
  const write = body => writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default {name:'Tasks',entry:'./view.tsx',${body}};`);
  const resources = `resources:{tasks:{kind:'database',key:'tasks'},projects:{kind:'database',key:'projects'}}`;
  const memory = `memory:{markdown:true,attachments:false,screenshot:false,snapshots:['on_render',{scheduled:'0 7 * * 1'}]}`;
  const params = `params:{task:{type:'record',database:'tasks',main:true,description:'The open task.'},status:{type:'enum',values:['inbox','done'],default:'inbox',description:'Only tasks in this status.'}}`;
  const shows = `shows:{tasks:{database:'tasks',where:{field:{property:'Status'},op:'equals',value:'{status}'},open:'task'},drafts:{about:'Drafts kept by the website.',services:['website_db']}}`;
  try {
    writeFileSync(join(root, 'spaces/a/markdown.ts'), `export default function markdown() { return '# Tasks'; }`);
    write(`specVersion:2,path:'tasks',description:'Every task, filtered by status.',${resources},${params},${shows},${memory},chrome:'hidden',markdown:'./markdown.ts'`);
    const selection = await loadSelectedSpace(root, 'a');
    const manifest = generateSpaceManifest(selection);
    assert.equal(manifest.spec_version, 2);
    assert.equal(manifest.path, 'tasks');
    assert.equal(manifest.params.task.main, true);
    assert.deepEqual(manifest.shows.tasks.where, { field: { property: 'Status' }, op: 'equals', value: '{status}' });
    assert.deepEqual(manifest.memory.snapshots, ['on_render', { scheduled: '0 7 * * 1' }]);
    assert.equal(manifest.chrome, 'hidden');
    assert.deepEqual(manifest.markdown, { export_name: 'SpaceMarkdown' });
    assert.equal(selection.markdown, 'spaces/a/markdown.ts');
    assert.ok(collectSelectedSpaceSource(root, selection)['spaces/a/markdown.ts']);
    // Omitting the marker is allowed only with the same mandatory declarations.
    write(`${VIEW_DECLARATION},${resources}`);
    const unversioned = generateSpaceManifest(await loadSelectedSpace(root, 'a'));
    assert.equal(unversioned.schema, 'notis-space/v1');
    assert.equal(Object.hasOwn(unversioned, 'spec_version'), false);
    assert.equal(unversioned.path, 'contract');
    assert.deepEqual(unversioned.memory, {markdown:false,attachments:false,screenshot:false,snapshots:[]});
    write(resources);
    await assert.rejects(loadSelectedSpace(root, 'a'), /needs path, description, memory/);
    const failures = [
      [`specVersion:2,description:'x',${resources},${memory}`, /needs path/],
      [`specVersion:2,path:'tasks',${resources},${memory}`, /needs description/],
      [`specVersion:2,path:'tasks',description:'x',${resources}`, /needs memory/],
      [`${VIEW_DECLARATION},${resources},params:{task:{type:'record',database:'tasks'}}`, /Describe param "task"/],
      [`${VIEW_DECLARATION},${resources},params:{a:{type:'record',database:'tasks',main:true,description:'x'},b:{type:'record',database:'tasks',main:true,description:'y'}}`, /both claim main/],
      [`${VIEW_DECLARATION},${resources},shows:{rows:{database:'unlinked',where:{}}}`, /not a database this Space declares/],
      [`${VIEW_DECLARATION},${resources},shows:{rows:{database:'tasks',where:{field:{property:'Status'},op:'equals',value:'{nope}'}}}`, /names no declared param/],
      [`${VIEW_DECLARATION},${resources},path:'skills-0123456789abcdef0123456789abcdef'`, /without ids/],
      [`${VIEW_DECLARATION},${resources},memory:{markdown:true,attachments:false,screenshot:false,snapshots:[{scheduled:'*/5 * * * *'}]}`, /fixed minute/],
      [`${VIEW_DECLARATION},${resources},chrome:'full'`, /chrome/],
    ];
    for (const [body, pattern] of failures) {
      write(body);
      await assert.rejects(loadSelectedSpace(root, 'a'), pattern, body);
    }
    writeFileSync(join(root, 'spaces/a/space.config.ts'), `export default {name:'A',specVersion:2,path:'a',description:'Root.',memory:{markdown:true,attachments:false,screenshot:false,snapshots:[]}};`);
    await assert.rejects(loadSelectedSpace(root, 'a'), /container has no page/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
