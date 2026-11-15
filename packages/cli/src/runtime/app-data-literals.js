import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let babelParse;

function isJsonParse(node) {
  const callee = node.callee;
  return node.type === 'CallExpression' && callee?.type === 'MemberExpression' && !callee.computed
    && callee.object?.type === 'Identifier' && callee.object.name === 'JSON'
    && callee.property?.type === 'Identifier' && callee.property.name === 'parse';
}

const NOT_DATA = new Set(['JSXAttribute', 'ImportDeclaration', 'ImportExpression', 'TSImportType',
  'ExportAllDeclaration', 'ExportNamedDeclaration', 'NewExpression', 'TaggedTemplateExpression',
  'MemberExpression', 'OptionalMemberExpression']);
const DATA = new Set(['VariableDeclarator', 'ExportDefaultDeclaration', 'ReturnStatement']);

// What this ancestor says about a literal below it: true or false, or null to ask its parent.
// The nearest ancestor that answers decides, as climbing from the literal would.
function decides(node) {
  if (NOT_DATA.has(node.type)) return false;
  if ((node.type === 'CallExpression' || node.type === 'OptionalCallExpression') && !isJsonParse(node)) return false;
  if (DATA.has(node.type)) return true;
  if (node.type === 'ExpressionStatement') return false;
  return null;
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
  // Each node carries what its ancestors decided, so no literal looks back up the tree and no
  // ancestor list is copied per node: deep data (objects nested a thousand levels) stays linear.
  const pending = [[ast, false, null]];
  while (pending.length) {
    const [node, underAttribute, decided] = pending.pop();
    if (!node || typeof node !== 'object') continue;
    const literal = node.type === 'StringLiteral' ? node.value
      : node.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0]?.value.cooked : null;
    if (typeof literal === 'string' && !underAttribute && decided === true) {
      try {
        const value = JSON.parse(literal);
        if (value !== null && typeof value === 'object') {
          ranges.push([node.start, node.end]);
          continue;
        }
      } catch { /* Ordinary/non-JSON strings keep their original checks. */ }
    }
    const own = node.type ? decides(node) : null;
    const below = [underAttribute || node.type === 'JSXAttribute', own ?? decided];
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'extra', 'tokens', 'comments', 'errors'].includes(key)) continue;
      if (Array.isArray(value)) {
        for (const child of value) if (child?.type) pending.push([child, ...below]);
      } else if (value?.type) pending.push([value, ...below]);
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
