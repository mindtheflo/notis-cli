import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '../scripts/finalize-handoff.js');

function finalize(flags) {
  const { GITHUB_EVENT_PATH: _event, NOTIS_BETA_RELEASE_FLAG: _beta, NOTIS_PRODUCTION_RELEASE_FLAG: _production,
    ...env } = process.env;
  return spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...env, ...flags } });
}

test('finalizer refuses a release flag that only equals true case-insensitively', () => {
  for (const flags of [{ NOTIS_BETA_RELEASE_FLAG: 'True' }, { NOTIS_PRODUCTION_RELEASE_FLAG: 'TRUE' },
    { NOTIS_BETA_RELEASE_FLAG: 'yes' }, { NOTIS_PRODUCTION_RELEASE_FLAG: ' true' }]) {
    const result = finalize(flags);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Release flags must be exactly true, false or unset/);
  }
  // Exact or unset flags pass the guard and stop later, at the missing dispatch event.
  for (const flags of [{}, { NOTIS_BETA_RELEASE_FLAG: 'true', NOTIS_PRODUCTION_RELEASE_FLAG: 'false' },
    { NOTIS_BETA_RELEASE_FLAG: '', NOTIS_PRODUCTION_RELEASE_FLAG: '' }]) {
    const result = finalize(flags);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /Release flags must be/);
    assert.match(result.stderr, /ERR_INVALID_ARG_TYPE/);
  }
});
