# Notis CLI — App Development Workflow

When running outside the Notis container, use the `notis` CLI to work with Notis Apps locally.

Notis apps are Vite + React projects using `@notis/sdk`. Workspace runs released versions only.
Local and cloud create/edit requests authorize Workspace delivery after checks; explicit read-only,
preview-only or no-deploy requests stop at local artifacts without remote mutation. Store publication
requires separate approval.

## Core workflow

1. Preserve local edits; pull the exact existing released app and current deployment base. For an
   unreleased container, recover original source (or scaffold locally if unrecoverable), reconcile
   its exact ID/current version/edit permission/scope and run apps link <app-id> <source-directory>
   --expected-version 0. If a release has appeared, preserve local source separately and pull/reapply
   on that current release. Never pull missing source or create another remote recovery app.
2. Build and automatically verify before new remote creation. Browser tooling is required.
3. Reconcile exact profile/app identity and personal/team scope. Create only if absent; never duplicate
   a failed first-release container. Prepare only necessary backward-compatible resource changes.
4. Deploy the same linked app. Deploy builds, verifies a frozen snapshot, then uploads those bytes.
   `--skip-build` still verifies and rejects stale output. No Store media requirement applies.
5. Read back the exact installed ID/version/Portal URL, run live verification, and open the installed
   app in Portal. Report unknown or deployed-but-unverified outcomes; never blindly redeploy.

For source restoration, pull the current release into a fresh checkout and historical source into
another folder. Replace source while retaining the current profile/app link and deployment base,
change the package release label, check resource compatibility and deploy as a new release.

## Reports

For a record-owned report, use `reports init → build → verify/preview → save` instead of the app deployment workflow above. Author exactly one route, select an existing app-owned database, and supply a readable context file. Revisions preserve the record ID and require its freshly read revision. See the product `notis-reports` skill for source recovery, ownership and readback. These commands do not deploy the owning app or publish a Store listing.

## Commands

### `npx --package @notis_ai/cli@latest -- notis doctor`

Run a quick CLI health check for config, auth, and API reachability.

When to use: Use this before relying on the CLI in automation or after changing environments.

Examples:
- `npx --package @notis_ai/cli@latest -- notis doctor`
- `npx --package @notis_ai/cli@latest -- notis doctor --json`

### `npx --package @notis_ai/cli@latest -- notis apps list`

List apps the current profile can access.

When to use: Discover existing apps before linking or deploying.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps list`
- `npx --package @notis_ai/cli@latest -- notis apps list --json`

### `npx --package @notis_ai/cli@latest -- notis apps init <name> [dir]`

Scaffold a new Notis app project.

When to use: Start a new Notis app. Use --from with a published Store app when one is close to the desired app; otherwise creates the bare Vite + React project.

Options:
- `--from <slug>` — Start from a published Store app listed by `notis apps scaffolds list`. Downloads its source from the public app registry.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps scaffolds list`
- `npx --package @notis_ai/cli@latest -- notis apps init "Mind the Flo"`
- `npx --package @notis_ai/cli@latest -- notis apps init "My CRM" --from databases`
- `npx --package @notis_ai/cli@latest -- notis apps init "My App" ~/code/my-app`

### `npx --package @notis_ai/cli@latest -- notis apps scaffolds list`

List published Store apps available as scaffolds.

When to use: Discover published Store apps to start from before creating a new app. Every app published to the public Store is automatically a scaffold; use --search to narrow the catalog.

Options:
- `--search <term>` — Filter scaffolds by name, tagline, description, or category.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps scaffolds list`
- `npx --package @notis_ai/cli@latest -- notis apps scaffolds list --search journal`
- `npx --package @notis_ai/cli@latest -- notis apps init "My App" --from databases`

### `npx --package @notis_ai/cli@latest -- notis apps create <name> [dir]`

Create a new remote Notis app and optionally link a local project to it.

When to use: Provision a fresh remote app before the first deploy. Pass a project directory to link it immediately.

Options:
- `--team-id <id>` — Create or reuse the exact team-scoped app (default: personal).

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps create "My App"`
- `npx --package @notis_ai/cli@latest -- notis apps create "My App" .`

### `npx --package @notis_ai/cli@latest -- notis apps build [dir]`

Build and package the app into .notis/output/.

When to use: Prepare the app for verification or deployment.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps build`
- `npx --package @notis_ai/cli@latest -- notis apps build ./my-app`

### `npx --package @notis_ai/cli@latest -- notis apps verify [dir]`

Validate that every route renders and reports Store listing readiness.

When to use: Any time after notis apps build, and before deploy. Catches render-time crashes and missing runtime calls. Incomplete listing media is reported as a warning; pass --listing to fail on it instead.

Options:
- `--routes <slugs>` — Comma-separated route slugs. Default: every route in manifest.
- `--port <n>` — Loopback port. Default: auto-pick.
- `--skip-build` — Skip notis apps build; reuse existing .notis/output/.
- `--mode <mode>` — stub | live. Default stub. Live posts to /portal_views/runtime_query with the CLI JWT and fails routes whose runtime calls all errored.
- `--listing` — Fail instead of warn when the Store listing (tagline, categories, screenshots, changelog) is incomplete.
- `--no-browser` — Start the harness server and print URLs; do not drive agent-browser.
- `--keep-open` — Leave server + browser session running after report (for manual triage).

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps verify`
- `npx --package @notis_ai/cli@latest -- notis apps verify --routes notes`
- `npx --package @notis_ai/cli@latest -- notis apps verify --mode live`
- `npx --package @notis_ai/cli@latest -- notis apps verify --listing  # gate on Store listing readiness before publish`
- `npx --package @notis_ai/cli@latest -- notis apps verify --no-browser  # start the harness, drive agent-browser yourself`

### `npx --package @notis_ai/cli@latest -- notis apps screenshot [dir]`

Capture configured listing route/scenario states via the headless harness.

When to use: Generate the 3–6 declared metadata/screenshot-N.png files for the App Store listing. Apps are icon-led (like Raycast) — there is no cover image, only these screenshots. Each screenshot may set a focus selector to remove empty canvas and a light or dark theme that also controls its Store frame. Run before notis apps verify / deploy / publish.

Options:
- `--routes <slugs>` — Comma-separated route slugs. Default: every configured screenshot state.
- `--port <n>` — Loopback port. Default: auto-pick.
- `--width <px>` — Viewport width. Default: 2000.
- `--height <px>` — Viewport height. Default: 1250 (16:10).
- `--output-dir <dir>` — Where to write screenshot-N.png. Default: metadata/.
- `--mode <mode>` — stub | live. Default stub. Live renders against real data via the CLI JWT (requires a linked app), so screenshots show actual content instead of empty states.
- `--raw` — Write the unframed harness capture instead of the default Store presentation.
- `--skip-build` — Skip notis apps build; reuse existing .notis/output/.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps screenshot  # honors notis.config.ts screenshot scenarios`
- `npx --package @notis_ai/cli@latest -- notis apps screenshot --routes home,history`
- `npx --package @notis_ai/cli@latest -- notis apps screenshot --mode live  # populated screenshots from real data`
- `npx --package @notis_ai/cli@latest -- notis apps screenshot --raw  # diagnostic capture without Store framing`

### `npx --package @notis_ai/cli@latest -- notis apps link <app-id> [dir]`

Link a local project to a remote Notis app.

When to use: Connect a local project to an existing app for deployment.

Options:
- `--expected-version <version>` — Link only if the remote deployment version still matches this non-negative integer.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps link abc123`
- `npx --package @notis_ai/cli@latest -- notis apps link abc123 ./my-app`
- `npx --package @notis_ai/cli@latest -- notis apps link abc123 ./recovered-app --expected-version 0`

### `npx --package @notis_ai/cli@latest -- notis apps pull <app-id> [dir]`

Download a Notis app source snapshot into a local project folder.

When to use: Edit an installed app. Preserve local edits, pull and link its persisted source, then build, verify and deploy.

Options:
- `--force` — Overwrite a non-empty target directory.
- `--source-version <n>` — Pull a specific app source version (default: latest).

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps pull abc123`
- `npx --package @notis_ai/cli@latest -- notis apps pull abc123 ./my-app --force --source-version 3`

### `npx --package @notis_ai/cli@latest -- notis apps deploy [dir]`

Build, verify and release the linked Workspace app.

When to use: Build, verify and release the linked personal or team Workspace app. This command does not publish to the Store.

Options:
- `--app-id <id>` — Override linked app ID.
- `--skip-build` — Reuse unchanged build output; automated verification still runs.

Examples:

### `npx --package @notis_ai/cli@latest -- notis apps publish [dir]`

Submit the deployed app for Store review.

When to use: After the user explicitly confirms the App Details page and Store listing are ready. Requires the current local project to match the latest deployed version.

Options:
- `--app-id <id>` — Override linked app ID.
- `--confirm-ready` — Confirm the user approved the current App Details page for Store submission.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps publish --confirm-ready`
- `npx --package @notis_ai/cli@latest -- notis apps publish ./my-app --confirm-ready`

### `npx --package @notis_ai/cli@latest -- notis apps duplicate [dir]`

Duplicate an app into an independent copy with its own databases.

When to use: When the same app should run for a second purpose - a notes app for blog drafts alongside one for bookmarks. The copy shares no data with the source.

Options:
- `--app-id <id>` — App to duplicate. Defaults to the app this project is linked to.
- `--name <name>` — Name for the duplicate (default: the source name followed by "copy").
- `--copy-documents <mode>` — Which rows to copy: 'declared' (default, the starter content a fresh install would have), 'all', or 'none'.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps duplicate --name "Blog"`
- `npx --package @notis_ai/cli@latest -- notis apps duplicate --app-id abc123 --name "Bookmarks" --copy-documents none`

### `npx --package @notis_ai/cli@latest -- notis apps doctor [dir]`

Check project health and readiness.

When to use: Diagnose issues with a Notis app project.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps doctor`
- `npx --package @notis_ai/cli@latest -- notis apps doctor ./my-app`

### `npx --package @notis_ai/cli@latest -- notis reports init <name> [dir]`

Init a record-owned SDK report locally.

When to use: Author an independent report without deploying its owning app.

Options:
- `--from <slug>` — Start from a published Store app listed by `notis apps scaffolds list`. Downloads its source from the public app registry.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps scaffolds list`
- `npx --package @notis_ai/cli@latest -- notis reports init "Mind the Flo"`
- `npx --package @notis_ai/cli@latest -- notis reports init "My CRM" --from databases`
- `npx --package @notis_ai/cli@latest -- notis reports init "My App" ~/code/my-app`

### `npx --package @notis_ai/cli@latest -- notis reports build [dir]`

Build a record-owned SDK report locally.

When to use: Author an independent report without deploying its owning app.

Examples:
- `npx --package @notis_ai/cli@latest -- notis reports build`
- `npx --package @notis_ai/cli@latest -- notis reports build ./my-app`

### `npx --package @notis_ai/cli@latest -- notis reports verify [dir]`

Verify a record-owned SDK report locally.

When to use: Author an independent report without deploying its owning app.

Options:
- `--routes <slugs>` — Comma-separated route slugs. Default: every route in manifest.
- `--port <n>` — Loopback port. Default: auto-pick.
- `--skip-build` — Skip notis apps build; reuse existing .notis/output/.
- `--mode <mode>` — stub | live. Default stub. Live posts to /portal_views/runtime_query with the CLI JWT and fails routes whose runtime calls all errored.
- `--listing` — Ignored for reports; saving a report does not publish a Store listing.
- `--no-browser` — Start the harness server and print URLs; do not drive agent-browser.
- `--keep-open` — Leave server + browser session running after report (for manual triage).

Examples:
- `npx --package @notis_ai/cli@latest -- notis reports verify`
- `npx --package @notis_ai/cli@latest -- notis reports verify --routes notes`
- `npx --package @notis_ai/cli@latest -- notis reports verify --mode live`
- `npx --package @notis_ai/cli@latest -- notis reports verify --no-browser  # start the harness, drive agent-browser yourself`

### `npx --package @notis_ai/cli@latest -- notis reports preview [dir]`

Preview a record-owned SDK report locally. Keeps the preview server and browser session open.

When to use: Author an independent report without deploying its owning app.

Options:
- `--routes <slugs>` — Comma-separated route slugs. Default: every route in manifest.
- `--port <n>` — Loopback port. Default: auto-pick.
- `--skip-build` — Skip notis apps build; reuse existing .notis/output/.
- `--mode <mode>` — stub | live. Default stub. Live posts to /portal_views/runtime_query with the CLI JWT and fails routes whose runtime calls all errored.
- `--listing` — Ignored for reports; saving a report does not publish a Store listing.
- `--no-browser` — Start the harness server and print URLs; do not drive agent-browser.
- `--keep-open` — Leave server + browser session running after report (for manual triage).

Examples:
- `npx --package @notis_ai/cli@latest -- notis reports preview`
- `npx --package @notis_ai/cli@latest -- notis reports preview --routes notes`
- `npx --package @notis_ai/cli@latest -- notis reports preview --mode live`
- `npx --package @notis_ai/cli@latest -- notis reports preview --no-browser  # start the harness, drive agent-browser yourself`

### `npx --package @notis_ai/cli@latest -- notis reports save [dir]`

Build, verify and save a report into an app-owned database record.

When to use: Persist an independently authored report, not an app release.

Options:
- `--database-id <id>` — Required. Owning app database.
- `--document-id <id>` — Existing record to update or attach to.
- `--attach` — Attach to an existing non-view record.
- `--expected-revision <revision>` — Fresh view revision (0 for a record without a view).
- `--title <title>` — Required, including updates. Record title.
- `--context-file <file>` — Required. UTF-8 readable report content and structure.
- `--properties-file <file>` — JSON database property values keyed by name.

Examples:
- `npx --package @notis_ai/cli@latest -- notis reports save ./weekly-report --database-id <id> --title "Weekly review" --context-file ./context.md`
