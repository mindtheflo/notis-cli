import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PORTAL_TOKEN_FILES, portalTokens, scanCustomProperties, toolkitTokens } from './tokens.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const read = (file: string) => readFileSync(path.join(HERE, file), 'utf8');

test('portalTokens gives exactly the shared expected output for the shared fixture', () => {
  const { text, tokens } = portalTokens(read('fixtures/tokens-sample.css'));
  assert.equal(text, read('fixtures/tokens-sample.expected.txt'));
  assert.equal(tokens.length, text.split('\n').filter(Boolean).length);
});

test('every token line number points at its declaration', () => {
  const css = read('fixtures/tokens-sample.css');
  const lines = css.split('\n');
  for (const token of portalTokens(css).tokens) {
    assert.ok(lines[token.line - 1].includes(token.name), `${token.name} is not on line ${token.line}`);
  }
});

test('comments, quotes and block preludes are honoured', () => {
  const scanned = scanCustomProperties('/* { --x: 1; } */ a { --b: "c;d" /* } */; }');
  assert.deepEqual(scanned, [{ stack: ['a'], name: '--b', value: '"c;d"', line: 1 }]);
  assert.equal(portalTokens(':root, .dark { --both: 1; } .dark .card { --inner: 1; }').text, '');
  assert.equal(portalTokens('@theme inline { @media (x) { --deep: 2px; } }').text, '@theme inline > @media (x)\t--deep: 2px\n');
});

test('the Portal token files yield the @theme, :root and .dark tokens, each at its own file and line', () => {
  assert.deepEqual(PORTAL_TOKEN_FILES, ['portal/src/app/theme-tokens.css', 'portal/src/app/globals.css']);
  const texts = new Map(PORTAL_TOKEN_FILES.map((file) => [file, readFileSync(path.join(ROOT, file), 'utf8')]));
  const tokens = PORTAL_TOKEN_FILES.flatMap((file) => portalTokens(texts.get(file) ?? '', file).tokens);
  const chains = new Set(tokens.map((token) => token.chain));
  assert.ok(chains.has('@theme'));
  assert.ok(chains.has('@layer base > :root'));
  assert.ok(chains.has('@layer base > .dark'));
  for (const token of tokens) {
    const lines = (texts.get(token.file ?? '') ?? '').split('\n');
    assert.ok(lines[token.line - 1]?.includes(token.name), `${token.name} at ${token.file}:${token.line}`);
  }
  const background = tokens.filter((token) => token.name === '--background').map((token) => token.chain);
  assert.ok(background.includes('@layer base > :root') && background.includes('@layer base > .dark'));
  assert.equal(portalTokens(':root { --x: 1; }').tokens[0].file, null);
});

test('toolkitTokens lists the --nui-* properties with file and line', () => {
  const file = 'packages/sdk/src/ui/toolkit.css';
  const tokens = toolkitTokens(readFileSync(path.join(ROOT, file), 'utf8'), file);
  assert.ok(tokens.length > 0);
  assert.ok(tokens.every((token) => token.name.startsWith('--nui-') && token.file === file && token.line > 0));
  assert.ok(tokens.some((token) => token.name === '--nui-blue'));
});
