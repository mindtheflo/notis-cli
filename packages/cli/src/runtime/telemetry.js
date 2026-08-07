const ERROR_CATEGORIES = new Map([
  [2, 'usage'],
  [3, 'auth'],
  [4, 'network'],
  [5, 'conflict'],
  [6, 'backend'],
  [7, 'unexpected'],
  [8, 'payment'],
]);

export function cliDurationBucket(durationMs) {
  if (durationMs < 1_000) return 'under_1s';
  if (durationMs < 5_000) return '1s_to_5s';
  if (durationMs < 30_000) return '5s_to_30s';
  return 'over_30s';
}

export function cliBackendKind(spec) {
  const value = String(spec?.backend_call?.type || '').toLowerCase();
  if (value === 'tool') return 'tool';
  if (value === 'http') return 'http';
  if (value === 'local') return 'local';
  if (value.includes('health')) return 'health';
  if (value.includes('local')) return 'local';
  return 'other';
}

export function buildCliTelemetryPayload({
  spec,
  runtime,
  result,
  durationMs,
  error,
}) {
  return {
    command_id: spec.command_path.join('.'),
    backend_kind: cliBackendKind(spec),
    result,
    error_category: result === 'failed'
      ? (ERROR_CATEGORIES.get(Number(error?.exitCode)) || 'unexpected')
      : 'none',
    duration_bucket: cliDurationBucket(durationMs),
    cli_version: runtime.cliVersion,
    agent_mode: Boolean(runtime.agentMode),
  };
}

export async function reportCliCommand({
  spec,
  runtime,
  result,
  durationMs,
  error = null,
  fetchImpl = globalThis.fetch,
}) {
  // Backend tool calls emit authoritative surface/tool telemetry server-side.
  // This client event exists only for local commands that otherwise leave no
  // observable runtime boundary.
  if (
    cliBackendKind(spec) !== 'local'
    || !runtime?.jwt
    || !runtime?.apiBase
    || typeof fetchImpl !== 'function'
  ) {
    return false;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetchImpl(`${runtime.apiBase}/cli_telemetry`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtime.jwt}`,
        'Content-Type': 'application/json',
        'X-Notis-CLI-Version': runtime.cliVersion,
      },
      body: JSON.stringify(buildCliTelemetryPayload({
        spec,
        runtime,
        result,
        durationMs,
        error,
      })),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
