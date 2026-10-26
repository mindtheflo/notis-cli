# Design

The look, keys and words of a Space come from the toolkit pieces in
`@notis/sdk/ui`. Pick the piece that matches the view, fill its slots with the
Space's data, and change only what the Space needs (the four rungs in
[SKILL.md](../SKILL.md#three-layers)).

## Pick the piece

| The view shows | Start from |
| --- | --- |
| A list beside an open item (tickets, notes, inbox) | `ListReader` ([sample](views.md#write-the-view)) |
| The same records as a table | `ListReader` with `layout: 'table'` |
| A gallery where each item has a picture or a mark (competitors, integrations, skills to discover) | `ListReader` with `layout: 'tiles'` and `renderTile`; every other list stays rows |
| Items on dates | `CalendarView` (month, week, agenda) |
| Items over time, by lane | `TimelineView` |
| Items by stage, moved from one stage to the next (a sales funnel, a production pipeline) | `BoardView`: one column per stage, `onMove` to move tiles |
| Numbers over a period | `Section kind="bar"` with `PeriodPicker`, `StatRow`, `Section kind="chart"` with `Chart`, `Section kind="data"` with `ChartTable`, top to bottom, full width |
| One record as the page | `DocumentPage` (see [SDK](sdk.md#first-party-record-components)). Pick its `width` for the page: `standard` (the default) is a centred 900 px reading column for a page read as text, `wide` (1200 px) or `full` for a record that is a working surface such as a wide table or board |
| A form or settings page | `Section kind="form"`, `Button`, `NativeSelect`, `SegmentedControl`, `Notice`, `EmptyState` |
| A list on your own layout | `useListKeys`, `useSelection`, `Row`, `SelectionBar`, `Panels` |
| Files or pictures attached to an item, or a picture to open full screen | `AttachmentGallery` (opens `ImageViewer` on its images); `ImageViewer` alone for one picture ([SDK](sdk.md#toolkit-pieces)) |

Floating UI comes from `Menu`, `Popover` and `Tooltip`; they open inside the
Space and pick up its theme. Open as Side, Center or Full belongs to the list
(`openAs`, `OpenAsMenu`); a Space does not build its own reader frame.

## Layout

The host top bar shows the title: Space / view with the view icon, and the
description as a tooltip. A Space never renders an h1, a description, a heading
block or its own search field; set `search` on `ListReader`. The Space fills the
frame: no `mx-auto`, no `max-w-*`, no outer padding wrapper. Only the reader
article keeps a reading measure, and the toolkit sets it. List toolbars are one
44px tab row with a "+" at the right end; there are no labelled primary buttons
and no second toolbar row. Sections have no boxes.

- **Crumb.** An open item adds its name to the top bar crumb ("Product /
  Tickets / PRO-002") in every open mode; `crumbLabel` on `ListReader` names it,
  and `useTopBarTitleLeaf` does the same on your own layout.
- **Search.** `ListReader` `search` puts the query in the host top bar and
  filters with `match`, or hands it to `onChange` and `onSubmit` for a server
  search. Never draw a second search field.
- **Tab row.** `ListReader` `tabs` (or `TabRow` on your own layout) draws pills
  in one 44px row: `create` adds the "+" at its right end, `viewMenu` the sort,
  group and layout menu. The pills the row has no room for fold into its More
  menu, the active one kept in view. Show only real tabs: a tab with no data
  source is left out, not faked. `infoLine` adds one 44px line under it for a state the whole
  list shares, such as a sync with its "Sync now" action.
- **Reader bar.** `readerLabel` names the open item and `readerActions` adds its
  own icon buttons; the toolkit places close or back, the open mode, previous
  and next, the "..." menu and expand, and moves what does not fit into the
  menu. Set `disabled` on an action that cannot run now instead of refusing it
  in `run`; while the open item is pending (`isPending`) every action is
  disabled for you, and while rows are selected their keys give way to the
  selection bar.
- **Drag to select.** A list that selects several gets the Manager's marquee
  for free: a drag from empty space selects the rows under it. Do not build
  your own.
- **Sections.** A dashboard, form or settings page is a stack of `Section`
  kinds, full width: `bar` for the period and filters, `stats`, `chart`, `data`
  for a table and `form`. A section title and count sit in its head; the page
  itself has no title. Put the bar's pills and picker in its `tabs` slot as
  they are: a `TabRow` folds what does not fit into More and other controls
  scroll in the one row, so add no wrapper or overflow CSS of your own.

Keep a Space small: its data, its fields, its own actions. Do not rebuild the
sidebar, top bar, title, search field, folder tree, chat, help sheet or selection
bar; the host and the pieces already show them. Let the phone layout come from
the pieces too: `Panels` shows one pane when the list and the open item no
longer both fit.

Row and tile states (hover, keyboard cursor, open, selected) are full fills from
the pieces; the keyboard cursor is a thin ring on all four sides. Never mark a
row, tile or card with a coloured or thicker edge on one side (a left bar, a
one-side border or an inset shadow with a sideways offset): a highlight is a
ring on all four sides. Never restyle the pieces' states.

## Words

- Standard actions bring Notis's EN and FR words, key and toast. Do not relabel
  them.
- A Space's own action brings `label: { en, fr }` and, if it takes a key, one
  that clashes with nothing on the page. Host-reserved keys (`/`, `c`,
  `shift+c`, `?`, `mod+k`, `escape` and the others in the toolkit types) are
  refused.
- Every other visible string comes from EN and FR copy keyed by the runtime
  locale (`useNotisRuntime()?.context.locale`). Format dates and numbers with
  that locale. French runs 15 to 30 percent longer: leave room in tabs, section
  titles, buttons, badges and table cells.

## Loading, empty and error

The pieces keep their layout while reading. On your own layout, keep the same
rule:

- First read: the tab row, navigation and panes stay where they will be;
  `ViewSkeleton` fills only the missing region. No page spinner and no
  whole-page Loading.
- Do not draw skeleton shapes by hand. `notis spaces verify` measures the view
  with its data at 390 and 1440 px in EN and FR and ships those shapes with the
  release, so `ViewSkeleton` always matches the current layout. Give each region
  that loads on its own a `ViewSkeleton` with its own `skeletonKey`.
- Never show an empty state before the first successful read (`hasData`). An
  empty result is real and renders at once from the cache; give `ListReader` an
  `empty` slot or use `EmptyState` with a next step.
- A background refresh keeps current content and selection. Do not swap rows for
  a skeleton or drive the top-bar spinner from `isFetching`.
- A failed read shows a scoped `Notice` with Retry and keeps usable cached
  content.
- Save, upload or a submitted search shows progress in that button or section;
  disable only the conflicting action.

Change view state with `useNotisNavigation` and declared params, never a page
reload; `toSpace`, `toNamedSpace` and `setParams` return promises, so `await`
or `void` them. Edit simple values inline with rollback on failure; use `Dialog` for a
multi-field edit or a destructive confirmation.

## Look at the result

`notis spaces build` runs the design check and reports each rule broken by file
and line; the server runs it again on publish. Passing it does not prove the
design is good. Then run `notis spaces verify`, which draws every view at 390
and 1440 px in EN and FR, once with data and once while the reads are still
pending, and actually look at both images:

- Does the view fill the host frame, also while loading?
- Does the pending image keep the final layout: same tab row and panes, a
  skeleton where content will be, no Loading text and no empty state? Fix every
  pending finding verify prints.
- Is anything clipped, overflowing or truncated, in French especially?
- Do keys, selection and the open item behave like the rest of Notis?
- Do empty and error states say what to do next?

Use fictional fixtures for slow, empty and failed reads; never change real
records for a screenshot. Fix what is wrong and recheck that state. After an
authorized deploy, check the affected view inside Notis as described in
[Delivery](release.md); a standalone harness is not proof of the host layout.

## Schemas and writes

Before editing a view, inspect its live database schema and options with native
tools through the CLI. Source names resources by portable alias; the backend
resolves physical IDs. Keep result types in the view and keep property IDs
stable when labels change.

At runtime write through declared actions or first-party record components, with
current schema and record revisions and a stable request ID. An uncertain
response keeps that request ID for reconciliation; a new ID is a new effect.
