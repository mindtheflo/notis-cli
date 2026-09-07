## Delivery

Workspace runs released versions only. Local and cloud agents use the same
workflow. Run Notis commands through
`npx --package @notis_ai/cli@latest -- notis ...`.

A create/edit request normally authorizes updating that app after checks pass,
**unless user or repository policy requires explicit deployment consent**.
Preserve authorization already given. Read-only, preview-only, and no-deploy
instructions stop at local source, build, and stub verification: no remote
resource mutation, app activation, or live verification. Store publication always
needs separate explicit approval. Do not deploy just to obtain visual proof when
deployment is not authorized; report that the host check remains unverified.

## Update an app

1. **Check identity.** Inspect the effective CLI profile and `apps list --json`.
   Preserve local edits, then pull the exact editable app ID and intended
   personal/team scope. Keep its profile-scoped link, current version, and revision.
   Never silently advance a stale checkout or create a duplicate to avoid a conflict.
2. **Build and inspect.** Edit the source, increment `notisAppVersion`, and update
   `CHANGELOG.md`. Run `apps build` and automated `apps verify`, then do the
   [visual check](design.md#look-at-the-result). For a new app, complete these
   local checks before creating remote resources.
3. **Prepare only missing resources.** For an existing app, retain its identity.
   For a new app, reconcile the exact canonical name, edit permission, and scope
   against `apps list --json`; reuse one matching editable identity, stop on
   ambiguity, or create only when none exists. Use `apps create "<display title>"
   <dir>` (with a verified `--team-id` for team scope), and read back the same ID.
   Create only necessary missing databases against that app. Verify ownership
   and database IDs before changing schemas; read back changes. Breaking changes
   require separate coordination. Never mutate user data merely to test the UI.
4. **Update Workspace.** Run `apps deploy` against that linked app. It builds and
   verifies a frozen source/artifact snapshot before activation. `--skip-build`
   accepts only unchanged valid output and still verifies. Use the supported
   backend path; do not bypass checks or write directly to storage.
5. **Verify delivery.** Read back the app ID, integer version, and Portal URL with
   `apps list --json`. Run `apps verify --mode live`, then open the released app
   inside Notis and inspect the affected screen and main interaction. Confirm the
   intended bundle/version, not just the existence of an app with the same name.
   A successful live harness check alone is not visual proof inside Notis.
6. **Report accurately.** Give the app link and a brief description of what changed
   and what was verified. Distinguish local-only, deployed and verified, deployed
   but unverified, failed before activation, and outcome unknown. If create/deploy
   has an uncertain outcome, reconcile its exact identity/version before retrying.

## What the checks prove

`build` validates the package, enforces design rules, and refreshes its embedded
SDK. Automated `verify` checks every route at desktop (1280px) and phone (390px)
widths, render errors, runtime calls, nested boxes, small text, lingering loading
placeholders, and horizontal overflow. It uses a temporary server and browser;
printed URLs or `--no-browser` are not passing verification. If tooling is missing,
install it with `npm exec --yes --package agent-browser@latest -- agent-browser install`.

Stub verification does not establish real account data, permissions, host layout,
or visual quality. Live verification exercises the authenticated runtime but still
uses the harness. The final installed-app check establishes the result inside Notis.
If that surface cannot be inspected, say so rather than claim it passed. No extra
approval round is needed for an already-authorized check.

`apps screenshot` supports declared scenarios and stub fixtures, including
`theme: 'dark'`; `--raw` gives uncomposited captures. Store listing screenshots are
not required for an ordinary Workspace update.

## Special cases — read only when relevant

### Unreleased container or stale checkout

An unreleased container has no source to pull. Recover its original local source,
or scaffold only if it cannot be recovered; verify the exact ID and scope and use
`apps link <app-id> <dir> --expected-version 0`. Reuse the container after a failed
first release; do not duplicate or automatically delete it. If another release
has appeared, pull it into a fresh directory and reapply the intended edits without
replacing its deployment base. Link/deploy guards must reject races and conflicts.

### Restore an older source

Pull the current release into a fresh checkout and the historical source into a
separate folder (`apps pull <id> <dir> --source-version <n>`). Replace source without
replacing the current `.notis` link/base, then check and deploy as a new release.
Preserve app/database/skill IDs. Never decrement versions or imply that source
restoration undoes user data or external actions.

### Release history and Store publication

Keep all release history in root `CHANGELOG.md`, newest first, with headings
`## [Release title] - YYYY-MM-DD` (or `{PR_MERGE_DATE}` while unpublished). Do not add
`versionNotes` to the config. App Details reads deployed history; the Store reads
its published snapshot. Local edits must not change the published listing.

`apps deploy` updates Workspace only. Use `apps publish --confirm-ready` only after
the user explicitly approves the current App Details and Store listing. Deploy the
exact approved source first. Respect listing completeness, visibility, version,
and pending-review guards. A public submission includes editable source, Store
assets, source-declared database schemas, and only explicitly opted-in starter
rows. Do not hand-edit `notis-listing.json` or strip files to pass review; fix the
source, redeploy, and resubmit. To start from a Store app, use `apps init --from
<slug>`; `apps pull` is for an accessible installed app, not a Store listing clone.
