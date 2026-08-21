---
name: notis-query
description: Use when agents need to query native Notis databases with direct structured filters, sorts, and pagination through `LOCAL_NOTIS_DATABASE_QUERY`.
feature_flag: store
mcp_resource: true
mcp_tool_patterns: ["LOCAL_NOTIS_DATABASE_*"]
---

# Notis Query Skill

Use this skill when the user wants to search, filter, sort, or page through records in a native Notis database and the task is best handled with structured criteria instead of semantic search.

This skill is the single source of truth for `LOCAL_NOTIS_DATABASE_QUERY`.

## Canonical contract source

For custom view runtime usage, the canonical contract is always MCP `tools/list` `inputSchema` for `LOCAL_NOTIS_DATABASE_QUERY`.

- Use `notisView.listTools()` (or MCP `tools/list`) to read the live schema.
- Use `notisView.callTool("LOCAL_NOTIS_DATABASE_QUERY", args)` (or MCP `tools/call`) with arguments that match that schema exactly.
- If this skill text and `inputSchema` ever differ, follow `inputSchema`.

This keeps query arguments aligned with the same tool definitions used by agent runtime and avoids maintaining duplicate schema formats.

## When to use `LOCAL_NOTIS_DATABASE_QUERY`

Use `LOCAL_NOTIS_DATABASE_QUERY` when:

- you already know the target native database
- the user wants structured filtering or sorting
- you need predictable pagination over database rows
- you need to find records before reading or updating a specific document
- you need to find matching records before calling `LOCAL_NOTIS_DATABASE_GET_DOCUMENT` or a generated database upsert tool
- the task should use direct database criteria instead of semantic memory search

Do not use `LOCAL_NOTIS_DATABASE_QUERY` when:

- the relevant database is unknown
- semantic search over broad workspace context is better
- the task points to one known document by `document_id` or portal URL

Use these tools together:

- `LOCAL_NOTIS_DATABASE_LIST_DATABASES` to discover available databases and confirm the slug
- `LOCAL_NOTIS_DATABASE_GET_DATABASE` to inspect read-only schema detail, ordered properties, options, and relation targets
- `LOCAL_NOTIS_DATABASE_QUERY` to find matching records
- `LOCAL_NOTIS_DATABASE_GET_DOCUMENT` to inspect one specific matching document in full
- generated database upsert tools to update or create records after you know the right document or relation IDs

Follow the same workflow and use the exact canonical tool names available in the current runtime.

## Native Database Workflow

### Listing databases

Use `LOCAL_NOTIS_DATABASE_LIST_DATABASES` (`notis_list_databases` in legacy
underscore-form references) when:

- you need to confirm which native databases exist
- you need the database ID or slug before querying or choosing an upsert tool
- you need database metadata such as name, description, or document counts
- the orchestrator asks what is available in the user's workspace

Always inspect the user's native Notis databases before creating schema updates or choosing where to save work.

### Creating databases

Use `LOCAL_NOTIS_DATABASE_UPSERT_DATABASE` (`notis_upsert_database` in legacy
underscore-form references) to create or update native databases.

Every native database must belong to a Notis app. When creating a database,
pass the owning app's slug or id in the `app` field; if the user has no
suitable app yet, create one first with `LOCAL_NOTIS_CREATE_APP`. Updates do
not need the `app` field.

Define schemas with appropriate property types:

- `title`
- `rich_text`
- `select`
- `multi_select`
- `status`
- `checkbox`
- `date`
- `number`
- `url`
- `email`
- `phone_number`
- `relation`

When adding or updating a `relation` property, always pass the target database explicitly with `database_id`. Do not rely on description text to imply the relation target.

Example relation update:

```json
{
  "operation": "update",
  "database_id": "tasks-db-id",
  "properties": [
    {
      "property_id": "prop_list",
      "name": "List",
      "action": "update",
      "type": "relation",
      "database_id": "lists-db-id",
      "description": "Relation to Lists"
    }
  ]
}
```

### Reading documents

Use `LOCAL_NOTIS_DATABASE_GET_DOCUMENT` when:

- the task references a specific document by `document_id` or portal URL
- detailed content from a known document is needed

You may pass either a `document_id` or a portal URL such as `https://app.notis.ai/documents/abc123` or `/documents/abc123`.

## Native Document Handling

### Response requirements

- Always include the document title, database name, and a markdown portal link for any document you create or update.
- Never expose a raw `document_id` in your completion summary unless the user explicitly asked for it.
- Clearly state whether the document was created or updated.
- For updates, clearly state whether you replaced the original content or appended to the end.

### Upserting with relations

When upserting into a database that relates to another database, first query for the related record and use the returned `document_id` for the relation.

### Upserting complex documents

For copywriting-style work such as articles or social posts, try to find similar writing by the user and match the user's style and tone.

### Updating a document

1. Retrieve the current content with `LOCAL_NOTIS_DATABASE_GET_DOCUMENT`, `LOCAL_NOTIS_DATABASE_QUERY`, or `LOCAL_NOTIS_SEARCH_MEMORIES` with `memory_kind="native_document"`.
2. Use the relevant `LOCAL_NOTIS_DATABASE_UPSERT_<DATABASE_SLUG>` tool with the existing `document_id` so the document is updated instead of recreated.
3. For local edits to an existing document such as appending a bullet, inserting a paragraph, changing one section, or preserving structure, use `edit_mode = "block_operations"` instead of rewriting markdown.
4. When developer context includes a `<page_context ... resource_type="document" ...>` tag, treat that as the currently open document and fetch it before asking the user for any identifier again.

### Default upsert preferences

As long as they do not conflict with the user's intent, the existing document style, or the tool contract:

- Prefer updating existing documents over creating new ones when the user asked for a modification.
- Use `replace = true` to replace content and `replace = false` to append when you are in markdown mode.
- When the user asked to append, insert, tweak, or preserve the rest of an existing document, prefer `block_operations` with `insert_blocks`, `update_block`, `replace_blocks`, or `remove_blocks`.
- Do not use markdown rewrite mode for surgical edits unless block operations are genuinely impossible for the requested change.
- Reorganize messy thoughts into a clearer structure.
- Highlight essential concepts and extract action items.
- Format notes with markdown titles, subheadings, bold text, blockquotes, ordered lists, and unordered lists when helpful.
- Add useful insight, challenge weak reasoning, debunk false claims, or enrich the content when appropriate.
- Fill in missing information the user asked you to complete when the context supports it.
- Imitate the user's voice when you can infer it from semantic memory search with `memory_kind="native_document"` or existing document context.
- Save images in document content using standard markdown and in URL properties when relevant.
- Do not place videos inside document content. Store them only in media properties.
- Do not add a custom emoji or cover unless the user requested one.

## Supported execution mode

`LOCAL_NOTIS_DATABASE_QUERY` supports direct structured queries only.

Natural-language query generation is retired. Do not send free-form requests like "find overdue tasks from important clients"; build the structured `query` payload yourself.

## Request shape

```json
{
  "database_id": "tasks-db-id",
  "database_slug": "tasks",
  "query": {
    "filter": {
      "operator": "and",
      "conditions": [
        {
          "property": "Status",
          "type": "status",
          "operator": "equals",
          "value": "In Progress"
        }
      ]
    },
    "sorts": [
      {
        "property": "Due Date",
        "direction": "ascending"
      }
    ],
    "page_size": 20
  },
  "offset": 0
}
```

Top-level fields:

- One of `database_id` or `database_slug` is required.
- `database_id`: stable native database ID. Prefer this when it is available from database context, `list_databases`, or `get_database`.
- `database_slug`: native database slug. Use this when `database_id` is not available, or pass it alongside `database_id` as a fallback.
- `query`: required object
- `offset`: optional numeric pagination offset

When both `database_id` and `database_slug` are provided, they must identify the same database. If the ID is stale and no database is found by ID, the runtime may fall back to the slug.

`query` fields:

- `filter`: optional rule tree
- `sorts`: optional array of sort definitions
- `page_size`: optional integer page size

## Filter shape

```json
{
  "operator": "and",
  "conditions": [
    {
      "property": "Status",
      "type": "status",
      "operator": "equals",
      "value": "In Progress"
    },
    {
      "property": "Priority",
      "type": "select",
      "operator": "equals",
      "value": "High"
    }
  ]
}
```

Use nested groups when needed:

```json
{
  "operator": "or",
  "conditions": [
    {
      "property": "Status",
      "type": "status",
      "operator": "equals",
      "value": "Todo"
    },
    {
      "operator": "and",
      "conditions": [
        {
          "property": "Priority",
          "type": "select",
          "operator": "equals",
          "value": "High"
        },
        {
          "property": "Archived",
          "type": "checkbox",
          "operator": "equals",
          "value": false
        }
      ]
    }
  ]
}
```

## Supported property semantics

Use the real Notis property name and the correct property type.

### Title and rich text

Recommended operators:

- `contains`
- `equals`
- `not_equals`

Example:

```json
{
  "property": "Title",
  "type": "title",
  "operator": "contains",
  "value": "launch"
}
```

### Select and status

Recommended operators:

- `equals`
- `not_equals`
- `in`

Example:

```json
{
  "property": "Status",
  "type": "status",
  "operator": "equals",
  "value": "Done"
}
```

### Multi-select

Recommended operators:

- `contains`
- `not_contains`

Example:

```json
{
  "property": "Tags",
  "type": "multi_select",
  "operator": "contains",
  "value": "Urgent"
}
```

### Checkbox

Recommended operator:

- `equals`

Example:

```json
{
  "property": "Archived",
  "type": "checkbox",
  "operator": "equals",
  "value": false
}
```

### Number

Recommended operators:

- `equals`
- `not_equals`
- `greater_than`
- `greater_than_or_equal`
- `less_than`
- `less_than_or_equal`

Example:

```json
{
  "property": "Score",
  "type": "number",
  "operator": "greater_than_or_equal",
  "value": 80
}
```

### Date

Recommended operators:

- `equals`
- `before`
- `after`
- `on_or_before`
- `on_or_after`

Use ISO dates or timestamps depending on the property precision.

Example:

```json
{
  "property": "Due Date",
  "type": "date",
  "operator": "on_or_before",
  "value": "2026-03-31"
}
```

### Relation

Recommended operators:

- `contains`
- `not_contains`

Pass the related `document_id`, not the display title.

Example:

```json
{
  "property": "Project",
  "type": "relation",
  "operator": "contains",
  "value": "doc_project_123"
}
```

### Formula

Treat formula values according to the returned data type. In practice, use the matching operator family for the computed result:

- text-like formula: `contains` or `equals`
- number-like formula: numeric comparison operators
- boolean-like formula: `equals`

Only use formula filters when the formula property already exists in the schema.

## Sorts

Sort objects look like this:

```json
{
  "property": "Created At",
  "direction": "descending"
}
```

Recommended directions:

- `ascending`
- `descending`

Common sorts:

- title sorts for alphabetical browsing
- status then date sorts for workflow queues
- timestamp sorts such as `Created At`, `Updated At`, or `Last Edited Time`

Example:

```json
[
  {
    "property": "Last Edited Time",
    "direction": "descending"
  }
]
```

## Pagination

Use `page_size` to cap the number of results per call.

The response returns:

- `documents`
- `results_count`
- `has_more`
- `next_offset`
- `query`
- `complementary_instructions`

Pagination rules:

- start with `offset: 0` or omit it
- if `has_more` is true, call again with `offset: next_offset`

Example follow-up call:

```json
{
  "database_id": "tasks-db-id",
  "query": {
    "page_size": 25
  },
  "offset": 25
}
```

## Response shape

The result includes database rows in `documents`. Each document usually contains:

- `document_id`
- title-like display fields
- matching property values
- metadata helpful for follow-up reads or updates

Use `document_id` from the query response when you need to:

- fetch full content with `LOCAL_NOTIS_DATABASE_GET_DOCUMENT`
- update a record with a generated database upsert tool
- attach it to a relation field in another upsert

## Examples

### Title or rich text contains

```json
{
  "database_id": "notes-db-id",
  "query": {
    "filter": {
      "operator": "and",
      "conditions": [
        {
          "property": "Title",
          "type": "title",
          "operator": "contains",
          "value": "pricing"
        }
      ]
    },
    "page_size": 10
  }
}
```

### Select or status equals

```json
{
  "database_id": "tasks-db-id",
  "query": {
    "filter": {
      "operator": "and",
      "conditions": [
        {
          "property": "Status",
          "type": "status",
          "operator": "equals",
          "value": "In Progress"
        }
      ]
    }
  }
}
```

### Multi-select contains

```json
{
  "database_id": "content-db-id",
  "query": {
    "filter": {
      "operator": "and",
      "conditions": [
        {
          "property": "Tags",
          "type": "multi_select",
          "operator": "contains",
          "value": "Newsletter"
        }
      ]
    }
  }
}
```

### Checkbox equals

```json
{
  "database_id": "tasks-db-id",
  "query": {
    "filter": {
      "operator": "and",
      "conditions": [
        {
          "property": "Completed",
          "type": "checkbox",
          "operator": "equals",
          "value": true
        }
      ]
    }
  }
}
```

### Number comparison

```json
{
  "database_id": "deals-db-id",
  "query": {
    "filter": {
      "operator": "and",
      "conditions": [
        {
          "property": "Amount",
          "type": "number",
          "operator": "greater_than",
          "value": 10000
        }
      ]
    }
  }
}
```

### Date comparison

```json
{
  "database_id": "tasks-db-id",
  "query": {
    "filter": {
      "operator": "and",
      "conditions": [
        {
          "property": "Due Date",
          "type": "date",
          "operator": "on_or_after",
          "value": "2026-03-01"
        }
      ]
    },
    "sorts": [
      {
        "property": "Due Date",
        "direction": "ascending"
      }
    ]
  }
}
```

### Relation contains

```json
{
  "database_id": "tasks-db-id",
  "query": {
    "filter": {
      "operator": "and",
      "conditions": [
        {
          "property": "Project",
          "type": "relation",
          "operator": "contains",
          "value": "doc_project_123"
        }
      ]
    }
  }
}
```

### Timestamp sort

```json
{
  "database_id": "tasks-db-id",
  "query": {
    "sorts": [
      {
        "property": "Last Edited Time",
        "direction": "descending"
      }
    ],
    "page_size": 20
  }
}
```

### Pagination follow-up

First call:

```json
{
  "database_id": "tasks-db-id",
  "query": {
    "page_size": 20
  }
}
```

Second call after a response with `has_more: true` and `next_offset: 20`:

```json
{
  "database_id": "tasks-db-id",
  "query": {
    "page_size": 20
  },
  "offset": 20
}
```

## Practical workflow

1. Call `LOCAL_NOTIS_DATABASE_LIST_DATABASES` if you do not know the database ID yet.
2. Call `LOCAL_NOTIS_DATABASE_GET_DATABASE` if you need schema detail before building filters or relation payloads.
3. Call `LOCAL_NOTIS_DATABASE_QUERY` with `database_id` plus structured filters and sorts. Use `database_slug` only when the ID is not available.
4. If you need the full body of one row, call `LOCAL_NOTIS_DATABASE_GET_DOCUMENT` with the returned `document_id`.
5. If you need to update one of the matched rows, call the relevant generated database upsert tool with that `document_id`.
6. If you need a relation value, query the related database first and pass the resulting `document_id` into the upsert.
