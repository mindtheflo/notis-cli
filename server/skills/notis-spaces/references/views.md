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

## Index the Space in the workspace

The root `notis.config.ts` maps each local Space key to an object with its
definition file. The value is not a path string or the definition itself:

```ts
import { defineSpaces } from '@notis/sdk/config';

export default defineSpaces({
  spaces: { notes: { definition: 'spaces/notes/space.config.ts' } },
});
```

That definition file exports `defineSpace`, as below; its `entry` is relative to
the definition file. `spaces init` creates this index for a new collection.
When writing a new source workspace through the confined source tools, include
the index and the definition before requesting a build.

## A complete view declaration

The linked `notes` resource below must already resolve to this installation's
native database. Descriptions explain what a person or agent can do here.

```ts
import { defineSpace } from '@notis/sdk/config';

export default defineSpace({
  specVersion: 2,
  name: 'Notes',
  icon: 'phosphor:notebook',
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

The saved `read` action is deliberately constrained to one native record for
body/Site reads; `shows.notes` owns the Editor's collection list. Keep both tied
to the same declared resource.

## Write the view

Start from the piece that matches the view. A list beside a reader is one
`ListReader`:

```tsx
import { DocumentPage, useAction, useNotisRuntime, useShown } from '@notis/sdk';
import { ListReader, Row } from '@notis/sdk/ui';

type Note = { record_key: string; title: string; updated_at: string };
const keys = (items: Note[]) => ({ record_keys: items.map((n) => n.record_key) });
const copy = { en: { search: 'Search notes' }, fr: { search: 'Rechercher des notes' } };

export default function Notes() {
  const t = copy[useNotisRuntime()?.context.locale === 'fr' ? 'fr' : 'en'];
  const notes = useShown<Note>('notes', { allPages: true });
  const archive = useAction('archive_notes'); // declared write actions
  const pin = useAction('pin_notes');
  return (
    <ListReader
      label={{ en: 'Notes', fr: 'Notes' }}
      items={notes.data?.rows ?? []}
      getId={(n) => n.record_key}
      openParam="note"
      search={{ placeholder: t.search,
        match: (n, query) => n.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) }}
      row={(n) => <Row title={n.title} time={n.updated_at} />}
      readerLabel={(n) => n.title}
      crumbLabel={(n) => n.title}
      reader={(n) => <DocumentPage recordKey={n.record_key} />}
      actions={[
        { id: 'archive', run: (items) => archive.call(keys(items)) },
        { id: 'pin', key: 'shift+p', label: { en: 'Pin', fr: 'Épingler' },
          run: (items) => pin.call(keys(items)) },
      ]}
    />
  );
}
```

That is the whole view. J/K (wrapping), Enter, Escape, selection with X,
Shift+J/K, Mod+A and the select-all checkbox before the title, E with Notis's
Archive words and toast, the selection bar,
the `?` sheet, open as Side, Center or Full, the one-pane rule next to chat and the
phone layout come with it. `openParam` names the declared record param, so the
open note lives in the link. `search` fills the host top bar search field and
filters the loaded notes; `crumbLabel` adds the open note to the top bar crumb
("Notes / Groceries"); `readerLabel` names it in the reader bar. The view draws
no title, heading or search field of its own. `archive` is a standard action: it
brings its own words and key. `pin` is the Space's own: it brings its EN and FR
words and a key the clash check accepts. Add `tabs` for real saved filters and
`create` for a "+" that makes a record. Other kinds of view start from their own
piece; see [Design](design.md#pick-the-piece).

Keep hooks unconditional; conditional record/list branches can be separate
components. The [SDK reference](sdk.md) covers data hooks, record components,
navigation and the toolkit pieces.

## Params and declared lists

- Param types: `record`, `enum`, `text`, `number`, `date`, `boolean`. Each needs a
  description. Enum values and defaults are typed; a required param has no default.
- Record params name a declared database and have no default record. `main: true`
  claims that database's main view. `slugProperty` is a title/number property used
  for readable link text, not record identity.
- One optional (never `required`) record param per view may declare `page: {where}`:
  a matching saved HTML page or report then opens full screen as its own page, for
  Editors in the Portal (Back, plus Share for HTML) and, for HTML pages only, on its
  record Site. `where` compares
  fixed values over `record_key`/`id`, `content_type`/`file_type`/`title` and select,
  status or checkbox properties; it never reaches the browser. Viewers still get the
  view, so keep its own HTML/report rendering. The full rules live under Record pages
  in the platform reference (`docs/notis-spaces-platform.md`).
- `path` is descriptive lowercase words, up to four slash-separated segments;
  do not put IDs, credentials or reserved product routes in it.
- `shows` for native data is `{database, where, open?}`. `where` is the native filter
  grammar and is what `useShown` executes, not commentary beside a different query.
  `open` names a record param over the same database.
- A condition may add `when: 'late'`, naming a boolean param. It is included
  only when that setting is true; absent/false drops it before pagination.
  This also gates `is_empty` for unplanned tasks. `tasksViewFilter` pairs with
  `tasksViewParams`; bind their property names and Done status to the actual schema.
  Its `today` date param defaults to the declared timezone's today; pin it for
  dated answers. Clear conflicting date/period/late/unplanned settings in controls.
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
presentations; ordinary collection views keep Portal chrome.
A Space whose published view hides chrome starts hidden from each person's sidebar;
it stays reachable by link and search. Each person can turn on **Show hidden Spaces**
in the sidebar's Spaces menu, then choose **Show in sidebar** in that Space's menu.
Optional `markdown: './markdown.ts'` names a module exporting a pure function of
`{params, shown}`. Its output must represent this view, not make hidden writes.
Use `<RenderChartData>` with the chart's actual rows so rendered Markdown contains
precise labels and values as well as its image.

Add synthetic action/list/body/record fixtures, then build and verify. Verification
and live rendering share the read-only renderer; fixture success does not prove
live permissions or data. After an authorized deploy, render the returned view link
with `notis views render` and inspect both the Markdown and full-height screenshot.
