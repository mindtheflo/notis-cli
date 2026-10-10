---
name: notis-query
description: Discover native Notis databases and query their records with exact structured filters, current Space authority and view-qualified links.
feature_flag: spaces
mcp_resource: true
mcp_tool_patterns: ["LOCAL_NOTIS_DATABASE_*"]
mcp_references: ["references/database-discovery.md", "references/documents.md", "references/query.md"]
---

# Native database queries

Use structured native queries for filtering, sorting, counts, aggregates and
pagination. Use memory for semantic discovery; use view rendering for what a page
shows. The live tool `inputSchema` is authoritative.

1. Discover the database and inspect its schema, property descriptions, relation
   targets and option IDs with `LOCAL_NOTIS_DATABASE_GET_DATABASE`.
2. Keep its exact returned native `target`, schema revision and available operations.
   Every database lives in a Space; failed access never falls back to another owner.
3. Use `LOCAL_NOTIS_DATABASE_QUERY` with `protocol: 1`, that `target` and direct
   `input`. Build filters from actual field types/options. Page until the returned
   continuation ends; one page is not the whole database.
4. For a known record or view link, follow [Reading records](references/documents.md)
   instead of running broad discovery. View links come from write results or
   `LOCAL_NOTIS_FIND_VIEWS`; sensitive or stale evidence needs a fresh render.
5. Writes use discovered native tools with current schema/record revisions and a
   stable request ID. Dry-run first and read back the committed state. A missing
   view link is not a failed write and does not justify repeating it.

In authored Space code use `useShown` or declared actions, not account-wide tool
calls. Load `notis-apps` for [Space authoring](../notis-apps/references/views.md);
its hosted reference is `notis://docs/notis-apps/references/views.md`.

## Guides

- [Database discovery and creation](references/database-discovery.md)
- [Structured native query grammar](references/query.md)
- [Reading, updating and citing records](references/documents.md)

Hosted MCP exposes these references under
`notis://docs/notis-query/references/<file>.md`; load only the relevant guide.
