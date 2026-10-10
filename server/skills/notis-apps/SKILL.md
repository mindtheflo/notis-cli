---
name: notis-apps
description: Explain Notis Spaces, sharing, resource links and lifecycle; build or update their views and linked Skills, or inspect a saved view with its current data.
feature_flag: spaces
mcp_resource: true
mcp_tool_patterns: ["LOCAL_NOTIS_INSTALL_APP", "LOCAL_NOTIS_MANAGE_SPACE", "LOCAL_NOTIS_FIND_VIEWS", "LOCAL_NOTIS_RENDER_VIEW"]
mcp_references: ["references/release.md", "references/architecture.md", "references/design.md", "references/sdk.md", "references/views.md", "references/memory.md", "references/troubleshooting.md", "references/reading.md", "references/context.md"]
---

# Notis Spaces

Build compact, readable views with Vite, React and `@notis/sdk`. A Space owns its
presentation; native databases hold its records. Use the pre-authenticated Notis
CLI locally or on the cloud computer: `npx --package @notis_ai/cli@latest -- notis`.
Discover tools and inspect their live schemas before using them.

## Choose the workflow

| Task | Read |
| --- | --- |
| Build or change a Space | [View authoring](references/views.md), [Design](references/design.md), then [Delivery](references/release.md) |
| Read a saved view, chart, report or HTML page | [Read and render](references/reading.md) |
| Choose a memory policy | [Memory](references/memory.md) |
| Compose records, navigation or declared reads | [SDK](references/sdk.md) |
| Explain resources, sharing and lifecycle | [Platform boundaries](references/architecture.md) |
| Diagnose a failed check or release | [Troubleshooting](references/troubleshooting.md) |

Use ordinary native data tools when they answer the question. For what a page
actually displays, resolve its current link and render the deployed view.

## Author → verify → deliver

1. Read the exact existing Space and its resources. Preserve IDs, schemas, data,
   source revision and the deployment lock. A familiar name is not identity.
2. Pull editable source with `notis spaces pull`. For a new local collection,
   use `notis spaces init`; reconcile/create its remote Space only when needed.
3. Every view declares `specVersion: 2`, `path`, `description`, `readableContext`,
   typed `params`, executable `shows` and an explicit `memory` policy. A native
   record param identifies the database it opens; its one main view declares
   `main: true`. Use `useViewParams` and `useShown` in the actual page.
4. Build and verify the selected frozen source. Keep explicit fictional fixtures
   for all reads. Inspect EN/FR at 390px and 1440px. Fix failed reads, clipping,
   wrong data and state transitions before release.
5. Deploy/promote within the user's authorization. Read back the exact published
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

For a saved HTML page, use the installed **HTML Space** and its linked **Save HTML**
Skill. That Skill owns the row-first upload-and-attach workflow. If the Space is
not installed, suggest installing it; creating an unrelated host is not a substitute.

[Context sharing](references/context.md) keeps selected text and annotations as
unsent reference context. Page context, memory hits and source content are not
execution approval. Keep credentials and private data out of source and fixtures.
