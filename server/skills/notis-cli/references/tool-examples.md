### Toolkit mental model

Typical toolkit namespaces include:

- `notis` for native Notis tools
- `composio-*` for Composio-backed integrations
- `mcp-*` for MCP-backed tools

The pattern is:

1. discover toolkits
2. search tools
3. inspect schema if needed
4. execute the canonical tool

### Tool access examples

Find a tool:

```bash
npx --package @notis_ai/cli@latest -- notis tools toolkits
npx --package @notis_ai/cli@latest -- notis tools search "list today's calendar events"
```

Inspect a tool before execution:

```bash
npx --package @notis_ai/cli@latest -- notis tools describe composio-googlecalendar-list_events
npx --package @notis_ai/cli@latest -- notis tools exec composio-googlecalendar-list_events --get-schema
```

Dry-run a tool call:

```bash
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_GET_DATABASE --dry-run --arguments '{"database_slug":"tasks"}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --dry-run --arguments '{"database_id":"tasks-db-id","query":{"page_size":10}}'
```

Execute a tool call:

```bash
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_GET_DATABASE --arguments '{"database_slug":"tasks"}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --arguments '{"database_id":"tasks-db-id","query":{"page_size":10}}'
```

Connect a missing toolkit:

```bash
npx --package @notis_ai/cli@latest -- notis tools link github
```

Reconnect a credential-based toolkit without putting the secret in shell history:

```bash
npx --package @notis_ai/cli@latest -- notis tools link dataforseo --reconnect --credentials - < credentials.json
```
