import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSpaceFunctions, functionManifestFields, validateSpaceFunctions } from '../src/runtime/space-functions.js';
import { loadAppConfig } from '../src/runtime/app-platform.js';
import { validateThreadItems } from '../src/runtime/space-source.js';

const closed = properties => ({ type: 'object', additionalProperties: false, properties });
const hookInput = closed({ event: {}, actor: {}, thread: {}, items: {} });
const optionInput = closed({ option: {}, comment: {} });
const definition = (changes = {}) => ({
  actions: { read_pull_request: {} },
  cloudComputer: 'shell',
  threadItems: { pull_request: {} },
  functions: {
    settle_thread: { description: 'Archive the thread once its pull requests are closed.', kind: 'action',
      input: closed({ thread: { type: 'string' } }), expose: ['agents'], access: ['editor'],
      uses: { actions: ['read_pull_request'], threads: ['archive'], cloudComputer: 'shell' }, handler: './functions/settle.ts' },
    clean_workspace: { description: 'Run the archive command.', kind: 'action', input: hookInput,
      uses: { cloudComputer: 'shell' }, handler: './functions/clean.ts' },
    approve_change: { description: 'Approve a change.', kind: 'write', input: optionInput, handler: './functions/approve.ts' },
  },
  threadHooks: { archive: 'clean_workspace' },
  commentOptions: { approve: { label: { en: 'Approve', fr: 'Approuver' }, function: 'approve_change' } },
  ...changes,
});
const withFunction = change => { const value = definition(); value.functions.settle_thread = { ...value.functions.settle_thread, ...change }; return value; };
const check = value => validateSpaceFunctions(value, { entry: 'src/View.tsx' });

test('a declared function set passes and the manifest drops handler paths', () => {
  const value = definition();
  check(value);
  const fields = functionManifestFields(value);
  assert.deepEqual(Object.keys(fields), ['functions', 'thread_hooks', 'comment_options']);
  assert.equal('handler' in fields.functions.settle_thread, false);
  assert.deepEqual(fields.functions.settle_thread.uses, value.functions.settle_thread.uses);
  assert.deepEqual(functionManifestFields({}), {});
});

test('a function outside the contract is refused before the build', () => {
  for (const [change, words] of [
    [{ kind: 'query' }, /kind/], [{ description: '' }, /description/], [{ input: { type: 'object' } }, /closed object/],
    [{ expose: ['web'] }, /expose/], [{ access: [] }, /access/], [{ uses: { network: true } }, /uses/],
    [{ uses: { actions: ['send_mail'] } }, /send_mail/], [{ uses: { threads: ['delete'] } }, /uses\.threads/],
    [{ handler: undefined }, /handler/], [{ secret: 'x' }, /only/],
  ]) assert.throws(() => check(withFunction(change)), words);
  assert.throws(() => check(definition({ cloudComputer: 'read' })), /cloud computer at shell/);
  assert.throws(() => check(definition({ threadItems: undefined })), /threadItems/);
  assert.throws(() => validateSpaceFunctions(definition(), { entry: null }), /container/);
  assert.throws(() => check({ threadHooks: { archive: 'x' } }), /declare functions first/);
});

test('a Space config takes threadHookInput, threadSettleInput and commentOptionInput from @notis/sdk/config', async () => {
  const project = mkdtempSync(join(tmpdir(), 'notis-functions-config-'));
  try {
    // The project's own SDK package, as a scaffold installs it: its built entry holds the schema values.
    const sdk = join(project, 'node_modules/@notis/sdk');
    mkdirSync(sdk, { recursive: true });
    writeFileSync(join(sdk, 'package.json'), JSON.stringify({ name: '@notis/sdk', type: 'module',
      exports: { '.': { node: './index.js' }, './config': './config.ts' } }));
    writeFileSync(join(sdk, 'index.js'), "export const threadHookInput = { type: 'object', hook: true };\n"
      + "export const threadSettleInput = { type: 'object', settle: true };\n"
      + "export const commentOptionInput = { type: 'object', option: true };\n");
    writeFileSync(join(project, 'notis.config.ts'), [
      "import { defineSpace, threadHookInput, threadSettleInput, commentOptionInput as optionInput } from '@notis/sdk/config';",
      'export default defineSpace({ hook: threadHookInput, settle: threadSettleInput, option: optionInput });', ''].join('\n'));
    assert.deepEqual(await loadAppConfig(project),
      { hook: { type: 'object', hook: true }, settle: { type: 'object', settle: true }, option: { type: 'object', option: true } });
    writeFileSync(join(project, 'notis.config.ts'), "import { definePage } from '@notis/sdk/config';\nexport default definePage({});\n");
    await assert.rejects(loadAppConfig(project), /Unsupported configuration helper: definePage/);
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test('kind bounds what a function uses', () => {
  assert.throws(() => check(withFunction({ kind: 'read' })), /is a read/);
  assert.throws(() => check(withFunction({ kind: 'write' })), /kind 'action'/);
});

test('hooks and comment options name functions with their own input', () => {
  assert.throws(() => check(definition({ threadHooks: { rename: 'clean_workspace' } })), /threadHooks/);
  assert.throws(() => check(definition({ threadHooks: { archive: 'missing' } })), /does not declare/);
  assert.throws(() => check(definition({ threadHooks: { archive: 'settle_thread' } })), /threadHookInput/);
  assert.throws(() => check(definition({ commentOptions: { approve: { label: 'Approve', function: 'settle_thread' } } })), /commentOptionInput/);
  assert.throws(() => check(definition({ commentOptions: { approve: { label: 'Approve', function: 'approve_change' },
    accept: { label: 'Approve', function: 'approve_change' } } })), /repeats/);
});

test('a thread item action runs a tool or a function', () => {
  const kind = actions => ({ pull_request: { label: 'Pull request',
    inputs: { type: 'object', additionalProperties: false, properties: { number: { type: 'integer' } }, required: ['number'] },
    read: { action: 'read_pull_request' }, title: '#{item.number}',
    states: [{ id: 'open', label: 'Open', icon: 'phosphor:git-pull-request' }], actions } });
  const functions = { settle_thread: {} };
  validateThreadItems(kind({ settle: { label: 'Settle', function: 'settle_thread' } }), { read_pull_request: {} }, functions);
  assert.throws(() => validateThreadItems(kind({ settle: { label: 'Settle', function: 'missing' } }), { read_pull_request: {} }, functions), /does not declare/);
  assert.throws(() => validateThreadItems(kind({ settle: { label: 'Settle', function: 'settle_thread', tool: 'GITHUB_MERGE_A_PULL_REQUEST' } }),
    { read_pull_request: {} }, functions), /not both/);
  assert.throws(() => validateThreadItems(kind({ settle: { label: 'Settle' } }), { read_pull_request: {} }, functions), /not both/);
});

test('handlers build into one module that exports each function by name', async () => {
  const project = mkdtempSync(join(tmpdir(), 'notis-functions-'));
  try {
    mkdirSync(join(project, 'functions'));
    writeFileSync(join(project, 'functions/shared.ts'), 'export const double = (value: number): number => value * 2;\n');
    writeFileSync(join(project, 'functions/count.ts'), [
      "import type { SpaceFunctionHandler } from '@notis/sdk';",
      "import { double } from './shared';",
      'const handler: SpaceFunctionHandler<{ n: number }, { n: number }> = async (input, ctx) => {',
      '  const seen = await ctx.actions.read_pull_request({ number: input.n }) as { n: number };',
      '  return { n: double(seen.n) };',
      '};',
      'export default handler;', ''].join('\n'));
    const built = await buildSpaceFunctions(project, { count_open: 'functions/count.ts' });
    assert.equal(built.path, 'functions/index.js');
    const file = join(project, '.notis/output/functions/index.js');
    assert.doesNotMatch(readFileSync(file, 'utf8'), /@notis\/sdk/);
    const module = await import(pathToFileURL(file).href);
    assert.deepEqual(await module.count_open({ n: 2 }, { actions: { read_pull_request: async input => ({ n: input.number + 1 }) } }), { n: 6 });
    // A valid name that is a JavaScript word (delete, new) still builds: handlers are exported by alias.
    await buildSpaceFunctions(project, { delete: 'functions/count.ts', count_open: 'functions/count.ts' });
    const words = await import(pathToFileURL(file).href + '?words');
    assert.equal(typeof words.delete, 'function');
    // No function left: the folder goes, so the next release ships none.
    assert.equal(await buildSpaceFunctions(project, {}), null);
    assert.equal(existsSync(join(project, '.notis/output/functions')), false);
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test('a handler cannot bring in the page SDK, node or a missing default export', async () => {
  const project = mkdtempSync(join(tmpdir(), 'notis-functions-'));
  try {
    mkdirSync(join(project, 'functions'));
    writeFileSync(join(project, 'functions/sdk.ts'), "import { useAction } from '@notis/sdk';\nexport default async () => useAction;\n");
    writeFileSync(join(project, 'functions/node.ts'), "import { readFileSync } from 'node:fs';\nexport default async () => readFileSync;\n");
    writeFileSync(join(project, 'functions/none.ts'), 'export const handler = async () => 1;\n');
    await assert.rejects(buildSpaceFunctions(project, { a: 'functions/sdk.ts' }), /types only from @notis\/sdk/);
    await assert.rejects(buildSpaceFunctions(project, { a: 'functions/node.ts' }), /cannot import node:fs/);
    await assert.rejects(buildSpaceFunctions(project, { a: 'functions/none.ts' }), /did not build|no default export/);
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test('a thread item kind settles with a function that takes threadSettleInput', () => {
  const settleInput = closed({ item: {}, thread: {} });
  const kind = (changes = {}) => ({ pull_request: { label: 'Pull request',
    inputs: { type: 'object', additionalProperties: false, properties: { number: { type: 'integer' } }, required: ['number'] },
    read: { action: 'read_pull_request' }, title: '#{item.number}',
    states: [{ id: 'merged', label: 'Merged', icon: 'phosphor:git-merge', when: { path: 'data.merged', equals: true }, final: true },
      { id: 'open', label: 'Open', icon: 'phosphor:git-pull-request' }],
    settle: { function: 'settle_workspace' }, ...changes } });
  const functions = { settle_workspace: { input: settleInput }, clean_workspace: { input: hookInput } };
  const actions = { read_pull_request: {} };
  validateThreadItems(kind(), actions, functions);
  assert.throws(() => validateThreadItems(kind({ settle: { function: 'missing' } }), actions, functions), /does not declare/);
  assert.throws(() => validateThreadItems(kind({ settle: { function: 'clean_workspace' } }), actions, functions), /threadSettleInput/);
  assert.throws(() => validateThreadItems(kind({ settle: 'settle_workspace' }), actions, functions), /settle: \{ function: '<name>' \}/);
  assert.throws(() => validateThreadItems(kind({ settle: { function: 'settle_workspace', when: 'merged' } }), actions, functions),
    /settle: \{ function: '<name>' \}/);
  assert.throws(() => validateThreadItems(kind({ states: [{ id: 'open', label: 'Open', icon: 'phosphor:git-pull-request' }] }),
    actions, functions), /final state/);
});
