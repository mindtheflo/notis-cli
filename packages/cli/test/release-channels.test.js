import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SUPPORTED_CHANNELS, resolveSelectedChannels } = require('../scripts/release-channels.cjs');

test('an "all" run evaluates every supported channel (the frozen-stable regression)', () => {
  // The bug: nightly `all` runs narrowed to the ref branch (always beta), so
  // `production`/stable was never evaluated and npm `latest` froze at 0.2.2.
  const selected = resolveSelectedChannels('all');
  assert.deepEqual(selected, SUPPORTED_CHANNELS);
  assert.ok(selected.includes('production'), 'stable channel must always be evaluated for "all"');
});

test('a missing/empty channel input defaults to "all" (evaluates every channel)', () => {
  assert.deepEqual(resolveSelectedChannels(undefined), SUPPORTED_CHANNELS);
  assert.deepEqual(resolveSelectedChannels(''), SUPPORTED_CHANNELS);
});

test('an explicit channel input is honored exactly', () => {
  assert.deepEqual(resolveSelectedChannels('production'), ['production']);
  assert.deepEqual(resolveSelectedChannels('beta'), ['beta']);
});

test('an unsupported channel throws instead of silently publishing nothing', () => {
  assert.throws(() => resolveSelectedChannels('canary'), /Unsupported channel: canary/);
});

test('resolveSelectedChannels does not depend on any ref/branch input', () => {
  // Guard the root cause directly: the only required parameter is the channel
  // input (supportedChannels has a default, so .length is 1). No ref/branch is
  // taken, so a future edit can't reintroduce ref-branch narrowing without
  // changing this contract and failing the tests above.
  assert.equal(resolveSelectedChannels.length, 1);
});
