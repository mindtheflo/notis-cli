import Ajv from 'ajv';
import addFormats from 'ajv-formats';
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
  'upload_file',
  'delete_database',
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
  const payload = await probeAuth(runtime);
  const toolkits = payload.toolkit_connection_statuses.map((entry) => ({
    id: entry.toolkit,
    provider: entry.provider,
    description: entry.description || entry.status_message || entry.toolkit,
    has_active_connection: Boolean(entry.has_active_connection),
    status_message: entry.status_message || '',
    availability: entry.availability,
  }));
  return { toolkits, coverage: payload.coverage, warnings: payload.warnings };
}

export async function probeAuth(runtime) {
  const result = await httpRequest({ runtime, path: '/cli_tools', body: { operation: 'toolkit_inventory' } });
  const payload = result.payload;
  if (payload?.success !== true || !Array.isArray(payload.toolkit_connection_statuses)
      || typeof payload.coverage?.complete !== 'boolean'
      || !payload.coverage.families || typeof payload.coverage.families !== 'object'
      || Array.isArray(payload.coverage.families)
      || payload.toolkit_connection_statuses.some((row) => !row || typeof row.toolkit !== 'string' || !row.toolkit
        || typeof row.provider !== 'string' || !row.provider)) {
    throw new CliError({ code: 'invalid_toolkit_inventory', message: 'The server did not return a valid toolkit inventory.', exitCode: EXIT_CODES.backend });
  }
  return {
    ...payload,
    toolkit_connection_statuses: [...payload.toolkit_connection_statuses].sort((a, b) => a.toolkit.localeCompare(b.toolkit)),
    warnings: [...(Array.isArray(payload.warnings) ? payload.warnings.filter((v) => typeof v === 'string') : []),
      ...(!payload.coverage.complete ? ['Toolkit inventory is incomplete; some connections could not be checked.'] : [])],
  };
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

// Tool schemas are the dry-run contract, including nested branches and constraints.
const toolArgumentsAjv = new Ajv({
  allErrors: true, strict: false, strictSchema: true, strictNumbers: true, logger: false,
  coerceTypes: false, useDefaults: false, removeAdditional: false,
});
addFormats(toolArgumentsAjv);
// Native tool schemas mark uploadable fields with this annotation.
toolArgumentsAjv.addKeyword({ keyword: 'file_uploadable', schemaType: 'boolean', valid: true });

export function validateArguments(schema, args) {
  if (schema == null) return [];
  let validate;
  try {
    validate = toolArgumentsAjv.compile(schema);
  } catch {
    // A malformed or unsupported schema cannot establish a valid dry run.
    return ['Tool schema could not be validated; inspect the current schema.'];
  }
  if (validate(args)) return [];
  return (validate.errors || []).map((error) => {
    const path = error.instancePath ? ` at "${error.instancePath}"` : '';
    if (error.keyword === 'required') {
      return `Missing required field: "${error.params.missingProperty}"${path}`;
    }
    if (error.keyword === 'additionalProperties') {
      return `Unknown field: "${error.params.additionalProperty}"${path}`;
    }
    return `Invalid arguments${path}: ${error.message || error.keyword}`;
  });
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
