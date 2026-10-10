import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let babelParse;

function isJsonParse(node) {
  const callee = node.callee;
  return node.type === 'CallExpression' && callee?.type === 'MemberExpression' && !callee.computed
    && callee.object?.type === 'Identifier' && callee.object.name === 'JSON'
    && callee.property?.type === 'Identifier' && callee.property.name === 'parse';
}

function dataContext(ancestors) {
  if (ancestors.some(node => node.type === 'JSXAttribute')) return false;
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index];
    if (node.type === 'JSXAttribute' || node.type === 'ImportDeclaration'
      || node.type === 'ImportExpression' || node.type === 'TSImportType'
      || node.type === 'ExportAllDeclaration' || node.type === 'ExportNamedDeclaration'
      || node.type === 'NewExpression' || node.type === 'TaggedTemplateExpression'
      || node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') return false;
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      if (!isJsonParse(node)) return false;
    }
    if (['VariableDeclarator', 'ExportDefaultDeclaration', 'ReturnStatement'].includes(node.type)) return true;
    if (node.type === 'ExpressionStatement') return false;
  }
  return false;
}

/**
 * Serialized JSON is data, not source: a review may quote forbidden host code
 * or historical styles. Mask only complete object/array JSON literal values in
 * data-expression positions. Keep ordinary strings, import/call/selector and
 * JSX attribute contexts, and every template expression under the existing
 * rules. Parsing errors (or a missing parser) retain the original checks.
 * Source/archive bytes are never rewritten; offsets and line breaks survive.
 */
export function maskSerializedJsonData(content, extension = '.js') {
  let ast;
  try {
    babelParse ||= require('@babel/parser').parse;
    ast = babelParse(content, {
      sourceType: 'unambiguous',
      allowReturnOutsideFunction: true,
      plugins: [...(['.ts', '.tsx'].includes(extension) ? ['typescript'] : []),
        ...(extension !== '.ts' ? ['jsx'] : [])],
    });
  } catch { return content; }
  const ranges = [];
  const pending = [[ast, []]];
  while (pending.length) {
    const [node, ancestors] = pending.pop();
    if (!node || typeof node !== 'object') continue;
    const literal = node.type === 'StringLiteral' ? node.value
      : node.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0]?.value.cooked : null;
    if (typeof literal === 'string' && dataContext(ancestors)) {
      try {
        const value = JSON.parse(literal);
        if (value !== null && typeof value === 'object') {
          ranges.push([node.start, node.end]);
          continue;
        }
      } catch { /* Ordinary/non-JSON strings keep their original checks. */ }
    }
    const parents = [...ancestors, node];
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'extra', 'tokens', 'comments', 'errors'].includes(key)) continue;
      if (Array.isArray(value)) {
        for (const child of value) if (child?.type) pending.push([child, parents]);
      } else if (value?.type) pending.push([value, parents]);
    }
  }
  let cursor = 0;
  const result = [];
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    result.push(content.slice(cursor, start), content.slice(start, end).replace(/[^\r\n]/g, ' '));
    cursor = end;
  }
  result.push(content.slice(cursor));
  return result.join('');
}
