/** Refresh only pulled database creation declarations; never execute authored code. */
import { parse } from '@babel/parser';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { usageError } from './errors.js';

const nameOf = node => node?.type === 'Identifier' ? node.name : node?.type === 'StringLiteral' ? node.value : null;

export function refreshDatabaseStructures(projectDir, localKey, structures) {
  return refreshSpaceAuthoring(projectDir, localKey, { databaseStructures: structures });
}

/** Exact current-host overrides for copied source. Archives remain byte-preserved. */
export function refreshSpaceAuthoring(projectDir, localKey, { databaseStructures, authoringOverrides } = {}) {
  let rewritten = new Map();
  if (Object.keys(databaseStructures || {}).length) rewritten = planSpaceAuthoring(projectDir, localKey, { databaseStructures }, rewritten);
  if (authoringOverrides) rewritten = planSpaceAuthoring(projectDir, localKey, { authoringOverrides }, rewritten);
  // Both stages must succeed before mutating even one downloaded file.
  for (const [file, source] of rewritten) writeFileSync(file, source);
  return [...rewritten.keys()].map(file => relative(realpathSync(projectDir), file).split(sep).join('/'));
}

function planSpaceAuthoring(projectDir, localKey, { databaseStructures: structures, authoringOverrides: overrides }, staged) {
  const root = realpathSync(projectDir), modules = new Map();
  const fail = () => usageError('The pulled database declaration is not statically addressable. Keep resources and create declarations as objects, local constants or relative imports; the downloaded source has not been rewritten.');
  function load(file) {
    file = realpathSync(file);
    if (!file.startsWith(root + sep) || file.includes(`${sep}node_modules${sep}`)) throw fail();
    if (modules.has(file)) return modules.get(file);
    const source = staged.get(file) ?? readFileSync(file, 'utf8');
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    const unit = { file, source, ast, bindings: new Map(), exports: new Map() };
    modules.set(file, unit);
    for (const statement of ast.program.body) {
      const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
      if (declaration?.type === 'VariableDeclaration') {
        for (const item of declaration.declarations) if (item.id.type === 'Identifier' && item.init) {
          unit.bindings.set(item.id.name, { node: item.init, unit });
          if (statement.type === 'ExportNamedDeclaration') unit.exports.set(item.id.name, { node: item.init, unit });
        }
      }
      if (statement.type === 'ImportDeclaration') {
        for (const item of statement.specifiers) unit.bindings.set(item.local.name, {
          imported: item.type === 'ImportDefaultSpecifier' ? 'default' : item.type === 'ImportNamespaceSpecifier' ? '*' : nameOf(item.imported),
          from: statement.source.value, unit,
        });
      }
      if (statement.type === 'ExportDefaultDeclaration') unit.exports.set('default', { node: statement.declaration, unit });
      if (statement.type === 'ExportNamedDeclaration') for (const item of statement.specifiers || []) {
        unit.exports.set(nameOf(item.exported), statement.source
          ? { imported: nameOf(item.local), from: statement.source.value, unit }
          : { node: item.local, unit });
      }
    }
    return unit;
  }
  function imported(reference) {
    if (!reference.from?.startsWith('.')) throw fail();
    const base = resolve(dirname(reference.unit.file), reference.from);
    const file = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.js'].map(suffix => base + suffix).find(existsSync);
    if (!file) throw fail();
    return load(file);
  }
  function unwrap(reference, depth = 0) {
    if (!reference || depth > 50) throw fail();
    if (reference.from) {
      if (reference.imported === '*') return { namespace: imported(reference) };
      return unwrap(imported(reference).exports.get(reference.imported), depth + 1);
    }
    const { node, unit } = reference;
    if (node.type === 'Identifier') return unwrap(unit.bindings.get(node.name), depth + 1);
    if (['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression', 'TSTypeAssertion'].includes(node.type)) {
      return unwrap({ node: node.expression, unit }, depth + 1);
    }
    if (node.type === 'CallExpression' && node.arguments.length === 1 && node.callee.type === 'Identifier') {
      const helper = unit.bindings.get(node.callee.name);
      if (helper?.from === '@notis/sdk/config' && ['defineSpace', 'defineSpaces'].includes(helper.imported)) {
        return unwrap({ node: node.arguments[0], unit }, depth + 1);
      }
    }
    if (node.type === 'MemberExpression' && (!node.computed || node.property.type === 'StringLiteral')) {
      const object = unwrap({ node: node.object, unit }, depth + 1);
      return object.namespace ? unwrap(object.namespace.exports.get(nameOf(node.property)), depth + 1)
        : unwrap(property(object, nameOf(node.property), depth + 1), depth + 1);
    }
    return reference;
  }
  function property(reference, name, depth = 0) {
    const object = unwrap(reference, depth + 1);
    if (object.node?.type !== 'ObjectExpression') throw fail();
    // Later properties/spreads win, exactly as the authored object does.
    for (const entry of [...object.node.properties].reverse()) {
      if (entry.type === 'SpreadElement') {
        const found = property({ node: entry.argument, unit: object.unit }, name, depth + 1);
        if (found) return found;
      } else if (entry.type === 'ObjectProperty' && !entry.computed && nameOf(entry.key) === name) {
        return { node: entry.value, unit: object.unit };
      }
    }
    return null;
  }
  function scalar(reference) {
    const value = unwrap(reference);
    if (value.node?.type !== 'StringLiteral') throw fail();
    return value.node.value;
  }
  const indexFile = ['notis.config.ts', 'notis.config.js', 'notis.config.mjs'].map(file => join(root, file)).find(existsSync);
  if (!indexFile) throw fail();
  const index = load(indexFile);
  const workspace = index.exports.get('default');
  const definition = scalar(property(property(property(workspace, 'spaces'), localKey), 'definition'));
  const unit = load(resolve(root, definition));
  const resources = property(unit.exports.get('default'), 'resources');
  const edits = new Map();
  for (const [alias, structure] of Object.entries(structures || {})) {
    if (!structure || typeof structure.name !== 'string' || !structure.schema || typeof structure.schema !== 'object' || Array.isArray(structure.schema)) throw usageError('The server returned an incomplete live database structure.');
    const resource = property(resources, alias);
    if (scalar(property(resource, 'kind')) !== 'database') throw fail();
    const create = property(resource, 'create');
    if (!create || !Number.isInteger(create.node.start) || !Number.isInteger(create.node.end)) throw fail();
    const list = edits.get(create.unit.file) || [];
    // Inline declarations are edited in place. Constants retain their shared
    // helper and get one explicit local override, not another wrapper per pull.
    let node = create.node;
    while (['TSAsExpression', 'TSSatisfiesExpression', 'ParenthesizedExpression'].includes(node.type)) node = node.expression;
    if (node.type === 'ObjectExpression') {
      const additions = [];
      for (const [name, value] of [['name', structure.name], ['schema', structure.schema]]) {
        const field = [...node.properties].reverse().find(item => item.type === 'ObjectProperty' && !item.computed && nameOf(item.key) === name);
        const replacement = JSON.stringify(value, null, 2);
        if (field && !field.shorthand) list.push({ start: field.value.start, end: field.value.end, replacement });
        else if (field) list.push({ start: field.start, end: field.end, replacement: `${name}: ${replacement}` });
        else additions.push(`${name}: ${replacement}`);
      }
      if (additions.length) list.push({ start: node.end - 1, end: node.end - 1,
        replacement: `${node.properties.length && !create.unit.source.slice(node.properties.at(-1).end, node.end - 1).includes(',') ? ',' : ''} ${additions.join(', ')} ` });
    } else {
      const original = create.unit.source.slice(create.node.start, create.node.end);
      list.push({ start: create.node.start, end: create.node.end,
        replacement: `({ ...(${original}), name: ${JSON.stringify(structure.name)}, schema: ${JSON.stringify(structure.schema, null, 2)} })` });
    }
    edits.set(create.unit.file, list);
  }
  if (overrides) {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)
      || Object.keys(overrides).some(key => !['record_params', 'resource_keys'].includes(key))) throw fail();
    const recordParams = overrides.record_params || {}, resourceKeys = overrides.resource_keys || {};
    if ([recordParams, resourceKeys].some(value => !value || typeof value !== 'object' || Array.isArray(value))) throw fail();
    // Pin authoring to this selected definition. Shared imports/constants are
    // overridden at their local use site, never rewritten for sibling Spaces.
    const rootDefinition = unwrap(unit.exports.get('default'));
    if (rootDefinition.unit !== unit || rootDefinition.node.type !== 'ObjectExpression') throw fail();
    const rawField = name => {
      const field = [...rootDefinition.node.properties].reverse().find(item => item.type === 'ObjectProperty'
        && !item.computed && nameOf(item.key) === name);
      if (!field || field.shorthand) throw fail();
      return { node: field.value, unit };
    };
    const text = reference => reference.unit.source.slice(reference.node.start, reference.node.end);
    const patchObject = (reference, fields) => {
      let node = reference.node;
      while (['TSAsExpression', 'TSSatisfiesExpression', 'ParenthesizedExpression'].includes(node.type)) node = node.expression;
      if (node.type !== 'ObjectExpression') {
        return `({ ...(${text(reference)}), ${Object.entries(fields).map(([key, value]) => `${JSON.stringify(key)}: ${value}`).join(', ')} })`;
      }
      let source = text(reference), changes = [], additions = [];
      for (const [key, replacement] of Object.entries(fields)) {
        const field = [...node.properties].reverse().find(item => item.type === 'ObjectProperty' && !item.computed && nameOf(item.key) === key);
        if (field) changes.push({ start: (field.shorthand ? field.start : field.value.start) - reference.node.start,
          end: (field.shorthand ? field.end : field.value.end) - reference.node.start,
          replacement: field.shorthand ? `${JSON.stringify(key)}: ${replacement}` : replacement });
        else additions.push(`${JSON.stringify(key)}: ${replacement}`);
      }
      if (additions.length) changes.push({ start: node.end - 1 - reference.node.start, end: node.end - 1 - reference.node.start,
        replacement: `${node.properties.length && !reference.unit.source.slice(node.properties.at(-1).end, node.end - 1).includes(',') ? ',' : ''} ${additions.join(', ')} ` });
      for (const change of changes.sort((a, b) => b.start - a.start)) source = source.slice(0, change.start) + change.replacement + source.slice(change.end);
      return source;
    };
    const queue = (reference, replacement) => {
      const list = edits.get(reference.unit.file) || [];
      list.push({ start: reference.node.start, end: reference.node.end, replacement }); edits.set(reference.unit.file, list);
    };
    for (const [fieldName, requests] of [['params', recordParams], ['resources', resourceKeys]]) {
      if (!Object.keys(requests).length) continue;
      const reference = rawField(fieldName), object = unwrap(reference), replacements = {};
      for (const [name, expected] of Object.entries(requests)) {
        if (!expected || typeof expected !== 'object' || Array.isArray(expected)) throw fail();
        const current = property(reference, name);
        if (!current) throw fail();
        const source = object.node.type === 'ObjectExpression' && object.unit === unit && current.unit === unit ? text(current)
          : `(${text(reference)})[${JSON.stringify(name)}]`;
        if (fieldName === 'params') {
          if (Object.keys(expected).some(key => !['database', 'main'].includes(key)) || typeof expected.main !== 'boolean'
            || scalar(property(current, 'type')) !== 'record' || scalar(property(current, 'database')) !== expected.database) throw fail();
          replacements[name] = current.unit === unit && object.node.type === 'ObjectExpression'
            ? patchObject(current, { main: JSON.stringify(expected.main) }) : `({ ...(${source}), main: ${JSON.stringify(expected.main)} })`;
        } else {
          if (Object.keys(expected).some(key => !['kind', 'key'].includes(key)) || typeof expected.key !== 'string' || !expected.key
            || scalar(property(current, 'kind')) !== expected.kind) throw fail();
          const create = property(current, 'create'), key = property(current, 'key');
          if (create) {
            // Copied source archives retain their original create declaration.
            // A reused database (or one whose main moved) is now an existing
            // binding: replace only this definition's resource, never a shared
            // imported creation or a sibling view's source.
            if (expected.kind !== 'database' || key) throw fail();
            replacements[name] = JSON.stringify(expected);
          } else {
            if (!key) throw fail();
            replacements[name] = current.unit === unit && object.node.type === 'ObjectExpression'
              ? patchObject(current, { key: JSON.stringify(expected.key) }) : `({ ...(${source}), key: ${JSON.stringify(expected.key)} })`;
          }
        }
      }
      queue(reference, patchObject(reference, replacements));
    }
  }
  const rewritten = new Map(staged);
  for (const [file, list] of edits) {
    let source = modules.get(file).source, previous = source.length;
    for (const edit of list.sort((a, b) => b.start - a.start)) {
      if (edit.end > previous) throw fail();
      source = source.slice(0, edit.start) + edit.replacement + source.slice(edit.end); previous = edit.start;
    }
    parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    rewritten.set(file, source);
  }
  return rewritten;
}
