import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { usageError } from '../runtime/errors.js';
import {
  COMPOSIO_MULTI_EXECUTE_TOOL,
  fetchToolDiscovery,
  healthCheck,
  nextIdempotencyKey,
  runToolCommand,
} from './helpers.js';

const ENTITLEMENT_FIELDS = [
  'created_at',
  'included_credit_seat_count',
  'on_demand_enabled',
  'on_demand_limit',
  'on_demand_period_used',
  'on_demand_status',
  'price_id',
  'sub_end',
  'sub_start',
  'sub_status',
  'usage_period_end',
  'usage_period_start',
];
export const CREATE_DEBUG_ENTITLEMENT_OVERRIDE_TOOL = 'LOCAL_NOTIS_CREATE_DEBUG_ENTITLEMENT_OVERRIDE';

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function discoveredToolNames(payload) {
  const names = [];
  for (const result of payload.results || []) {
    names.push(...(result.primary_tool_slugs || []), ...(result.related_tool_slugs || []));
  }
  return [...new Set(names.filter(Boolean))];
}

async function discoverSupabaseSqlTool(runtime) {
  const payload = await fetchToolDiscovery(
    runtime,
    'Execute a read-only SQL query against the connected Notis application Supabase project for debugging user context and interaction costs',
    'query',
  );
  const names = discoveredToolNames(payload);
  const match = names.find((name) => (
    name.toUpperCase().includes('SUPABASE')
    && name.toUpperCase().includes('EXECUTE_SQL')
  ));
  if (!match) {
    throw usageError('No connected Supabase execute-SQL capability was discovered. Run `notis tools link mcp_supabase_notis_app`.');
  }
  return match;
}

export function unwrapToolExecutionPayload(payload) {
  return (
    payload?.data?.results?.[0]?.response?.data
    ?? payload?.results?.[0]?.response?.data
    ?? payload?.data?.result
    ?? payload?.result
    ?? payload?.data
    ?? payload
  );
}

function parseJsonCandidate(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const boundaryEnd = trimmed.lastIndexOf('</untrusted-data');
    const boundaryStart = boundaryEnd >= 0
      ? trimmed.lastIndexOf('<untrusted-data', boundaryEnd)
      : -1;
    const contentStart = boundaryStart >= 0 ? trimmed.indexOf('>', boundaryStart) + 1 : -1;
    if (contentStart > 0 && boundaryEnd > contentStart) {
      // Supabase MCP sometimes returns the prose envelope with literal "\\n"
      // separators. Strip those only at the boundary: globally replacing them
      // corrupts valid escaped newlines inside JSON string values.
      const inner = trimmed
        .slice(contentStart, boundaryEnd)
        .trim()
        .replace(/^(?:\\r?\\n)+/, '')
        .replace(/(?:\\r?\\n)+$/, '')
        .trim();
      try {
        return JSON.parse(inner);
      } catch (error) {
        const nested = parseJsonCandidate(inner);
        if (nested !== null) return nested;
        throw usageError(
          `Supabase diagnostic rows were not valid JSON: ${error instanceof Error ? error.message : String(error)}; prefix=${JSON.stringify(inner.slice(0, 100))}`,
        );
      }
    }
    const arrayMatch = trimmed.match(/(\[[\s\S]*\])/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[1]);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function extractSqlRows(payload) {
  let current = unwrapToolExecutionPayload(payload);
  for (let depth = 0; depth < 8; depth += 1) {
    if (Array.isArray(current)) return current;
    if (typeof current === 'string') {
      const parsed = parseJsonCandidate(current);
      if (parsed === null) break;
      current = parsed;
      continue;
    }
    if (!current || typeof current !== 'object') break;
    if (Array.isArray(current.rows)) return current.rows;
    if ('result' in current) {
      current = current.result;
      continue;
    }
    if ('data' in current) {
      current = current.data;
      continue;
    }
    break;
  }
  const shape = current && typeof current === 'object'
    ? `object keys: ${Object.keys(current).sort().join(', ')}`
    : typeof current;
  if (current && typeof current === 'object' && current.error) {
    const message = typeof current.error === 'string'
      ? current.error
      : (current.error.message || JSON.stringify(current.error));
    throw usageError(`Supabase diagnostic query failed: ${String(message).slice(0, 500)}`);
  }
  if (typeof current === 'string') {
    const safePrefix = current.split('<untrusted-data', 1)[0].trim();
    const boundaryEnd = current.lastIndexOf('</untrusted-data');
    const boundaryStart = boundaryEnd >= 0
      ? current.lastIndexOf('<untrusted-data', boundaryEnd)
      : -1;
    const contentStart = boundaryStart >= 0 ? current.indexOf('>', boundaryStart) + 1 : -1;
    const inner = contentStart > 0 && boundaryEnd > contentStart
      ? current.slice(contentStart, boundaryEnd).trim()
      : '';
    const boundaryShape = boundaryStart >= 0
      ? `; boundary content length=${inner.length}, starts=${JSON.stringify(inner.slice(0, 1))}, ends=${JSON.stringify(inner.slice(-1))}`
      : '';
    throw usageError(
      `Supabase diagnostic query returned non-row text${safePrefix ? `: ${safePrefix.slice(0, 500)}` : ''}${boundaryShape}`,
    );
  }
  throw usageError(`The Supabase SQL capability returned an unsupported result shape (${shape}).`);
}

async function executeReadOnlySql(ctx, query, phase) {
  // An exported override applies to ordinary tool calls, not to the read-only
  // commands that inspect or regenerate the assertion itself. The backend
  // intentionally blocks SQL under an override, so diagnostics must explicitly
  // use the operator's own unmodified context.
  const diagnosticRuntime = {
    ...ctx.runtime,
    debugEntitlementOverride: null,
  };
  ctx.output.emitProgress({ phase: 'discover', message: 'Resolving the connected Notis Supabase SQL capability' });
  const toolName = await discoverSupabaseSqlTool(diagnosticRuntime);
  ctx.output.emitProgress({ phase, message: 'Running the read-only diagnostic query' });
  const result = await runToolCommand({
    runtime: diagnosticRuntime,
    toolName: COMPOSIO_MULTI_EXECUTE_TOOL,
    arguments_: {
      tools: [{ tool_slug: toolName, arguments: { query } }],
    },
    mutating: false,
    // Always a fresh key, never the operator's --idempotency-key: a diagnostic
    // must observe current state rather than replay a cached response, and two
    // different queries under one reused key would collide on the request hash.
    idempotencyKey: randomUUID(),
    sendIdempotencyKeyWhenReading: true,
  });
  if (result.payload?.successful === false || result.payload?.error) {
    throw usageError(
      `Supabase diagnostic query failed: ${result.payload.error || 'unknown SQL error'}`,
    );
  }
  return {
    rows: extractSqlRows(result.payload),
    requestId: result.requestId,
    toolName,
  };
}

function redactIdentifier(value) {
  if (!value) return null;
  const text = String(value);
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 12);
  return `${text.slice(0, 3)}…#${digest}`;
}

function canonicalObjectHash(value) {
  const ordered = Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

function entitlementParityHash(context) {
  const canonical = { scope_type: context.billing.scope_type };
  for (const field of ENTITLEMENT_FIELDS) {
    let value = context.billing[field] ?? null;
    if (
      (field === 'created_at' || field.endsWith('_start') || field.endsWith('_end'))
      && typeof value === 'string'
    ) {
      const timestamp = Date.parse(value);
      if (Number.isFinite(timestamp)) value = timestamp;
    } else if (typeof value === 'number' && !Number.isInteger(value)) {
      value = Math.round(value * 1_000_000) / 1_000_000;
    }
    canonical[field] = value;
  }
  return canonicalObjectHash(canonical);
}

export function buildUserContextSql(reference) {
  const literal = sqlLiteral(reference);
  return `
WITH target AS (
  SELECT u.*
  FROM public.users AS u
  LEFT JOIN public.user_primary_emails AS upe ON upe.user_id = u.user_id
  WHERE u.user_id::text = ${literal}
     OR lower(upe.primary_email) = lower(${literal})
  ORDER BY CASE WHEN u.user_id::text = ${literal} THEN 0 ELSE 1 END
  LIMIT 1
),
effective AS (
  SELECT
    target.*,
    team.row_json AS team_json,
    CASE WHEN team.row_json IS NULL THEN 'user' ELSE 'team' END AS scope_type,
    COALESCE(team.row_json, to_jsonb(target)) AS scope_json
  FROM target
  LEFT JOIN LATERAL (
    SELECT to_jsonb(t) AS row_json
    FROM public.teams AS t
    WHERE t.id::text = target.team_id::text
       OR t.owner_id = target.user_id
    ORDER BY CASE WHEN t.id::text = target.team_id::text THEN 0 ELSE 1 END
    LIMIT 1
  ) AS team ON true
)
SELECT jsonb_build_object(
  'user_id', effective.user_id,
  'primary_email', (
    SELECT upe.primary_email FROM public.user_primary_emails AS upe
    WHERE upe.user_id = effective.user_id LIMIT 1
  ),
  'test_user', COALESCE((to_jsonb(effective)->>'test_user')::boolean, false),
  'users_for_eval', COALESCE((to_jsonb(effective)->>'users_for_eval')::boolean, false),
  'channel_runtime_defaults', COALESCE(to_jsonb(effective)->'channel_runtime_defaults', '{}'::jsonb),
  'billing', jsonb_build_object(
    'created_at', to_jsonb(effective)->>'created_at',
    'scope_type', effective.scope_type,
    'scope_id', COALESCE(effective.scope_json->>'id', effective.user_id::text),
    'billing_owner_id', COALESCE(effective.team_json->>'owner_id', effective.user_id::text),
    'price_id', effective.scope_json->>'price_id',
    'sub_status', effective.scope_json->>'sub_status',
    'sub_start', effective.scope_json->>'sub_start',
    'sub_end', effective.scope_json->>'sub_end',
    'usage_period_start', effective.scope_json->>'usage_period_start',
    'usage_period_end', effective.scope_json->>'usage_period_end',
    'on_demand_enabled', COALESCE((effective.scope_json->>'on_demand_enabled')::boolean, false),
    'on_demand_limit', (effective.scope_json->>'on_demand_limit')::numeric,
    'on_demand_status', effective.scope_json->>'on_demand_status',
    'on_demand_period_used', COALESCE((effective.scope_json->>'on_demand_period_used')::numeric, 0),
    'included_credit_seat_count', COALESCE((effective.scope_json->>'included_credit_seat_count')::integer, 1)
  ),
  'runtime', jsonb_build_object(
    'model', COALESCE(
      to_jsonb(effective)->'settings'->>'model',
      to_jsonb(effective)->'settings'->>'model_name'
    ),
    'mode', to_jsonb(effective)->'settings'->>'mode',
    'reasoning_effort', to_jsonb(effective)->'settings'->>'reasoning_effort',
    'channel_defaults', COALESCE(to_jsonb(effective)->'channel_runtime_defaults', '{}'::jsonb),
    'last_channel', (
      SELECT to_jsonb(ca)->>'provider'
      FROM public.channel_accounts AS ca
      WHERE ca.id::text = to_jsonb(effective)->>'last_channel_account_id'
      LIMIT 1
    )
  ),
  'plan', (
    SELECT jsonb_build_object(
      'price', to_jsonb(prices),
      'catalog', to_jsonb(plan)
    )
    FROM public.prices AS prices
    LEFT JOIN public.pricing_plans AS plan
      ON effective.scope_json->>'price_id' IN (
        plan.test_monthly_price_id, plan.test_yearly_price_id,
        plan.prod_monthly_price_id, plan.prod_yearly_price_id
      )
    WHERE prices.stripe_price_id = effective.scope_json->>'price_id'
    LIMIT 1
  ),
  'channels', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'provider', to_jsonb(ca)->>'provider',
      'service', to_jsonb(ca)->>'messaging_service',
      'status', to_jsonb(ca)->>'status'
    )), '[]'::jsonb)
    FROM public.channel_accounts AS ca WHERE ca.user_id = effective.user_id
  ),
  'integrations', jsonb_build_object(
    'composio_labeled_accounts', (
      SELECT count(*) FROM public.user_integration_labels AS c
      WHERE c.user_id = effective.user_id
    ),
    'mcp', (SELECT count(*) FROM public.user_mcps AS m WHERE m.user_id = effective.user_id)
  )
) AS context
FROM effective;`;
}

export async function loadUserContext(ctx, reference) {
  const execution = await executeReadOnlySql(ctx, buildUserContextSql(reference), 'user-context');
  const row = execution.rows[0];
  const raw = row?.context ?? row;
  if (!raw) {
    throw usageError(`No Notis user matched "${reference}".`);
  }
  const context = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const parityHash = entitlementParityHash(context);
  return {
    context,
    parityHash,
    requestId: execution.requestId,
    toolName: execution.toolName,
  };
}

async function debugUserContextHandler(ctx) {
  const loaded = await loadUserContext(ctx, ctx.args.user);
  const context = loaded.context;
  const redactPlanIds = (value) => {
    if (Array.isArray(value)) return value.map(redactPlanIds);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
      key,
      /(?:^|_)(?:price_id|messaging_service_id)$/.test(key)
        ? redactIdentifier(nested)
        : redactPlanIds(nested),
    ]));
  };
  const redacted = {
    identity: {
      user: redactIdentifier(context.user_id),
      email: redactIdentifier(context.primary_email),
      test_user: Boolean(context.test_user),
      users_for_eval: Boolean(context.users_for_eval),
    },
    billing: {
      ...context.billing,
      scope_id: redactIdentifier(context.billing?.scope_id),
      billing_owner_id: redactIdentifier(context.billing?.billing_owner_id),
      price_id: redactIdentifier(context.billing?.price_id),
    },
    plan: redactPlanIds(context.plan),
    usage_settings: {
      on_demand_enabled: context.billing?.on_demand_enabled,
      on_demand_limit: context.billing?.on_demand_limit,
      usage_period_start: context.billing?.usage_period_start,
      usage_period_end: context.billing?.usage_period_end,
    },
    feature_flags: redactPlanIds(context.plan?.price || {}),
    model_and_channel_defaults: context.runtime || {
      channel_defaults: context.channel_runtime_defaults || {},
    },
    channels: context.channels || [],
    integrations: context.integrations || {},
    parity_hash: loaded.parityHash,
  };
  ctx.output.emitProgress({ phase: 'complete', message: 'Resolved effective redacted user context', requestId: loaded.requestId });
  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: redacted,
    humanSummary: `Resolved effective user context for ${redacted.identity.email}`,
    requestId: loaded.requestId,
    meta: { mutating: false, sql_tool: loaded.toolName },
    renderHuman: () => JSON.stringify(redacted, null, 2),
  });
}

export async function mintEntitlementOverride(ctx, referenceUser, actorUser = null) {
  const requestedTtl = Number.parseInt(ctx.options.ttlSeconds || '600', 10);
  if (!Number.isInteger(requestedTtl) || requestedTtl < 30 || requestedTtl > 900) {
    throw usageError('--ttl-seconds must be between 30 and 900.');
  }
  const result = await runToolCommand({
    runtime: { ...ctx.runtime, debugEntitlementOverride: null },
    toolName: CREATE_DEBUG_ENTITLEMENT_OVERRIDE_TOOL,
    arguments_: {
      reference_user: referenceUser,
      ttl_seconds: requestedTtl,
      ...(actorUser ? { actor_user: actorUser } : {}),
    },
    mutating: false,
  });
  const minted = result.payload || {};
  if (!minted.override || !minted.encoded || minted.persistent !== false) {
    throw usageError('The backend did not return a signed non-persistent entitlement override.');
  }
  return { ...minted, requestId: result.requestId || minted.request_id };
}

async function debugEntitlementOverrideHandler(ctx) {
  const minted = await mintEntitlementOverride(
    ctx,
    ctx.args.referenceUser,
    ctx.options.actorUser,
  );
  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: {
      ...minted,
      shell: `export NOTIS_DEBUG_ENTITLEMENT_OVERRIDE=${minted.encoded}`,
    },
    humanSummary: 'Created a request-scoped entitlement parity override; no account row was modified.',
    requestId: minted.requestId,
    meta: { mutating: false },
    renderHuman: () => [
      'Request-scoped entitlement parity override created (no database mutation).',
      `Actor: ${minted.actor_user_id}`,
      `Expires: ${minted.override.expires_at}`,
      `export NOTIS_DEBUG_ENTITLEMENT_OVERRIDE=${minted.encoded}`,
    ].join('\n'),
  });
}

function buildTraceCostSql(reference) {
  const literal = sqlLiteral(reference);
  return `
SELECT jsonb_build_object(
  'id', i.id,
  'trace_id', to_jsonb(i)->>'trace_id',
  'created_at', to_jsonb(i)->>'created_at',
  'updated_at', to_jsonb(i)->>'updated_at',
  'completed_at', COALESCE(to_jsonb(i)->>'completed_at', to_jsonb(i)->>'ended_at'),
  'status', COALESCE(to_jsonb(i)->>'status', to_jsonb(i)->>'state'),
  'total_cost', COALESCE((to_jsonb(i)->>'total_cost')::numeric, 0),
  'model', COALESCE(to_jsonb(i)->>'model', to_jsonb(i)->>'model_name'),
  'usage_details', COALESCE(to_jsonb(i)->'usage_details', '{}'::jsonb),
  'error', COALESCE(to_jsonb(i)->>'error', to_jsonb(i)->>'error_message'),
  'retry_count', COALESCE((to_jsonb(i)->>'retry_count')::integer, 0)
) AS interaction
FROM public.interactions AS i
WHERE i.id::text = ${literal}
   OR to_jsonb(i)->>'trace_id' = ${literal}
ORDER BY i.created_at ASC;`;
}

export function traceFileDiagnostics(path) {
  if (!path) return null;
  if (!existsSync(path)) throw usageError(`Trace file not found: ${path}`);
  const trace = JSON.parse(readFileSync(path, 'utf-8'));
  const text = JSON.stringify(trace).toLowerCase();
  const modelCounts = {};
  const generationIds = new Set();
  const retryEventIds = new Set();
  const toolFailureIds = new Set();
  let anonymousGenerations = 0;
  let anonymousRetryEvents = 0;
  let anonymousToolFailures = 0;
  let explicitRetries = 0;
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value)) {
      const observationType = String(value.type || value.observation_type || '').toLowerCase();
      const eventName = String(value.name || value.event || '').toLowerCase();
      const status = String(value.status || value.level || '').toLowerCase();
      const recordId = String(value.id || value.observation_id || '');
      if (observationType.includes('generation')) {
        if (recordId) generationIds.add(recordId);
        else anonymousGenerations += 1;
        if (typeof value.model === 'string' && value.model) {
          modelCounts[value.model] = (modelCounts[value.model] || 0) + 1;
        }
      }
      const retryCount = Number(value.retry_count ?? value.retryCount ?? value.retries);
      if (Number.isFinite(retryCount) && retryCount > 0) {
        explicitRetries += retryCount;
      } else if (/\bretr(?:y|ies|ied|ying)\b/.test(`${observationType} ${eventName}`)) {
        if (recordId) retryEventIds.add(recordId);
        else anonymousRetryEvents += 1;
      }
      const isToolRecord = observationType.includes('tool')
        || eventName.includes('tool');
      const isFailure = ['error', 'failed', 'failure'].some((token) => (
        status.includes(token)
        || String(value.error || '').toLowerCase().includes(token)
      ));
      if (isToolRecord && isFailure) {
        if (recordId) toolFailureIds.add(recordId);
        else anonymousToolFailures += 1;
      }
    }
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(trace);
  return {
    generations: generationIds.size + anonymousGenerations
      || (text.match(/"generation"/g) || []).length,
    retries: explicitRetries + retryEventIds.size + anonymousRetryEvents,
    tool_failures: toolFailureIds.size + anonymousToolFailures,
    model_counts: modelCounts,
    source: path,
  };
}

function usageModelCounts(interactions) {
  const counts = {};
  for (const interaction of interactions) {
    if (typeof interaction.model === 'string' && interaction.model) {
      counts[interaction.model] = (counts[interaction.model] || 0) + 1;
    }
    for (const usage of Object.values(interaction.usage_details || {})) {
      if (usage && typeof usage === 'object' && typeof usage.model === 'string' && usage.model) {
        counts[usage.model] = (counts[usage.model] || 0) + 1;
      }
    }
  }
  return counts;
}

async function debugTraceCostHandler(ctx) {
  const execution = await executeReadOnlySql(ctx, buildTraceCostSql(ctx.args.traceOrInteraction), 'trace-cost');
  const interactions = execution.rows.map((row) => row.interaction ?? row);
  if (!interactions.length) {
    throw usageError(`No interaction or trace matched "${ctx.args.traceOrInteraction}".`);
  }
  const costs = interactions.map((item) => Number(item.total_cost || 0));
  const totalCost = costs.reduce((sum, cost) => sum + cost, 0);
  const attributable = ctx.options.attributableCost === undefined
    ? null
    : Number(ctx.options.attributableCost);
  if (attributable !== null && (!Number.isFinite(attributable) || attributable < 0)) {
    throw usageError('--attributable-cost must be a non-negative number.');
  }
  const confirmedBug = Boolean(ctx.options.confirmedBug);
  const refundableEstimate = confirmedBug && attributable !== null
    ? Math.min(totalCost, attributable)
    : null;
  const traceDiagnostics = traceFileDiagnostics(ctx.options.traceFile);
  const recordedModelCounts = usageModelCounts(interactions);
  const modelCounts = traceDiagnostics && Object.keys(traceDiagnostics.model_counts).length
    ? traceDiagnostics.model_counts
    : recordedModelCounts;
  const result = {
    interaction_count: interactions.length,
    latency: {
      started_at: interactions[0].created_at,
      completed_at: interactions.at(-1).completed_at || interactions.at(-1).updated_at,
    },
    generations: traceDiagnostics?.generations ?? null,
    retries: traceDiagnostics?.retries
      ?? interactions.reduce((sum, item) => sum + Number(item.retry_count || 0), 0),
    tool_failures: traceDiagnostics?.tool_failures ?? null,
    model_counts: modelCounts,
    total_provider_cost: totalCost,
    refundable_cost_estimate: refundableEstimate,
    refund_basis: refundableEstimate === null
      ? 'Requires confirmed Notis bug evidence and an explicit bug-attributable cost. Misunderstandings and service limitations are not goodwill bugs.'
      : 'Capped at the lower of recorded provider cost and the explicitly attributed true-bug amount.',
    interactions,
    trace_file: traceDiagnostics,
  };
  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: result,
    humanSummary: `Attributed ${interactions.length} interaction(s) and ${totalCost.toFixed(4)} in recorded provider cost.`,
    requestId: execution.requestId,
    meta: { mutating: false, sql_tool: execution.toolName },
    renderHuman: () => JSON.stringify(result, null, 2),
  });
}

async function debugWorkerIdentityHandler(ctx) {
  ctx.output.emitProgress({ phase: 'worker-identity', message: 'Reading backend worker identity' });
  const result = await healthCheck(ctx.runtime);
  const identity = result.payload?.runtime || result.payload;
  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: identity,
    humanSummary: `Worker ${identity.build_sha || 'unknown'} started ${identity.process_started_at || 'unknown'}.`,
    requestId: result.requestId,
    meta: { mutating: false },
    renderHuman: () => JSON.stringify(identity, null, 2),
  });
}

export const diagnosticCommandSpecs = [
  {
    command_path: ['debug', 'user-context'],
    summary: 'Resolve a user’s effective redacted runtime and billing context.',
    when_to_use: 'Use before reproducing user-specific plan, team, model, channel, or integration behavior.',
    args_schema: { arguments: [{ token: '<user>', key: 'user', description: 'Notis user UUID or primary email.' }], options: [] },
    examples: ['notis debug user-context user@example.com --json'],
    output_schema: 'Returns redacted identity, effective billing scope, plan features, usage settings, defaults, channels, integrations, and a parity hash.',
    mutates: false,
    idempotent: true,
    related_commands: ['notis debug entitlement-override <reference-user>', 'notis debug trace-cost <trace-or-interaction>'],
    backend_call: { type: 'tool-discovery', name: 'Supabase execute SQL capability' },
    handler: debugUserContextHandler,
  },
  {
    command_path: ['debug', 'entitlement-override'],
    summary: 'Create a short-lived request-scoped entitlement parity assertion.',
    when_to_use: 'Use to reproduce a reference user’s plan gates without modifying any user or team row.',
    args_schema: {
      arguments: [{ token: '<reference-user>', key: 'referenceUser', description: 'Reference user UUID or primary email.' }],
      options: [
        { flags: '--ttl-seconds <n>', description: 'Lifetime from 30 to 900 seconds (default 600).' },
        { flags: '--actor-user <user>', description: 'Bind the assertion to this test actor (defaults to the authenticated CLI user).' },
      ],
    },
    examples: [
      'notis debug entitlement-override user@example.com --ttl-seconds 600',
      'notis debug entitlement-override user@example.com --actor-user <test-user-id> --ttl-seconds 600',
    ],
    output_schema: 'Returns a base64url request-scoped assertion for NOTIS_DEBUG_ENTITLEMENT_OVERRIDE.',
    mutates: false,
    idempotent: true,
    related_commands: ['notis debug user-context <user>', 'notis smoke file-upload --parity-user <user>'],
    backend_call: { type: 'tool', name: CREATE_DEBUG_ENTITLEMENT_OVERRIDE_TOOL },
    handler: debugEntitlementOverrideHandler,
  },
  {
    command_path: ['debug', 'trace-cost'],
    summary: 'Attribute latency, retries, failures, generations, and refundable cost for a trace.',
    when_to_use: 'Use when investigating looping, unexpectedly expensive, or failed Notis work.',
    args_schema: {
      arguments: [{ token: '<trace-or-interaction>', key: 'traceOrInteraction', description: 'Interaction UUID or Langfuse trace id.' }],
      options: [
        { flags: '--trace-file <path>', description: 'Optional exported trace JSON for generation and tool-failure attribution.' },
        { flags: '--confirmed-bug', description: 'Mark that evidence confirms a true Notis bug.' },
        { flags: '--attributable-cost <amount>', description: 'Cost attributed specifically to the confirmed bug.' },
      ],
    },
    examples: ['notis debug trace-cost trace_123 --trace-file trace.json --confirmed-bug --attributable-cost 9'],
    output_schema: 'Returns structured cost, latency, retry, generation, tool-failure, and refund-attribution data.',
    mutates: false,
    idempotent: true,
    related_commands: ['notis debug user-context <user>'],
    backend_call: { type: 'tool-discovery', name: 'Supabase execute SQL capability' },
    handler: debugTraceCostHandler,
  },
  {
    command_path: ['debug', 'worker-identity'],
    summary: 'Read the active backend worker identity.',
    when_to_use: 'Use to confirm which process, environment, build, and Supabase project handled a reproduction.',
    args_schema: { arguments: [], options: [] },
    examples: ['notis debug worker-identity --json'],
    output_schema: 'Returns process start time, environment, build SHA, process id, and Supabase project.',
    mutates: false,
    idempotent: true,
    require_auth: false,
    related_commands: ['notis doctor'],
    backend_call: { type: 'http', path: '/health' },
    handler: debugWorkerIdentityHandler,
  },
];
