import { randomUUID } from 'node:crypto';
import { CliError, EXIT_CODES, usageError } from '../runtime/errors.js';
import { callTool, httpRequest } from '../runtime/transport.js';

export const COMPOSIO_SEARCH_TOOLS = 'COMPOSIO_SEARCH_TOOLS';
export const COMPOSIO_GET_TOOL_SCHEMAS = 'COMPOSIO_GET_TOOL_SCHEMAS';
export const COMPOSIO_MULTI_EXECUTE_TOOL = 'COMPOSIO_MULTI_EXECUTE_TOOL';

const NOTIS_DATABASE_CORE_NAMES = new Set([
  'query',
  'get_database',
  'get_document',
  'list_databases',
  'upsert_database',
]);

function isNotisDatabaseCoreName(coreName) {
  // Mirrors server is_database_tool_name: canonical database ops plus generated
  // upsert_<db> tools. Database tools live in the NOTIS_DATABASE toolkit so their
  // public slug carries the DATABASE segment.
  return NOTIS_DATABASE_CORE_NAMES.has(coreName) || coreName.startsWith('upsert_');
}

export function localNotisToolSlug(toolName) {
  if (typeof toolName !== 'string' || !toolName.startsWith('notis-')) {
    return toolName;
  }
  const coreName = toolName.slice('notis-'.length);
  const prefix = isNotisDatabaseCoreName(coreName) ? 'LOCAL_NOTIS_DATABASE_' : 'LOCAL_NOTIS_';
  return `${prefix}${coreName.replace(/-/g, '_').toUpperCase()}`;
}

export function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw usageError(`${label} must be valid JSON`, { value });
  }
}

export function parseMaybeJson(value, label) {
  if (!value) {
    return undefined;
  }
  return parseJson(value, label);
}

export function nextIdempotencyKey(globalOptions) {
  return globalOptions.idempotencyKey || randomUUID();
}

export async function runToolCommand({
  runtime,
  toolName,
  arguments_ = {},
  mutating = false,
  idempotencyKey,
  fileBindings = [],
  sendIdempotencyKeyWhenReading = false,
}) {
  // The server owns effect classification and requires a key whenever *its*
  // metadata says write or unknown — a client-side `mutating: false` hint does
  // not exempt the call. Callers that knowingly dispatch through an
  // unknown-classified wrapper (e.g. COMPOSIO_MULTI_EXECUTE_TOOL) opt in so the
  // request carries a key instead of being rejected as idempotency_key_required.
  const result = await callTool({
    runtime: { ...runtime, mutating },
    toolName,
    arguments_,
    idempotencyKey: mutating || sendIdempotencyKeyWhenReading ? idempotencyKey : null,
    fileBindings,
  });
  return result;
}

export async function fetchToolkits(runtime) {
  const payload = await fetchToolDiscovery(runtime, 'List available toolkit namespaces and connection statuses');
  return (payload.toolkit_connection_statuses || []).map((entry) => ({
    id: entry.toolkit,
    provider: typeof entry.toolkit === 'string' ? entry.toolkit.split('-', 1)[0] : undefined,
    description: entry.description || entry.status_message || entry.toolkit,
    has_active_connection: Boolean(entry.has_active_connection),
    status_message: entry.status_message || '',
    connection_details: entry.connection_details || {},
  }));
}

export async function probeAuth(runtime) {
  return fetchToolDiscovery(runtime, 'List available toolkit namespaces and connection statuses');
}

export async function healthCheck(runtime) {
  return httpRequest({
    runtime,
    method: 'GET',
    path: '/health',
    requireAuth: false,
  });
}

export async function fetchToolSchema(runtime, toolName) {
  const result = await runToolCommand({
    runtime,
    toolName: COMPOSIO_GET_TOOL_SCHEMAS,
    arguments_: {
      tool_slugs: [toolName],
    },
  });
  const payload = result.payload || {};
  const schema = (
    payload.tool_schemas?.[toolName] ||
    payload.schemas?.[toolName] ||
    payload.tools?.find?.((tool) => tool?.tool_slug === toolName || tool?.name === toolName)
  );
  if (!schema) {
    throw usageError(`Tool "${toolName}" not found.`);
  }
  return {
    name: toolName,
    toolkit_id: schema.toolkit,
    description: schema.description || '',
    parameters: schema.input_schema || { type: 'object', properties: {} },
    output_schema: schema.output_schema || {},
    schema_available: Boolean(
      schema.hasFullSchema
      || (schema.input_schema && typeof schema.input_schema === 'object'),
    ),
  };
}

export async function fetchToolDiscovery(runtime, useCase, knownFields = '') {
  const query = { use_case: useCase };
  if (knownFields) {
    query.known_fields = knownFields;
  }
  const result = await runToolCommand({
    runtime,
    toolName: COMPOSIO_SEARCH_TOOLS,
    arguments_: {
      queries: [query],
    },
  });
  return result.payload || {};
}

export function validateArguments(schema, args) {
  const errors = [];
  if (!schema || schema.type !== 'object') return errors;

  const properties = schema.properties || {};
  const required = schema.required || [];

  for (const field of required) {
    if (!(field in args)) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!(key in properties)) {
        errors.push(`Unknown field: "${key}"`);
      }
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const prop = properties[key];
    if (!prop) continue;
    if (prop.type === 'string' && typeof value !== 'string') {
      errors.push(`Field "${key}" should be a string, got ${typeof value}`);
    }
    if (prop.type === 'integer' && !Number.isInteger(value)) {
      errors.push(`Field "${key}" should be an integer, got ${typeof value}`);
    }
    if (prop.type === 'array' && !Array.isArray(value)) {
      errors.push(`Field "${key}" should be an array, got ${typeof value}`);
    }
    if (prop.type === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
      errors.push(`Field "${key}" should be an object, got ${typeof value}`);
    }
  }

  return errors;
}

export function toolConflictToError(payload, defaultMessage) {
  return new CliError({
    code: 'conflict',
    message: payload?.error?.message || payload?.message || defaultMessage,
    exitCode: EXIT_CODES.conflict,
    details: payload || {},
    hints: payload?.hints || [],
  });
}
