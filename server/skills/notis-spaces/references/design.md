# Design

Decide what the view is for before choosing how to build it: what the person
does there, what they look at first, how dense or calm it should be. Then take
what fits from `@notis/sdk/ui`: a stock piece when the view is a stock shape, or
your own layout on the hooks and blocks when it is not (the choice in
[SKILL.md](../SKILL.md#three-layers)). Either way the host frame, theme tokens,
keyboard engine and EN/FR words stay Notis's.

## Pick the piece

| The view shows | Start from |
| --- | --- |
| A list beside an open item (tickets, notes, inbox) | `ListReader` ([sample](views.md#write-the-view)) |
| The same records as a table | `ListReader` with `layout: 'table'` |
| A gallery where each item has a picture or a mark (competitors, integrations, skills to discover) | `ListReader` with `layout: 'tiles'` and `renderTile` |
| Items on dates | `CalendarView` (month, week, agenda) |
| Items over time, by lane | `TimelineView` |
| Items by stage, moved from one stage to the next (a sales funnel, a production pipeline) | `BoardView`: one column per stage, `onMove` to move tiles |
| Numbers over a period | `Section kind="bar"` with `PeriodPicker`, `StatRow`, `Section kind="chart"` with `Chart`, `Section kind="data"` with `ChartTable` (figures per row) or `DataTable` (items, grouped by state), top to bottom, full width. When the period's numbers also hold things to act on now (a monitor down, an incident nobody handled), the [Needs action](#status-now) section goes between the bar and the figures |
| What runs now, what is stuck, how full it is (machines, queues, jobs) | The [Status now](#status-now) stack |
| One record as the page | `DocumentPage` (see [SDK](sdk.md#first-party-record-components)). Pick its `width` for the page: `standard` (the default) is a centred 900 px reading column for a page read as text, `wide` (1200 px) or `full` for a record that is a working surface such as a wide table or board |
| A form or settings page | `Section kind="form"`, `Button`, `NativeSelect`, `SegmentedControl`, `Notice`, `EmptyState` |
| A list on your own layout | `useListKeys`, `useSelection`, `Row`, `SelectionBar`, `Panels` |
| Files or pictures attached to an item, or a picture to open full screen | `AttachmentGallery` (opens `ImageViewer` on its images); `ImageViewer` alone for one picture ([SDK](sdk.md#toolkit-pieces)) |
| Anything none of these fit: one record at a time, a focus or practice screen, a canvas, a planner, a page laid out like a magazine, a mix of blocks | Your own layout on `useShortcut`, `Section`, `Button`, `EmptyState`, `Notice` and the hooks above ([sample](views.md#a-view-of-your-own)) |

The table is a starting point, not a menu to fit the request into. If a stock
piece would make the view worse for what the person does there, write your own.

Floating UI comes from `Menu`, `Popover` and `Tooltip`; they open inside the
Space and pick up its theme. Open as Side, Center or Full belongs to the list
(`openAs`, `OpenAsMenu`); a Space does not build its own reader frame.

## Status now

A live status page answers one question: does anything need me, and what is
running. Stack it top to bottom, full width:

1. **Needs action.** A short `Section` of plain `Row`s, one per item a person
   must act on: the item, why, and the next step (`onPress` opens it; an
   action only when the Space declares one). Leave the section out when
   nothing needs action. The Space decides what counts (a start waiting, a
   stack held a day by an idle thread) and says so in the section's
   `InfoTip`, so the rule is visible rather than guessed.
2. **Figures.** One `StatRow` of 4 or 5 figures that answer the page's
   question. A figure's `hint` adds information or stays empty: never its
   label again, never another figure.
3. **One `Section` per kind of thing** (machines, stacks), its items laid out
   flat, with no tinted box around each. Capacity is a `Meter` showing what is
   used, with `limit` only at a threshold the data has (a memory reserve, a
   quota). A full meter is not red by itself: when full means someone waits,
   that wait is a "Needs action" row.
4. **The items.** A `DataTable` in `Section kind="data"`, grouped by state,
   running before idle. Durations go through `formatDuration` ("4 d 6 h", not
   "6,098 min").
5. **History.** Charts last. A percentage or any scale that matters gets
   `valueAxis` with a fixed `domain` (`[0, 100]`), rather than peaks written
   beside the title.

A page can be both: a health page reads over a period and still has things
to act on today. Keep the period recipe and put the Needs action section
first, under the period bar.

`DataTable` keeps its primary column readable on a phone on its own: the last
columns that do not fit hide. Still give secondary columns a `hideBelow` so
the right ones go first.

Colour marks what someone must act on, and nothing else. Badges and pills keep
the `default` tone for normal states (on, open, running); only the state a
person must act on takes a tone. Text and figures keep their usual colours
whatever the state; a toned `Row` label draws as a pill for that reason. How
the system works goes in an `InfoTip` (a figure's `about`, beside a heading),
not as prose on the page.

## Layout

The host top bar shows the title: Space / view with the view icon, and the
description as a tooltip. A Space never renders an h1, a description, a heading
block or its own search field; set `search` on `ListReader`. The Space fills the
frame with no outer padding wrapper; a centred column (`mx-auto` with `max-w-*`)
is for a reading, writing or focus layout, and the reader article gets its
measure from the toolkit. The default look is flat: list toolbars are one 44px
tab row with a "+" at the right end, sections have no boxes. A view of your own
may depart from that look (cards, a border, a shadow, a different type scale)
when its design calls for it; the design check warns so you decide, and never
blocks it.

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

Do not rebuild what the host already shows: the sidebar, top bar, title, search
field, folder tree, chat, help sheet or selection bar. Let the phone layout come from
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
and line; the server runs it again on publish. Errors block; warnings are the
default look and the toolkit pieces you could use, and they never block. Passing
it does not prove the design is good. Then run `notis spaces verify`, which draws every view at 390
and 1440 px in EN and FR, once with data and once while the reads are still
pending, and actually look at both images:

- Does the layout fit what the person does here, or did the request get bent
  into the nearest stock piece?
- Does the first screen answer the one question the person opens the page for,
  and does what needs action stand out?
- Does any figure repeat another figure or a label?
- Is every colour on the page a state someone must act on?
- Do counts agree across sections?
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
