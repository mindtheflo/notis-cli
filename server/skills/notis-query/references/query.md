# Structured native query grammar

Discover and inspect `LOCAL_NOTIS_DATABASE_QUERY`; use its current input schema.
For native Spaces use `protocol: 1`, the exact discovery `target`, and `input`.
The native query lives directly inside `input`, without another request/query wrapper.

```json
{
  "protocol": 1,
  "target": {"space_id": "<exact-discovered-space-id>", "binding": "<exact-discovered-binding-id>"},
  "input": {
    "mode": "rows",
    "filter": {"field": {"property": "Status"}, "op": "equals", "value": "Done"},
    "sorts": [{"field": {"column": "updated_at"}, "direction": "desc"}],
    "page_size": 20,
    "offset": 0,
    "include_content": false
  }
}
```

Use the complete Space binding target returned by schema discovery. Every
database lives in a Space: a bare `database_id` gets `resolved_target` from
`LOCAL_NOTIS_DATABASE_GET_DATABASE`, and a bare-id query answers
`database_in_spaces` with its links. Never remove its record context or substitute
another database/owner after a denial. `action_id`, when present, retains the
saved action's narrower authority rather than granting direct Editor access.

## Fields and filters

Choose one field reference: `{property_id}`, an unambiguous `{property}` label,
or a supported `{column}` such as `record_key`, `id`, `title`, `created_at`,
`updated_at`, `last_edited_time`, `content_type`, `file_type`. Current property
names take precedence; use stable IDs when names are ambiguous.

A condition is `{field, op, value}`. Empty checks (`is_empty`, `is_not_empty`)
omit `value`. Combine with `{and: [conditions]}` or `{or: [conditions]}`; groups
must be nonempty. Invalid conditions fail—they never become an unrestricted query.

| Type | Operators |
| --- | --- |
| Record identity | `equals`, `not_equals`, `in` |
| Text/title/URL | `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with`, empty checks |
| Number | `equals`, `not_equals`, `greater_than`, `less_than`, inclusive variants, empty checks |
| Checkbox | `equals`, `not_equals` with real booleans |
| Select/status | `equals`, `not_equals`, empty checks; use a current option ID or unambiguous label |
| Multi-select/relation | `contains`, `does_not_contain`, empty checks |
| Date | `equals`, `before`, `after`, `on_or_before`, `on_or_after`, empty checks; use ISO dates/timestamps |

A relation filter uses the related record identity returned by its native read,
not a guessed title. Do not encode a relation as a scalar text equality. Avoid
assuming every application uses the same status labels or Inbox semantics.

## Pagination and projection

Use bounded pages (1–500) and the returned continuation/offset until complete.
Native row results expose `rows`, stable `record_key`, revision and schema
metadata; do not assume the older `documents` result shape. Sorts use
`{field, direction: 'asc'|'desc'}`. Multi-select/relation fields cannot be sorted.

Use `include_content: false` for lists. Include bodies only when needed.
Archived rows are excluded unless `include_archived: true`; binned/inaccessible
rows remain excluded by authority. Do not turn a missing page into a zero count.

## Count, aggregate and search

- `mode: 'count'` applies the same authorized filter and returns its count.
- `mode: 'aggregate'` adds `aggregate: {op: 'sum'|'avg'|'min'|'max', field}` over
  a numeric field. It is computed within the same native scope.
- `mode: 'search'` adds `search: {text, fields: [field, ...]}` over supported text
  fields; this is structured native search, not semantic memory retrieval.
- For one current body, use `input: {mode: 'document_body', record_key}` with the
  exact body-capable target. The response includes Markdown and current revisions.

For visual dashboards or a link's selected params, resolve/render the view rather
than guessing that an independent query recreates its presentation or period.
