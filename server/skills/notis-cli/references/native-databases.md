## Native database access

Native Notis databases are accessed through the generic tool workflow, not a first-class database command group. Use these canonical tool names:

- `LOCAL_NOTIS_DATABASE_LIST_DATABASES` -- list databases accessible to the current profile
- `LOCAL_NOTIS_DATABASE_GET_DATABASE` -- inspect read-only metadata and schema detail
- `LOCAL_NOTIS_DATABASE_QUERY` -- query documents from a database
- `LOCAL_NOTIS_DATABASE_UPSERT_DATABASE` -- create or update a database schema. Every database belongs to a Notis app: creation requires the owning app's slug or id in the `app` argument (create the app first with `LOCAL_NOTIS_CREATE_APP` if needed)

Example workflow before building an app:

```bash
npx --package @notis_ai/cli@latest -- notis tools search "list Notis databases"
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_LIST_DATABASES --arguments '{}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_GET_DATABASE --get-schema
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_GET_DATABASE --arguments '{"database_slug":"social_media_calendar"}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --arguments '{"database_id":"social-media-calendar-db-id","query":{"page_size":1}}'
```

When `LOCAL_NOTIS_DATABASE_LIST_DATABASES` or `LOCAL_NOTIS_DATABASE_GET_DATABASE` returns a database ID, prefer `database_id` for `LOCAL_NOTIS_DATABASE_QUERY`; `database_slug` remains supported as a fallback.
