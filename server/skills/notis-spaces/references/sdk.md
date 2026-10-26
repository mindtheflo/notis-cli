# SDK reference for Space views

For offline verification, read [the fixture contract](fixtures.md) before
creating a `verificationFixtures` file. That short reference contains the exact
list-case format and every required initial-read fixture.

| Import | Holds |
| --- | --- |
| `@notis/sdk` | Data hooks, navigation, host interactions and record components |
| `@notis/sdk/ui` | The toolkit pieces and their hooks |
| `@notis/sdk/config` | `defineSpace` and view declarations |
| `@notis/sdk/words` | Pure action ids, EN and FR words and key specs |

`@notis/sdk` and `@notis/sdk/ui` are provided live by the host: never vendor,
copy or deep-import them (`@notis/sdk/src/...`), and never import the toolkit
stylesheet; the host adopts it. The host runtime is scoped: source never owns an
account credential or backend transport.

For a toolkit select, import `NativeSelect` from `@notis/sdk/ui` and pass
`options={[{value: 'all', label: {en: 'All', fr: 'Tous'}}]}`, `value`,
`onChange={value => ...}` and an accessible `label`. Its callback receives the
selected string, not a DOM event; its options come from `options`, not child
`<option>` elements. Keep the visible field label in the surrounding layout.

## Records and declared reads

| API | Use |
| --- | --- |
| `useViewParams<typeof definition>()` | `{params, invalid, missing, declared, ready, setParams}` for declared typed URL params. Unknown names are dropped; invalid values use their declared default. `setParams(changes, {replace?})` changes this view's own params (`null` removes one) and keeps the same Space and record open. |
| `useShown<Row>(name, options?)` | Execute the native list in `shows[name]` with current params. Options: `sorts`, `pageSize`, `offset`, `includeContent`, `allPages` (every page, for a whole count or a local search); rows are in `data?.rows` and the schema revision a write needs in `data?.schema_revision`, with `loading`, `hasData`, `isFetching`, `error`, `refetch` (resolves to the read's error, or null when it succeeded; it never rejects). |
| `useShownAvailable(name)` | Check whether this host exposes the declared native list. A record Site can expose only its exact server-pinned row scope. |
| `useAction<Inputs, Result>(name)` / `useActionQuery<Result>(name, inputs)` | Call a declared action (`call(inputs, options)`); read the result of a declared read action. Never call account-wide tools from a Space. |
| `useNativeMutation(binding, operation)` | Insert, update or delete one row of a linked database through the action that declares `LOCAL_NOTIS_DATABASE_INSERT`, `_UPDATE` or `_DELETE` on that binding with `request: { $input: 'request' }`. `mutate(input, {schemaRevision, requestId})` returns the receipt (`record_key`, `revision`); a delete moves the record to the bin, leaves every list at once and comes back if the write fails. One new request ID per effect. An insert action takes no `content_markdown`: insert, then save the body with `useNativeDocumentBody` and the record's revision. |
| `useNativeDelete(binding)` | Trash many rows of one linked database (a deck and its slides, a multi-select). `deleteMany(inputs, {schemaRevision, requestId})` hides every row from the lists at once, runs the writes a few at a time, each with the request ID `${requestId}:${record_key}` (a retry with the same `requestId` replays instead of trashing twice), refreshes the lists once at the end and brings back the rows whose write failed. It never throws for a failed row: it resolves to `{done, failed}`; say how many failed. Use it rather than a loop of `mutate`. |
| `useNativeDocumentBody(binding, recordKey, {readAction, writeAction?, enabled?})` | Markdown body adapter. Keep drafts in the view; save with the original content, record/schema revisions and stable request ID. Rich editing normally uses `DocumentEditor`. |
| `useNotis()` | Host resource, Space labels, route and ready state. Use `resource.id` for the current Space identity. |

Keep hooks unconditional. `loading` means no first successful read;
`isFetching` includes a silent refresh. Do not copy rows into mount-only state
or clear them on error ([loading rules](design.md#loading-empty-and-error)).
`Skeleton` and `ViewSkeleton` come from `@notis/sdk`; `ViewSkeleton`'s `label`
names what loads (`{ en: 'Loading meetings', fr: 'Chargement des réunions' }`),
said in the Space's language, default Loading content. Its shapes are
measured from the view at verify time and drawn from the release; `skeletonKey`
(default `main`) names the region when a view has several separately loading
parts, and `variant` only draws the fallback before the first measured release.

For another explicitly idempotent read use `useActionQuery`, or
`useQuery(keyArray, readCallback, { readOnly: true })` with every input in the
key. Call declared read actions inside a custom read with
`{ readOnly: true, dedupe: true }`; never mark a whole tool family read-only.
`useQueryClient().prefetch(...)` with the exact foreground key prepares a small
known read after render or on hover; never prefetch a write, a polling action or
a fan-out aggregate. The host keeps one in-memory cache per account, Space,
version and permission; do not add module-global or `localStorage` caches of
user data.

## First-party record components

| Component | Contract |
| --- | --- |
| `<DocumentPage recordKey>` | A record as the view's main content: save state, menu, cover, icon, title, meta, properties that save automatically, collaborative body. Slots `breadcrumb`, `actions`, `menuItems`, `aboveBody`, `belowBody`; toggles `share` (off by default, never for a report record), `header`, `meta`, `properties`, `width` (`standard` 900 px centred column by default, `wide` 1200 px, `full`); `viewer: 'html'` shows a record whose one stored `.html` file is the page; `onSaved`; `layout`. Pair with `DocumentPageSkeleton` and `usePrefetchRecord()`. It is the usual `reader` slot of `ListReader`; there it takes no `breadcrumb`, because the top bar crumb already names the open record. A page with a `breadcrumb` (a record opened from the view) names the top bar crumb leaf with its title itself; `topBarTitle` overrides that, and `onTitle` hears the title. |
| `<DocumentEditor recordKey>` | Native collaborative body, properties, images and attachments. With separate properties use `showProperties={false}`. |
| `<RecordProperties recordKey>` | Native revision-checked property editing. |
| `<HtmlFrame recordKey>` | Attached HTML under viewer CSP and an opaque-origin sandbox. Source cannot relax that boundary. `onReady` is called once per page after it has loaded and painted, or when the record cannot load: keep a slide hidden until then instead of showing a half-drawn page. `presentation={{ onAction }}` turns the pointer into a laser dot inside the page, keeps its buttons and links clickable, and hands the presenter's keys and plain clicks back as `next`, `previous`, `first`, `last` or `stop`; the page can send the same actions, so treat them as navigation only. |
| `<ReportFrame recordKey>` | A report row's saved independent implementation in its database's current view. |
| `<ShareControl recordKey>` | Private/shared record Site, copy link and revoke. |
| `<SpacePageFrame href>` | Another Notis Space page, live in this view: `href` is a Notis link (a path or a full link of this origin, such as a Page property). The Portal shows only that page's view (no sidebar, top bar or chat) with the viewer's own session and permissions. `interactive` (default `false`) lets it take clicks and keys; off, the view around it (a deck's arrows and swipes) keeps them. `title`, `className` (sizes the box it fills). Any other link, and every verify or build preview, shows a card with the title, the path and Open page. |

In its own Space's view, a record's Site is a row of the top bar Share panel, not
a toolbar button. The published Space declares the database binding; the server
rechecks record scope and binding revision. A Site exposes read-only body and
property snapshots and HTML for its pinned record, including a declared
non-collection record param. A report row cannot be shared as a Site; a report
saved as an HTML file can. A Site has no upload, collaboration credential,
authoring controls or sharing mutation. No credentials or filesystem URLs belong
in component props.

## Toolkit pieces

From `@notis/sdk/ui`. Their props live in the piece types; read them there
rather than from a copy.

- **Lists**: `ListReader`, `Row`, `TabRow`, `SelectionBar`, `Panels`,
  `OpenAsMenu`, `Keycap`. `ListReader` draws the whole list chrome from props:
  `search` (the host top bar field), `tabs` (pills in one 44px row), `title`
  (a short status with its count at the start of that row, such as "23 to
  triage"), `create` (the "+" at its end), `viewMenu`, `infoLine`,
  `readerLabel` and `readerActions` (the reader bar), `crumbLabel` (the open
  item in the top bar crumb), `onOpenChange(id, reason)` (`reason` is `user`,
  `auto` for a move the list makes itself, or `url`), `renderTile` (tiles), `look` (`two-tone` keeps
  the list tinted) and `autoOpen` (opens the first item). It has no toolbar or
  header slot. `Row` takes `wrap` (title lines) and `now` (a fixed clock for
  relative times). Drag to select is automatic on a list that selects several
  (`selectable` or a bulk action): a drag from empty space selects the rows
  under it, as in the Manager; `dragSelect={false}` turns it off. Reorder is
  off until the view passes `reorder={{ onReorder, canReorder }}`: a row then
  drags with a line where it lands, or moves with Alt and an arrow key (Alt
  with Home or End for the ends), and screen readers hear its new place.
  `onReorder({ item, id, from, to, ids })` gets the moved item, its new index
  and the whole new order; save `ids` in the view's own order (a position
  property, for example). The list shows the new order at once and puts the
  old one back with an error toast if the promise rejects. Pending and
  disabled rows, and rows `canReorder` refuses, do not move; reorder is off
  while `search` filters or `groupBy` groups. For a strip of your own (slide
  thumbnails, a rail), `useReorder({ items, getId, onReorder, orientation })`
  gives the ordered `items`, `getItemProps(id)` for each element and an
  `announcer` to render once.
- **Boards**: `BoardView` is a Kanban board (a funnel, a pipeline): one
  column per stage (`columns`, each `{ id, label, tone? }`, with `getColumn`
  saying where an item sits) and a tile per item (`renderTile`, the same
  `TileParts` as tiles). It is `ListReader` underneath, so `reader`, the open
  modes, `actions`, selection and `search` work the same; a tile opens on
  Enter or a click and nothing opens on its own. `onMove(ids, toColumnId,
  index?)` moves tiles by drag and drop, Shift+Left/Right and M (Move to):
  update the items in the page (optimistically if you like) and return an
  undo function for Undo in the toast. Leave `onMove` out for a board that
  only reads. Use it rather than columns of your own.
- **Time and numbers**: `PeriodPicker` with `usePeriod`, `DayPicker`,
  `CalendarView`, `TimelineView`, `Chart`, `StatRow`, `ChartTable`,
  `RenderChartData`. `Chart` stacks bars or areas (`stacked`) and runs bars
  left to right (`horizontal`): each label on up to two lines before its bar
  in a measured axis, and its value after it; `labelFormat` gives that short
  value ("1.2k") while `format` stays the exact tooltip and table text. Draw
  category bars this way rather than with your own recharts. For a chart of
  your own, `ChartContainer` takes `aspect` or `height`; `ChartTooltipContent`
  and `ChartLegend` also work outside it; `<Bar shape={barShape}
  label={{ content: barLabel }} />` keeps zero bars and their value labels. A
  sparkline `null` is a gap. `PeriodPicker` without the `custom` preset offers
  presets only.
- **Floating**: `Menu`, `Popover`, `Tooltip`.
- **Files and pictures**: `AttachmentGallery` and `ImageViewer`, the ones
  Notis conversations use. `AttachmentGallery` draws a row of file cards
  (`items`: `url`, `name`, `type` or `kind`, `size`, `thumbnailUrl`); an
  image card opens `ImageViewer` on the gallery's images (zoom, pan, arrows,
  copy, download, Escape), and any other card goes to `onOpen` (a new tab by
  default). `renderOpener` swaps a card's opener, `itemAction` adds a corner
  button, `viewerActions` adds viewer buttons (class `nui-viewer-btn`) and
  `onNotice` hears copy and download results. Use `ImageViewer` alone for a
  picture that opens full screen. Do not build your own lightbox.
- **Presenting on a second screen**: `useAudienceScreen({ onAction, onClose,
  title })` works like PowerPoint. `secondScreen` says whether another screen
  is connected; call `open(anchor)` from the Present press itself. It answers
  `opened` (the audience window is on the other screen), `one-screen` (present
  full screen in this window, as before), `press-again` (the browser just asked
  for permission and used up the press: show `PRESENT_WORDS.pressAgain`) or
  `blocked` (pop-ups blocked: show `PRESENT_WORDS.blocked`). Render the
  audience view with `portal(<Slide ... />)` from the same component, so both
  windows share one state: the current slide, next and previous, and a
  presented `HtmlFrame`'s laser all stay in sync. Keys, clicks and right clicks
  in the audience window come back through `onAction` (`next`, `previous`,
  `first`, `last`, `stop`); the presenter window keeps the normal view (notes,
  previews, a timer). The browser asks once to place windows on screens; the
  desktop app never asks. Leaving the view closes the audience window.
- **Blocks**: `Section`, `Badge`, `Button`, `ToggleGroup`, `SegmentedControl`,
  `NativeSelect`, `EmptyState`, `Notice`, `Metric`. A page is a stack of
  `Section`s, full width and without boxes: `kind` is `bar` (period and
  filters), `stats`, `chart`, `data` (a table) or `form`, and its head takes
  `title`, `count`, `meta`, `tabs` and `actions`. There is no page heading and
  no card: the host top bar shows the title. One toggle is a `Button` with
  `pressed`; several with any number on (filters, chart series) are a
  `ToggleGroup`; tabs and filters over a whole list or section are pills
  (`TabRow`); a `SegmentedControl` is only a mode switch inside a section.
  A `Notice` is read politely, danger too; pass `urgent` only for a problem the
  person must act on now (it becomes an alert that interrupts the screen reader).
- **Fields**: `EditableFields` (a form; Save and Cancel show once something
  changed) or `FieldList` (the same rows without them) around `FieldRow`s holding
  `FieldText`, `FieldLongText`, `FieldSelect`, `FieldMultiSelect` (`searchable`
  for a long list, `onAdd` to add the typed text as an option) or
  `FieldDisclosure` (its summary, such as a `formatLongDay` date, wraps in a
  narrow reader). A row's `hint` describes its control; `invalid` reads the
  hint as the error. Their rules ship in the toolkit styles: draw no `<style>`.
- **Hooks for your own layout**: `useListKeys` and `useSelection` (list keys and
  selection), `useShortcut` (a key at route scope or below), `usePanels` (split
  or stacked), `useOpenMode`, `useActions` (standard and own actions),
  `useLayerRoot` (container for anything floating), `useEscapeLayer`.

A standard action is an id (`archive`, `complete`, `star`, `later`, `move`,
`assign`, `read`, `delete`...) plus `run`; without `run` it is hidden. The standard
`delete` hides its records from the lists while `run` works, keeps hidden the
ones it removed and brings back the ones in `failed` (or all of them when `run`
throws, and on Undo): return `{ failed }` rather than refetching yourself. An own
action is `{ id, label: { en, fr }, icon?, key?, tone?, bulk?, appliesTo?, run }`.
A standard id with a `label` keeps its key, icon and toast: `unarchive` reads
Move to triage, and a Space whose first stop has a name passes
`{ id: 'unarchive', label: { en: 'Move to Inbox', fr: 'Remettre dans la boîte' } }`.

A status maps to one of ten groups (`backlog`, `todo`, `active`, `review`,
`waiting`, `done`, `cancelled`, `failed`, and `up`/`down` for a service), each
with its icon, words and the one status palette: pass the Space's own status to
`Row` or `StatusIcon` (with `label` for its own name), never a colour.

## Navigation

`useNotisNavigation()` exposes `toSpace(spaceId, {recordKey?, params?})` and
`toNamedSpace(alias, {recordKey?, params?})`. Both return a promise that settles
once the host has taken the navigation and rejects when the host refuses it:
`await` it (or `void` it in a click handler). Prefer declared portable navigation
aliases for sibling destinations; the host resolves them under current access.
Use declared params for view state, for example `{params: {project: key, period: 'week'}}`.
The destination drops unknown params and authorizes referenced records. Changing
a slug cannot change identity. Agents cite current server-returned links.

To change the open view's own params (an open item, a tab, a filter), call
`useViewParams().setParams({open: key})` instead of navigating to the same Space:
there is no alias to declare and no destination request, and each call adds a
history entry unless you pass `{replace: true}`. `ListReader` with `openParam` and
`usePeriod` already write this way.

## Viewer-only exploration

`viewerReads: ['databases', 'skills']` permits read-only inspection of what the
signed-in viewer already reaches. It creates no shared grant. Use
`useViewerReadAvailable(family)`, `useViewerDatabases`, `useViewerSkills`, or
`useViewerRead(operation, input)`. Anonymous Sites cannot use these families.
Explicit synthetic `viewerReads` fixtures stand in for the viewer's reads offline.

## The viewer's cloud computer

`cloudComputer: 'shell'` (or `'read'` for facts only) lets a page run one command
or write one file on the signed-in viewer's own cloud computer, after that viewer
allows it in the Portal prompt. Use `useCloudComputerShell()`: check `level`, call
`requestApproval()` when `approved` is false (either level; the facts of
`useCloudComputer()` are read again once allowed), then, when `available` (`shell`),
`run(command, options)` or
`upload({ path, content, content_encoding: 'base64', mode: 0o600 })`. Never put
secrets in a command; send them as upload content. A run is never repeated for one
request key: pass `requestId` (run option, or `request_id` in the upload) when the
page retries a run itself; `cloud_computer_already_ran` means it already ran. The
approval covers only the exact code the viewer allowed, so every new release asks
again. Keep a fallback (a Manager draft) for Sites, previews offline and viewers
who do not allow it. Declare it only when the page's core controls run on the
cloud computer.

## Visual data and Markdown

Give a chart its numbers through `RenderChartData` (the toolkit's `Chart` and
`ChartTable` already do): it adds a semantic table without a second visible one.
The renderer never guesses exact numbers from SVG or canvas geometry; a chart
without it contributes only its accessible name to the Markdown.

An optional `markdown` source module exports a pure function of `{params, shown}`.
It must describe the rendered selection and its actual data. Ordinary rendering
extracts tables, lists, controls and visible document/HTML content automatically.

## Host interactions and context

- `useHandover()` exposes `{handover, available, pending, error}`. Call a declared
  linked Skill with `handover({skill, prompt})`; fall back when no agent UI exists.
  A selected row goes as `record: {binding, recordKey, readAction}`: the host
  reads that row without its body, so pass the database's `query_` action (a
  `read_record_` action fixed to `include_content: true` is refused).
- The host top bar owns the title, the search and Share. `ListReader` `search`
  fills the host search field; a Space never wires its own search. The open
  item joins the crumb through `ListReader` `crumbLabel`, or
  `useTopBarTitleLeaf(label, onBack)` on your own layout; the view crumb then
  calls `onBack`. When the item is a record of the Space's `collection`, pass
  `useTopBarTitleLeaf(label, onBack, { recordKey })` so Editors rename it from
  the crumb; read its name from your data, which refreshes after the rename. A
  `DocumentPage` breadcrumb moves into the top bar on wide
  screens and stays in the page only on narrow ones, so never draw your own
  title or breadcrumb row. Do not duplicate host chrome.
- `useActiveResource` publishes the current resource; `useAgentContext`,
  `NotisSelectionBoundary`, `NotisCommentBoundary` and `NotisCommentBox` support
  explicit reference context. [Context sharing](context.md) owns the contract.
- `Dialog` supplies a themed modal with focus handling; while it is open, only
  its own keys and Escape work. For a confirmation (delete, discard), pass
  `nativeOnTouch` and mark the buttons `data-dialog-confirm` and
  `data-dialog-cancel`: phones and tablets then ask with the system dialog.
- `MarkdownEditor` is for a view-owned Markdown draft/persistence adapter. Native
  documents use `DocumentEditor` so collaboration and file authority stay with Notis.

## Offline fixtures

Read the complete [offline fixture contract](fixtures.md). Keep every fixture
fictional; verification never falls back to the user's real account.
