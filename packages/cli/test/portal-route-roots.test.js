import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateViewPath } from '../src/runtime/space-view-manifest.js';

test('every consumer uses the generated current Portal route ownership list', () => {
  const check = spawnSync(process.execPath, [fileURLToPath(new URL('../../../scripts/generate-portal-route-roots.mjs', import.meta.url)), '--check'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  assert.throws(() => validateViewPath('skills'), /belongs to the Portal/);
  assert.throws(() => validateViewPath('api/private'), /belongs to the Portal/);
  assert.equal(validateViewPath('notes'), 'notes');
});
