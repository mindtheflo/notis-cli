# @notis_ai/cli

Agent-first Notis CLI for apps and generic tool execution.

## Install

Use the Notis CLI through NPX; do not rely on an installed `notis` command. Run `notis login` once to authorize a scoped, revocable OAuth credential in the browser — that is how the CLI signs in everywhere, including on a machine that also runs Notis Desktop.

For CI, hosted agents, or internal scripts, pass a non-persisted token with `NOTIS_JWT=<token>`.

## Quick Start

```bash
npx --package @notis_ai/cli@latest -- notis --help
npx --package @notis_ai/cli@latest -- notis login
npx --package @notis_ai/cli@latest -- notis doctor
npx --package @notis_ai/cli@latest -- notis apps list
npx --package @notis_ai/cli@latest -- notis tools search "list Notis databases"
```

Use `notis login --paste-code` for the HTTPS copy-paste fallback on a remote machine.

## Release channels

`@latest` is the only tag worth documenting, for beta accounts too.

The npm tag has to be chosen before the CLI starts, and the CLI only learns which Notis it talks to once it reads the profile — so no single install command can be right for both environments on its own. Instead the deployment answers the question: `/.well-known/oauth-protected-resource/cli` reports its channel, `notis login` pins it on the profile, and any later run that finds itself on the wrong build hands the whole invocation to the right one before it does anything else.

- `notis doctor` reports `release_channel`, `cli_version`, and a `channel` check.
- `--api-base <url>` decides the build for that one run, so a one-off call against another environment uses the matching CLI.
- `./dev.sh` profiles and source checkouts are never re-executed: whatever you started stays in control.
- `NOTIS_CLI_AUTO_CHANNEL=0` disables the hand-off; `doctor` then reports the mismatch instead of correcting it.

## Profiles

A profile is one account paired with one API endpoint. Every profile keeps its own credential, so switching between them never signs any of them out.

```bash
npx --package @notis_ai/cli@latest -- notis login --profile work
npx --package @notis_ai/cli@latest -- notis profile list
npx --package @notis_ai/cli@latest -- notis profile use work
npx --package @notis_ai/cli@latest -- notis --profile default tools search "..."
```

`notis logout` revokes and removes the OAuth grant for one profile; `--all-profiles` clears every one.

Credential precedence within the selected profile is: an active `./dev.sh` worktree credential, then `NOTIS_JWT`, then the profile's OAuth grant.

`./dev.sh` exposes its test account as a lease-backed `dev-<workspace>-<hash>` profile bound to its loopback backend. The credential stays in the worktree rather than the shared account config. That synthetic profile is the default only inside its active worktree; naming any stored profile with `--profile` runs against that real account instead.

The CLI defaults to `json` output in agent or non-TTY contexts and `table` output in interactive terminals.

## Global Flags

- `--json` — Shortcut for `--output json`
- `--output <table|json|yaml|ndjson>` — Output mode override
- `--non-interactive` — Disable prompts
- `--profile <name>` — Run as a stored profile instead of the active one
- `--api-base <url>` — Override the API base for one invocation
- `--timeout-ms <n>` — HTTP timeout in milliseconds
- `--idempotency-key <key>` — Override the generated idempotency key for mutating commands

## Authentication

### `npx --package @notis_ai/cli@latest -- notis login`

Authorize a CLI profile in a browser with scoped OAuth access.

When to use: Run this once per account you want the CLI to reach. Pass --profile to add a second account without signing the first one out.

Options:
- `--no-browser` — Print the authorization URL without opening a browser.
- `--print-url` — Print the authorization URL even when opening a browser.
- `--paste-code` — Use the copy-paste callback for SSH and headless machines.
- `--timeout-seconds <n>` — How long to wait for authorization (default 300).
- `--scope <scope>` — OAuth permission to request (repeatable).
- `--code <code>` — Redeem the code shown in the browser after a non-interactive login.

Examples:
- `npx --package @notis_ai/cli@latest -- notis login`
- `npx --package @notis_ai/cli@latest -- notis login --profile work`
- `npx --package @notis_ai/cli@latest -- notis login --profile beta --api-base https://api-beta.notis.ai`
- `npx --package @notis_ai/cli@latest -- notis login --no-browser --print-url`
- `npx --package @notis_ai/cli@latest -- notis login --paste-code`
- `npx --package @notis_ai/cli@latest -- notis login --code 4f3c2b1a`

### `npx --package @notis_ai/cli@latest -- notis logout`

Revoke and remove the OAuth credential for one CLI profile.

When to use: Use this to disconnect a single account. Other profiles keep their credentials unless you pass --all-profiles.

Options:
- `--all-profiles` — Remove OAuth credentials from every CLI profile.

Examples:
- `npx --package @notis_ai/cli@latest -- notis logout`
- `npx --package @notis_ai/cli@latest -- notis logout --profile work`
- `npx --package @notis_ai/cli@latest -- notis logout --all-profiles`


## Apps

### `npx --package @notis_ai/cli@latest -- notis apps list`

List apps the current profile can access.

When to use: Discover existing apps before linking or deploying.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps list`
- `npx --package @notis_ai/cli@latest -- notis apps list --json`

### `npx --package @notis_ai/cli@latest -- notis apps init <name> [dir]`

Scaffold a new Notis app project.

When to use: Start a new Notis app. Use --from with a bundled scaffold when one is close to the desired app; otherwise creates the bare Vite + React project.

Options:
- `--from <slug>` — Start from a bundled scaffold listed by `notis apps scaffolds list`.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps scaffolds list`
- `npx --package @notis_ai/cli@latest -- notis apps init "Mind the Flo"`
- `npx --package @notis_ai/cli@latest -- notis apps init "My CRM" --from notis-database`
- `npx --package @notis_ai/cli@latest -- notis apps init "My App" ./my-app`

### `npx --package @notis_ai/cli@latest -- notis apps scaffolds list`

List bundled Notis app scaffolds.

When to use: Discover the fixed scaffold catalog shipped with the CLI before starting a new app.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps scaffolds list`
- `npx --package @notis_ai/cli@latest -- notis apps init "My App" --from notis-database`

### `npx --package @notis_ai/cli@latest -- notis apps create <name> [dir]`

Create a new remote Notis app and optionally link a local project to it.

When to use: Provision a fresh remote app before the first deploy. Pass a project directory to link it immediately.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps create "My App"`
- `npx --package @notis_ai/cli@latest -- notis apps create "My App" .`

### `npx --package @notis_ai/cli@latest -- notis apps dev [dir]`

Develop Notis apps inside the Electron desktop Portal with automatic local bundle reloads.

When to use: Run this inside a single app or a monorepo root with apps/<name>/notis.config.ts. It discovers every app, starts the local bundle server, registers desktop-local dev sessions, and opens the Electron Portal to the local development app.

Options:
- `--port <number>` — Local bundle server port (default: 5173).
- `--no-open` — Do not auto-open the desktop Portal local development app.
- `--live-data` — Read and write the installed app's real databases instead of empty dev copies. Applies to this session only; warns and falls back when the app is not installed yet.
- `--grant-cloud-shell` — Approve a cloudComputer: 'shell' declaration without the interactive prompt. The grant persists for this dev app; authorship alone never grants it.

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps dev`
- `npx --package @notis_ai/cli@latest -- notis apps dev ./my-app`
- `npx --package @notis_ai/cli@latest -- notis apps dev ./workspace --port 5200`
- `npx --package @notis_ai/cli@latest -- notis apps dev --live-data  # iterate on a view over the installed app's real rows`

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
- `--version <n>` — Pull a specific app source version (default: latest).

Examples:
- `npx --package @notis_ai/cli@latest -- notis apps pull abc123`
- `npx --package @notis_ai/cli@latest -- notis apps pull abc123 ./my-app --force`

### `npx --package @notis_ai/cli@latest -- notis apps deploy [dir]`

Build and upload the app to the linked Notis app.

When to use: Ship the installed app to production for the linked user/team app. Requires a linked app (notis apps link). This command does not publish to the app store.

Options:
- `--app-id <id>` — Override linked app ID.
- `--skip-build` — Skip the build step (use existing .notis/output/).
- `--direct` — Upload directly to Supabase storage, bypassing the backend server. Auto-fallback on network errors.

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


## Hand-over

Give the branch you are on to a Notis agent, which continues the work in a git worktree on the Notis cloud computer. `--route` picks the agent: the hosted Notis agent, or the user's own Codex/Claude Code in the cloud sandbox or on their Mac. `--branch-mode same` makes the agent commit onto your branch; the default cuts a new branch from it.

### `npx --package @notis_ai/cli@latest -- notis handover start <task>`

Hand the current branch to a Notis agent and keep working.

When to use: Use this when you want Notis to continue work on the branch you are on -- long refactors, test fixing, or anything that should keep running after you close the laptop. Pick the agent with --route.

Options:
- `--branch-mode <mode>` — same = the agent commits onto your branch. new = the agent cuts a new branch from it (default).
- `--route <target>` — Which agent runs it: notis (hosted, default), codex_cloud, claude_cloud, codex_local, claude_local, or auto.
- `--repo <slug>` — Configured repository slug on the cloud computer, when you know it.
- `--no-wip` — Refuse on a dirty tree instead of committing the changes first.

Examples:
- `npx --package @notis_ai/cli@latest -- notis handover start "fix the failing auth tests"`
- `npx --package @notis_ai/cli@latest -- notis handover start "finish the migration" --branch-mode same --route codex_cloud`
- `npx --package @notis_ai/cli@latest -- notis handover start "add integration tests" --route claude_cloud`
- `npx --package @notis_ai/cli@latest -- notis handover start "review and clean up this branch" --route claude_local`

### `npx --package @notis_ai/cli@latest -- notis handover status`

Show the coding-agent threads Notis is running for you.

When to use: Use this after a hand-over to see whether the agent is still working.

Options:
- `--provider <provider>` — Filter to codex or claude_code.
- `--refresh` — Force a live refresh instead of cached state.

Examples:
- `npx --package @notis_ai/cli@latest -- notis handover status`
- `npx --package @notis_ai/cli@latest -- notis handover status --provider codex --refresh`


## Generic Tools

### `npx --package @notis_ai/cli@latest -- notis tools toolkits`

List toolkit namespaces and connection statuses available to the active user.

When to use: Use this to inspect connection state before searching or executing generic tools.

Examples:
- `npx --package @notis_ai/cli@latest -- notis tools toolkits`
- `npx --package @notis_ai/cli@latest -- notis tools toolkits --json`

### `npx --package @notis_ai/cli@latest -- notis tools search <query>`

Search across toolkit namespaces using natural language.

When to use: Use this when you need a generic capability that does not have a first-class CLI command.

Options:
- `--known-fields <text>` — Optional known field hints, such as channel_name:general or user_email:a@example.com.

Examples:
- `npx --package @notis_ai/cli@latest -- notis tools search "send an email"`
- `npx --package @notis_ai/cli@latest -- notis tools search "post on LinkedIn" --known-fields "platform:linkedin"`

### `npx --package @notis_ai/cli@latest -- notis tools describe <tool-name>`

Describe a generic tool by name.

When to use: Use this when you know the tool name and want its parameter schema before execution.

Examples:
- `npx --package @notis_ai/cli@latest -- notis tools describe composio-gmail-send_email`
- `npx --package @notis_ai/cli@latest -- notis tools describe LOCAL_NOTIS_DATABASE_QUERY`

### `npx --package @notis_ai/cli@latest -- notis tools exec <tool-name>`

Execute a generic tool by canonical tool name.

When to use: Use this as the escape hatch for integrations or Notis tools without a first-class CLI wrapper.

Options:
- `--arguments <json>` — JSON object, @file path, or - for stdin.
- `--arguments-file <path>` — Read the JSON arguments object from a file.
- `--file <argument-path=local-path>` — Upload a local file into a file-uploadable tool argument. Repeatable.
- `--get-schema` — Display the tool parameter schema without executing.
- `--dry-run` — Validate arguments against the tool schema without executing.

Examples:
- `npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --arguments '{"database_slug":"tasks","query":{}}'`
- `npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_GET_DATABASE --arguments '{"database_slug":"tasks"}'`
- `npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --get-schema`
- `npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --dry-run --arguments '{"database_slug":"tasks","query":{}}'`
- `npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --arguments @query.json`
- `npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --arguments-file query.json`
- `npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --arguments - < query.json`
- `npx --package @notis_ai/cli@latest -- notis tools exec composio-dropbox-upload_file --arguments '{"path":"/target/in/dropbox.pdf"}' --file content=./Invoice.pdf`

### `npx --package @notis_ai/cli@latest -- notis tools exec-parallel <calls>`

Execute multiple tools concurrently.

When to use: Use this when you need to run independent tool calls simultaneously for speed.

Options:
- `--file <argument-path=local-path>` — Unsupported for exec-parallel; use tools exec for file uploads.

Examples:
- `npx --package @notis_ai/cli@latest -- notis tools exec-parallel '[{"tool_name":"LOCAL_NOTIS_DATABASE_QUERY","arguments":{"database_slug":"tasks","query":{}}},{"tool_name":"LOCAL_NOTIS_DATABASE_LIST_DATABASES","arguments":{}}]'`

### `npx --package @notis_ai/cli@latest -- notis tools link <toolkit>`

Connect or reconnect an integration toolkit.

When to use: Use this when a tool requires authentication or an active connection must be replaced.

Options:
- `--reconnect` — Replace the existing account instead of adding another connection.
- `--connection-id <id>` — Exact connection id to replace when multiple accounts exist.
- `--label <label>` — Account label for a new or replacement connection.
- `--credentials <json>` — Credential JSON object, @file path, or - for stdin. Prefer stdin so secrets do not enter shell history.

Examples:
- `npx --package @notis_ai/cli@latest -- notis tools link github`
- `npx --package @notis_ai/cli@latest -- notis tools link dataforseo --reconnect --credentials - < credentials.json`


## Profile Commands

### `npx --package @notis_ai/cli@latest -- notis profile list`

List every CLI profile with its account, API endpoint, and credential state.

When to use: Use this to see which accounts and environments this machine can reach before choosing one.

Examples:
- `npx --package @notis_ai/cli@latest -- notis profile list`
- `npx --package @notis_ai/cli@latest -- notis profile list --json`

### `npx --package @notis_ai/cli@latest -- notis profile use <name>`

Switch the default profile without signing any profile out.

When to use: Use this to change which account and API subsequent commands target. Every other profile keeps its credential.

Examples:
- `npx --package @notis_ai/cli@latest -- notis profile use work`
- `npx --package @notis_ai/cli@latest -- notis profile use default`

### `npx --package @notis_ai/cli@latest -- notis profile show [name]`

Show one profile in detail, including scopes and credential expiry.

When to use: Use this to inspect exactly which account and endpoint a profile resolves to.

Examples:
- `npx --package @notis_ai/cli@latest -- notis profile show`
- `npx --package @notis_ai/cli@latest -- notis profile show work --json`

### `npx --package @notis_ai/cli@latest -- notis profile remove <name>`

Delete a CLI profile from this machine.

When to use: Use this after logging a profile out. Removing a still-authorized profile requires --force and leaves the grant live server-side.

Options:
- `--force` — Discard a profile that still holds a credential.

Examples:
- `npx --package @notis_ai/cli@latest -- notis profile remove old-work`
- `npx --package @notis_ai/cli@latest -- notis profile remove old-work --force`


## Meta Commands

### `npx --package @notis_ai/cli@latest -- notis doctor`

Run a quick CLI health check for config, auth, and API reachability.

When to use: Use this before relying on the CLI in automation or after changing environments.

Examples:
- `npx --package @notis_ai/cli@latest -- notis doctor`
- `npx --package @notis_ai/cli@latest -- notis doctor --json`

### `npx --package @notis_ai/cli@latest -- notis whoami`

Display the active profile, user, and available toolkit connection statuses.

When to use: Use this to quickly confirm which account and environment a command will target.

Examples:
- `npx --package @notis_ai/cli@latest -- notis whoami`
- `npx --package @notis_ai/cli@latest -- notis whoami --json`

### `npx --package @notis_ai/cli@latest -- notis describe <command...>`

Describe a first-class CLI command in detail.

When to use: Use this when an agent or human needs the exact shape, examples, and semantics of a command.

Examples:
- `npx --package @notis_ai/cli@latest -- notis describe apps deploy`
- `npx --package @notis_ai/cli@latest -- notis describe tools exec`


## Local Development

```bash
cd packages/cli
npm install
node ./bin/notis.js --help
npm run docs:generate
npm test
```
