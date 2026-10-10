# View authoring

A view is the presentation of a Space. A record opens in a view; its database has
one main view. Words in links describe the destination, while IDs choose it.
Get links from write results or `LOCAL_NOTIS_FIND_VIEWS`, not by joining labels.

## Start from the collection scaffold

```bash
notis spaces init "Notes" ./notes --database-key notes --path notes
notis spaces build ./notes --space collection
```

`init` is local only. For an existing Space, pull its exact ID instead. Keep its
lock and local source key; one build/deploy changes that selected Space only.
A container has children but no page; page-only params/shows/memory belong on views.

## A complete view declaration

The linked `notes` resource below must already resolve to this installation's
native database. Descriptions explain what a person or agent can do here.

```ts
import { defineSpace } from '@notis/sdk/config';

export default defineSpace({
  specVersion: 2,
  name: 'Notes',
  path: 'notes',
  description: 'Browse notes and open one with its files.',
  readableContext: 'The note parameter opens one note. The list shows all notes available through this Space.',
  entry: './view.tsx',
  resources: { notes: { kind: 'database', key: 'notes' } },
  collection: { database: 'notes', titleProperty: 'title' },
  params: {
    note: { type: 'record', database: 'notes', main: true,
      description: 'The note to open beside the list.' },
  },
  shows: { notes: { database: 'notes', where: {}, open: 'note' } },
  memory: { markdown: true, attachments: true, screenshot: false, snapshots: [] },
  actions: {
    read: {
      tool: 'LOCAL_NOTIS_DATABASE_QUERY',
      inputs: { type: 'object', additionalProperties: false,
        required: ['request'], properties: { request: {
          type: 'object', additionalProperties: false,
          required: ['filter', 'page_size', 'include_content'],
          properties: {
            filter: { type: 'object', additionalProperties: false,
              required: ['field', 'op', 'value'], properties: {
                field: { type: 'object', additionalProperties: false,
                  required: ['column'], properties: { column: { const: 'record_key' } } },
                op: { const: 'equals' }, value: { type: 'string', format: 'uuid' },
              } },
            page_size: { const: 1 }, include_content: { const: true },
          },
        } } },
      arguments: { database_id: { $asset: 'notes' }, request: { $input: 'request' } },
    },
  },
});
```

Use `useViewParams<typeof definition>()`, `useShown('notes')`, and
`<DocumentPage recordKey={params.note}>` (the whole note page; use `DocumentEditor` only to embed a body
inside a layout of your own; if `spaces build` reports no `DocumentPage` export, your CLI predates it: use
`useNotisRuntime().ui?.DocumentPage` with a `DocumentEditor` fallback, see the SDK reference). Keep hooks unconditional; conditional
record/list branches can be separate components. The SDK reference covers the
components and exact navigation helpers. The saved `read` action is deliberately
constrained to one native record for body/Site reads; `shows.notes` owns the
Editor’s collection list. Keep both tied to the same declared resource.

## Params and declared lists

- Param types: `record`, `enum`, `text`, `number`, `date`, `boolean`. Each needs a
  description. Enum values and defaults are typed; a required param has no default.
- Record params name a declared database and have no default record. `main: true`
  claims that database's main view. `slugProperty` is a title/number property used
  for readable link text, not record identity.
- `path` is descriptive lowercase words, up to four slash-separated segments;
  do not put IDs, credentials or reserved product routes in it.
- `shows` for native data is `{database, where, open?}`. `where` is the native filter
  grammar and is what `useShown` executes, not commentary beside a different query.
  `open` names a record param over the same database.
- A project-scoped task list can use
  `{field: {property: 'Project'}, op: 'contains', value: '{project}'}` with a declared
  project record param. `{project.Status}` reads a property of that authorized record.
- For connected-service content use `{about, services?}` and declared actions.
  This descriptive form is not a native executable list; use `useAction` for reads.
- Preserve the application's real semantics and option names. For the existing
  Tasks migration, Inbox is **Project empty OR Status equals Inbox**. Keep imported
  rows, statuses and creation defaults; add the Inbox option only if absent. Its
  native filter is `{or: [{field: {property: 'Project'}, op: 'is_empty'},
  {field: {property: 'Status'}, op: 'equals', value: 'Inbox'}]}`. Other applications
  must use their own inspected schema rather than copying these labels blindly.

## Create a database in the same release

Replace an existing database reference with:

```ts
resources: {
  notes: { kind: 'database', create: {
    name: 'Notes',
    schema: {
      schema_version: 1, value_encoding_version: 1, coercion_version: 1,
      title_property_id: 'title', property_order: ['title'],
      properties: { title: { id: 'title', name: 'Name', kind: 'title',
        storage_family: 'textish', description: '', order: 0, config: {} } },
    },
  } },
},
```

The same view declares a record param over `notes` with `main: true`. Promotion
creates the database, link, main view, optional fictional `starterRows` and source
atomically; a later failure leaves none of them behind. Verification does not create
it. `create` is creation-only: later schema edits use native database tools;
`spaces pull` refreshes the declaration from the live schema.

The separate native schema-tool creation route requires `links.add` and
`main_view: {space_id, param}` in that linked Space. Until the Space next deploys
that main param, record links open the Space and writes return `view_warning`.
Inspect current tools for exact argument shapes; do not repeatedly insert rows
because a pending main view cannot yet open one.

## Rendering and memory

Choose [memory](memory.md) deliberately. `chrome: 'hidden'` is for full-screen
presentations such as the HTML Space; ordinary collection views keep Portal chrome.
A Space whose published view hides chrome starts hidden from each person's sidebar,
like Skill review Spaces; it stays reachable by link and search, and each person
can show it from the sidebar's hidden Spaces list or the Space's menu.
Optional `markdown: './markdown.ts'` names a module exporting a pure function of
`{params, shown}`. Its output must represent this view, not make hidden writes.
Use `<RenderChartData>` with the chart's actual rows so rendered Markdown contains
precise labels and values as well as its image.

Add synthetic action/list/body/record fixtures, then build and verify. Verification
and live rendering share the read-only renderer; fixture success does not prove
live permissions or data. After an authorized deploy, render the returned view link
with `notis views render` and inspect both the Markdown and full-height screenshot.
