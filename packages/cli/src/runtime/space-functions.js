/**
 * Space `functions`, `threadHooks` and `commentOptions`: server code a Space declares once and Notis
 * calls from every side. The shape is checked here so a mistake fails before the build;
 * server/lib/space_functions.py repeats every check when the Space is published.
 *
 * Handlers are built into one module, `.notis/output/functions/index.js`, exporting each handler
 * under its function name. That file is never part of the page bundle and no route serves it.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { usageError } from './errors.js';

export const FUNCTIONS_BUNDLE = 'functions/index.js';
export const MAX_FUNCTIONS_BUNDLE_BYTES = 1_048_576;
const KINDS = ['read', 'write', 'action'];
const EXPOSURES = ['page', 'api', 'agents'];
const ROLES = ['public', 'viewer', 'editor', 'key'];
const LEVELS = ['read', 'shell'];
export const THREAD_OPERATIONS = Object.freeze(['archive', 'unarchive', 'read', 'unread', 'star', 'unstar', 'later', 'back']);
export const THREAD_HOOK_EVENTS = Object.freeze([...THREAD_OPERATIONS, 'delete', 'idle']);
const FUNCTION_FIELDS = ['description', 'kind', 'input', 'output', 'expose', 'access', 'uses', 'handler'];
const USES_FIELDS = ['actions', 'cloudComputer', 'threads'];
// Field names a hook's or a comment option's function must take: the server compares the whole schema.
const HOOK_INPUT_FIELDS = 'actor,event,items,thread';
const COMMENT_INPUT_FIELDS = 'comment,option';

const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const listed = (value, allowed, { empty = true } = {}) => Array.isArray(value) && (empty || value.length > 0)
  && value.every(item => allowed.includes(item)) && new Set(value).size === value.length;
const inputFields = spec => Object.keys(spec?.input?.properties || {}).sort().join(',');

function label(value) {
  if (typeof value === 'string') return value.trim().length > 0 && value.length <= 200;
  return plain(value) && typeof value.en === 'string' && value.en.trim().length > 0
    && Object.keys(value).every(name => ['en', 'fr'].includes(name) && typeof value[name] === 'string' && value[name].trim());
}

/** Check `functions`, `threadHooks` and `commentOptions` of one Space definition. */
export function validateSpaceFunctions(definition, { entry } = {}) {
  const { functions, threadHooks, commentOptions } = definition;
  if (functions == null && threadHooks == null && commentOptions == null) return;
  if (!entry) throw usageError('A container has no built code, so it declares no functions.');
  if (functions == null) throw usageError('threadHooks and commentOptions name functions: declare functions first.');
  const names = plain(functions) ? Object.entries(functions) : null;
  if (!names || names.length < 1 || names.length > 30) throw usageError('Declare functions as 1 to 30 named functions.');
  const actions = definition.actions || {};
  const cloud = typeof definition.cloudComputer === 'string' ? definition.cloudComputer : definition.cloudComputer?.access;
  const hasItems = plain(definition.threadItems) && Object.keys(definition.threadItems).length > 0;
  for (const [name, spec] of names) {
    if (!/^[a-z][a-z0-9_]{0,59}$/.test(name)) throw usageError('Each function needs a short name: lowercase letters, digits and _.');
    if (!plain(spec) || Object.keys(spec).some(field => !FUNCTION_FIELDS.includes(field))) {
      throw usageError(`Function ${name} takes ${FUNCTION_FIELDS.join(', ')} only.`);
    }
    if (typeof spec.description !== 'string' || !spec.description.trim() || spec.description.length > 1000) {
      throw usageError(`Function ${name} needs a description: agents read it to decide when to call it.`);
    }
    if (!KINDS.includes(spec.kind)) {
      throw usageError(`Function ${name} needs kind: 'read' (changes nothing), 'write' (changes this Space's data) or 'action' (reaches a connected app, a machine or a thread).`);
    }
    if (spec.input?.type !== 'object' || spec.input?.additionalProperties !== false) {
      throw usageError(`Function ${name} declares input as a closed object schema: type object, additionalProperties false.`);
    }
    if (spec.output !== undefined && !plain(spec.output)) throw usageError(`Function ${name} declares output as a JSON schema.`);
    if (spec.expose !== undefined && !listed(spec.expose, EXPOSURES)) {
      throw usageError(`Function ${name} lists expose from 'page', 'api' and 'agents', once each.`);
    }
    if (spec.access !== undefined && !listed(spec.access, ROLES, { empty: false })) {
      throw usageError(`Function ${name} lists access from 'public', 'viewer', 'editor' and 'key', once each.`);
    }
    const uses = spec.uses ?? {};
    if (!plain(uses) || Object.keys(uses).some(field => !USES_FIELDS.includes(field))) {
      throw usageError(`Function ${name} declares uses as actions, cloudComputer and threads only.`);
    }
    const used = uses.actions ?? [];
    if (!Array.isArray(used) || used.length > 20 || new Set(used).size !== used.length) {
      throw usageError(`Function ${name} lists up to 20 of this Space's actions in uses.actions, once each.`);
    }
    const unknown = used.filter(action => typeof action !== 'string' || !Object.hasOwn(actions, action)).map(String).sort();
    if (unknown.length) throw usageError(`Function ${name} uses actions this Space does not declare: ${unknown.join(', ')}.`);
    const level = uses.cloudComputer;
    if (level != null) {
      if (!LEVELS.includes(level)) throw usageError(`Function ${name} uses the cloud computer at 'read' or 'shell'.`);
      if (!LEVELS.includes(cloud) || LEVELS.indexOf(level) > LEVELS.indexOf(cloud)) {
        throw usageError(`Function ${name} uses the cloud computer at ${level}: declare cloudComputer at that level on this Space first.`);
      }
    }
    if (uses.threads != null) {
      if (!listed(uses.threads, THREAD_OPERATIONS, { empty: false })) {
        throw usageError(`Function ${name} lists uses.threads from ${THREAD_OPERATIONS.join(', ')}, once each.`);
      }
      if (!hasItems) {
        throw usageError(`Function ${name} acts on threads: a Space reaches only the threads its own items are attached to, so declare threadItems first.`);
      }
    }
    if (spec.kind === 'read' && (uses.threads || level === 'shell')) {
      throw usageError(`Function ${name} is a read: it cannot run thread actions or shell commands. Use kind 'action'.`);
    }
    if (spec.kind === 'write' && (uses.threads || level === 'shell')) {
      throw usageError(`Function ${name} reaches beyond this Space's data: use kind 'action'.`);
    }
    if (typeof spec.handler !== 'string' || !/\.[cm]?[jt]s$/.test(spec.handler)) {
      throw usageError(`Function ${name} needs handler: the source module whose default export is its code, such as './functions/${name.replaceAll('_', '-')}.ts'.`);
    }
  }
  if (threadHooks != null) {
    if (!plain(threadHooks) || !Object.keys(threadHooks).length || Object.keys(threadHooks).some(event => !THREAD_HOOK_EVENTS.includes(event))) {
      throw usageError(`Declare threadHooks as { <action>: '<function>' } for ${THREAD_HOOK_EVENTS.join(', ')}.`);
    }
    if (!hasItems) throw usageError("threadHooks follow the threads this Space's items are attached to: declare threadItems first.");
    for (const [event, name] of Object.entries(threadHooks)) {
      if (typeof name !== 'string' || !Object.hasOwn(functions, name)) throw usageError(`Thread hook ${event} names a function this Space does not declare.`);
      const idle = event === 'idle';
      if (inputFields(functions[name]) !== (idle ? 'actor,event,items,run_id,thread' : HOOK_INPUT_FIELDS)) {
        const schema = idle ? 'threadIdleInput' : 'threadHookInput';
        throw usageError(`Function ${name} runs as a thread hook: declare its input as ${schema} from @notis/sdk.`);
      }
    }
  }
  if (commentOptions != null) {
    const options = plain(commentOptions) ? Object.entries(commentOptions) : null;
    if (!options || options.length < 1 || options.length > 12) throw usageError('Declare commentOptions as 1 to 12 options.');
    const labels = new Set();
    for (const [option, spec] of options) {
      if (!/^[a-z][a-z0-9_-]{0,39}$/.test(option)) throw usageError('Each comment option needs a short id.');
      if (!plain(spec) || Object.keys(spec).sort().join(',') !== 'function,label' || !label(spec.label)) {
        throw usageError(`Comment option ${option} is { label, function }; the label is text or { en, fr }.`);
      }
      if (typeof spec.function !== 'string' || !Object.hasOwn(functions, spec.function)) {
        throw usageError(`Comment option ${option} names a function this Space does not declare.`);
      }
      if (inputFields(functions[spec.function]) !== COMMENT_INPUT_FIELDS) {
        throw usageError(`Function ${spec.function} runs for a comment option: declare its input as commentOptionInput from @notis/sdk.`);
      }
      for (const text of typeof spec.label === 'string' ? [spec.label] : Object.values(spec.label)) {
        if (labels.has(text.trim())) throw usageError(`Comment option ${option} repeats another option's label: an answer must name one option.`);
        labels.add(text.trim());
      }
    }
  }
}

/** The manifest's `functions`: each declaration without its source `handler` path. */
export function manifestFunctions(functions) {
  return Object.fromEntries(Object.entries(functions || {}).map(([name, { handler: _handler, ...declared }]) => [name, declared]));
}

/** Manifest keys for the three declarations; each absent when undeclared, so other manifests stay byte-identical. */
export function functionManifestFields(definition) {
  const declared = plain(definition.functions) && Object.keys(definition.functions).length > 0;
  return {
    ...(declared ? { functions: manifestFunctions(definition.functions) } : {}),
    ...(plain(definition.threadHooks) && Object.keys(definition.threadHooks).length ? { thread_hooks: definition.threadHooks } : {}),
    ...(plain(definition.commentOptions) && Object.keys(definition.commentOptions).length ? { comment_options: definition.commentOptions } : {}),
  };
}

/** { function name: workspace-relative handler path } for a loaded selection. */
export function functionHandlerPaths(definition, resolveDefinitionPath) {
  return Object.fromEntries(Object.entries(definition.functions || {}).map(([name, spec]) => [name, resolveDefinitionPath(spec.handler)]));
}

/**
 * Build every handler of the selected Space into `.notis/output/functions/index.js`. Without functions
 * the folder is removed, so a build after the last function was deleted ships none.
 */
export async function buildSpaceFunctions(projectDir, handlers) {
  const outputDir = join(projectDir, '.notis/output/functions');
  rmSync(outputDir, { recursive: true, force: true });
  const names = Object.keys(handlers || {}).sort();
  if (!names.length) return null;
  const entryPath = join(projectDir, '.notis/_functions.ts');
  mkdirSync(dirname(entryPath), { recursive: true });
  const reference = path => JSON.stringify('./' + relative(dirname(entryPath), join(projectDir, path)).replaceAll('\\', '/'));
  // A TypeScript module without a default export still bundles (the name could have been a type), so the
  // source is checked here and the built module refuses to load without it.
  const missing = names.filter(name => !/\bexport\s+default\b|\bas\s+default\b/.test(readFileSync(join(projectDir, handlers[name]), 'utf8')));
  if (missing.length) {
    throw usageError(`This Space's functions did not build:\n${missing.map(name => `  - ${handlers[name]}: export the handler of ${name} as the module's default export.`).join('\n')}`);
  }
  writeFileSync(entryPath, [
    ...names.map((name, index) => `import * as module${index} from ${reference(handlers[name])};`),
    'const handler = (name: string, module: { default?: unknown }) => {',
    "  if (typeof module.default !== 'function') throw new Error(`Function ${name} needs a default export that is its handler.`);",
    '  return module.default;',
    '};',
    // Exported by alias, so a function may carry any valid name (delete, new, import).
    ...names.map((name, index) => `const handler${index} = handler(${JSON.stringify(name)}, module${index});`),
    `export { ${names.map((name, index) => `handler${index} as ${name}`).join(', ')} };`,
  ].join('\n') + '\n');
  const { build } = await import('esbuild');
  const outfile = join(projectDir, '.notis/output', FUNCTIONS_BUNDLE);
  let result;
  try {
    result = await build({
      absWorkingDir: projectDir, entryPoints: [entryPath], outfile, bundle: true, format: 'esm', platform: 'neutral',
      target: 'es2022', mainFields: ['module', 'main'], conditions: ['worker', 'import'], minify: false, sourcemap: false,
      legalComments: 'none', logLevel: 'silent', metafile: true, treeShaking: true, charset: 'utf8',
      plugins: [{ name: 'notis-functions', setup(builder) {
        // The SDK is the page's code (React, the host bridge). A handler takes its types only, which are erased.
        builder.onResolve({ filter: /^@notis\/sdk(\/|$)/ }, () => ({ errors: [{ text:
          'A function handler imports types only from @notis/sdk (import type { SpaceFunctionHandler }). Its code runs on the server, without the page SDK.' }] }));
        builder.onResolve({ filter: /^(node:|cloudflare:)/ }, args => ({ errors: [{ text:
          `A function handler cannot import ${args.path}: it has no file system, no network and no process.` }] }));
      } }],
    });
  } catch (error) {
    const lines = (error?.errors || []).map(item => `  - ${item.location?.file ? `${item.location.file}: ` : ''}${item.text}`);
    throw usageError(`This Space's functions did not build:\n${lines.join('\n') || `  - ${error?.message || error}`}`);
  }
  const size = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
  if (size > MAX_FUNCTIONS_BUNDLE_BYTES) throw usageError('The built functions of this Space are over 1 MB. Move large data into a database.');
  return { path: FUNCTIONS_BUNDLE, bytes: size };
}
