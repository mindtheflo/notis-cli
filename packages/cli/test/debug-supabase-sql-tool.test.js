import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { selectSupabaseSqlTool } from '../src/command-specs/diagnostics.js';

test('discovered Notis App execute-SQL tool wins', () => {
  assert.equal(
    selectSupabaseSqlTool(['SUPABASE_MCP_EXECUTE_SQL', 'MCP_SUPABASE_NOTIS_APP_EXECUTE_SQL']),
    'MCP_SUPABASE_NOTIS_APP_EXECUTE_SQL',
  );
});

test('a connected custom Notis App toolkit is used when discovery misses it', () => {
  // Semantic discovery returns only Composio's generic Supabase tools.
  const discovered = ['SUPABASE_RUN_READ_ONLY_QUERY', 'SUPABASE_READ_MCP_EXECUTE_SQL'];
  const toolkits = [
    { id: 'custom_supabase_notis_website', has_active_connection: true },
    { id: 'custom_supabase_notis_app', has_active_connection: true },
  ];
  assert.equal(selectSupabaseSqlTool(discovered), null);
  assert.equal(selectSupabaseSqlTool(discovered, toolkits), 'CUSTOM_SUPABASE_NOTIS_APP_EXECUTE_SQL');
});

test('website and disconnected toolkits are never selected', () => {
  assert.equal(selectSupabaseSqlTool(['CUSTOM_SUPABASE_NOTIS_WEBSITE_EXECUTE_SQL'], [
    { id: 'custom_supabase_notis_website', has_active_connection: true },
    { id: 'custom_supabase_notis_app', has_active_connection: false },
  ]), null);
});

test('debug user-context resolves an App SQL tool from the toolkit inventory envelope', async (t) => {
  const requests = [];
  const sqlTool = 'CUSTOM_SUPABASE_NOTIS_APP_EXECUTE_SQL';
  const context = {
    user_id: 'diagnostic-user',
    primary_email: 'diagnostic@example.test',
    billing: { scope_type: 'TEAM', scope_id: 'team-fixture', sub_status: 'active' },
  };
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    let payload;
    if (body.tool_name === 'COMPOSIO_SEARCH_TOOLS') {
      payload = { results: [{ primary_tool_slugs: ['SUPABASE_RUN_READ_ONLY_QUERY'] }] };
    } else if (body.operation === 'toolkit_inventory') {
      payload = {
        success: true,
        toolkit_connection_statuses: [
          { toolkit: 'custom_supabase_notis_website', provider: 'custom_mcp', has_active_connection: true },
          { toolkit: 'custom_supabase_notis_app_disconnected', provider: 'custom_mcp', has_active_connection: false },
          { toolkit: 'custom_supabase_notis_app', provider: 'custom_mcp', has_active_connection: true },
        ],
        coverage: { complete: true, families: {} },
        warnings: [],
      };
    } else if (body.tool_name === 'COMPOSIO_GET_TOOL_SCHEMAS') {
      payload = { tool_schemas: { [sqlTool]: { input_schema: { type: 'object' } } } };
    } else if (body.tool_name === 'COMPOSIO_MULTI_EXECUTE_TOOL') {
      payload = { results: [{ response: { data: [{ context }] } }] };
    } else {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: 'Unexpected diagnostic request' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const home = await mkdtemp(join(tmpdir(), 'notis-debug-inventory-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = `${encode({ alg: 'none', typ: 'at+jwt' })}.${encode({ sub: context.user_id, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  const { stdout } = await promisify(execFile)(process.execPath, [
    new URL('../bin/notis.js', import.meta.url).pathname,
    '--api-base', `http://127.0.0.1:${server.address().port}`,
    'debug', 'user-context', 'diagnostic@example.test', '--json',
  ], {
    env: { PATH: process.env.PATH, HOME: home, NODE_ENV: 'test', NOTIS_JWT: jwt, NOTIS_TEST_DISABLE_WORKTREE_ROUTING: '1' },
  });
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.data.billing.scope_type, 'TEAM');
  assert.equal(result.meta.sql_tool, sqlTool);
  const execution = requests.find((request) => request.tool_name === 'COMPOSIO_MULTI_EXECUTE_TOOL');
  assert.equal(execution.arguments.tools[0].tool_slug, sqlTool);
  assert.match(execution.arguments.tools[0].arguments.query, /SELECT/);
  assert.ok(execution.idempotency_key);
  assert.equal(requests.length, 4);
});
