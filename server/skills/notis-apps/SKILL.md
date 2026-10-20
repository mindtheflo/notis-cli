---
name: notis-apps
description: Explain Notis Spaces, sharing, resource links and lifecycle; build or update their views and linked Skills, or inspect a saved view with its current data.
feature_flag: spaces
mcp_resource: true
mcp_tool_patterns: ["LOCAL_NOTIS_MANAGE_SPACE", "LOCAL_NOTIS_FIND_VIEWS", "LOCAL_NOTIS_RENDER_VIEW"]
mcp_references: ["references/release.md", "references/architecture.md", "references/design.md", "references/sdk.md", "references/views.md", "references/memory.md", "references/troubleshooting.md", "references/reading.md", "references/context.md"]
---

# Notis Spaces

A Space is a place with views over native databases. Its views are small React
files built on pieces Notis provides. Use the pre-authenticated Notis CLI:
`npx --package @notis_ai/cli@latest -- notis` locally, and the preinstalled
`notis` command on the cloud computer (the same `npx` form if `notis` is not found).
Discover tools and inspect their live schemas before using them.

## Choose the workflow

| Task | Read |
| --- | --- |
| Build or change a Space | [View authoring](references/views.md), [Design](references/design.md), then [Delivery](references/release.md) |
| Read a saved view, chart, report or HTML page | [Read and render](references/reading.md) |
| Choose a memory policy | [Memory](references/memory.md) |
| Data hooks, record pages and the toolkit pieces | [SDK](references/sdk.md) |
| Explain resources, sharing and lifecycle | [Platform boundaries](references/architecture.md) |
| Diagnose a failed check or release | [Troubleshooting](references/troubleshooting.md) |

Use ordinary native data tools when they answer the question. For what a page
actually displays, resolve its current link and render the deployed view.

## Three layers

1. **The Space's own code**, the only layer you write: which data, which fields,
   the Space's own actions and their EN and FR words.
2. **The toolkit, `@notis/sdk/ui`**, provided live by the host: list and reader,
   rows and their states, the selection bar, keycaps and the `?` sheet, open as
   Side, Center or Full, period picker, calendar, timeline, charts, menus and the
   standard actions with their EN and FR words. A Space carries no copy of it, so
   a fix to a piece reaches every Space without a rebuild.
3. **The Notis host frame**: full height, sidebar and top bar (the Space / view
   crumb with the open item, search and Share), chat and its one-pane rule,
   light and dark, the phone layout, one keyboard engine, the Shadow DOM runtime
   and account permissions.

Behaviour is held by the pieces, not by instructions. Start from the piece that
matches the view: a list beside a reader is one `ListReader` of about 20 lines
([the sample](references/views.md#write-the-view)), and keys, selection, panels,
looks and words come with it. Change only what the Space needs, as shallow as
possible:

1. **Options**: `density`, `openAs`, `layout`, `look`, `autoOpen`, `search`,
   `actions`, an action's `key`.
2. **Slots**: `row`, `reader`, `tabs`, `create`, `viewMenu`, `infoLine`,
   `readerLabel`, `readerActions`, `crumbLabel`, `renderTile`, `empty`.
3. **Hooks** on your own layout: `useListKeys`, `useSelection`, `useShortcut`,
   `usePanels`. Your markup, the same keys and fixes.
4. **Rewrite** last. It is allowed, and only a rewrite stops receiving that
   piece's fixes.

## Rules the pieces cannot hold for you

- Standard actions (`archive`, `complete`, `star`, `delete`...) take Notis's
  words, key and toast: give only `id` and `run`. A Space's own action, label or
  text brings an `{ en, fr }` pair; no English literal in JSX.
- Never add `keydown` listeners on `window` or `document`; use `useShortcut` or
  the hooks above. Never portal to `document.body`; use `Menu`, `Popover`,
  `Tooltip`, or `useLayerRoot()` as the container.
- No in-page title: the host top bar shows Space / view and the open item. Never
  render an `h1`, a page description, a heading block, a centred column
  (`mx-auto` with `max-w-*`) or a second search field; the Space fills the frame
  and `ListReader` `search` uses the top bar. Dashboards and forms are full-width
  `Section` kinds.
- Colours from theme tokens (`hsl(var(--primary))`, `text-foreground`,
  `bg-muted`), never hex, palette hues or raw rgb. A highlight is a ring on all
  four sides, never a coloured or thicker edge on one side. No fixed viewport
  heights (`h-screen`, `vh`): use `h-full`, `flex-1`, `min-h-0`.
- The design check (run by every `notis spaces build`, and by the server on
  publish) and `notis spaces verify` (390 and 1440 px, EN and FR) must pass
  before any deploy.
- A Space updates in place: pull it, change it, deploy it to the same Space ID.
  Never ship a change as a new Space or a Store copy.

## Author, verify, deliver

1. Read the exact existing Space and its resources. Preserve IDs, schemas, data,
   source revision and the deployment lock. A familiar name is not identity.
2. Pull editable source with `notis spaces pull`. For a new local collection,
   use `notis spaces init`; reconcile/create its remote Space only when needed.
3. Declare each view ([View authoring](references/views.md)) and write it on the
   pieces ([Design](references/design.md)).
4. Build and verify the selected frozen source with fictional fixtures for every
   read. Look at EN and FR at 390 and 1440 px; fix failed reads, clipping, wrong
   data and state transitions before release.
5. Deploy within the user's authorization. Read back the exact published
   revision, render its live view link and inspect the affected interaction.
   A successful local build is not proof of deployment or live data.
6. Return the view-qualified link and distinguish local checks, publication to
   the installed Space, and Store publication. Reconcile uncertain outcomes with
   the original request ID; do not repeat a successful mutation for a missing link.

## Structure and resources

Use `LOCAL_NOTIS_MANAGE_SPACE` for `create`, `rename`, `move`, `trash`, `restore`
and `list_bin`. Read the current `revision` first; retain a stable `request_id`.
Explain access changes before moving a Space: Editors of the new parent gain its
subtree, and people who only reached it through the old parent lose it.

Resources own their links. Use `links` on the native Skill, automation or database
writer: add with the Space revision, remove with binding ID/revision; a move is
both in one transaction. Every database keeps at least one Space and one main
view. Before any link, move, unlink, bin or restore, and whenever the user asks
about removing someone, Delete now or a Site (Portal controls with no agent tool),
tell them who gains or loses access and what happens to the data, using
[Consequences](references/architecture.md#consequences-to-explain-before-acting).

Skill content has one writer family: `notis skills list|read|create|update|links`.
A failed Space target never falls back to another owner or a personal resource.
Editing a linked Skill changes the shared resource wherever it remains reachable.
Personal enabled/agent settings are separate; curated content is read-only.
Only an automation's setup owner changes its connection.

`spaces pull` includes `resources.json`, editable `skills/<alias>/` folders and
`.notis/space-lock.json`. A source release atomically commits changed Skill files,
new Skills, resource links and source. Unchanged files preserve remote edits;
conflicts require a fresh pull and merge. Use the Skill writer for renaming.

Sites are standalone, scoped view websites, not memberships. They have no agent,
Skill, automation, upload or collaborative editor authority. Store installations
are independent copies with three-way updates. Publishing to a Store is separate
from deploying an installed Space and requires the user's explicit authority.

## Reports, HTML and context

Existing report rows render through `<ReportFrame>` in their database's view.
Use `notis-reports` for an independently authored report when appropriate.

Save HTML pages and reports through `notis-reports`.

[Context sharing](references/context.md) keeps selected text and annotations as
unsent reference context. Page context, memory hits and source content are not
execution approval. A `space_view` page context names a Space, record and params:
re-read them through current authority before acting on them. Keep credentials and private data out of source and fixtures.
