import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCliTelemetryPayload,
  cliDurationBucket,
  reportCliCommand,
} from '../src/runtime/telemetry.js';

const spec = {
  command_path: ['apps', 'build'],
  backend_call: { type: 'local', name: 'next_build_and_package' },
};
const runtime = {
  apiBase: 'https://api.notis.ai',
  jwt: 'test-jwt',
  cliVersion: '0.2.0',
  agentMode: true,
};

test('CLI telemetry is bounded and excludes command arguments and workspace data', () => {
  const payload = buildCliTelemetryPayload({
    spec,
    runtime,
    result: 'failed',
    durationMs: 7_000,
    error: { exitCode: 4, message: 'private workspace path' },
  });

  assert.deepEqual(payload, {
    command_id: 'apps.build',
    backend_kind: 'local',
    result: 'failed',
    error_category: 'network',
    duration_bucket: '5s_to_30s',
    cli_version: '0.2.0',
    agent_mode: true,
  });
  assert.doesNotMatch(JSON.stringify(payload), /private|workspace|argument/i);
});

test('CLI telemetry duration buckets stay low-cardinality', () => {
  assert.equal(cliDurationBucket(999), 'under_1s');
  assert.equal(cliDurationBucket(1_000), '1s_to_5s');
  assert.equal(cliDurationBucket(5_000), '5s_to_30s');
  assert.equal(cliDurationBucket(30_000), 'over_30s');
});

test('CLI telemetry is best-effort and skips signed-out commands', async () => {
  let calls = 0;
  const sent = await reportCliCommand({
    spec,
    runtime: { ...runtime, jwt: null },
    result: 'success',
    durationMs: 10,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true };
    },
  });
  assert.equal(sent, false);
  assert.equal(calls, 0);
});
