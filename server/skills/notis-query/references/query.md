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
