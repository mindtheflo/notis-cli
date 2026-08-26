# Notis CLI — App Development Workflow

When running outside the Notis container, use the `notis` CLI to work with Notis Apps locally.

Notis apps are Vite + React projects using `@notis/sdk`. The workflow is init, dev, build, verify, create/link, pull, deploy, and doctor.

Important: `notis apps deploy` updates the linked installed app. It is not an app-store publishing flow.

## Setup

Run `npx --package @notis_ai/cli@latest -- notis login` to authorize the CLI. Run commands through NPX, for example `npx --package @notis_ai/cli@latest -- notis apps list`.

For CI, hosted agents, or internal scripts, pass a non-persisted token with `NOTIS_JWT=<token>` and use `--api-base <server-url>` when targeting a non-default server.

## Core Workflow

1. Scaffold a new app:

```bash
npx --package @notis_ai/cli@latest -- notis apps init
```

2. Or pull an installed app's saved source snapshot:

```bash
npx --package @notis_ai/cli@latest -- notis apps pull <app-id> ./my-app
cd ./my-app
npm install
```

3. Develop locally with live reload:

```bash
npx --package @notis_ai/cli@latest -- notis apps dev
```

4. Build the production artifact:

```bash
npx --package @notis_ai/cli@latest -- notis apps build
```

5. Verify the built artifact headlessly:

```bash
npx --package @notis_ai/cli@latest -- notis apps verify
```

6. Link the project if it was not created or pulled from an app, then deploy:

```bash
npx --package @notis_ai/cli@latest -- notis apps link <app-id>
npx --package @notis_ai/cli@latest -- notis apps deploy
```

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

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps create "My App"`
- `npx --package @notis_ai/cli@latest -- notis apps create "My App" .`

### `npx --package @notis_ai/cli@latest -- notis apps dev [dir]`

Register a development root and connect its apps to the shared local development host.

When to use: Run this once for any folder that should be watched permanently. The folder itself, direct child apps, and apps/* are discovered automatically by every signed-in Notis Desktop instance.

Options:
- `--port <number>` — Local bundle server port (default: 5173).
- `--scratch` — Use isolated empty databases, bundled skills, and bundled automations for this session instead of the installed app's resources. For fixture work and destructive experiments.
- `--live-data` — Deprecated: using the installed app's real resources is now the default. Accepted as a no-op; use `--scratch` for the old isolated behavior.
- `--grant-cloud-shell` — Approve a cloudComputer: 'shell' declaration without the interactive prompt. The grant persists for this dev app; authorship alone never grants it.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps dev`
- `npx --package @notis_ai/cli@latest -- notis apps dev ./my-app`
- `npx --package @notis_ai/cli@latest -- notis apps dev ./workspace --port 5200`
- `npx --package @notis_ai/cli@latest -- notis apps dev --scratch  # isolated resources for fixture or schema experiments`

### `npx --package @notis_ai/cli@latest -- notis apps roots list`

List persistent machine-local Notis app development roots.

When to use: See which folders every local Notis Desktop instance watches for development apps.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps roots list`

### `npx --package @notis_ai/cli@latest -- notis apps roots remove <folder>`

Stop watching a registered Notis app development root.

When to use: Remove a persistent development root. The built-in ~/.notis/apps root cannot be removed.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps roots remove ./old-apps`

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

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps link abc123`
- `npx --package @notis_ai/cli@latest -- notis apps link abc123 ./my-app`

### `npx --package @notis_ai/cli@latest -- notis apps pull <app-id> [dir]`

Download a Notis app source snapshot into a local project folder.

When to use: Edit an installed app locally. Pulls the persisted source, links the directory to the app/version, then continue with npm install, notis apps dev, notis apps build, and notis apps deploy.

Options:
- `--force` — Overwrite a non-empty target directory.
- `--source-version <n>` — Pull a specific app source version (default: latest).

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps pull abc123`
- `npx --package @notis_ai/cli@latest -- notis apps pull abc123 ./my-app --force --source-version 3`

### `npx --package @notis_ai/cli@latest -- notis apps deploy [dir]`

Build and upload the app to the linked Notis app.

When to use: Ship the installed app to production for the linked user/team app. A project that has only a development app is promoted in place on first deploy: same app id, same databases, dev markers removed. This command does not publish to the app store.

Options:
- `--app-id <id>` — Override linked app ID.
- `--skip-build` — Skip the build step (use existing .notis/output/).
- `--direct` — Explicitly upload to Supabase storage, bypassing the backend server.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps deploy`
- `npx --package @notis_ai/cli@latest -- notis apps deploy --skip-build`
- `npx --package @notis_ai/cli@latest -- notis apps deploy --app-id abc123`
- `npx --package @notis_ai/cli@latest -- notis apps deploy --direct`

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
