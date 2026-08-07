import { accessSync, constants as fsConstants, createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { usageError } from '../runtime/errors.js';
import {
  COMPOSIO_GET_TOOL_SCHEMAS,
  COMPOSIO_MULTI_EXECUTE_TOOL,
  COMPOSIO_SEARCH_TOOLS,
  fetchToolDiscovery,
  fetchToolkits,
  fetchToolSchema,
  localNotisToolSlug,
  nextIdempotencyKey,
  parseJson,
  parseMaybeJson,
  runToolCommand,
  validateArguments,
} from './helpers.js';

export async function resolveJsonInput(value, label) {
  if (!value) return undefined;

  if (value === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    return parseJson(Buffer.concat(chunks).toString('utf-8'), label);
  }

  if (value.startsWith('@')) {
    const filePath = value.slice(1);
    if (!existsSync(filePath)) {
      throw usageError(`File not found: ${filePath}`);
    }
    return parseJson(readFileSync(filePath, 'utf-8'), label);
  }

  return parseJson(value, label);
}

const READ_ACTIONS = new Set([
  'CHECK',
  'DESCRIBE',
  'DOWNLOAD',
  'FETCH',
  'FIND',
  'GET',
  'INSPECT',
  'LIST',
  'LOOKUP',
  'PREVIEW',
  'QUERY',
  'READ',
  'SEARCH',
  'STATUS',
  'VERIFY',
]);
const WRITE_ACTIONS = new Set([
  'AUTHENTIFY',
  'CANCEL',
  'CONNECT',
  'COPY',
  'CREATE',
  'DELETE',
  'DEPLOY',
  'DISCARD',
  'EDIT',
  'GRANT',
  'INCREMENT',
  'INSERT',
  'LINK',
  'MOVE',
  'POST',
  'PUBLISH',
  'REFUND',
  'REMOVE',
  'RENAME',
  'SAVE',
  'SEND',
  'SUBMIT',
  'UPDATE',
  'UPLOAD',
  'UPSERT',
]);

function splitSqlStatements(query) {
  const statements = [];
  let current = '';
  let quote = null;
  let dollarTag = null;
  for (let index = 0; index < query.length; index += 1) {
    const char = query[index];
    if (dollarTag) {
      if (query.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length - 1;
        dollarTag = null;
      } else {
        current += char;
      }
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) {
        if (query[index + 1] === quote) {
          current += query[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '$') {
      const match = query.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        index += dollarTag.length - 1;
        continue;
      }
    }
    if (char === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

function classifySqlMutation(query) {
  const statements = splitSqlStatements(query);
  if (statements.length > 1) {
    const classifications = statements.map(classifySqlMutation);
    if (classifications.includes(true)) return true;
    if (classifications.every((classification) => classification === false)) return false;
    return null;
  }
  const statement = statements[0] || '';
  if (statement) {
    const normalizedStatement = statement.toUpperCase();
    if (/^EXPLAIN\b/.test(normalizedStatement)) {
      const executes = /^EXPLAIN\s+(?:\([^)]*\bANALYZE\b[^)]*\)\s*|ANALYZE\s+)/.test(normalizedStatement);
      if (!executes) return false;
      return /\b(ALTER|CREATE|DELETE|DROP|GRANT|INSERT|MERGE|REVOKE|TRUNCATE|UPDATE)\b/.test(normalizedStatement);
    }
    if (/^SHOW\b/.test(normalizedStatement)) return false;
    // PostgreSQL SELECT can call side-effecting functions. Without catalog
    // knowledge it is not provably read-only, so preserve idempotency and report
    // an unknown classification instead of claiming mutating=false.
    if (/^SELECT\b/.test(normalizedStatement)) return null;
    if (/^WITH\b/.test(normalizedStatement)) {
      return /\b(ALTER|CREATE|DELETE|DROP|GRANT|INSERT|MERGE|REVOKE|TRUNCATE|UPDATE)\b/.test(normalizedStatement)
        ? true
        : null;
    }
    if (/^(ALTER|CREATE|DELETE|DROP|GRANT|INSERT|MERGE|REVOKE|TRUNCATE|UPDATE)\b/.test(normalizedStatement)) {
      return true;
    }
  }
  return null;
}

export function classifyToolMutation(toolName, args = {}) {
  const normalized = localNotisToolSlug(toolName).toUpperCase();
  if (normalized.includes('EXECUTE_SQL') && typeof args.query === 'string') {
    const query = args.query
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\n]*/g, ' ')
      .trim();
    const sqlClassification = classifySqlMutation(query);
    if (sqlClassification !== null) return sqlClassification;
  }
  if (/(?:^|_)(?:FIND|GET|LOOKUP|SEARCH)_OR_(?:CREATE|INSERT|SAVE|UPDATE|UPSERT)(?:_|$)/.test(normalized)) {
    return true;
  }
  const tokens = normalized.split(/[^A-Z0-9]+/).filter(Boolean);
  for (const token of tokens) {
    if (WRITE_ACTIONS.has(token)) return true;
    if (READ_ACTIONS.has(token)) return false;
  }
  return null;
}

const LONG_RUNNING_TOOL_TIMEOUT_MS = 600000;
const LONG_RUNNING_TOOL_NAMES = new Set([
  'LOCAL_NOTIS_GENERATE_IMAGE_OPENAI',
  'LOCAL_NOTIS_EDIT_IMAGE_OPENAI',
  'LOCAL_NOTIS_GENERATE_IMAGE_GEMINI',
  'LOCAL_NOTIS_EDIT_IMAGE_GEMINI',
]);

const EXTENSION_CONTENT_TYPES = new Map([
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.txt', 'text/plain'],
  ['.csv', 'text/csv'],
  ['.json', 'application/json'],
  ['.md', 'text/markdown'],
]);

function guessContentType(filePath) {
  const lower = filePath.toLowerCase();
  const dotIndex = lower.lastIndexOf('.');
  if (dotIndex === -1) return 'application/octet-stream';
  return EXTENSION_CONTENT_TYPES.get(lower.slice(dotIndex)) || 'application/octet-stream';
}

export async function hashFileSha256(localPath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(localPath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function parseFileBindingSpec(spec, index) {
  if (typeof spec !== 'string' || !spec.trim()) {
    throw usageError('--file must be formatted as <argument-path>=<local-path>');
  }

  const equalsIndex = spec.indexOf('=');
  if (equalsIndex <= 0 || equalsIndex === spec.length - 1) {
    throw usageError('--file must be formatted as <argument-path>=<local-path>');
  }

  const argumentPath = spec.slice(0, equalsIndex).trim();
  const localPath = spec.slice(equalsIndex + 1).trim();
  if (!argumentPath) {
    throw usageError('--file argument path is required');
  }
  if (!localPath) {
    throw usageError('--file local path is required');
  }
  if (!existsSync(localPath)) {
    throw usageError(`File not found: ${localPath}`);
  }

  let stats;
  try {
    stats = statSync(localPath);
    accessSync(localPath, fsConstants.R_OK);
  } catch {
    throw usageError(`File is not readable: ${localPath}`);
  }
  if (!stats.isFile()) {
    throw usageError(`File is not a regular file: ${localPath}`);
  }

  const sha256 = await hashFileSha256(localPath);
  const fileBasename = basename(localPath);
  const fieldName = `file_${index}`;

  return {
    argument_path: argumentPath,
    field_name: fieldName,
    basename: fileBasename,
    size: stats.size,
    sha256,
    contentType: guessContentType(fileBasename),
    localPath,
  };
}

export async function parseFileBindings(rawFileOptions) {
  const values = Array.isArray(rawFileOptions)
    ? rawFileOptions
    : (rawFileOptions ? [rawFileOptions] : []);
  return Promise.all(values.map((value, index) => parseFileBindingSpec(value, index)));
}

function ensureLongRunningToolTimeout(ctx, toolNames) {
  const names = Array.isArray(toolNames) ? toolNames : [toolNames];
  if (!names.some((name) => LONG_RUNNING_TOOL_NAMES.has(localNotisToolSlug(name)))) {
    return;
  }
  ctx.runtime.timeoutMs = Math.max(ctx.runtime.timeoutMs || 0, LONG_RUNNING_TOOL_TIMEOUT_MS);
}

async function toolsToolkitsHandler(ctx) {
  const toolkits = await fetchToolkits(ctx.runtime);
  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: { toolkits },
    humanSummary: `Found ${toolkits.length} toolkits`,
    hints: [
      { command: 'notis tools search <query>', reason: 'Search canonical tools and schemas' },
    ],
    renderHuman: () =>
      toolkits
        .map((entry) => {
          const status = entry.has_active_connection ? 'connected' : 'needs auth';
          return `${entry.id}  ${status}  ${entry.description}`;
        })
        .join('\n'),
  });
}

function discoveryToolRows(payload) {
  const schemas = payload.tool_schemas || {};
  const statuses = new Map(
    (payload.toolkit_connection_statuses || [])
      .filter((entry) => entry && typeof entry.toolkit === 'string')
      .map((entry) => [entry.toolkit, entry])
  );
  const seen = new Set();
  const rows = [];
  for (const result of payload.results || []) {
    for (const name of [...(result.primary_tool_slugs || []), ...(result.related_tool_slugs || [])]) {
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const schema = schemas[name] || {};
      const toolkit = schema.toolkit || name.split('-').slice(0, -1).join('-');
      const status = statuses.get(toolkit);
      rows.push({
        name,
        toolkit,
        description: schema.description || '',
        schema_available: Boolean(schemas[name]),
        connection_status: status
          ? (status.has_active_connection ? 'connected' : 'needs auth')
          : 'unknown',
      });
    }
  }
  return rows;
}

async function toolsSearchHandler(ctx) {
  const payload = await fetchToolDiscovery(ctx.runtime, ctx.args.query || 'Find tools', ctx.options.knownFields || '');
  const tools = discoveryToolRows(payload);
  const firstTool = tools[0];
  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: payload,
    humanSummary: `Found ${tools.length} tools`,
    hints: firstTool
      ? [
          { command: `notis tools exec ${firstTool.name} --get-schema`, reason: 'Inspect the parameter schema' },
          { command: `notis tools exec ${firstTool.name} --arguments '{}'`, reason: 'Execute the tool' },
        ]
      : [],
    renderHuman: () =>
      tools
        .map((tool) => `${tool.name}\n  toolkit: ${tool.toolkit || 'unknown'} (${tool.connection_status})\n  schema: ${tool.schema_available ? 'available' : 'missing'}\n  ${tool.description || 'No description'}\n`)
        .join('\n')
        .trim(),
  });
}

async function toolsDescribeHandler(ctx) {
  const requestedToolName = localNotisToolSlug(ctx.args.toolName);
  const match = await fetchToolSchema(ctx.runtime, requestedToolName);

  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: { tool: match },
    humanSummary: `Described tool ${requestedToolName}`,
    hints: [
      { command: `notis tools exec ${requestedToolName} --dry-run --arguments '{}'`, reason: 'Validate arguments first' },
      { command: `notis tools exec ${requestedToolName} --arguments '{}'`, reason: 'Execute this tool' },
    ],
    renderHuman: () => JSON.stringify(match, null, 2),
  });
}

async function toolsExecHandler(ctx) {
  const requestedToolName = localNotisToolSlug(ctx.args.toolName);
  let targetMutating = classifyToolMutation(requestedToolName);
  ensureLongRunningToolTimeout(ctx, requestedToolName);
  ctx.output.emitProgress({
    phase: 'prepare',
    message: `Resolving ${requestedToolName}`,
  });
  const fileBindings = await parseFileBindings(ctx.options.file);

  if (ctx.options.getSchema) {
    const tool = await fetchToolSchema(ctx.runtime, requestedToolName);
    return ctx.output.emitSuccess({
      command: ctx.spec.command_path.join(' '),
      data: { tool },
      humanSummary: `Schema for ${requestedToolName}`,
      hints: [
        { command: `notis tools exec ${requestedToolName} --dry-run --arguments '{}'`, reason: 'Validate arguments before executing' },
      ],
      renderHuman: () => JSON.stringify(tool, null, 2),
    });
  }

  if (ctx.options.argumentsFile && ctx.options.arguments) {
    throw usageError('Use either --arguments or --arguments-file, not both.');
  }
  const rawArguments = ctx.options.argumentsFile
    ? `@${ctx.options.argumentsFile}`
    : (ctx.options.arguments || '{}');
  const args = rawArguments === '-' || rawArguments.startsWith('@')
    ? await resolveJsonInput(rawArguments, 'arguments') || {}
    : parseMaybeJson(rawArguments, 'arguments') || {};
  targetMutating = classifyToolMutation(requestedToolName, args);

  if (ctx.options.dryRun) {
    if (fileBindings.length) {
      throw usageError('--file is only supported when executing a tool, not with --dry-run');
    }
    const tool = await fetchToolSchema(ctx.runtime, requestedToolName);
    const errors = validateArguments(tool.parameters, args);

    if (errors.length) {
      return ctx.output.emitSuccess({
        command: ctx.spec.command_path.join(' '),
        data: { valid: false, errors, tool: requestedToolName },
        humanSummary: `Dry run failed: ${errors.length} validation error(s)`,
        hints: [
          { command: `notis tools exec ${requestedToolName} --get-schema`, reason: 'Review the full parameter schema' },
        ],
        renderHuman: () => errors.map((e) => `  - ${e}`).join('\n'),
      });
    }

    return ctx.output.emitSuccess({
      command: ctx.spec.command_path.join(' '),
      data: { valid: true, tool: requestedToolName, arguments: args },
      humanSummary: `Dry run passed for ${requestedToolName}`,
      hints: [
        { command: `notis tools exec ${requestedToolName} --arguments '${JSON.stringify(args)}'`, reason: 'Execute with these arguments' },
      ],
    });
  }

  const idempotencyKey = nextIdempotencyKey(ctx.globalOptions);
  ctx.output.emitProgress({
    phase: 'execute',
    message: `Calling ${requestedToolName}`,
  });

  const result = await runToolCommand({
    runtime: ctx.runtime,
    toolName: COMPOSIO_MULTI_EXECUTE_TOOL,
    arguments_: {
      tools: [{ tool_slug: requestedToolName, arguments: args }],
    },
    // The server is authoritative about provider/MCP effects. A tool name that
    // looks like a read is not proof of read-only behavior, so generic
    // executions always carry a key and use mutation-safe transport retries.
    // Proven reads are still executed in the read lane by hosted MCP.
    mutating: true,
    idempotencyKey,
    fileBindings,
  });
  ctx.output.emitProgress({
    phase: 'complete',
    message: `Finished ${requestedToolName}`,
    requestId: result.requestId,
  });

  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: result.payload,
    humanSummary: `Executed tool ${requestedToolName}`,
    requestId: result.requestId,
    meta: {
      mutating: targetMutating,
      mutation_classification: targetMutating === null ? 'unknown' : 'name_hint_only',
      idempotency_key: idempotencyKey,
    },
    renderHuman: () => JSON.stringify(result.payload, null, 2),
  });
}

async function toolsExecParallelHandler(ctx) {
  const parallelFileBindings = await parseFileBindings(ctx.options.file);
  if (parallelFileBindings.length) {
    throw usageError('--file is supported by `notis tools exec` only; exec-parallel accepts JSON calls without file uploads.');
  }
  const calls = parseMaybeJson(ctx.args.calls, 'calls');
  if (!Array.isArray(calls) || !calls.length) {
    throw usageError('calls must be a non-empty JSON array of {tool_name, arguments} objects');
  }

  for (const [i, call] of calls.entries()) {
    if (!call.tool_name || typeof call.tool_name !== 'string') {
      throw usageError(`calls[${i}] missing required "tool_name" string`);
    }
  }
  ensureLongRunningToolTimeout(ctx, calls.map((call) => localNotisToolSlug(call.tool_name)));

  const data = await Promise.all(
    calls.map((call) =>
      runToolCommand({
        runtime: ctx.runtime,
        toolName: COMPOSIO_MULTI_EXECUTE_TOOL,
        arguments_: {
          tools: [{ tool_slug: localNotisToolSlug(call.tool_name), arguments: call.arguments || {} }],
        },
        mutating: true,
        idempotencyKey: nextIdempotencyKey(ctx.globalOptions),
      })
        .then((r) => ({ tool_name: call.tool_name, status: 'ok', payload: r.payload }))
        .catch((e) => ({ tool_name: call.tool_name, status: 'error', error: e.message }))
    )
  );

  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: { results: data },
    humanSummary: `Executed ${calls.length} tools in parallel`,
    meta: { mutating: true },
    renderHuman: () => data.map((r) => `${r.tool_name}: ${r.status}`).join('\n'),
  });
}

async function toolsLinkHandler(ctx) {
  const credentials = ctx.options.credentials
    ? await resolveJsonInput(ctx.options.credentials, 'credentials')
    : undefined;
  if (credentials !== undefined && (typeof credentials !== 'object' || credentials === null || Array.isArray(credentials))) {
    throw usageError('credentials must be a JSON object');
  }

  const arguments_ = {
    toolkit: ctx.args.toolkit,
    ...(ctx.options.reconnect ? { reconnect: true } : {}),
    ...(ctx.options.connectionId ? { reconnect_connection_id: ctx.options.connectionId } : {}),
    ...(ctx.options.label ? { label: ctx.options.label } : {}),
    ...(credentials ? { credentials } : {}),
  };
  const idempotencyKey = nextIdempotencyKey(ctx.globalOptions);
  const result = await runToolCommand({
    runtime: ctx.runtime,
    toolName: 'LOCAL_NOTIS_AUTHENTIFY',
    arguments_,
    mutating: true,
    idempotencyKey,
  });
  const payload = result.payload || {};
  if (payload.status === 'error') {
    throw usageError(payload.message || `Failed to connect ${ctx.args.toolkit}`, payload);
  }
  const authUrl = payload.redirect_url || payload.integrations_url || payload.url || null;

  return ctx.output.emitSuccess({
    command: ctx.spec.command_path.join(' '),
    data: {
      ...payload,
      auth_url: authUrl,
    },
    humanSummary: ctx.options.reconnect
      ? `Reconnected ${ctx.args.toolkit}`
      : `Started connection for ${ctx.args.toolkit}`,
    hints: [
      { command: 'notis tools toolkits', reason: 'Verify the toolkit is connected after setup' },
    ],
    meta: { mutating: true, idempotency_key: idempotencyKey },
    renderHuman: () => JSON.stringify({ ...payload, auth_url: authUrl }, null, 2),
  });
}

export const toolsCommandSpecs = [
  {
    command_path: ['tools', 'toolkits'],
    summary: 'List toolkit namespaces and connection statuses available to the active user.',
    when_to_use: 'Use this to inspect connection state before searching or executing generic tools.',
    args_schema: { arguments: [], options: [] },
    examples: ['notis tools toolkits', 'notis tools toolkits --json'],
    output_schema: 'Returns toolkit_connection_statuses from COMPOSIO_SEARCH_TOOLS, rendered as toolkit rows.',
    mutates: false,
    idempotent: true,
    related_commands: ['notis tools search <query>', 'notis tools describe <tool-name>'],
    backend_call: { type: 'tool', name: COMPOSIO_SEARCH_TOOLS },
    handler: toolsToolkitsHandler,
  },
  {
    command_path: ['tools', 'search'],
    summary: 'Search across toolkit namespaces using natural language.',
    when_to_use: 'Use this when you need a generic capability that does not have a first-class CLI command.',
    args_schema: {
      arguments: [{ token: '<query>', description: 'Natural language description of the tool you need.' }],
      options: [{ flags: '--known-fields <text>', key: 'knownFields', description: 'Optional known field hints, such as channel_name:general or user_email:a@example.com.' }],
    },
    examples: ['notis tools search "send an email"', 'notis tools search "post on LinkedIn" --known-fields "platform:linkedin"'],
    output_schema: 'Returns the full COMPOSIO_SEARCH_TOOLS response. Human output renders canonical names, connection status, and schema availability.',
    mutates: false,
    idempotent: true,
    related_commands: ['notis tools toolkits', 'notis tools exec <tool-name>'],
    backend_call: { type: 'tool', name: COMPOSIO_SEARCH_TOOLS },
    handler: toolsSearchHandler,
  },
  {
    command_path: ['tools', 'describe'],
    summary: 'Describe a generic tool by name.',
    when_to_use: 'Use this when you know the tool name and want its parameter schema before execution.',
    args_schema: {
      arguments: [{ token: '<tool-name>', description: 'Exact tool name to locate and describe.' }],
      options: [],
    },
    examples: ['notis tools describe composio-gmail-send_email', 'notis tools describe LOCAL_NOTIS_DATABASE_QUERY'],
    output_schema: 'Returns one tool descriptor with name, description, and parameters.',
    mutates: false,
    idempotent: true,
    related_commands: ['notis tools search <query>', 'notis tools exec <tool-name>'],
    backend_call: { type: 'tool', name: COMPOSIO_GET_TOOL_SCHEMAS },
    handler: toolsDescribeHandler,
  },
  {
    command_path: ['tools', 'exec'],
    summary: 'Execute a generic tool by canonical tool name.',
    when_to_use: 'Use this as the escape hatch for integrations or Notis tools without a first-class CLI wrapper.',
    args_schema: {
      arguments: [{ token: '<tool-name>', description: 'Tool name returned by `notis tools search`.' }],
      options: [
        { flags: '--arguments <json>', description: 'JSON object, @file path, or - for stdin.' },
        { flags: '--arguments-file <path>', description: 'Read the JSON arguments object from a file.' },
        { flags: '--file <argument-path=local-path>', description: 'Upload a local file into a file-uploadable tool argument. Repeatable.', collect: true },
        { flags: '--get-schema', description: 'Display the tool parameter schema without executing.' },
        { flags: '--dry-run', description: 'Validate arguments against the tool schema without executing.' },
      ],
    },
    examples: [
      'notis tools exec LOCAL_NOTIS_DATABASE_QUERY --arguments \'{"database_slug":"tasks","query":{}}\'',
      'notis tools exec LOCAL_NOTIS_DATABASE_GET_DATABASE --arguments \'{"database_slug":"tasks"}\'',
      'notis tools exec LOCAL_NOTIS_DATABASE_QUERY --get-schema',
      'notis tools exec LOCAL_NOTIS_DATABASE_QUERY --dry-run --arguments \'{"database_slug":"tasks","query":{}}\'',
      'notis tools exec LOCAL_NOTIS_DATABASE_QUERY --arguments @query.json',
      'notis tools exec LOCAL_NOTIS_DATABASE_QUERY --arguments-file query.json',
      'notis tools exec LOCAL_NOTIS_DATABASE_QUERY --arguments - < query.json',
      'notis tools exec composio-dropbox-upload_file --arguments \'{"path":"/target/in/dropbox.pdf"}\' --file content=./Invoice.pdf',
    ],
    output_schema: 'Returns the raw tool execution payload.',
    mutates: true,
    idempotent: true,
    related_commands: ['notis tools search <query>', 'notis tools describe <tool-name>', 'notis tools exec-parallel <calls>'],
    backend_call: { type: 'tool', name: COMPOSIO_MULTI_EXECUTE_TOOL },
    handler: toolsExecHandler,
  },
  {
    command_path: ['tools', 'exec-parallel'],
    summary: 'Execute multiple tools concurrently.',
    when_to_use: 'Use this when you need to run independent tool calls simultaneously for speed.',
    args_schema: {
      arguments: [
        { token: '<calls>', description: 'JSON array of {tool_name, arguments} objects.' },
      ],
      options: [
        { flags: '--file <argument-path=local-path>', description: 'Unsupported for exec-parallel; use tools exec for file uploads.', collect: true },
      ],
    },
    examples: [
      'notis tools exec-parallel \'[{"tool_name":"LOCAL_NOTIS_DATABASE_QUERY","arguments":{"database_slug":"tasks","query":{}}},{"tool_name":"LOCAL_NOTIS_DATABASE_LIST_DATABASES","arguments":{}}]\'',
    ],
    output_schema: 'Returns an array of results, one per tool call.',
    mutates: true,
    idempotent: true,
    related_commands: ['notis tools exec <tool-name>', 'notis tools search <query>'],
    backend_call: { type: 'tool', name: COMPOSIO_MULTI_EXECUTE_TOOL },
    handler: toolsExecParallelHandler,
  },
  {
    command_path: ['tools', 'link'],
    summary: 'Connect or reconnect an integration toolkit.',
    when_to_use: 'Use this when a tool requires authentication or an active connection must be replaced.',
    args_schema: {
      arguments: [{ token: '<toolkit>', description: 'Toolkit name to connect (e.g. github, gmail, slack).' }],
      options: [
        { flags: '--reconnect', description: 'Replace the existing account instead of adding another connection.' },
        { flags: '--connection-id <id>', key: 'connectionId', description: 'Exact connection id to replace when multiple accounts exist.' },
        { flags: '--label <label>', description: 'Account label for a new or replacement connection.' },
        { flags: '--credentials <json>', description: 'Credential JSON object, @file path, or - for stdin. Prefer stdin so secrets do not enter shell history.' },
      ],
    },
    examples: [
      'notis tools link github',
      'notis tools link dataforseo --reconnect --credentials - < credentials.json',
    ],
    output_schema: 'Returns the connection result and an authentication URL when provider authorization is still required.',
    mutates: true,
    idempotent: false,
    require_auth: true,
    related_commands: ['notis tools toolkits', 'notis tools search <query>'],
    backend_call: { type: 'tool', name: 'LOCAL_NOTIS_AUTHENTIFY' },
    handler: toolsLinkHandler,
  },
];
