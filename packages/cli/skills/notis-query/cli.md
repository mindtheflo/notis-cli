# Notis CLI — Database Tool Workflow

Use the generic `notis tools` workflow through NPX for native Notis Database operations from the terminal. The dedicated database command group has been removed.

## Setup

Sign into Notis Desktop or run `npx --package @notis_ai/cli@latest -- notis login` to authorize the CLI. Run commands through NPX, for example `npx --package @notis_ai/cli@latest -- notis tools search "list Notis databases"`.

For CI, hosted agents, or internal scripts, pass a non-persisted token with `NOTIS_JWT=<token>` and use `--api-base <server-url>` when targeting a non-default server.

## Canonical database tools

- `LOCAL_NOTIS_DATABASE_LIST_DATABASES` — list native databases.
- `LOCAL_NOTIS_DATABASE_GET_DATABASE` — inspect one database schema.
- `LOCAL_NOTIS_DATABASE_QUERY` — query native database documents.
- `LOCAL_NOTIS_DATABASE_UPSERT_DATABASE` — create or update database schema. Creation requires the owning app's slug or id in the `app` argument (every database belongs to a Notis app).

## Workflow

```bash
npx --package @notis_ai/cli@latest -- notis tools search "list Notis databases"
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_LIST_DATABASES --arguments '{}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_GET_DATABASE --get-schema
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_GET_DATABASE --arguments '{"database_slug":"tasks"}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --dry-run --arguments '{"database_slug":"tasks","query":{"page_size":10}}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --arguments '{"database_slug":"tasks","query":{"page_size":10}}'
```

## Supporting command

### `npx --package @notis_ai/cli@latest -- notis doctor`

Run a quick CLI health check for config, auth, and API reachability.

When to use: Use this before relying on the CLI in automation or after changing environments.

Examples:
- `npx --package @notis_ai/cli@latest -- notis doctor`
- `npx --package @notis_ai/cli@latest -- notis doctor --json`
