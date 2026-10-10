# @notis_ai/cli

Agent-first Notis CLI for Spaces, Skills and generic tool execution.

## Install

Requires Node.js 22.12.0 or newer (Node 24 LTS recommended). Update Node.js before installing or running the CLI; the CLI never upgrades your host runtime.

Use the Notis CLI through NPX; do not rely on an installed `notis` command. Run `notis login` once to authorize a scoped, revocable OAuth credential in the browser — that is how the CLI signs in everywhere, including on a machine that also runs Notis Desktop.

After local login, the CLI idempotently adds static Notis guidance to detected Codex and Claude Code user instruction files without changing their hooks. Run `notis agents install` when you explicitly want memory hooks that load the user's profile at session start, recall only new relevant memories before prompts, and save completed turns as automatic cross-session context. Codex then asks you to review and trust those hooks once in `/hooks`.

For CI, hosted agents, or internal scripts, pass a non-persisted token with `NOTIS_JWT=<token>`.

## Quick Start

```bash
npx --package @notis_ai/cli@latest -- notis --help
npx --package @notis_ai/cli@latest -- notis login
npx --package @notis_ai/cli@latest -- notis doctor
npx --package @notis_ai/cli@latest -- notis spaces list
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
- `--mode <mode>` — auto (default) hands the browser callback to a background listener when this command cannot wait; browser waits in-process; code shows a one-time code to copy.
- `--paste-code` — Alias for --mode code.
- `--timeout-seconds <n>` — Authorization lifetime in seconds (default 300 while waiting in a terminal; 1800 for detached or code hand-offs).
- `--scope <scope>` — OAuth permission to request (repeatable).
- `--code <code>` — Redeem the code shown in the browser after a non-interactive login.

Examples:
- `npx --package @notis_ai/cli@latest -- notis login`
- `npx --package @notis_ai/cli@latest -- notis login --profile work`
- `npx --package @notis_ai/cli@latest -- notis login --profile beta --api-base https://api-beta.notis.ai`
- `npx --package @notis_ai/cli@latest -- notis login --no-browser --print-url`
- `npx --package @notis_ai/cli@latest -- notis login --mode browser`
- `npx --package @notis_ai/cli@latest -- notis login --mode code`
- `npx --package @notis_ai/cli@latest -- notis login --code 4f3c2b1a`

### `npx --package @notis_ai/cli@latest -- notis logout`

Revoke and remove the OAuth credential for one CLI profile.

When to use: Use this to disconnect a single account. Other profiles keep their credentials unless you pass --all-profiles.

Options:
- `--all-profiles` — Clear OAuth credentials and pending authorizations from every CLI profile.

Examples:
- `npx --package @notis_ai/cli@latest -- notis logout`
- `npx --package @notis_ai/cli@latest -- notis logout --profile work`
- `npx --package @notis_ai/cli@latest -- notis logout --all-profiles`


## Coding-agent context

### `npx --package @notis_ai/cli@latest -- notis agents install`

Install Notis instructions and recall/capture hooks for local Codex and Claude Code.

When to use: Run after login to give local coding agents durable Notis CLI guidance, session-start profile context, deduplicated relevant recall, and automatic completed-turn capture. Hosted Notis sandboxes already receive prompt context and are skipped.

Options:
- `--codex-only` — Configure only Codex.
- `--claude-only` — Configure only Claude Code.
- `--no-memory-hooks` — Install static instructions and remove Notis recall/capture hooks.

Examples:
- `npx --package @notis_ai/cli@latest -- notis agents install`
- `npx --package @notis_ai/cli@latest -- notis agents install --codex-only`
- `npx --package @notis_ai/cli@latest -- notis agents install --claude-only`
- `npx --package @notis_ai/cli@latest -- notis agents install --no-memory-hooks`


## Skills

### `npx --package @notis_ai/cli@latest -- notis skills list`

List every Skill you can see, with its kind, editability and Space links.

When to use: Find a Skill and its exact edit target before reading or editing it, or see what a Space and its sub-Spaces list. Links to Spaces you cannot open are omitted; an unavailable link gives no access.

Options:
- `--space <id>` — Only Skills listed by this Space and, by default, its sub-Spaces.
- `--no-child-spaces` — With --space: direct links of that Space only.
- `--include-disabled` — Include Skills you disabled.
- `--after <cursor>` — Continue from the next cursor of the previous page.
- `--limit <n>` — Page size between 1 and 100 (default 50).

Examples:
- `npx --package @notis_ai/cli@latest -- notis skills list`
- `npx --package @notis_ai/cli@latest -- notis skills list --space <space-id> --no-child-spaces --json`

### `npx --package @notis_ai/cli@latest -- notis skills create <file>`

Create a native Skill, standalone or linked to an editable Space.

When to use: Create complete instructions or files without provider installation. Choose an optional Space destination, dry-run, and keep the exact request key on retry.

Options:
- `--request-id <key>` — Stable creation intent key; reuse after an uncertain reply.
- `--dry-run` — Validate without creating an identity or uploading files.

Examples:
- `npx --package @notis_ai/cli@latest -- notis skills create ./skill.json --request-id create-1 --dry-run`

### `npx --package @notis_ai/cli@latest -- notis skills settings read <skill-id>`

Read a native Skill personal enablement, agent targets and settings revision.

When to use: Inspect direct-owner preferences without changing shared instructions or Space access.

Examples:

### `npx --package @notis_ai/cli@latest -- notis skills settings update <file>`

Update personal native Skill settings with a current revision and stable retry key.

When to use: Enable or disable your agents without changing a shared Skill definition or another Space.

Options:
- `--request-id <key>` — Stable settings intent; reuse after a lost reply.
- `--dry-run` — Validate current ownership and revision without changing settings.

Examples:

### `npx --package @notis_ai/cli@latest -- notis skills read [skill-id]`

Inspect a native Skill through direct ownership or an editable Space link.

When to use: Read the exact target and content version before editing. A Space target uses its current Editor authority, never a personal fallback.

Options:
- `--files` — Include every verified supporting file as base64.
- `--target <json>` — Exact {skill_id} or {space_id,binding_id} read target; do not combine with a Skill ID.

Examples:
- `npx --package @notis_ai/cli@latest -- notis skills read <skill-id> --files`
- `npx --package @notis_ai/cli@latest -- notis skills read --target '{"space_id":"<id>","binding_id":"<binding>"}' --files`

### `npx --package @notis_ai/cli@latest -- notis skills update <file>`

Edit a native Skill through its direct or Space target, preserving its ID and supporting files.

When to use: Use the target/version from skills list or skills read, dry-run, then reuse the same request key and bytes to save or recover a lost reply. The same edit file works for a standalone or a Space target; an optional links key changes where the Skill is listed in the same transaction.

Options:
- `--request-id <key>` — Stable edit intent key; reuse after lost replies.
- `--dry-run` — Check current access, content and revisions without uploading or saving.

Examples:
- `npx --package @notis_ai/cli@latest -- notis skills update ./skill-edit.json --request-id edit-1 --dry-run`

### `npx --package @notis_ai/cli@latest -- notis skills links <skill-id>`

Add, remove or move a Skill between Spaces; the Skill keeps its ID.

When to use: Change where a Skill is listed without editing its content. A move is one add plus one remove in one transaction. You must be an Editor of every Space you touch and able to edit the Skill; removing its last available link keeps it as your own standalone Skill.

Options:
- `--add <json>` — JSON array of {space_id, space_revision, alias?} links to add; alias defaults to the Skill name.
- `--remove <json>` — JSON array of {binding_id, binding_revision} links to remove, from skills list.
- `--request-id <key>` — Stable intent key; reuse it unchanged when retrying this change.

Examples:
- `npx --package @notis_ai/cli@latest -- notis skills links <skill-id> --add '[{"space_id":"<space-id>","space_revision":3}]' --request-id link-1`
- `npx --package @notis_ai/cli@latest -- notis skills links <skill-id> --add '[{"space_id":"<to-space-id>","space_revision":3}]' --remove '[{"binding_id":"<binding-id>","binding_revision":2}]' --request-id move-1`

### `npx --package @notis_ai/cli@latest -- notis skills sync`

Synchronize account skills and keep the three Notis base skills current.

When to use: Run manually whenever local agent skills should be reconciled. Manual runs ignore the Desktop automatic-sync preference.

Options:
- `--electron-repeat` — Honor the automatic Desktop sync preference (used by Notis Desktop).

Examples:
- `npx --package @notis_ai/cli@latest -- notis skills sync`
- `npx --package @notis_ai/cli@latest -- notis skills sync --json`


## Spaces

Build, verify and publish Space views, their linked Skills and resources. The product `notis-apps` skill owns the workflow and the consequences of links, moves and the bin.

### `npx --package @notis_ai/cli@latest -- notis spaces screenshot <url>`

Capture a full-height PNG of a live view with your current access.

When to use: Check the actual deployed view; writes are blocked and current access is checked again before any output is saved.

Options:
- `--width <pixels>` — 1440 (default) or 390.
- `--output-dir <path>` — New output directory; defaults to a unique .notis/renders directory. Existing files are never overwritten.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces screenshot <view-link> --width 390`

### `npx --package @notis_ai/cli@latest -- notis spaces init <name> [dir]`

Scaffold an editable collection view with first-party record components.

When to use: Start a local Space collection source for an existing linked database. Does not create or deploy remote resources.

Options:
- `--database-key <key>` — Portable key of the database this Space links.
- `--path <path>` — Descriptive view path; defaults to records.
- `--title-property <id>` — Canonical title/number property ID, or the title column (default).

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces init Notes ./notes --database-key notes --path notes`

### `npx --package @notis_ai/cli@latest -- notis spaces navigation bind <space-id>`

Bind a named destination for the next source publication without granting target access.

When to use: Connect a portable navigation alias to an existing Space or exact record before building and publishing.

Options:
- `--alias <name>` — Declared portable navigation alias.
- `--target <json>` — Exact {space_id,document_id?}, or null to remove the draft binding.
- `--revision <number>` — Current source Space metadata revision.
- `--dry-run` — Check current source/target access and revision without changing anything.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces navigation bind <space-id> --alias history --target '{"space_id":"<history-id>"}' --revision 2 --dry-run`

### `npx --package @notis_ai/cli@latest -- notis spaces resources name <space-id> <binding-id>`

Give an included resource a portable alias before the first source revision.

When to use: Prepare staged resources for source authoring without replacing their IDs, scope or owners.

Options:
- `--alias <name>` — Stable lowercase alias to use in source.
- `--revision <number>` — Current Space metadata revision.
- `--dry-run` — Check naming, current access and revision without changing metadata.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces resources name <space-id> <binding-id> --alias weekly-report --revision 0 --dry-run`

### `npx --package @notis_ai/cli@latest -- notis spaces pull <space-id> [dir]`

Pull one editable Space source snapshot, its resource list and its Skill folders into an empty directory.

When to use: Edit a Space you can administer: the source, its links (resources.json) and every editable linked Skill (skills/<alias>/) arrive together, with a local lock file so a later deploy sends only what you changed.

Options:
- `--revision <number>` — Exact published source revision; defaults to the current one.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces pull <space-id> ./space-source`

### `npx --package @notis_ai/cli@latest -- notis spaces verify [dir]`

Render one frozen Space with offline fixtures and validate its current action authorizations.

When to use: Check immutable build bytes and authoring compatibility without executing actions or publishing.

Options:
- `--space <key>` — Exact source key from the workspace index.
- `--space-id <id>` — Exact existing destination Space.
- `--reuse-grants <json>` — Explicit action-key to saved-grant-ID map. Otherwise your own connections are used.
- `--reuse-grants-only` — Never authorize new actions. Reuse only the supplied saved grants; other declarations remain unavailable. Requires existing bound databases.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces verify . --space overview --space-id <space-id>`

### `npx --package @notis_ai/cli@latest -- notis spaces preview [dir]`

Seal a checked unpublished revision of the same Space and return its authenticated preview link.

When to use: Review a checked candidate using current Editor access without changing live source or cloning the Space.

Options:
- `--space <key>` — Exact source key from the workspace index.
- `--space-id <id>` — Exact existing destination Space.
- `--reuse-grants <json>` — Explicit action-key to saved-grant-ID map. Otherwise your own connections are used.
- `--reuse-grants-only` — Never authorize new actions. Reuse only the supplied saved grants; other declarations remain unavailable. Requires existing bound databases.
- `--request-id <key>` — Stable intent key. Reuse after timeouts or lost replies.
- `--dry-run` — Validate without uploading or publishing.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces preview . --space overview --space-id <space-id> --request-id release-1`

### `npx --package @notis_ai/cli@latest -- notis spaces deploy [dir]`

Publish one built Space with a retry-safe, independent source revision.

When to use: Update only the selected existing Space; this does not publish to the Store or change siblings.

Options:
- `--space <key>` — Exact source key from the workspace index.
- `--space-id <id>` — Exact existing destination Space.
- `--reuse-grants <json>` — Explicit action-key to saved-grant-ID map. Otherwise your own connections are used.
- `--reuse-grants-only` — Never authorize new actions. Reuse only the supplied saved grants; other declarations remain unavailable. Requires existing bound databases.
- `--request-id <key>` — Stable intent key. Reuse after timeouts or lost replies.
- `--dry-run` — Validate without uploading or publishing.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces deploy . --space overview --space-id <space-id> --request-id release-1`

### `npx --package @notis_ai/cli@latest -- notis spaces promote <release-id> [dir]`

Publish the exact sealed Space revision, with its pending Skill and link changes, after current permission and concurrency checks.

When to use: Finish a reviewed preview without rebuilding or substituting a different candidate. The Skill edits, new Skills and list changes the preview carried go live in the same transaction.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces promote <release-id>`

### `npx --package @notis_ai/cli@latest -- notis spaces abandon <release-id>`

Close an unpublished Space preview without changing its live source, Skills or links, or deleting action history.

When to use: Stop using a candidate while preserving live source and completed effects.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces abandon <release-id>`

### `npx --package @notis_ai/cli@latest -- notis spaces list`

List Spaces currently available to your account.

When to use: Discover accessible Spaces without exposing an issuer-wide resource catalogue.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces list`

### `npx --package @notis_ai/cli@latest -- notis spaces get <space-id>`

Read one accessible Space and its scoped resources.

When to use: Inspect the current published revision and named capabilities before executing.

Options:
- `--record <record-key>` — Fixed record context, when this is a record-scoped Space.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces get <space-id>`

### `npx --package @notis_ai/cli@latest -- notis spaces action <space-id> <action-id>`

Execute a declared action using its saved authorization.

When to use: Use Space capabilities as the actual actor, with the saved issuer connection and payer.

Options:
- `--revision <number>` — Exact published source revision.
- `--preview-release <id>` — Exact sealed candidate ID; requires current Editor access.
- `--schema-revision <number>` — Native schema revision; required for native row writes.
- `--inputs <json>` — Declared action input values; defaults to {}.
- `--record <record-key>` — Fixed record context, when this is a record-scoped Space.
- `--request-id <key>` — Stable intent key. Reuse after timeouts or lost replies.
- `--dry-run` — Validate current access and action inputs without executing or billing.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces action <space-id> refresh --revision 1 --inputs '{}' --request-id refresh-1 --dry-run`

### `npx --package @notis_ai/cli@latest -- notis spaces viewer-read <space-id> <operation>`

Run one declared viewer read as yourself.

When to use: Check what an explorer Space shows you: the databases or Skills you can open, with your own access and never an issuer grant.

Options:
- `--revision <number>` — Exact published source revision.
- `--preview-release <id>` — Exact sealed candidate ID; requires current Editor access.
- `--input <json>` — Read input, e.g. {"database_id":"<id>"}; defaults to {}.
- `--record <record-key>` — Fixed record context, when this is a record-scoped Space.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces viewer-read <space-id> list_databases --revision 3`
- `npx --package @notis_ai/cli@latest -- notis spaces viewer-read <space-id> query_database --revision 3 --input '{"database_id":"<id>","request":{"page_size":20}}'`

### `npx --package @notis_ai/cli@latest -- notis spaces grants list <space-id>`

Inspect authorization records for a Space you can edit.

When to use: Inspect issuers and exact constraints without exposing connection secrets.

Options:
- `--record <record-key>` — Fixed record context, when this is a record-scoped Space.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces grants list <space-id>`

### `npx --package @notis_ai/cli@latest -- notis spaces grants create <space-id>`

Authorize an exact template using your current connection.

When to use: Create a Space-bound authorization; the server resolves the signed-in issuer connection.

Options:
- `--template <file>` — Canonical action template JSON file.
- `--record <record-key>` — Fixed record context, when this is a record-scoped Space.
- `--request-id <key>` — Stable intent key. Reuse after timeouts or lost replies.
- `--dry-run` — Validate the template and Editor access without creating a grant.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces grants create <space-id> --template action.json --request-id grant-1 --dry-run`

### `npx --package @notis_ai/cli@latest -- notis spaces grants revoke <grant-id>`

Revoke one saved Space authorization.

When to use: Stop future dispatches for an authorization you issued or can administer.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces grants revoke <grant-id>`

### `npx --package @notis_ai/cli@latest -- notis spaces store list`

List Space Store listings you can see.

When to use: Find Space templates published to your team or approved for everyone, and your own listings.

Options:
- `--channel <team|public>` — Only one channel.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces store list --channel team`

### `npx --package @notis_ai/cli@latest -- notis spaces store get <listing-id>`

Read one Store listing with its versions and your installs.

When to use: Check what a listing contains, its review state and whether your copies have an update.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces store get <listing-id>`

### `npx --package @notis_ai/cli@latest -- notis spaces store installs`

List the Spaces you installed from the Store.

When to use: See which installed copies have an update or conflicts to resolve.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces store installs`

### `npx --package @notis_ai/cli@latest -- notis spaces store publish <space-id>`

Publish a Space and its sub-Spaces as the next Store version.

When to use: Share a Space as an installable template: team listings publish at once, public ones wait for review.

Options:
- `--channel <team|public>` — Where to publish.
- `--metadata <json>` — Listing name, tagline, description, category, icon, accent.
- `--starter <json>` — Starter row IDs per database ({"<database-id>":["<record-key>"]}).
- `--notes <text>` — Release notes for this version.
- `--request-id <key>` — Stable intent key. Reuse after timeouts or lost replies.
- `--dry-run` — Show the package counts and review diff without publishing.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces store publish <space-id> --channel team --request-id publish-1 --dry-run`

### `npx --package @notis_ai/cli@latest -- notis spaces store install <listing-id>`

Install a Store listing as your own independent copy.

When to use: Add a published Space template to your account; your copy keeps your changes on later updates.

Options:
- `--name <name>` — Name of the installed top Space.
- `--parent <space-id>` — Install under one of your Spaces.
- `--request-id <key>` — Stable intent key. Reuse after timeouts or lost replies.
- `--dry-run` — Show what the copy contains without installing.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces store install <listing-id> --request-id install-1`

### `npx --package @notis_ai/cli@latest -- notis spaces store update <install-id>`

Update an installed copy, keeping your changes, or resolve its conflicts.

When to use: Take a newer Store version: unchanged parts update, your edits stay, and parts both sides changed become conflicts you resolve.

Options:
- `--resolve <json>` — Per conflict key: "keep_mine" or "take_theirs".
- `--request-id <key>` — Stable intent key. Reuse after timeouts or lost replies.
- `--dry-run` — Show the three-way plan without changing anything.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces store update <install-id> --request-id update-1 --dry-run`
- `npx --package @notis_ai/cli@latest -- notis spaces store update <install-id> --resolve '{"skill:<key>":"keep_mine"}' --request-id resolve-1`

### `npx --package @notis_ai/cli@latest -- notis spaces store unpublish <listing-id>`

Stop new installs of a Store listing.

When to use: Withdraw a listing: existing copies keep working and a version waiting for review is withdrawn.

Options:
- `--request-id <key>` — Stable intent key. Reuse after timeouts or lost replies.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces store unpublish <listing-id> --request-id unpublish-1`

### `npx --package @notis_ai/cli@latest -- notis spaces build [dir]`

Build one independent Space and save its frozen source/artifact snapshot.

When to use: Prepare a selected Space for verification without publishing it or changing siblings.

Options:
- `--space <key>` — Exact source key from the workspace Space index.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces build . --space overview`

### `npx --package @notis_ai/cli@latest -- notis spaces inspect [dir]`

Inspect one local Space definition and its declared capabilities.

When to use: Read the selected source definition without loading sibling definitions or account resources.

Options:
- `--space <key>` — Exact source key from the workspace Space index.

Examples:
- `npx --package @notis_ai/cli@latest -- notis spaces inspect . --space overview`


## Views

### `npx --package @notis_ai/cli@latest -- notis views find`

Find the views you can open for a record, database, view link, Space or search.

When to use: Get fresh view-qualified links and declared URL parameters before citing or opening a view.

Options:
- `--record-key <id>` — Find views that show this exact native record.
- `--database-id <id>` — Find views over this database.
- `--url <url>` — Resolve this view link and its current parameters.
- `--space-id <id>` — Describe this Space view.
- `--query <text>` — Search accessible view names, descriptions and readable context.

Examples:
- `npx --package @notis_ai/cli@latest -- notis views find --record-key <record-key>`
- `npx --package @notis_ai/cli@latest -- notis views find --url <view-link>`
- `npx --package @notis_ai/cli@latest -- notis views find --query inbox`

### `npx --package @notis_ai/cli@latest -- notis views render <url>`

Render a live view as Markdown and a full-height PNG with your current access.

When to use: Check the actual deployed view; writes are blocked and current access is checked again before any output is saved.

Options:
- `--outputs <kinds>` — Comma-separated markdown,screenshot (default both).
- `--width <pixels>` — 1440 (default) or 390.
- `--output-dir <path>` — New output directory; defaults to a unique .notis/renders directory. Existing files are never overwritten.

Examples:
- `npx --package @notis_ai/cli@latest -- notis views render <view-link> --outputs markdown,screenshot`


## Legacy Apps

For accounts not yet moved to Spaces. A legacy App cannot declare Skills; Skills are linked to Spaces.

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


## Reports and saved HTML

Create independently authored reports as Space views with the product `notis-reports` and `notis-apps` guidance. Build and verify the selected source, deploy within the user's authorization, then render its current view link. Preserved database report rows open through their main view.

For plain HTML, use the installed HTML Space and its linked saving Skill. Its generic file upload is attached to an existing native record with a separate revision-checked write; a raw download URL is not a saved page link.

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
