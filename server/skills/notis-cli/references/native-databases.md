## Native database access

Native Notis databases are accessed through the generic tool workflow, not a first-class database command group. Use these canonical tool names:

- `LOCAL_NOTIS_DATABASE_LIST_DATABASES` -- list databases accessible to the current profile
- `LOCAL_NOTIS_DATABASE_GET_DATABASE` -- inspect read-only metadata and schema detail
- `LOCAL_NOTIS_DATABASE_QUERY` -- query documents from a database
- `LOCAL_NOTIS_DATABASE_UPSERT_DATABASE` -- create or update a database schema. A new database is linked to a Space in the same call (`links.add`) and names its main view; change a database used in Spaces through protocol 1 with its exact Space binding target
- `LOCAL_NOTIS_DATABASE_DELETE_DATABASE` -- permanently delete a database and all its rows by `database_id`. It is refused for every database a Space links (`database_linked_to_space`: move it instead; a database used only in one Space is deleted with that Space from the bin), for a legacy App database its App declares, and while another database relates to it or an automation is triggered by it; the error says what to remove first

Example workflow before building a Space view:

```bash
npx --package @notis_ai/cli@latest -- notis tools search "list Notis databases"
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_LIST_DATABASES --arguments '{}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_GET_DATABASE --get-schema
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_GET_DATABASE --arguments '{"database_id":"<id from LIST_DATABASES>"}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --arguments '{"protocol":1,"target":{"space_id":"<space id>","binding":"<binding id>"},"input":{"mode":"rows","page_size":1}}'
```

Most databases are used in Spaces. Such a database is read only through one of its links: `GET_DATABASE` with a bare `database_id` returns `resolved_target` (the main view's `{space_id, binding}`), and a bare-id `QUERY` answers `database_in_spaces` with every link. Reuse that exact target with `protocol: 1`. Every database lives in a Space; a `database_slug` resolves among every database you can reach, and a slug several of them share answers `database_slug_ambiguous` with each `database_id` and its Spaces.
