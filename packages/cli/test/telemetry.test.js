import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { COMMAND_SPECS } from '../src/command-specs/index.js';
import {
  buildCliTelemetryPayload,
  cliBackendKind,
  cliDurationBucket,
  reportCliCommand,
} from '../src/runtime/telemetry.js';

const serverAllowlist = new URL('../../../server/routers/cli_telemetry/_1_code/entry.py', import.meta.url);

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

test('every local spaces command the CLI reports is accepted by the server allowlist', {
  // The public notis-cli mirror ships without the server: the pair is checked in the monorepo.
  skip: existsSync(serverAllowlist) ? false : 'the server allowlist is not part of this checkout',
}, () => {
  // The server drops a command_id it does not list, so a new local spaces command must be added there too.
  const block = readFileSync(serverAllowlist, 'utf8').match(/CLI_COMMAND_IDS = frozenset\(\s*\{([\s\S]*?)\}\s*\)/);
  assert.ok(block, 'the server allowlist is one frozenset literal');
  const allowed = new Set([...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]));
  const reported = COMMAND_SPECS
    .filter((spec) => spec.command_path[0] === 'spaces' && cliBackendKind(spec) === 'local')
    .map((spec) => buildCliTelemetryPayload({ spec, runtime, result: 'success', durationMs: 1 }).command_id);
  assert.ok(reported.includes('spaces.build'));
  assert.deepEqual(reported.filter((commandId) => !allowed.has(commandId)), []);
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
