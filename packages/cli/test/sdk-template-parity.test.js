import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '../..');
const canonicalSdkRoot = join(repoRoot, 'packages', 'sdk');
const templateSdkRoot = join(cliRoot, 'template', 'packages', 'sdk');

function listFiles(root, current = root) {
  return readdirSync(current, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = join(current, entry.name);
      return entry.isDirectory() ? listFiles(root, absolute) : [relative(root, absolute)];
    })
    .sort();
}

test('the app scaffold ships the complete canonical SDK source', () => {
  const canonicalFiles = listFiles(join(canonicalSdkRoot, 'src'));
  const templateFiles = listFiles(join(templateSdkRoot, 'src'));
  assert.deepEqual(
    templateFiles,
    canonicalFiles,
    'SDK source files drifted; mirror packages/sdk/src into packages/cli/template/packages/sdk/src.',
  );

  for (const file of canonicalFiles) {
    assert.equal(
      readFileSync(join(templateSdkRoot, 'src', file), 'utf8'),
      readFileSync(join(canonicalSdkRoot, 'src', file), 'utf8'),
      `SDK scaffold copy drifted at ${file}.`,
    );
  }
});

test('the app scaffold SDK package metadata matches the canonical package', () => {
  assert.equal(
    readFileSync(join(templateSdkRoot, 'package.json'), 'utf8'),
    readFileSync(join(canonicalSdkRoot, 'package.json'), 'utf8'),
    'SDK package metadata drifted; mirror packages/sdk/package.json into the app scaffold.',
  );
});
