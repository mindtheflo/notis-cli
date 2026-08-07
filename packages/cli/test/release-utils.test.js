import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareVersions,
  computePublishVersion,
  computePrereleasePublishVersion,
  incrementPatchVersion,
  normalizeRegistryVersion,
} from '../scripts/release-utils.js';

test('normalizeRegistryVersion handles empty and array responses', () => {
  assert.equal(normalizeRegistryVersion(null), null);
  assert.equal(normalizeRegistryVersion([]), null);
  assert.equal(normalizeRegistryVersion(['0.2.0', '0.2.3']), '0.2.3');
  assert.equal(normalizeRegistryVersion('0.2.4'), '0.2.4');
});

test('compareVersions sorts semantic versions numerically', () => {
  assert.ok(compareVersions('0.2.1', '0.2.0') > 0);
  assert.ok(compareVersions('0.2.0', '0.2.1') < 0);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});

test('incrementPatchVersion bumps the patch number', () => {
  assert.equal(incrementPatchVersion('0.2.0'), '0.2.1');
  assert.equal(incrementPatchVersion('1.9.9'), '1.9.10');
});

test('computePublishVersion keeps a newer repo version', () => {
  assert.equal(
    computePublishVersion({
      packageVersion: '0.3.0',
      latestRegistryVersion: '0.2.9',
    }),
    '0.3.0',
  );
});

test('computePublishVersion bumps when the registry already has the repo version', () => {
  assert.equal(
    computePublishVersion({
      packageVersion: '0.2.0',
      latestRegistryVersion: '0.2.0',
    }),
    '0.2.1',
  );
});

test('computePublishVersion bumps from the latest published patch when the repo lags behind', () => {
  assert.equal(
    computePublishVersion({
      packageVersion: '0.2.0',
      latestRegistryVersion: '0.2.4',
    }),
    '0.2.5',
  );
});

test('computePrereleasePublishVersion appends beta run identifiers', () => {
  assert.equal(
    computePrereleasePublishVersion({
      packageVersion: '0.2.0',
      prereleaseTag: 'beta',
      runNumber: '241',
      runAttempt: '3',
    }),
    '0.2.0-beta.241.3',
  );
});
