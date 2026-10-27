import test from 'node:test';
import assert from 'node:assert/strict';

import { DEPRECATION_MESSAGE, planBetaRetirement } from '../scripts/retire-beta-dist-tag.js';

test('retiring beta points the tag at latest and deprecates every beta prerelease in one call', () => {
  const history = {
    'dist-tags': { latest: '0.2.23', beta: '0.2.0-beta.20.1', nightly: '0.2.0-nightly.30.1' },
    versions: {
      '0.2.23': { version: '0.2.23' },
      '0.2.0-beta.19.1': { version: '0.2.0-beta.19.1' },
      '0.2.0-beta.20.1': { version: '0.2.0-beta.20.1' },
      '0.2.0-beta.18.1': { version: '0.2.0-beta.18.1', deprecated: DEPRECATION_MESSAGE },
      '0.2.0-nightly.30.1': { version: '0.2.0-nightly.30.1' },
    },
  };
  const plan = planBetaRetirement(history);
  assert.equal(DEPRECATION_MESSAGE, 'Notis CLI beta is now nightly: npm i -g @notis_ai/cli@latest');
  assert.equal(plan.stable, '0.2.23');
  assert.deepEqual(plan.deprecate, ['0.2.0-beta.19.1', '0.2.0-beta.20.1']);
  assert.deepEqual(plan.commands, [
    ['dist-tag', 'add', '@notis_ai/cli@0.2.23', 'beta'],
    ['deprecate', '@notis_ai/cli@0.2.0-beta.19.1 || 0.2.0-beta.20.1', DEPRECATION_MESSAGE],
  ]);
});

test('a finished retirement plans nothing, and a registry without stable refuses', () => {
  const done = {
    'dist-tags': { latest: '0.2.23', beta: '0.2.23' },
    versions: { '0.2.0-beta.1.1': { version: '0.2.0-beta.1.1', deprecated: DEPRECATION_MESSAGE } },
  };
  assert.deepEqual(planBetaRetirement(done).commands, []);
  assert.throws(() => planBetaRetirement({ 'dist-tags': {}, versions: {} }), /no stable release/);
});
