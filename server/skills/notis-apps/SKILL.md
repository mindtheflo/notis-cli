---
name: notis-apps
description: Design and package Notis apps. Use when users want an app that groups databases, routes, documents, automations, and skills into one installable Notis product.
feature_flag: store
mcp_resource: true
mcp_tool_patterns: ["LOCAL_NOTIS_INSTALL_APP"]
---

# Notis Apps Skill

Use this skill when the user wants a packaged Notis app -- task manager, CRM, dashboard, internal tool, etc. Notis apps are **Vite + React projects** that deploy into the Notis portal as installed apps for the current user or team.

Run the Notis CLI through NPX, for example `npx --package @notis_ai/cli@latest -- notis apps list`. Sign the CLI in once with `notis login`; each account you authorize is a profile you can switch between with `notis profile use`. The CLI bundles this `notis-apps` base skill and refreshes its canonical copy under `~/.notis/skills/base/` on every launch. It is independent of account-skill sync, feature flags, target selection, and cloud deletion.

## How Apps Are Built

All Notis apps are built using the Notis CLI, either locally in a repo workspace or inside a Vercel Sandbox. The platform contract is the same in both cases:
- the app is a Vite + React project
- the app uses `@notis/sdk`
- the app is packaged as an ES module bundle
- the portal renders it as a React component inside the portal's React tree

## Release-only delivery

Workspace runs released app versions only. Local and cloud agents use the same workflow.
A request to create or edit app source authorizes updating that app in Workspace after checks pass.
Explicit read-only, preview-only or no-deploy requests stop at local artifacts and checks: no remote
app/resource creation or mutation, Workspace preview, deployment or live verification. Store
publication always needs separate explicit approval.

1. Inspect the effective CLI profile and the exact app's current version with `apps list --json`.
   For an existing released app, preserve local edits and pull its exact app ID into the intended
   directory. Retain the profile/app link, deployment version and revision. An unreleased container
   has no source to pull: recover its original local source and edits, or scaffold locally only if
   that source cannot be recovered. Confirm its exact ID, edit permission and personal/team scope,
   then run `apps link <app-id> <source-directory> --expected-version 0` to resume that same container.
   If a release has appeared, preserve local source separately, pull the current release into a fresh
   directory and reapply the intended edits. The link guard compares against the same remote read
   whose version/revision it saves; deploy still rejects a release racing after that read. Do not pull
   missing source or create another remote app to recover a failed first release.
2. Scaffold a new app locally, or edit the pulled source. Run `apps build` and automated
   `apps verify` before new remote creation. Missing browser tooling or failed checks blocks delivery;
   printed URLs and `--no-browser` are not passing verification. Install browser tooling with
   `npm exec --yes --package agent-browser@latest -- agent-browser install`; if needed run
   `npx --yes --package @notis_ai/cli@latest --package agent-browser@latest -- notis apps verify`.
3. Reconcile `apps list --json` and the exact intended name/slug, edit permission and personal/team
   scope. Default to personal only when no team was requested. Reuse a matching editable identity;
   stop on ambiguous matches or conflicting identity/scope. Create only when none exists, using
   `apps create "<exact app name>" .` (or `--team-id <verified team ID>`). Read back the same ID.
   A failed first release leaves a container: reuse it, never duplicate or automatically delete it.
4. Compare existing app-owned schemas. Create only necessary missing databases against that exact
   app ID. Change existing schemas by verified database ID and ownership, and only with backward-
   compatible changes before release. Read back each change. Breaking changes need separate coordination.
   Ordinary note/record edits and existing resource editors remain immediate.
5. Run `apps deploy` against the same linked app. It builds, verifies a frozen source/artifact
   snapshot with stubs, then sends that snapshot to the backend. `--skip-build` accepts only unchanged,
   valid output and still verifies. Do not bypass the backend or create implicitly on deploy.
6. Read back the exact installed app ID, integer version and Portal URL with `apps list --json`.
   Run `apps verify --mode live` and open the installed app in the actual Portal for surface proof.
   A live harness check alone does not prove the deployed bundle rendered in Portal.
7. Report **failed before activation**, **deployed but unverified**, or **outcome unknown** accurately.
   Never blindly replay an uncertain create/deploy response; reconcile its exact identity/version first.
   `apps publish --confirm-ready` is **Publish to Store**, separately approved and listing-gated.
   Workspace delivery is **Update app**, with no Store screenshot/readiness requirement.

### Restore historical source as a new release

Pull the current release into a fresh checkout first. Retrieve historical source into a different
folder (`apps pull <id> <historical-dir> --source-version <n>`). Replace source in the current checkout
without replacing its `.notis` profile/app link or deployment base. Update `package.json`'s
`notisAppVersion`, check compatibility with current resources, build, verify and deploy as a new
release. Preserve app/database/skill IDs. Never decrement the deployment counter, rewrite snapshots,
or claim to undo user data or external actions.

## Architecture

```
Notis CLI (local workspace or Vercel Sandbox)
  -> Vite + React project with @notis/sdk
  -> notis apps init / build / verify / create / link / pull / deploy
  -> ES module bundle (app.js + app.css) + manifest
  -> Portal renders as React component with real tools/databases
```

`deploy` updates the linked installed app for the current account or team. After the user explicitly confirms the App Details page is ready, `apps publish --confirm-ready` submits that deployed version to the Team or Public Store review flow.

### Key Components

1. **@notis/sdk** (`packages/sdk/`) -- SDK for app developers
   - `@notis/sdk` -- NotisProvider, runtime hooks, editors, selection helpers, and shortcut primitives
   - `@notis/sdk/interactions` -- headless collection actions and interaction types
   - `@notis/sdk/config` -- `defineNotisApp()` for notis.config.ts
   - `@notis/sdk/vite` -- `notisViteConfig()` for vite.config.ts
   - `@notis/sdk/styles.css` -- shadow-safe app shell styles and base app-surface classes

2. **CLI** (`packages/cli/src/command-specs/apps.js`) -- release delivery uses init, build, verify, create, deploy, link, pull, doctor, and list

3. **Server** (`server/routers/portal_views/`) -- Returns signed bundle URLs, proxies tool calls

4. **Portal** (`portal/src/components/apps/`) -- Renders app bundles as React components via AppViewRenderer

### Runtime Bridge

Apps communicate with the platform through the `NotisRuntime` interface, provided by the portal via React context:

- **Portal**: the portal creates a real `NotisRuntime` and passes it as a prop to `NotisProvider`. All calls go to `/portal_views/runtime_query` via fetch with the user's JWT.
- The portal mounts the app inside a shadow-scoped content surface and injects the runtime before app mount. There is no supported window-global runtime fallback.

App code never accesses the runtime directly -- it uses SDK hooks (`useTool`, `useTools`, `useNotis`, etc.) which read from the `NotisProvider` context.

## Hard Rules

1. **React + Vite only** -- No Next.js, no custom server
2. **ES module bundle** -- Vite builds a library-mode bundle with React externalized
3. **Component rendering** -- Apps render as React components directly in the portal. Do not create your own iframe; the host chooses the trusted shadow-root or isolated Store rendering path.
   The portal owns the `ShadowRoot`, theme tokens, and runtime provider.
4. **HTTP bridge** -- Runtime calls use fetch to `/portal_views/runtime_query`
5. **Declarative tools** -- Tool access is declared in `notis.config.ts` by the final names returned by tool discovery and enforced server-side. Views can call native Notis, connected integrations, PostForMe, and MCP tools directly; metered calls use the same credit-cap and usage-billing path as the CLI.
6. **shadcn + Notis theme** -- Apps must use shadcn components with the live Notis theme provided by the portal
7. **Phosphor icons only** -- Always `phosphor:` prefix. Never emojis.
8. **Database refs only** -- `notis.config.ts` references existing databases by slug. The schema source of truth lives in the `databases` table, not in the manifest. Every native database is owned by exactly one app (`databases.owner_app_id`): creating one through `LOCAL_NOTIS_DATABASE_UPSERT_DATABASE` requires the owning app's slug or id in the `app` argument, installation stamps ownership automatically, and deleting an app deletes its databases and their documents.
   An app-owned database slug is a stable deployed contract because bundles and
   collection routes may call it directly. Do not try to rename that slug with
   a schema tool; rename the display title instead.
9. **Use NPX for CLI commands** -- Always run `npx --package @notis_ai/cli@latest -- notis ...`.
10. **`apps deploy` is not store publishing** -- `apps deploy` updates an installed app only and persists its source snapshot. Store review starts separately with `apps publish --confirm-ready` after explicit user approval.
11. **Routes are canonical** -- Define navigation only in `manifest.routes`. Every configured route must declare an explicit `slug`. Do not rely on legacy `manifest.views`.
12. **Portal-owned sidebars stay portal-owned** -- If a route uses `collection.sidebar`, treat that sidebar as platform chrome. Do not remove it, recreate it inside app JSX, or replace it with a custom in-app folder rail.
13. **Portal globals are off-limits** -- Never use `window.__NOTIS_RUNTIME__`, query portal-owned DOM hooks, or create global DOM portals.
14. **Prefer inline optimistic edits** -- Rename-like edits for collections, app-owned rows, and sidebar-backed entities should use inline editing with an optimistic UI update, then roll back on backend failure. Use modals only when the edit requires multiple fields or destructive confirmation.
15. **One delivery gate** -- Follow Release-only delivery on local and cloud computers. No DEV runtime exists.
16. **Exact identity** -- Preserve the intended profile, editable app ID, personal/team scope and current deployment base. Never silently advance a stale checkout.
17. **Automatic source updates** -- Build and check requested app source changes, then update Workspace unless the user opted out. Store publication stays separate.
18. **Runtime permissions stay least-authority** -- Release activation preserves existing grants and keeps restricted capabilities denied until approved.
19. **Store submission is user-gated** -- Run `apps publish --confirm-ready` only after the user explicitly confirms the current App Details page and Store listing are ready. Deploy the exact approved local state first. The command must reject missing confirmation, incomplete listing media, a local/deployed version mismatch, private visibility, or an existing pending review.
20. **Source restoration** -- Restore historical source as a new release using the current deployment base; never revert data or decrement versions.
21. **`CHANGELOG.md` owns release history** -- Keep the complete release history in one root `CHANGELOG.md`, newest entry first. Do not add new `versionNotes` values to `notis.config.ts`. Use `## [Release title] - YYYY-MM-DD`, or `{PR_MERGE_DATE}` for an unpublished entry. App Details reads **What’s New** and **Version History** from the deployed package manifest, while the Store reads them from the latest published snapshot; unpublished workspace edits must never change the Store page. The manifest also exposes `package.json` `notisAppVersion` as the package version shown in App Details.
22. **Database rows are private unless explicitly seeded** -- A string declaration such as `databases: ['notes']` publishes schema only and never includes the developer's rows. Use `{ slug: 'templates', seedDocuments: true }` only for small, intentional starter content that every installer should receive. Never enable it for user-created notes, history, leads, or other personal data.
23. **Public submissions are complete, reviewable packages** -- The registry PR must contain the full editable source tree, Store assets, exact source-declared database schemas, and only explicitly seeded starter rows. Registry CI validates those boundaries before merge; do not hand-edit `notis-listing.json` or strip source files to make a check pass. Fix the app locally, redeploy, and resubmit.
24. **New projects default to `~/.notis/apps/<slug>`, and `[dir]` overrides it** -- `apps init` and `apps pull` use this stable, predictable home unless the app belongs in a specific repository, monorepo, or user-chosen location. In those cases, pass `[dir]` and report the resulting path. Do not nest an app inside a directory whose local workspace metadata selects an unrelated Notis runtime or profile: later CLI calls inherit that routing and may target the wrong environment.
25. **Machine names and display titles use different casing** -- In `notis.config.ts`, `name` is the stable machine identity and must be lowercase kebab-case (`name: 'link-building'`). `title` is the human-facing app name and must use deliberate display casing (`title: 'Link Building'`), preserving product spelling and acronyms such as `Notis` and `SEO`. Never put a title-cased phrase in `name`, never show a raw slug as the title, and never change an existing canonical `name` or remote slug merely to repair display casing. The persisted `apps.name`, Workspace sidebar, App Details, and Store listing must use `title`.

## Anti-patterns -- NEVER do these

These are the most common mistakes agents make. Each one wastes time and produces broken results.

- **NEVER assume app deploys create databases for you** -- Create or update databases through native Notis database tools or the assistant first, then reference them by slug in `notis.config.ts`. Database creation requires the owning app to exist: pass its slug or id in the `app` argument of `LOCAL_NOTIS_DATABASE_UPSERT_DATABASE` (create the app first with `LOCAL_NOTIS_CREATE_APP` if needed). A database can only be referenced by the app that owns it.
- **NEVER bypass the supported workflow by manually stitching together low-level save or lint calls from a local workspace** -- Local agents should go through the NPX Notis CLI for `apps pull`, `apps build`, `apps verify`, `apps create`, `apps link`, and `apps deploy`.
- **NEVER use `apps pull` to clone a Store listing** -- `npx --package @notis_ai/cli@latest -- notis apps pull` only pulls source for an app the user can already access as an installed app. To fork a published Store app, run `npx --package @notis_ai/cli@latest -- notis apps init "My App" --from <slug>` instead: it downloads that app's source from the public registry, and installing the app first is not required.
- **One local/cloud delivery contract** -- App source create/edit requests authorize Workspace delivery after checks. Explicit read-only, preview-only and no-deploy requests prohibit remote mutations. Neither authorizes Store publication.
- **NEVER submit without explicit approval** -- A deploy request alone does not authorize Store submission. Run `npx --package @notis_ai/cli@latest -- notis apps publish --confirm-ready` only when the user confirms App Details is ready for Store review.
- **NEVER write raw `views/<slug>/index.js` files** -- Write standard React pages in `app/`.
- **NEVER invent `npx --package @notis_ai/cli@latest -- notis apps push` or bypass the review flow** -- Source moves through `apps pull` and `apps deploy`; `apps publish --confirm-ready` submits the deployed snapshot through the same authenticated review endpoint as App Details.
- **NEVER treat `apps deploy` as store submission** -- It updates the linked installed app for the current account or team scope only. Store submission is a separate, explicitly confirmed step.
- **NEVER explore server code or tool schemas to invent an alternative app workflow** -- Use the Notis CLI.
- **NEVER work around a missing `collection.sidebar` portal tree by rendering a duplicate sidebar inside the app** -- keep the route manifest as the source of truth and escalate the missing portal sidebar as a platform bug instead.
- **NEVER invent a custom visual language** -- Do not ship full-screen gradients, glassmorphism, bright neon palettes, or raw HTML controls as the primary UI. Apps should look like a natural extension of the portal.
- **NEVER hand-roll buttons/cards/badges when the scaffold already provides flat primitives** -- Prefer `@/components/ui/*` and portal token classes such as `bg-background`, `bg-muted`, and `text-muted-foreground`. Never add `border` or `shadow` classes to `Card`; a `Card` nested in a `Card` is flat automatically. See Design bar.

## Workflow

Follow **Release-only delivery** above. Use `apps scaffolds list` to discover public Store starting
points, `apps init` to scaffold locally, and `apps pull` for existing source. App file operations go
through the CLI, never raw storage/database writes. Run all Notis commands through NPX.

## Building an App

### Step 1: Define the config

Create `notis.config.ts` with:
- **name** -- Stable machine identity in lowercase kebab-case, such as `link-building`; do not use display casing here
- **title** -- Human-facing app name with deliberate casing, such as `Link Building`; preserve brands and acronyms exactly
- **databases** -- Slug references to existing Notis databases
- **routes** -- Route-first sidebar entries with explicit `slug`, optional `parentSlug`, and optional `collection.sidebar` tree config
- **tools** -- Final tool names the app can call at runtime. Use the shared discovery flow (`COMPOSIO_SEARCH_TOOLS`, then `COMPOSIO_GET_TOOL_SCHEMAS`) while building the app, and copy the returned final names into this list. Examples include `LOCAL_NOTIS_DATABASE_QUERY`, `LOCAL_NOTIS_MONID_RUN`, `GMAIL_SEND_EMAIL`, `LOCAL_POSTFORME_CREATE_POST`, and `LOCAL_MCP_<SERVER>_<TOOL>`. App code calls each declared name directly through `useTool`; it does not wrap provider or MCP calls in `COMPOSIO_MULTI_EXECUTE_TOOL`. Access stays scoped to the signed-in user's own connections, native database tools stay scoped to the app's databases unless `capabilities.workspaceDatabases: 'read'` is granted, and metered tools use the CLI-equivalent credit-cap and fail-closed usage-billing path.

For collection-backed sidebars, use the route schema directly:

```ts
routes: [
  {
    path: '/',
    slug: 'notes',
    name: 'Notes',
    icon: 'phosphor:note-pencil',
    default: true,
    collection: {
      database: 'notes',
      titleProperty: 'Title',
      parentProperty: 'Parent note',
      sidebar: {
        mode: 'tree',
        allowCreate: true,
      },
    },
  },
]
```

Use the same page template for the root Notes route and collection/sub-collection detail states. The portal sidebar injects live collection items under the static route row when `collection.sidebar.mode === 'tree'`.

For arbitrary app-owned resources that are not Notis collection rows, set `resourceDeepLinks: true` on the route. Read the decoded `?resource=` identifier from `useNotis().resourceId`, and link between routes with `toRoute('/inbox', { resourceId })`. Keep collection links on `?item=`. Publish external preview/source links as the resource `url`; the host separately supplies the exact Notis review link as `active_resource.view_url` for opted-in routes. Handle missing or deleted identifiers with a safe view-level fallback.

### Step 2: Build pages

Standard React pages in `app/`. Use generic SDK tool hooks for data and build on top of the scaffolded flat components and portal shell classes (`notis-app-shell` for ordinary pages, `notis-app-split` for list-plus-detail pages, `notis-app-surface` for a flat panel):

```tsx
import { useDocuments, ViewSkeleton } from '@notis/sdk';
import { Card } from '@/components/ui/card';

export default function TasksPage() {
  const tasks = useDocuments('tasks', { pageSize: 25 });
  return <section className="space-y-4 p-6">
    <h1 className="text-xl font-semibold">Tasks</h1>
    {tasks.error && <p role="alert">{tasks.error.message} <button onClick={tasks.refetch}>Retry</button></p>}
    {tasks.loading ? <ViewSkeleton variant="table" rows={5} /> : tasks.hasData ? (
      tasks.documents.length ? tasks.documents.map((task) => (
        <Card key={task.id} className="p-4"><h2>{task.title || 'Untitled'}</h2></Card>
      )) : <p>No tasks yet.</p>
    ) : null}
  </section>;
}
```

### Instant-view loading contract (required)

Build a client-side, multi-route app with one persistent `app/layout.tsx` shell. Navigate with `useNotisNavigation`; never use a document reload for an internal route. “SPA” means preserving that shell and reusing reads, **not** mounting every page or fetching every database at startup.

| State | Required UI |
| --- | --- |
| First read, no successful data | Keep headings/navigation/layout visible; use content-shaped skeletons only in missing regions. No page spinner or whole-page `Loading...`. |
| Cached view / successful empty result | Render synchronously from the shared SDK cache. Empty results are real cached results. |
| Background refresh | Keep current content and selection. Never replace populated content with a skeleton; do not drive the top-bar spinner from mount/refetch state. |
| Explicit Save / Upload / submitted search | Progress belongs in that button or affected section. Disable only the conflicting action. |
| Failed read | Show a scoped error and Retry; keep usable cached content. Never show an empty-state message before `hasData` is true. |

Use `useDocuments`, `useDocument`, `useDatabaseSchema`, and `useDatabaseSubscription` for native reads. `loading` means no first successful response; `isFetching` includes silent refresh. Do not copy their data into mount-only state, clear rows on error, or gate the entire app on `isFetching`.

For another **explicitly identified idempotent read**, use `useToolQuery<Result>(toolName, exactArguments, { readOnly: true })`, or `useQuery(keyArray, readCallback, { readOnly: true })`. Include every filter, selected resource, pagination option, and other input in the key. Call tools within a custom read with `{ readOnly: true, dedupe: true }`; the same SQL/shell tool can also perform writes, so never mark a whole toolkit read-only. Leave mutations as ordinary `useTool` actions.

`useQueryClient().prefetch(keyArray, readCallback, { readOnly: true })` prepares small known reads after the current view has rendered or on hover/focus. It shares the host's two-request speculative budget. Match the exact foreground query key. Never prefetch a mutation, login/polling action, provider sweep, `fetchAll` query, or an aggregate that fans out into more requests. Do not invent tool names to prepare a view. Older hosts safely fall back to uncached hook-local reads and skip prefetch.

Caches belong to the host's in-memory account/environment/app/version/effective-permission scope. Do not add module-global or `localStorage` caches of user data. Writes and realtime events invalidate reads; logout, access loss, and updates retire scopes. Preserve the last successful snapshot on an ordinary network failure.

### Discovering database schema

Before writing app code, inspect the database schema to know what properties exist:

```bash
npx --package @notis_ai/cli@latest -- notis tools search "list Notis databases"
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_LIST_DATABASES --arguments '{}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_GET_DATABASE --arguments '{"database_slug":"social_media_calendar"}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --arguments '{"database_id":"social-media-calendar-db-id","query":{"page_size":1}}'
```

Prefer the database `id` returned by `LOCAL_NOTIS_DATABASE_LIST_DATABASES` or `LOCAL_NOTIS_DATABASE_GET_DATABASE` when calling `LOCAL_NOTIS_DATABASE_QUERY`; use `database_slug` only as a fallback.

Use `LOCAL_NOTIS_DATABASE_GET_DATABASE` through `useTool` when an app needs schema detail at runtime. Keep database-specific result and property helper types inside the app code.
For document writes, declare the generated canonical tool for the target database, such as `LOCAL_NOTIS_DATABASE_UPSERT_TASKS`, and call it through `useTool`. Pass flat property values; the server wraps them:

```tsx
const upsertTask = useTool<Record<string, unknown>, { document?: { id: string } }>('LOCAL_NOTIS_DATABASE_UPSERT_TASKS');

await upsertTask.call({
  title: 'My Task',
  Status: 'Todo',
  Priority: 'P1',
  Due: '2025-04-01',
  Done: false,
  Count: 5,
});
```

Do NOT pass Notion-style wrappers (`{select: {name: "Todo"}}`) when upserting.

### Design bar (enforced)

Every page must read as a native, flat Notis page. `npx --package @notis_ai/cli@latest -- notis apps build` and the deploy endpoint fail on the banned patterns below with the exact file and line; the only override is an inline `// notis-design-allow: <rule-id> <reason>` comment on the line before (reason required, at least 12 characters). Do not work around a failure by moving the markup elsewhere; fix it.

Banned in `app/` and `components/` (form controls in `components/ui/{input,textarea,checkbox,switch,button}.tsx` are exempt):

- Four-side `border` boxes, `border-dashed`, `divide-*`, `<hr>`, thick `border-l-2` bars, `ring-*` as a box or selection indicator (`focus-visible:ring-2` on controls is fine).
- `shadow-*` on panels, tiles, rows, or bubbles. Only a floating popover or menu may use `shadow-lg` together with `bg-popover`.
- Tailwind palette hues (`emerald-500`, `slate-200`, ...), hex colors, gradients, `backdrop-blur`, `font-serif`.
- Uppercase `tracking-wide` eyebrows and marketing headlines. Page titles are plain nouns matching the route ("Dashboard", "Meetings").
- Text below 12px (`text-[11px]`); use `text-xs` at minimum and `text-sm` for body.
- `Badge variant="outline"`, raw `<select>`, in-app search inputs, duplicate sidebars, untouched scaffold placeholder copy.
- Loading text ("Loading...") or whole-page spinners. Keep headings visible and render `Skeleton` / `ViewSkeleton` from `@notis/sdk` only in the missing region (see the Instant-view contract).

Use instead:

- `Card` from the scaffold: a flat `bg-muted` panel that becomes `bg-background` when nested. Page sections can also be plain `h2` + content with `space-y-8`.
- `.list-row` / `.list-row-selected` from `@notis/sdk/styles.css` for rows and table bodies (tinted on mobile, transparent with hover tint on desktop, selection by tint). Tables are flat on the page: `text-xs` muted header, `text-sm` rows, no wrapping panel.
- Stats as bare figures: `text-xs` label over `text-2xl font-semibold tabular-nums`. Tiles (`rounded-2xl bg-muted p-5`) only when they are the page's single grouping device.
- `PageHeading` for the header, `NativeSelect` for filters, `Badge` variants `default | secondary | destructive`, tokens only (`text-foreground`, `text-muted-foreground`, `text-primary`, `bg-primary/10`, `text-destructive`, `bg-destructive/10`), `tabular-nums` on numbers, `min-w-0` on every grid item that can hold long text.
- One hairline (`border-t` / `border-b border-border`) between major sections or large list entries is the only allowed line.
- List-plus-detail pages are full-bleed: `notis-app-split` with `notis-app-pane-list` (tinted, one `border-r` hairline, fixed width on desktop, stacked on mobile) and `notis-app-pane-detail` (`bg-background`), never the centered `notis-app-shell`.
- Respect the portal theme in both modes. Never hardcode dark mode or an app palette.
- For Notes-style apps, the folder tree belongs to the portal sidebar when configured via `collection.sidebar`. The page content should complement that chrome, not duplicate or replace it.
- Do not render any search input inside the app (in-page search rails, "Ask Notis…" pills, command-palette-style bars, etc.). The portal already owns the top-bar search field. Wire your view to it with `useTopBarSearch({ value, onChange, placeholder, onSubmit })` from `@notis/sdk` and let the page filter or refetch on the values it receives. Use its `setLoading` only for an explicit submitted search, never initial view loading or background refresh.

### Sidebar invariants

- When a user asks for folders, sections, or hierarchy in the app sidebar, express that through `routes` and `collection.sidebar` in `notis.config.ts`.
- Treat an existing collection-tree sidebar as a locked structural requirement unless the user explicitly asks to change navigation architecture.
- If the sidebar appears missing for the installed app, do not silently redesign around it. Preserve the manifest contract, call out the discrepancy, and treat it as a portal/runtime bug.

### Step 3: Root layout

```tsx
import { NotisProvider } from '@notis/sdk';
import '@notis/sdk/styles.css';
import './globals.css';

export default function AppShell({ children }: { children: React.ReactNode }) {
  return <NotisProvider>{children}</NotisProvider>;
}
```

## Manifest Format

Generated by `npx --package @notis_ai/cli@latest -- notis apps build` at `.notis/output/manifest.json`:

```json
{
  "version": 1,
  "spec_version": 4,
  "app": { "name": "My App", "slug": "my-app", "title": "My App", "description": "...", "icon": "phosphor:..." },
  "routes": [
    {
      "path": "/",
      "slug": "index",
      "name": "Dashboard",
      "icon": "phosphor:squares-four",
      "default": true,
      "export_name": "index",
      "collection": null
    }
  ],
  "bundle": {
    "js": "bundle/app.js",
    "css": "bundle/app.css"
  },
  "databases": ["tasks", { "slug": "templates", "seed_documents": true }],
  "tools": ["LOCAL_NOTIS_DATABASE_QUERY"]
}
```

Use canonical `notis-*` tool names for explicit app tool declarations. App-specific TypeScript shapes for tool arguments and results live in the app code; the SDK exposes the generic `useTool<TArgs, TResult>()` hook instead of database-specific tool hooks.

Database strings package schema only. The object form shown above opts that database into copying its current rows as Store starter content. Use it sparingly and only for non-personal fixtures/templates every installer is meant to receive.

For a read-only database catalog app, declare `["LOCAL_NOTIS_DATABASE_LIST_DATABASES", "LOCAL_NOTIS_DATABASE_GET_DATABASE"]`. Use the list tool for the left/catalog pane and the get tool for the selected database detail pane.

## Database Schema

### apps table

| Column | Type | Description |
|---|---|---|
| id | uuid PK | App ID |
| user_id | uuid FK | Owner |
| team_id | uuid FK | Team (nullable) |
| name | text | Display name |
| slug | text UNIQUE | URL slug |
| description | text | App description |
| icon | text | Phosphor icon (e.g. "phosphor:list") |
| status | text | draft, active, archived |
| visibility | text | private, team |
| manifest | jsonb | Latest deployed manifest |
| current_version | integer | Version counter |
| source_listing_id | uuid FK | Source App Store listing for installed store apps; cleared when submitted as a derivative |
| installed_snapshot | jsonb | Store-installed baseline used for update/reset comparison |
| customization_overlay | jsonb | User changes over the installed store baseline |
| update_status | text | up_to_date, update_available, needs_resolution, update_failed |
| bundled_automation_ids | uuid[] | Linked automations |
| bundled_skill_ids | uuid[] | Linked skills |

### databases ownership

Every row in the `databases` table carries `owner_app_id` (uuid FK to
`apps.id`, `ON DELETE CASCADE`): a database belongs to exactly one app, and
deleting the app deletes its databases and their documents (`documents` cascade
from `databases`). Install, resource preparation, and Store updates stamp
`owner_app_id` automatically; standalone creation requires the `app` argument.

### Storage (Supabase)

Files stored in `app-code` bucket at `{app_id}/v{version}/`:
- `manifest.json`
- `bundle/app.js`
- `bundle/app.css`

Editable source snapshots are stored in the private `app-source` bucket at
`{app_id}/v{version}/`. Portal App Store listing screenshots are uploaded to
the public `app-listing-assets` bucket before submission.

### Related tables

- **databases** -- Apps reference these rows by slug. Schema lives on the database row (`schema_metadata` / `original_fields`), not in the app manifest.
- **documents** -- `database_id` links to databases. Properties in `properties` jsonb.
- **app_store_listings** -- Snapshots for publishing to the app store.
- **app_submissions** -- Portal review submissions keyed to an app source version and registry slug.

## Server Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/portal_views/get` | GET | Route detail + runtime descriptor with signed bundle URLs |
| `/portal_views/runtime_query` | POST | Proxy tool calls and DB operations |
| `/portal_views/collection_items` | GET | List collection items |
| `/portal_views/collection_tree` | GET | List normalized collection tree nodes for a tree sidebar route |
| `/portal_views/collection_tree/create` | POST | Create a root or child collection row from the sidebar |
| `/portal_views/collection_tree/rename` | POST | Rename a collection tree item inline |
| `/portal_views/collection_tree/delete` | POST | Delete a collection tree item from the sidebar |
| `/portal_apps/list` | GET | List apps |
| `/portal_apps/get` | GET | Get app detail |
| `/portal_apps/publish` | POST | Submit a deployed app source snapshot for public store review |
| `/portal_apps/listing_assets/upload` | POST | Legacy pre-manifest screenshot upload; do not use for current manifest-media workflows |
| `/portal_apps/submissions` | GET/PATCH | List or edit App Store submissions |
| `/portal_apps/submissions/withdraw` | POST | Close a pending App Store submission |
| `/cli_tools` | POST | CLI tool execution (save_app_files, create_app, etc.) |

## SDK Hook Reference

All hooks and components below are imported from `@notis/sdk`. `NotisProvider`
already installs `ShortcutProvider`; app code should not add a second provider.

| API | Signature | Description |
|-----|-----------|-------------|
| `useNotis()` | `() => { app, route, databases, collectionItem, resourceId, ready }` | App metadata, current route, selected collection item, decoded exact-resource id, ready state |
| `useTool<TArgs, TResult>(name)` | `(name: string) => { call, loading, error }` | Call a declared tool with app-defined argument/result types. Identical idempotent reads may use `call(args, { dedupe: true })`; never dedupe writes |
| `useTools()` | `() => { tools, loading }` | List available tools |
| `useNotisNavigation()` | `() => { toRoute, toDocument, toApp }` | Navigate between routes (including `toRoute(path, { resourceId })`), documents, or the app root |
| `useTopBarSearch(opts)` | `({ value, onChange, placeholder?, onSubmit? }) => { setLoading }` | Bind the current view to the Portal-owned top-bar search input |
| `useBackend()` | `() => { request }` | Raw backend request proxy with JWT auth |
| `useDatabaseSubscription(slug, opts?)` | `(slug: string, opts?) => { rows, documents, loading, error, refetch, live }` | Query a database and refetch it when its rows change. `live` is false on hosts without a change feed (temporary test harness, vite preview) -- keep a manual refresh for those |
| `useHandover()` | `() => { handover, pending, error, available }` | Open manager chat with app/resource context plus an optional starter prompt or declared skill. Omit `prompt` for a context-only composer. `available` is false on hosts with no chat -- fall back to a copyable prompt |
| `useCloudComputer()` | `() => { facts, loading, error, refresh }` | Read-only cloud computer facts: sandbox existence/status and whether the GitHub CLI is signed in. Requires `capabilities.cloudComputer: 'read'` plus the user's approval; `facts.available === false` means answer from the app's own fallback |
| `useActiveResource(resource)` | `(ContextResource \| null) => void` | Publish the record currently open in the app so manager handover and context menus stay grounded |
| `useCollectionInteractions(opts)` | `(opts) => CollectionInteractionController` | Keyboard navigation, active-row state, range/toggle selection, marquee selection, and action dispatch for collection UIs |
| `useShortcuts(definitions, opts?)` | `(definitions, opts?) => void` | Register scoped keyboard shortcuts. Editable targets are ignored unless explicitly allowed; use `ShortcutHints` to display them |
| `MarkdownEditor` | `(NotisMarkdownEditorProps) => ReactElement` | Use the host editor with app-owned persistence, stable `resourceKey`, revision-aware `onSave`, and optional `onUploadFile` returning a durable URL |
| `NotisSelectionBoundary` | `(NotisSelectionBoundaryProps) => ReactElement` | Attach structured, explicitly untrusted app/resource/selection context to selected content and copy operations |
| `SelectionCheckbox` / `SelectionMarquee` | components | Standard selection controls backed by `useCollectionInteractions` |
| `MultiSelectActionBar` | component | Standard bulk actions with pending/disabled state and shortcut support |

Import headless collection action types and helpers from
`@notis/sdk/interactions`. Keep an open detail view synchronized with
`useActiveResource`, and wrap its selectable content in
`NotisSelectionBoundary` so the manager receives both the active record and the
user's exact selection. For `MarkdownEditor`, keep `resourceKey` stable per
record, pass the latest revision back from `onSave`, reject revision conflicts
instead of overwriting newer data, and implement `onUploadFile` whenever the
editor should accept media or file blocks.

### App configuration additions

- `toolBindings` is only for provider-generated public tool names whose upstream
  action cannot be reconstructed. Keep the exact final public `name` in
  `tools`, then bind it to `providerToolName`; the public name remains the
  permission boundary.

### Typed tool calls

`useTool` accepts generic argument and result types. Query the database at dev time to discover actual property shapes, then keep those types in the app:

```tsx
type QueryTasksArgs = { database_id?: string; database_slug?: string; query: { page_size?: number } };
interface TaskDoc {
  title: string;
  properties: {
    Status: string;
    Priority: string;
    Due: string;
  };
};
type QueryTasksResult = { documents: TaskDoc[] };

const queryTasks = useTool<QueryTasksArgs, QueryTasksResult>('LOCAL_NOTIS_DATABASE_QUERY');
const result = await queryTasks.call({ database_id: 'tasks-db-id', query: { page_size: 25 } });
// result.documents[0].properties.Status is typed as string
```

## Testing

Build and automated stub verification precede release. `verify` and `screenshot` start temporary,
explicit test servers only: no folder discovery, watchers, Desktop registration, persistent roots,
consumer leases or Workspace mounting. They close server/browser resources at completion or interruption.
Build also enforces the design bar and refreshes the app's embedded SDK copy. Automated verification
checks every route at desktop (1280px) and phone (390px) widths, including nested boxes, text below
12px, lingering loading placeholders and horizontal overflow. Standalone verification writes a
local diagnostic report; deploy always verifies its own frozen snapshot, with no stamp or environment bypass.
After release, verify live runtime integration and open the installed bundle in Portal. Source edits
and Desktop restarts cannot change the running version.

### Screenshots

`apps screenshot` supports declared screenshot scenarios and stub fixtures. A scenario can set
`theme: 'dark'`; use `--raw` for uncomposited captures. Store screenshots and listing readiness
are required only for Publish to Store, never for Update app.

### Headless harness verification

Run `npx --package @notis_ai/cli@latest -- notis apps verify` after `npx --package @notis_ai/cli@latest -- notis apps build`. Use `--mode live` after deploy to exercise the real `/portal_views/runtime_query` with the CLI JWT instead of stub data; live mode also fails a route whose runtime calls all errored, which a well-behaved error state would otherwise hide. In a hosted sandbox, put `agent-browser` on the verification process's `PATH` with the combined-package command above. `--no-browser` only prints URLs for manual triage and does not satisfy the automated deployment gate.

#### What the harness catches that `npx --package @notis_ai/cli@latest -- notis apps build` does not

- Hooks that mount but throw on first read (`useTool` called with the wrong tool name or argument shape, accessing nested props that are undefined).
- Runtime database queries whose slug is not declared by the app, and collection routes that never query their configured collection database. Declared databases may also support automations or agent workflows, so ordinary routes do not need to query every app database.
- Tool names referenced by hooks but missing from `notis.config.ts -> tools`.
- Suspense / async boundaries that never resolve because a runtime stub returned the wrong shape.
- Render-time exceptions that the portal would surface as the `View crashed` error boundary.

#### What the harness does not catch

- Bugs that only manifest with real backend data (auth-scoped filters, RLS, malformed prod records). For those, swap the stub runtime for a real one that posts to `/portal_views/runtime_query` with a JWT.
- Pixel-level visual regressions beyond the automated design checks (the harness does flag nested boxes, sub-12px text, lingering loading placeholders, and horizontal overflow at 390px). For anything else, use `agent-browser screenshot` + a baseline compare.
- Bugs that depend on the portal's shadow-DOM stylesheet wrapping. The harness mounts in light DOM, so global Tailwind/shadcn classes work normally; portal-specific theme tokens injected as inline styles are not present.

## Troubleshooting

### Common issues

- **Deploy transport failure**: Run `notis doctor` and read back the exact app/version. Never blindly retry an unknown outcome or write directly to storage.
- **App shows old code after deploy**: Bundle cache is stale. Hard refresh (Cmd+Shift+R) or clear site data in DevTools.
- **App is missing from Workspace**: Inspect its exact installed version. Unreleased containers have no runnable routes. A successful release appears through ordinary refresh/navigation.
- **`LOCAL_NOTIS_DATABASE_QUERY` returns empty documents**: Check that the database ID passed to the tool matches the intended database. Use `npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_LIST_DATABASES --arguments '{}'` to verify the ID; use the database slug only as a fallback.
- **Properties are `undefined`**: Keep app-local result types for `useTool<TArgs, TResult>` and guard optional nested properties when reading live data.
