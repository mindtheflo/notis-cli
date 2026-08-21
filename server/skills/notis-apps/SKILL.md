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

## App Workspace Tool Rules

- Apps are the top-level packaging unit in Notis.
- Use `LOCAL_NOTIS_CREATE_APP` to register a new app, then use the Notis CLI in the shell to build and deploy it.
- Use `LOCAL_NOTIS_UPDATE_APP` to update app metadata.
- Use `LOCAL_NOTIS_LIST_APPS` to discover the user's apps.
- The full app lifecycle uses the CLI in the shell. Always run it through the registry-resolved package, for example `npx --package @notis_ai/cli@latest -- notis apps init`; use the same prefix for `build` and `deploy`. In hosted shells, the CLI is pre-authenticated through `NOTIS_JWT`.
- There are no `save_app` or `load_app` tools. Do not attempt to call them. Use only the CLI for app file operations.
- Use `npx --package @notis_ai/cli@latest -- notis apps scaffolds list` to discover bundled starting points before scaffolding.
- Use `LOCAL_NOTIS_LIST_PUBLIC_APP_STORE` only to help users choose apps to install, not as a source-clone workflow.
- Use `LOCAL_NOTIS_INSTALL_APP` only when the user explicitly wants to install from a listing.
- Before installing, inspect the listing's `required_capabilities`. Explain each
  requested capability and obtain explicit approval; only then pass the matching
  token in `approved_capabilities`. Never infer capability approval. The current
  workspace-wide read token is `workspace_databases_read`; the read-only
  cloud computer token is `cloud_computer_read`.

## Architecture

```
Notis CLI (local workspace or Vercel Sandbox)
  -> Vite + React project with @notis/sdk
  -> notis apps init / dev / build / verify / create / link / pull / deploy
  -> ES module bundle (app.js + app.css) + manifest
  -> Portal renders as React component with real tools/databases
```

`deploy` updates the linked installed app for the current account or team. After the user explicitly confirms the App Details page is ready, `apps publish --confirm-ready` submits that deployed version to the Team or Public Store review flow.

### Key Components

1. **@notis/sdk** (`packages/sdk/`) -- SDK for app developers
   - `@notis/sdk` -- NotisProvider and generic runtime hooks such as useTool and useTools
   - `@notis/sdk/config` -- `defineNotisApp()` for notis.config.ts
   - `@notis/sdk/vite` -- `notisViteConfig()` for vite.config.ts
   - `@notis/sdk/styles.css` -- shadow-safe app shell styles and base app-surface classes

2. **CLI** (`packages/cli/src/command-specs/apps.js`) -- local development should center on `apps dev`, plus init, build, verify, create, deploy, link, pull, doctor, and list

3. **Server** (`server/routers/portal_views/`) -- Returns signed bundle URLs, proxies tool calls

4. **Portal** (`portal/src/components/apps/`) -- Renders app bundles as React components via AppViewRenderer

### Runtime Bridge

Apps communicate with the platform through the `NotisRuntime` interface, provided by the portal via React context:

- **Portal development**: the portal loads a local bundle for an active dev session and still provides a real `NotisRuntime`.
- **Portal**: the portal creates a real `NotisRuntime` and passes it as a prop to `NotisProvider`. All calls go to `/portal_views/runtime_query` via fetch with the user's JWT.
- The portal mounts the app inside a shadow-scoped content surface and injects the runtime before app mount. There is no supported window-global runtime fallback.

App code never accesses the runtime directly -- it uses SDK hooks (`useTool`, `useTools`, `useNotis`, etc.) which read from the `NotisProvider` context.

## Hard Rules

1. **React + Vite only** -- No Next.js, no custom server
2. **ES module bundle** -- Vite builds a library-mode bundle with React externalized
3. **Component rendering** -- Apps render as React components directly in the portal. No iframes.
   The portal owns the `ShadowRoot`, theme tokens, and runtime provider.
4. **HTTP bridge** -- Runtime calls use fetch to `/portal_views/runtime_query`
5. **Declarative tools** -- Tool access is declared in `notis.config.ts` by the final names returned by tool discovery and enforced server-side. Views can call native Notis, connected integrations, PostForMe, and MCP tools directly; metered calls use the same credit-cap and usage-billing path as the CLI.
6. **shadcn + Notis theme** -- Apps must use shadcn components with the live Notis theme provided by the portal
7. **Phosphor icons only** -- Always `phosphor:` prefix. Never emojis.
8. **Database refs only** -- `notis.config.ts` references existing databases by slug. The schema source of truth lives in the `databases` table, not in the manifest. Every native database is owned by exactly one app (`databases.owner_app_id`): creating one through `LOCAL_NOTIS_DATABASE_UPSERT_DATABASE` requires the owning app's slug or id in the `app` argument, install/dev materialization stamps ownership automatically, and deleting an app deletes its databases and their documents.
   An app-owned database slug is a stable deployed contract because bundles and
   collection routes may call it directly. Do not try to rename that slug with
   a schema tool; rename the display title instead.
9. **Use NPX for CLI commands** -- Always run `npx --package @notis_ai/cli@latest -- notis ...`.
10. **`apps deploy` is not store publishing** -- `apps deploy` updates an installed app only and persists its source snapshot. Store review starts separately with `apps publish --confirm-ready` after explicit user approval.
11. **Routes are canonical** -- Define navigation only in `manifest.routes`. Every configured route must declare an explicit `slug`. Do not rely on legacy `manifest.views`.
12. **Portal-owned sidebars stay portal-owned** -- If a route uses `collection.sidebar`, treat that sidebar as platform chrome. Do not remove it, recreate it inside app JSX, or replace it with a custom in-app folder rail.
13. **Portal globals are off-limits** -- Never use `window.__NOTIS_RUNTIME__`, query portal-owned DOM hooks, or create global DOM portals.
14. **Prefer inline optimistic edits** -- Rename-like edits for collections, app-owned rows, and sidebar-backed entities should use inline editing with an optimistic UI update, then roll back on backend failure. Use modals only when the edit requires multiple fields or destructive confirmation.
15. **Local development first; deploy is user-gated** -- Iterate with `apps dev` and let the **user** test the app in the desktop **Local development** sidebar group. Do NOT run `apps create` or `apps deploy` on your own initiative, even after a clean build and verify. `deploy` installs the app onto the user's account and is a one-directional, outward-facing action — treat it like publishing: only run it when the user has tested the local build and **explicitly asks you to deploy**. Building a new app end-to-end without deploying is the expected, complete outcome. (See the **Local-development-first handoff** in the Workflow.)
16. **Installed app links are explicit** -- A mounted dev session updates an installed workspace app only when the local checkout is linked by app id in `.notis/state.json` and the dev-session registry mirrors that id. Name or slug matches may be suggestions, never update targets. After first install, keep that link so Portal and CLI show/update the same app instead of creating duplicates.
17. **Development identities stay separate** -- `.notis/state.json` uses `dev_app_id` for the hidden development-runtime row and `app_id` only for an accessible installed workspace app. The Electron registry mirrors the installed id as `targetAppId`. Never pass a runtime app whose manifest has `is_dev: true` to `notis apps link`; it is not an install/update target. Current CLIs reject that link and repair stale hidden, deleted, or inaccessible targets on the next `apps dev` without erasing valid state on transport or authentication failures.
18. **Mounted means Portal-acknowledged** -- A running process or HTTP 200 proves only that the app is serving. Before telling the user an app is mounted, require the current `apps dev` process to report `Mounted in <target desktop>`. The CLI selects the target from the active Notis profile: normal CLI runs target the signed-in Notis or Notis Beta desktop, while a CLI running inside an active Notis source workspace targets that workspace's matching desktop instance. The exact session/app/slug/nonce acknowledgment is accepted only from the visible target window after the app enters its final **Local development** sidebar model. Route rendering is a separate proof: when UI verification is required, also open the app and require `Rendered in <target desktop>`.
19. **Store submission is user-gated** -- Run `apps publish --confirm-ready` only after the user explicitly confirms the current App Details page and Store listing are ready. Deploy the exact approved local state first. The command must reject missing confirmation, incomplete listing media, a local/deployed version mismatch, private visibility, or an existing pending review.
20. **Bump `notisAppVersion` for every Store update** -- `package.json` must contain a semver `notisAppVersion`. For an existing Store app, increment it beyond the currently published registry version before deploy and submission; registry CI rejects equal or lower versions.
21. **`CHANGELOG.md` owns release history** -- Keep the complete release history in one root `CHANGELOG.md`, newest entry first. Do not add new `versionNotes` values to `notis.config.ts`. Use `## [Release title] - YYYY-MM-DD`, or `{PR_MERGE_DATE}` for an unpublished entry. App Details reads **What’s New** and **Version History** from the deployed package manifest, while the Store reads them from the latest published snapshot; unpublished workspace edits must never change the Store page. The manifest also exposes `package.json` `notisAppVersion` as the package version shown in App Details.
22. **Database rows are private unless explicitly seeded** -- A string declaration such as `databases: ['notes']` publishes schema only and never includes the developer's rows. Use `{ slug: 'templates', seedDocuments: true }` only for small, intentional starter content that every installer should receive. Never enable it for user-created notes, history, leads, or other personal data.
23. **Public submissions are complete, reviewable packages** -- The registry PR must contain the full editable source tree, Store assets, exact source-declared database schemas, and only explicitly seeded starter rows. Registry CI validates those boundaries before merge; do not hand-edit `notis-listing.json` or strip source files to make a check pass. Fix the app locally, redeploy, and resubmit.

## Anti-patterns -- NEVER do these

These are the most common mistakes agents make. Each one wastes time and produces broken results.

- **NEVER assume app deploys create databases for you** -- Create or update databases through native Notis database tools or the assistant first, then reference them by slug in `notis.config.ts`. Database creation requires the owning app to exist: pass its slug or id in the `app` argument of `LOCAL_NOTIS_DATABASE_UPSERT_DATABASE` (create the app first with `LOCAL_NOTIS_CREATE_APP` if needed). A database can only be referenced by the app that owns it.
- **NEVER bypass the supported workflow by manually stitching together low-level save or lint calls from a local workspace** -- Local agents should go through the NPX Notis CLI for `apps pull`, `apps dev`, `apps build`, `apps verify`, `apps create`, `apps link`, and `apps deploy`.
- **NEVER invent a Store clone path** -- `npx --package @notis_ai/cli@latest -- notis apps pull` only pulls source for an app the user can already access as an installed app. Pulling source directly from arbitrary Store listings is not supported yet.
- **NEVER deploy on your own initiative** -- A clean `apps build` + `apps verify` is NOT a signal to deploy. `apps create` / `apps deploy` install the app onto the user's account; run them only after the user has tested the local (`apps dev`) build and explicitly asked you to deploy. When you finish building, hand off for local testing and stop — do not create or deploy unprompted.
- **NEVER submit without explicit approval** -- A deploy request alone does not authorize Store submission. Run `npx --package @notis_ai/cli@latest -- notis apps publish --confirm-ready` only when the user confirms App Details is ready for Store review.
- **NEVER write raw `views/<slug>/index.js` files** -- Write standard React pages in `app/`.
- **NEVER invent `npx --package @notis_ai/cli@latest -- notis apps push` or bypass the review flow** -- Source moves through `apps pull` and `apps deploy`; `apps publish --confirm-ready` submits the deployed snapshot through the same authenticated review endpoint as App Details.
- **NEVER treat `apps deploy` as store submission** -- It updates the linked installed app for the current account or team scope only. Store submission is a separate, explicitly confirmed step.
- **NEVER explore server code or tool schemas to invent an alternative app workflow** -- Use the Notis CLI.
- **NEVER work around a missing `collection.sidebar` portal tree by rendering a duplicate sidebar inside the app** -- keep the route manifest as the source of truth and escalate the missing portal sidebar as a platform bug instead.
- **NEVER invent a custom visual language** -- Do not ship full-screen gradients, glassmorphism, bright neon palettes, or raw HTML controls as the primary UI. Apps should look like a natural extension of the portal.
- **NEVER hand-roll buttons/cards/badges when the scaffold already provides shadcn primitives** -- Prefer `@/components/ui/*` and portal token classes such as `bg-background`, `bg-card`, `border-border`, and `text-muted-foreground`.

## Workflow

**Default to the bundled scaffold catalog, not a blank project.** Most user requests overlap with one of the scaffolds shipped inside the CLI. Starting from a bundled scaffold is faster than a bare app and does not require backend Store access.

1. **Find a starting point.** Run `npx --package @notis_ai/cli@latest -- notis apps scaffolds list`. If something close matches, run `npx --package @notis_ai/cli@latest -- notis apps init "My App" --from <slug>`. Only run plain `npx --package @notis_ai/cli@latest -- notis apps init "My App"` when no scaffold fits.
2. **Pull only installed apps.** If the user explicitly wants to fork an app they already installed, run `npx --package @notis_ai/cli@latest -- notis apps list`, then `npx --package @notis_ai/cli@latest -- notis apps pull <app-id> ./<dir>`. To fork a Store app that is not installed, tell the user to install it from `/store` first.
3. **Edit the listing source.** Update `name` (slug), `title`, description, icon, accent, author, categories, tagline, databases, routes, and tools in `notis.config.ts`. Declare a database as a string for schema-only Store packaging; use `{ slug: 'templates', seedDocuments: true }` only when its rows are deliberate starter content for every installer. Keep the complete Store release history in the root `CHANGELOG.md`, newest entry first, using `## [Release title] - YYYY-MM-DD` (or `{PR_MERGE_DATE}` before publication). The first entry powers **What’s New** and the same file powers **Version History**. `icon` is a `phosphor:<name>` value or `metadata/icon.png`; when unset the app shows its **two-letter initials** everywhere (store, sidebar, app details). `accent` optionally pins the avatar color to one of `blue|violet|emerald|amber|rose|sky|fuchsia|teal` (default derived from the app id). Icon/accent flow through deploy onto the app row + listing and can also be set later via the `update_app` tool.
4. **Build pages in `app/`.** Reuse scaffold code wherever it fits.
5. **Iterate live.** Run `npx --package @notis_ai/cli@latest -- notis apps dev` so the target desktop's **Local development** sidebar group discovers the app and renders the local bundle. Keep this command running for as long as the user is testing; stopping it removes the temporary Local development entry. Read the command's `Target desktop` line instead of guessing between Notis, Notis Beta, or a source-workspace desktop. Add `--live-data` to point the session at the installed app's real databases instead of its own empty dev copies -- it applies to that session only, and warns and falls back when the app has not been deployed yet.
6. **Capture listing screenshots.** Declare 3–6 screenshots in `notis.config.ts`, each with a stable `path`, descriptive `alt`, and optional `route`/`scenario`/`focus`/`theme`, then run `npx --package @notis_ai/cli@latest -- notis apps screenshot`. Use `focus` to frame a real app root without empty browser canvas; use `theme: 'light'` or `theme: 'dark'` to match both the Portal render and Store backdrop, and pair both modes when that best represents the app. It renders the configured states in a headless harness and writes exact 2000x1250 PNGs under `metadata/`, using the deterministic Store presentation by default (`--raw` is diagnostic only). Apps are icon-led like Raycast — the icon set in `notis.config.ts` represents the app, so there is no cover image, only these screenshots. Never hand-author the PNGs; regenerate them when routes or UI change.
7. **Verify locally.** Run `npm install`, then `npx --package @notis_ai/cli@latest -- notis apps build` and `npx --package @notis_ai/cli@latest -- notis apps verify`. Surface the verify report and fix failures.
8. **Local-development-first handoff — STOP HERE.** Keep `apps dev` running and hand off to the user: tell them the app is live in the target desktop's **Local development** sidebar group (green `DEV` badge) and ask them to test it there. Building a new app to this point, without deploying, is a **complete and expected** result. Do NOT proceed to `apps create` / `apps deploy` yet — wait for the user to test and explicitly ask to deploy. (`apps dev` is what puts the app in Local development; without a running session the app never appears there.) **Before handing off, complete all three acceptance checks:**
   1. Target: capture the CLI's `Target desktop: <name>` line and make sure that exact desktop app is running and signed in.
   2. Bundle: the reported loopback `/snapshot` URL responds successfully and contains the expected manifest/routes.
   3. Mount and render: require `Mounted in <target desktop>: <app name>`. If the task includes UI or runtime behavior, open the default route and also require `Rendered in <target desktop>: <app name>`. If the CLI says only `Serving locally`, do not claim the app is mounted.
   See Troubleshooting → *App is missing from Local development* if any check fails.
9. **Deploy only when the user asks.** Once the user has tested locally and explicitly requests a deploy, run `npx --package @notis_ai/cli@latest -- notis apps create "<name>" .` (first time) then `npx --package @notis_ai/cli@latest -- notis apps deploy --direct`, or link first with `npx --package @notis_ai/cli@latest -- notis apps link <id> .` / pass `--app-id <id>` for an existing app. Deploy installs or updates the app on the user's account (it appears under **Workspace**, not Local development). After first install, `.notis/state.json` must point at the installed app id so future local-dev actions become **Update**, not another **Install**.
10. **Submit only after confirmation.** When the user explicitly confirms the current App Details page is ready, ensure the approved state is deployed, then run `npx --package @notis_ai/cli@latest -- notis apps publish --confirm-ready`. The command submits Team apps immediately or opens the Public Store registry review PR. Without that confirmation, stop after deploy.

### Quick start

Steps 1–3 are the agent's job on a build request. Step 4 is **user-gated** — do not run it until the user has tested the local build and asked you to deploy.

```bash
# 1. Pick a scaffold and scaffold
npx --package @notis_ai/cli@latest -- notis apps scaffolds list
npx --package @notis_ai/cli@latest -- notis apps init "My App" --from <scaffold-slug>
cd my-app
npm install

# 2. Develop against the Electron Portal, then HAND OFF for the user to test.
#    Keep this running — it is what surfaces the app in the Local development
#    sidebar group. This is the finish line for a build request.
npx --package @notis_ai/cli@latest -- notis apps dev
# ... iterate until the app looks right in the Local development sidebar group ...

# 3. Build, capture listing screenshots, and verify (still local — no deploy)
npx --package @notis_ai/cli@latest -- notis apps build
npx --package @notis_ai/cli@latest -- notis apps screenshot
npx --package @notis_ai/cli@latest -- notis apps verify

# 4. ONLY after the user tested locally and asked to deploy: create + deploy.
#    This writes .notis/state.json so future deploys update this app.
npx --package @notis_ai/cli@latest -- notis apps create "My App" .
npx --package @notis_ai/cli@latest -- notis apps deploy --direct

# 5. ONLY after the user explicitly confirms App Details is ready for Store review
npx --package @notis_ai/cli@latest -- notis apps publish --confirm-ready
```

If deploying to an existing app without linking first, pass `--app-id` directly. Prefer linking when this checkout will keep being used for development:

```bash
npx --package @notis_ai/cli@latest -- notis apps link <app-id> .
npx --package @notis_ai/cli@latest -- notis apps deploy --direct --app-id <app-id>
```

Or if editing an installed app:

```bash
npx --package @notis_ai/cli@latest -- notis apps list
npx --package @notis_ai/cli@latest -- notis apps pull <installed-app-id> ./my-app
cd my-app
npm install
npx --package @notis_ai/cli@latest -- notis apps dev
npx --package @notis_ai/cli@latest -- notis apps build
npx --package @notis_ai/cli@latest -- notis apps verify
npx --package @notis_ai/cli@latest -- notis apps deploy --direct --app-id <existing-app-id>
```

## Building an App

### Step 1: Define the config

Create `notis.config.ts` with:
- **name** -- Display name
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

### Step 2: Build pages

Standard React pages in `app/`. Use generic SDK tool hooks for data and build on top of the scaffolded shadcn components and portal shell classes (`notis-app-shell`, `notis-app-surface`):

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useTool } from '@notis/sdk';
import { Card } from '@/components/ui/card';

type QueryTasksArgs = { database_id?: string; database_slug?: string; query: { page_size?: number } };
type TaskDoc = { document_id?: string; id?: string; title?: string; properties?: Record<string, unknown> };
type QueryTasksResult = { documents?: TaskDoc[] };

export default function TasksPage() {
  const queryTasks = useTool<QueryTasksArgs, QueryTasksResult>('LOCAL_NOTIS_DATABASE_QUERY');
  const [documents, setDocuments] = useState<TaskDoc[]>([]);

  useEffect(() => {
    void queryTasks
      .call({ database_id: 'tasks-db-id', query: { page_size: 25 } })
      .then((result) => setDocuments(result.documents || []));
  }, [queryTasks.call]);

  if (queryTasks.loading) return <div>Loading...</div>;

  return (
    <div className="p-6 space-y-4">
      {documents.map((doc) => (
        <Card key={doc.id || doc.document_id} className="p-4">
          <h3>{doc.title || 'Untitled'}</h3>
          <p className="text-muted-foreground">{String(doc.properties?.status || '')}</p>
        </Card>
      ))}
    </div>
  );
}
```

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

### Design rules

- Start from the scaffolded `@/components/ui/*` components before writing new UI primitives.
- Use restrained portal surfaces: `bg-background`, `bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`.
- Keep layouts compact and dashboard-like. Prefer cards, sections, badges, and tables over marketing-style hero treatments.
- Respect the portal theme. Do not hardcode dark mode or create an app-specific palette.
- If a screen looks like a standalone microsite instead of a portal tool, it is too custom.
- For Notes-style apps, the folder tree belongs to the portal sidebar when configured via `collection.sidebar`. The page content should complement that chrome, not duplicate or replace it.
- Never indicate selected items with a heavy left-border bar (e.g. `border-l-2 border-l-foreground` paired with a muted background). It looks dated and clashes with the portal chrome. Use a single subtle background change (`bg-muted` for selected, `hover:bg-muted/50` for hover) and let typography or an icon carry the rest of the state.
- Do not render any search input inside the app (in-page search rails, "Ask Notis…" pills, command-palette-style bars, etc.). The portal already owns the top-bar search field. Wire your view to it with `useTopBarSearch({ value, onChange, placeholder, onSubmit })` from `@notis/sdk` and let the page filter or refetch on the values it receives. The hook also exposes `setLoading` so the standard top-bar spinner reflects in-flight queries.

### Sidebar invariants

- When a user asks for folders, sections, or hierarchy in the app sidebar, express that through `routes` and `collection.sidebar` in `notis.config.ts`.
- Treat an existing collection-tree sidebar as a locked structural requirement unless the user explicitly asks to change navigation architecture.
- If the sidebar appears missing in the Local development sidebar group or deployed portal build, do not silently redesign around it. Preserve the manifest contract, call out the discrepancy, and treat it as a portal/runtime bug.

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
  "app": { "name": "My App", "description": "...", "icon": "phosphor:..." },
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
from `databases`). Install, dev materialization, and store updates stamp
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

All hooks are imported from `@notis/sdk`:

| Hook | Signature | Description |
|------|-----------|-------------|
| `useNotis()` | `() => { app, route, context, ready }` | App metadata, current route, generic portal context, ready state |
| `useTool<TArgs, TResult>(name)` | `(name: string) => { call, loading, error }` | Call a specific tool by name with app-defined argument and result types |
| `useTools()` | `() => { tools, loading }` | List available tools |
| `useNotisNavigation()` | `() => { toRoute, toDocument, toApp }` | Navigate between routes, documents, or the app root |
| `useTopBarSearch(opts)` | `({ value, onChange, placeholder?, onSubmit? }) => { setLoading }` | Bind the current view to the Portal-owned top-bar search input |
| `useBackend()` | `() => { request }` | Raw backend request proxy with JWT auth |
| `useDatabaseSubscription(slug, opts?)` | `(slug: string, opts?) => { rows, documents, loading, error, refetch, live }` | Query a database and refetch it when its rows change. `live` is false on hosts without a change feed (dev harness, vite preview) -- keep a manual refresh for those |
| `useHandover()` | `() => { handover, pending, error, available }` | Hand a prompt (optionally bound to a declared skill) to the Notis manager chat, which owns progress, billing and cancellation. `available` is false on hosts with no chat -- fall back to a copyable prompt |
| `useCloudComputer()` | `() => { facts, loading, error, refresh }` | Read-only cloud computer facts: sandbox existence/status and whether the GitHub CLI is signed in. Requires `capabilities.cloudComputer: 'read'` plus the user's approval; `facts.available === false` means answer from the app's own fallback |

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

## Development Modes

### Canonical local development

```bash
npx --package @notis_ai/cli@latest -- notis apps dev
```

Runs the real desktop-local development workflow. The CLI should discover all apps in the target workspace, serve their bundles from loopback, and surface them in the Electron Portal's Local development sidebar group through the local desktop session registry.

## Deploy Without Backend Server

If the live API is unreachable, use `--direct`:

```bash
npx --package @notis_ai/cli@latest -- notis apps deploy --direct
```

This uploads the bundle and editable source snapshot directly to Supabase storage and updates the app manifest in the database, bypassing the API server. The CLI auto-falls back to direct mode on network errors. Localhost backends are reserved for `/notis-tests` via `./dev.sh`; do not retarget the personal CLI lane at loopback from this skill.

## Testing

1. **Build validation**: `npx --package @notis_ai/cli@latest -- notis apps build` must succeed without errors. Vite surfaces TypeScript and bundling errors during this step.
2. **Headless render verification** (recommended after every build): run `npx --package @notis_ai/cli@latest -- notis apps verify`. It builds unless `--skip-build` is passed, spins up a loopback harness, drives `agent-browser` against every route, and reports per-route pass/fail with captured render errors and runtime calls.
3. **Local development acceptance**: Require the running CLI to name the intended desktop and report `Mounted in <target desktop>`, which proves the exact nonce-backed session entered that visible desktop's final `Local development` sidebar model. Bundle HTTP health alone proves only `Serving locally`. When the task includes UI, runtime behavior, or visual acceptance, open the default route and also require `Rendered in <target desktop>` before claiming the app works.
4. **Post-deploy**: Verify the deployed bundle via `/portal_views/get` -> `runtime_descriptor.bundle.js_url`, then verify the app renders in the portal. The portal renders app bundles directly as React components, so the fastest verification is navigating to the app page in the portal.

### Headless harness verification

Run `npx --package @notis_ai/cli@latest -- notis apps verify` after `npx --package @notis_ai/cli@latest -- notis apps build`. Use `--mode live` after deploy to exercise the real `/portal_views/runtime_query` with the CLI JWT instead of stub data. If `agent-browser` is unavailable, pass `--no-browser` to print URLs and use `--keep-open` for interactive triage with `notis-browser-control`.

#### What the harness catches that `npx --package @notis_ai/cli@latest -- notis apps build` does not

- Hooks that mount but throw on first read (`useTool` called with the wrong tool name or argument shape, accessing nested props that are undefined).
- Runtime database queries whose slug is not declared by the app, and collection routes that never query their configured collection database. Declared databases may also support automations or agent workflows, so ordinary routes do not need to query every app database.
- Tool names referenced by hooks but missing from `notis.config.ts -> tools`.
- Suspense / async boundaries that never resolve because a runtime stub returned the wrong shape.
- Render-time exceptions that the portal would surface as the `View crashed` error boundary.

#### What the harness does not catch

- Bugs that only manifest with real backend data (auth-scoped filters, RLS, malformed prod records). For those, swap the stub runtime for a real one that posts to `/portal_views/runtime_query` with a JWT.
- Visual regressions (use `agent-browser screenshot` + a baseline compare if you need this).
- Bugs that depend on the portal's shadow-DOM stylesheet wrapping. The harness mounts in light DOM, so global Tailwind/shadcn classes work normally; portal-specific theme tokens injected as inline styles are not present.

## Troubleshooting

### Common issues

- **Deploy fails with network error**: Backend server not running. Use `npx --package @notis_ai/cli@latest -- notis apps deploy --direct` or start the server.
- **App shows old code after deploy**: Bundle cache is stale. Hard refresh (Cmd+Shift+R) or clear site data in DevTools.
- **App is missing from Local development**: Read the `Target desktop` line from `apps dev`, then bring that exact Notis app forward and confirm it is signed into the same account reported by `npx --package @notis_ai/cli@latest -- notis whoami`. Keep `apps dev` running. If it still says only `Serving locally`, run `npx --package @notis_ai/cli@latest -- notis doctor`, restart the target desktop, and retry `apps dev`. Do not redirect internal registry files manually: the CLI selects the normal Notis/Notis Beta target from the active profile and selects a source-workspace desktop only when an active workspace runtime identifies it. Wait for `Mounted in <target desktop>` before claiming success; when validating UI or runtime behavior, open the route and wait for `Rendered in <target desktop>` too.
- **`LOCAL_NOTIS_DATABASE_QUERY` returns empty documents**: Check that the database ID passed to the tool matches the intended database. Use `npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_LIST_DATABASES --arguments '{}'` to verify the ID; use the database slug only as a fallback.
- **Properties are `undefined`**: Keep app-local result types for `useTool<TArgs, TResult>` and guard optional nested properties when reading live data.
