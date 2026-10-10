# Notis CLI: Space Development Workflow

When running outside the Notis container, use the `notis` CLI to build Notis Spaces locally. Space views are
Vite + React source using `@notis/sdk`. The product `notis-apps` skill and its release guide own the workflow;
this file lists the commands generated from the CLI's own help.

Create and edit requests authorize delivery to the installed Space after checks; explicit read-only, preview-only
or no-deploy requests stop at local artifacts without remote mutation. Store publication requires separate approval.

## Core workflow

1. `spaces pull` the exact existing Space (source, resource list, Skill folders and lock file), or `spaces init`
   a new collection view.
2. `spaces build` and `spaces verify` the selected source with fictional fixtures.
3. `spaces deploy`, or `spaces preview` then `spaces promote`, within the user's authorization. Changed Skill
   folders and resource links commit with the source release.
4. Read back the published revision, then `views find` and `views render` its live view link.

`notis apps` is the legacy App group for accounts not yet moved to Spaces; a legacy App cannot declare Skills.

## Reports and HTML

New reports are independent Space views. Existing database report payloads render inside their database's main view. Use the installed HTML Space's saving Skill for self-contained HTML. See the canonical product guidance for build, revision, native file and view-link rules.

## Commands

### `npx --package @notis_ai/cli@latest -- notis doctor`

Run a quick CLI health check for config, auth, and API reachability.

When to use: Use this before relying on the CLI in automation or after changing environments.

Examples:
- `npx --package @notis_ai/cli@latest -- notis doctor`
- `npx --package @notis_ai/cli@latest -- notis doctor --json`

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
