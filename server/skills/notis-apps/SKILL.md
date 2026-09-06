---
name: notis-apps
description: Design and package Notis apps. Use when users want an app that groups databases, routes, documents, automations, and skills into one installable Notis product.
feature_flag: store
mcp_resource: true
mcp_tool_patterns: ["LOCAL_NOTIS_INSTALL_APP"]
mcp_references: ["references/release.md", "references/architecture.md", "references/design.md", "references/sdk.md", "references/troubleshooting.md"]
---

# Notis Apps Skill

Use this skill when the user wants a packaged Notis app -- task manager, CRM, dashboard, internal tool, etc. Notis apps are **Vite + React projects** that deploy into the Notis portal as installed apps for the current user or team.

Run the Notis CLI through NPX, for example `npx --package @notis_ai/cli@latest -- notis apps list`. Sign the CLI in once with `notis login`; each account you authorize is a profile you can switch between with `notis profile use`. The CLI bundles this `notis-apps` base skill and refreshes its canonical copy under `~/.notis/skills/base/` on every launch. It is independent of account-skill sync, feature flags, target selection, and cloud deletion.
## User and repository policy takes precedence

Default delivery below applies only when no more restrictive user or repository
instruction exists. Explicit preview-only/no-deploy requests and standing requirements
for explicit deployment consent override the default. Preserve that authority across
local and cloud runs. For local-only work, build and run stub verification; do not
create remote resources or activate an app. `apps dev` is not a supported delivery
path; use the CLI's documented build/verification harness. Store publication remains
separately authorized.

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
15. **One delivery gate** -- Follow the release guide on local and cloud computers, subject to the policy precedence above. No DEV runtime exists.
16. **Exact identity** -- Preserve the intended profile, editable app ID, personal/team scope and current deployment base. Never silently advance a stale checkout.
17. **Automatic source updates** -- Build and check requested app source changes, then update Workspace only when allowed by the user/repository policy above. Store publication stays separate.
18. **Runtime permissions stay least-authority** -- Release activation preserves existing grants and keeps restricted capabilities denied until approved.
19. **Store submission is user-gated** -- Run `apps publish --confirm-ready` only after the user explicitly confirms the current App Details page and Store listing are ready. Deploy the exact approved local state first. The command must reject missing confirmation, incomplete listing media, a local/deployed version mismatch, private visibility, or an existing pending review.
20. **Source restoration** -- Restore historical source as a new release using the current deployment base; never revert data or decrement versions.
21. **`CHANGELOG.md` owns release history** -- Keep the complete release history in one root `CHANGELOG.md`, newest entry first. Do not add new `versionNotes` values to `notis.config.ts`. Use `## [Release title] - YYYY-MM-DD`, or `{PR_MERGE_DATE}` for an unpublished entry. App Details reads **What’s New** and **Version History** from the deployed package manifest, while the Store reads them from the latest published snapshot; unpublished workspace edits must never change the Store page. The manifest also exposes `package.json` `notisAppVersion` as the package version shown in App Details.
22. **Database rows are private unless explicitly seeded** -- A string declaration such as `databases: ['notes']` publishes schema only and never includes the developer's rows. Use `{ slug: 'templates', seedDocuments: true }` only for small, intentional starter content that every installer should receive. Never enable it for user-created notes, history, leads, or other personal data.
23. **Public submissions are complete, reviewable packages** -- The registry PR must contain the full editable source tree, Store assets, exact source-declared database schemas, and only explicitly seeded starter rows. Registry CI validates those boundaries before merge; do not hand-edit `notis-listing.json` or strip source files to make a check pass. Fix the app locally, redeploy, and resubmit.
24. **New projects default to `~/.notis/apps/<slug>`, and `[dir]` overrides it** -- `apps init` and `apps pull` use this stable, predictable home unless the app belongs in a specific repository, monorepo, or user-chosen location. In those cases, pass `[dir]` and report the resulting path. Do not nest an app inside a directory whose local workspace metadata selects an unrelated Notis runtime or profile: later CLI calls inherit that routing and may target the wrong environment.
25. **Machine names and display titles use different casing** -- In `notis.config.ts`, `name` is the stable machine identity and must be lowercase kebab-case (`name: 'link-building'`). `title` is the human-facing app name and must use deliberate display casing (`title: 'Link Building'`), preserving product spelling and acronyms such as `Notis` and `SEO`. Never put a title-cased phrase in `name`, never show a raw slug as the title, and never change an existing canonical `name` or remote slug merely to repair display casing. The persisted `apps.name`, Workspace sidebar, App Details, and Store listing must use `title`.

## Task guides

Read only the guide needed for this task. Relative links resolve in the skill bundle.
For hosted MCP, fetch the matching `notis://docs/notis-apps/references/<file>.md` URI
with resources/read or the available Notis resource-fetch tool; the root resource
also rewrites these links to their published URIs.

- [Release-only delivery](references/release.md)
- [How Apps Are Built](references/architecture.md)
- [Building an App](references/design.md)
- [SDK Hook Reference](references/sdk.md)
- [Anti-patterns -- NEVER do these](references/troubleshooting.md)
