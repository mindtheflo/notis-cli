---
name: notis-cli
description: Use when agents should work through the Notis CLI, especially to develop Notis apps locally or to access Notis, Composio, or MCP tools they do not currently have loaded directly.
feature_flag: cli_access
mcp_resource: true
mcp_tool_patterns: []
---

# Notis CLI Skill

Use this skill when the user wants work done through the Notis CLI.

This skill covers two main CLI workflows:

1. Developing Notis apps locally.
2. Accessing Notis, Composio, and MCP tools through the CLI.

## When to use this skill

Activate this skill when:

- the user wants to init, develop, build, verify, link, pull, or deploy a Notis app through the CLI
- the current agent does not have the tool it needs in its direct tool list
- the user wants direct MCP access through Notis
- the user wants to use an integration-backed capability through Notis rather than a first-class local tool
- the task mentions the `notis` CLI directly

Use the registry-resolved published npm package everywhere:

- `npx --package @notis_ai/cli@latest -- notis ...`

Always use this NPX command form so the agent runs the current published CLI. In hosted shells, the CLI is pre-authenticated through `NOTIS_JWT`. On a local machine the CLI holds its own OAuth grant: `notis login` authorizes one in the browser, and signing in to the Notis desktop app authorizes one automatically for that account. Either way the grant belongs to the CLI, which refreshes it without the desktop app running.

`@latest` is correct for every account, including beta ones. Each deployment reports which published build belongs to it, `notis login` pins that on the profile, and a later run that finds itself on the wrong build hands the invocation to the right one before doing anything. Never substitute a channel by hand: pinning `@beta` on a production profile is how a machine ends up running a build its API does not expect. `notis doctor` reports the active channel, and `NOTIS_CLI_AUTO_CHANNEL=0` turns the hand-off off for a run.

The CLI bundles this `notis-cli` base skill and refreshes its canonical copy under `~/.notis/skills/base/` on every launch. It is independent of account-skill sync, feature flags, target selection, and cloud deletion.

## Profiles: accounts and endpoints

A profile is one account paired with one API endpoint. Profiles live side by side; switching between them never signs any of them out.

- `npx --package @notis_ai/cli@latest -- notis profile list` — every profile on this machine, with its endpoint, user, and whether it is signed in. The active one is marked.
- `npx --package @notis_ai/cli@latest -- notis profile use <name>` — change which account subsequent commands run as.
- `npx --package @notis_ai/cli@latest -- notis --profile <name> <command>` — run a single command as another account without changing the active one.
- `npx --package @notis_ai/cli@latest -- notis login --profile <name>` — add an account. The existing profiles keep their credentials.
- `npx --package @notis_ai/cli@latest -- notis logout` — sign out of the active profile only; pass `--all-profiles` to clear every one.

Read the profile before acting on the user's data. `notis whoami` reports the account and endpoint a command will hit; if that is not the account the user meant, switch profiles rather than proceeding.

### Working against a local `./dev.sh` backend

`./dev.sh` exposes its test account as a lease-backed profile (`dev-<workspace>-<hash>`) pointing at the local backend, and prints the name on startup. Its credential stays in that worktree and it is the automatic default there, so `notis ...` targets the local API and test user with no extra flags. It is not a stored account profile and cannot be selected outside the worktree.

Two rules follow from the dev credential being scoped to that local backend:

- A `dev-*` profile only exists while its `./dev.sh` lease is running. If it is stopped, the CLI fails with `dev_runtime_unavailable` instead of sending the test user's token to the live API.
- To reach a real account from inside a worktree — including when the local backend is wedged — name a real profile explicitly: `notis --profile <name> ...`. That is the supported escape hatch.

## Critical rule for missing tools

If the tool you need is not already available in your current tool surface, do not stop and do not assume the task is blocked.

Use the Notis CLI as the fallback access layer.

This is especially important when:

- you need direct MCP tools
- you need a Composio-backed integration tool
- you need a Notis tool that is not exposed as a first-class command in your current environment
- you need to discover the canonical tool name before execution

Treat the Notis CLI the same way you would treat a Composio-style tool router flow: discover what is available first, then execute the right tool through the CLI.

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

## IMPORTANT: When NOT to use tool access for app development

When building or deploying a Notis app, do NOT use `npx --package @notis_ai/cli@latest -- notis tools exec` for app file operations:

- Loading or saving app files -- use `npx --package @notis_ai/cli@latest -- notis apps build` and `npx --package @notis_ai/cli@latest -- notis apps deploy`
- Linting app files -- use `npx --package @notis_ai/cli@latest -- notis apps build` which validates automatically
- Managing app routes -- write standard Vite + React pages in `app/`, not raw JS files

Database schemas are the exception: declaring a slug in `notis.config.ts` does
not create it. Use the discovery-first native database tool workflow to
create/update and read back each app-owned schema before deployment. Tool calls
are also valid for testing runtime behavior after deployment.

## Section 2: Accessing Tools Through the Notis CLI

Use this section when the current agent does not already have the right tool and needs to reach tools through Notis.

This is the main escape hatch for:

- direct MCP access
- Composio-backed integrations
- native Notis tools that are available through the generic CLI tool bridge
- any task where you need to discover the canonical tool name and schema before execution

### Tool access workflow

1. List available toolkit namespaces:
   - `npx --package @notis_ai/cli@latest -- notis tools toolkits --timeout-ms 90000`
2. Search for the capability you need using natural language:
   - `npx --package @notis_ai/cli@latest -- notis tools search "<query>" --timeout-ms 90000`
   - optionally add known field hints with `--known-fields "<key:value>"`
3. If needed, inspect the exact tool and parameter schema:
   - `npx --package @notis_ai/cli@latest -- notis tools describe <tool-name> --timeout-ms 90000`
   - `npx --package @notis_ai/cli@latest -- notis tools exec <tool-name> --get-schema --timeout-ms 90000`
4. Validate arguments before execution when the tool is mutating or the schema is non-trivial:
   - `npx --package @notis_ai/cli@latest -- notis tools exec <tool-name> --dry-run --arguments '<json>'`
5. Execute the tool:
   - `npx --package @notis_ai/cli@latest -- notis tools exec <tool-name> --arguments '<json>'`
6. If multiple independent calls are needed, use:
   - `npx --package @notis_ai/cli@latest -- notis tools exec-parallel '<json-array>'`
7. If the toolkit is not connected yet, start its connection flow:
   - `npx --package @notis_ai/cli@latest -- notis tools link <toolkit>`
   - For a revoked or invalid credential-based connection, reconnect with credential JSON on stdin: `npx --package @notis_ai/cli@latest -- notis tools link <toolkit> --reconnect --credentials -`

### Discovery latency and caching

The discovery bridge may query several connected MCP servers on a cold run and
can legitimately take longer than the CLI's general 30-second timeout. Always
use `--timeout-ms 90000` for `tools toolkits`, `tools search`, `tools describe`,
and schema-only discovery calls. If a discovery call returns `network_timeout`,
retry that same command once with `--timeout-ms 90000`; do not start a new
query, invent a tool name, or loop on the default 30-second command.

Discovery is idempotent but should be bounded: run the toolkit listing once per
task, run one natural-language search per distinct capability, and cache the
returned canonical tool names and schemas for the rest of the current turn.
After a successful search/schema response, call the returned canonical tool
directly (with a dry-run before mutations) instead of repeating the same
discovery request before every connected-service action.

### Tool access rules

- Never guess tool names. Discover them with `npx --package @notis_ai/cli@latest -- notis tools search` first.
- Prefer first-class CLI commands when they exist, but use `npx --package @notis_ai/cli@latest -- notis tools ...` whenever the capability is not covered by a dedicated command.
- When you know the tool name but not the argument shape, use `npx --package @notis_ai/cli@latest -- notis tools describe` or `--get-schema` before execution.
- Use `--dry-run` before mutating calls when you want schema validation without execution.
- If a toolkit is missing, use `npx --package @notis_ai/cli@latest -- notis tools link <toolkit>` to start the connection flow.
- Use `--reconnect` to replace an existing connection. If multiple accounts exist, select one with `--connection-id <id>`.
- For API keys, basic auth, or other credential JSON, prefer `--credentials -` and pipe or redirect stdin. Avoid inline secrets because they can enter shell history and process listings.

### Toolkit mental model

Typical toolkit namespaces include:

- `notis` for native Notis tools
- `composio-*` for Composio-backed integrations
- `mcp-*` for MCP-backed tools

The pattern is:

1. discover toolkits
2. search tools
3. inspect schema if needed
4. execute the canonical tool

### Tool access examples

Find a tool:

```bash
npx --package @notis_ai/cli@latest -- notis tools toolkits
npx --package @notis_ai/cli@latest -- notis tools search "list today's calendar events"
```

Inspect a tool before execution:

```bash
npx --package @notis_ai/cli@latest -- notis tools describe composio-googlecalendar-list_events
npx --package @notis_ai/cli@latest -- notis tools exec composio-googlecalendar-list_events --get-schema
```

Dry-run a tool call:

```bash
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_GET_DATABASE --dry-run --arguments '{"database_slug":"tasks"}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --dry-run --arguments '{"database_id":"tasks-db-id","query":{"page_size":10}}'
```

Execute a tool call:

```bash
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_GET_DATABASE --arguments '{"database_slug":"tasks"}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --arguments '{"database_id":"tasks-db-id","query":{"page_size":10}}'
```

Connect a missing toolkit:

```bash
npx --package @notis_ai/cli@latest -- notis tools link github
```

Reconnect a credential-based toolkit without putting the secret in shell history:

```bash
npx --package @notis_ai/cli@latest -- notis tools link dataforseo --reconnect --credentials - < credentials.json
```

## Native database access

Native Notis databases are accessed through the generic tool workflow, not a first-class database command group. Use these canonical tool names:

- `LOCAL_NOTIS_DATABASE_LIST_DATABASES` -- list databases accessible to the current profile
- `LOCAL_NOTIS_DATABASE_GET_DATABASE` -- inspect read-only metadata and schema detail
- `LOCAL_NOTIS_DATABASE_QUERY` -- query documents from a database
- `LOCAL_NOTIS_DATABASE_UPSERT_DATABASE` -- create or update a database schema. Every database belongs to a Notis app: creation requires the owning app's slug or id in the `app` argument (create the app first with `LOCAL_NOTIS_CREATE_APP` if needed)

Example workflow before building an app:

```bash
npx --package @notis_ai/cli@latest -- notis tools search "list Notis databases"
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_LIST_DATABASES --arguments '{}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_GET_DATABASE --get-schema
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_GET_DATABASE --arguments '{"database_slug":"social_media_calendar"}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --arguments '{"database_id":"social-media-calendar-db-id","query":{"page_size":1}}'
```

When `LOCAL_NOTIS_DATABASE_LIST_DATABASES` or `LOCAL_NOTIS_DATABASE_GET_DATABASE` returns a database ID, prefer `database_id` for `LOCAL_NOTIS_DATABASE_QUERY`; `database_slug` remains supported as a fallback.

## Supporting commands

- `npx --package @notis_ai/cli@latest -- notis whoami` — confirm which account and endpoint a command will target
- `npx --package @notis_ai/cli@latest -- notis doctor` — verify CLI config, auth, routing, and API reachability before relying on the CLI
- `npx --package @notis_ai/cli@latest -- notis describe <command...>` — get the exact command contract for first-class CLI commands

## Summary

Use `notis-cli` for two things:

1. local app development through `npx --package @notis_ai/cli@latest -- notis apps ...`
2. tool discovery and execution through `npx --package @notis_ai/cli@latest -- notis tools ...`

Most importantly: if you do not currently have the tool you need, especially for direct MCP or integration work, use the Notis CLI instead of treating the task as blocked.

## Troubleshooting

### CLI returns `auth_expired` or `auth_missing`

The profile's browser authorization has lapsed or was never granted. Run
`notis login` (add `--profile <name>` when the failing profile is not the
active one) and have the user approve the browser prompt. In JSON/agent mode
the first hint is the exact command to run. Do not copy refresh tokens into
commands or try to mint a credential yourself.

If the profile is a `dev-*` one, the fix is to restart `./dev.sh` in the
workspace it belongs to, or to switch to a real account profile.

### Deploy fails with "network_error" or "fetch failed"

Run `notis doctor` to verify the effective profile and endpoint. Read back the exact app ID,
version and release state before retrying. An uncertain network response is not proof of rollback.
There is no direct storage deployment path. Repair authentication when needed without changing the
intended profile, then reconcile the previous outcome before starting a new release.

Localhost backends are a Notis-developer test lane owned by `./dev.sh` and its lease-backed profile.
Do not silently switch between that lane and a live account.

### Health or tool-roundtrip errors

Local scaffold/build and stub verification can run without an API connection (dependencies and
browser tooling must already be available). `link`, `pull`, `create`, `list`, `deploy`, live verification
and Store operations require the intended backend. Never bypass it.

### Stale bundle in Portal after an update

Every successful release gets a new integer deployment version. Read back that version, then use
normal refresh/navigation to load it. Never overwrite or decrement an existing deployment version.
