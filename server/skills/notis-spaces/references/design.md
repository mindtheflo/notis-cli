# Design

Decide what the view is for before choosing how to build it: what the person
does there, what they look at first, how dense or calm it should be. Then take
what fits from `@notis/sdk/ui` ([SDK](sdk.md#toolkit-pieces)). The host frame,
theme tokens, keyboard engine and EN/FR words stay Notis's.

Floating UI comes from `Menu`, `Popover` and `Tooltip`; they open inside the
Space and pick up its theme. Open as Side, Center or Full belongs to the list
(`openAs`, `OpenAsMenu`).

## Layout

The host top bar shows the title: Space / view with the view icon, and the
description as a tooltip. A Space does not draw its own search field; set
`search` on `ListReader`. The Space fills the frame.

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
- A count in words takes its plural from the count, in each language:
  `pluralWords(n, { one: { en: '{n} campaign', fr: '{n} campagne' }, other: {
  en: '{n} campaigns', fr: '{n} campagnes' } })` from `@notis/sdk/words`
  (French uses the singular for 0 and 1). Never write "1 campaigns" or "(s)".

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
and line; the server runs it again on publish. Errors block; warnings name toolkit
pieces you could use, and they never block. Passing it does not prove the design
is good. Then run `notis spaces verify`, which draws every view at 390
and 1440 px in EN and FR, once with data and once while the reads are still
pending, and actually look at both images:

- Does the first screen answer the one question the person opens the page for,
  and does what needs action stand out?
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
