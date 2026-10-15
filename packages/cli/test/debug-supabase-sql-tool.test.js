import test from 'node:test';
import assert from 'node:assert/strict';

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
