---
name: notis-cli
description: Use when agents should work through the Notis CLI, especially to develop Notis apps locally or to access Notis, Composio, or MCP tools they do not currently have loaded directly.
feature_flag: cli_access
mcp_resource: true
mcp_tool_patterns: []
mcp_references: ["references/app-delivery.md", "references/tool-examples.md", "references/native-databases.md", "references/troubleshooting.md"]
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

## User and repository policy takes precedence

Default delivery below applies only when no more restrictive user or repository
instruction exists. Explicit preview-only/no-deploy requests and standing requirements
for explicit deployment consent override the default. Preserve that authority across
local and cloud runs. For local-only work, build and run stub verification; do not
create remote resources or activate an app. `apps dev` is not a supported delivery
path; use the CLI's documented build/verification harness. Store publication remains
separately authorized.

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

## Task guides

Read only the guide needed for this task. Relative links resolve in the skill bundle.
For hosted MCP, fetch the matching `notis://docs/notis-cli/references/<file>.md` URI
with resources/read or the available Notis resource-fetch tool; the root resource
also rewrites these links to their published URIs.

- [App delivery](references/app-delivery.md)
- [Toolkit mental model](references/tool-examples.md)
- [Native database access](references/native-databases.md)
- [Supporting commands](references/troubleshooting.md)
