# Delivery

Workspace runs released Space source. Use the same workflow locally and on the
cloud computer through `npx --package @notis_ai/cli@latest -- notis`.
A create/edit request authorizes the checked installed-Space update unless the
user or applicable policy says preview-only/no-deploy. Store publication is a
separate action. Preserve exact identity and prior authorization.

## Update one Space

1. **Read identity.** Check the active account/endpoint and `spaces get <space-id>`.
   Pull the exact editable source with `spaces pull <space-id> <dir>`. Keep
   `.notis/space-lock.json`, resources, source key and current revisions. Never
   silently advance a stale checkout or create a duplicate to avoid a conflict.
2. **Build.** Edit the selected definition, its view and linked Skill files.
   Update `CHANGELOG.md`. Run `spaces build <dir> --space <key>`; it freezes source
   and artifact bytes and validates the view contract and design.
3. **Verify.** Run `spaces verify <dir> --space <key> --space-id <space-id>`.
   This checks current action authorizations and renders explicit fictional
   fixtures at 390px and 1440px with the shared read-only renderer. Provide exact
   action/list/body/record fixtures. A denied read, write-on-load or failed width
   is a failure, not a passing empty page. Inspect both locales and intended states.
4. **Publish source.** Use `spaces deploy <dir> --space <key> --space-id <space-id>
   --request-id <stable-id>`. Or `spaces preview` seals a candidate, and
   `spaces promote <release-id> <dir>` publishes that exact candidate. Preview
   authoring never silently gains live record-edit authority. Deployment updates
   the selected Space, not siblings or the Store.
5. **Read back.** Confirm published source revision and link with `spaces get` or
   `views find --space-id`. Run `views render <view-link>` and inspect Markdown
   plus the full-height screenshot. Check the affected interaction in the actual
   Portal/required Desktop surface, in EN/FR at 390px and 1440px. Fixture success
   does not prove data, access, collaboration or Site revocation.
6. **Report.** Return the canonical view link and the exact completed boundary:
   local-only, deployed/verified, deployed/unverified, failed-before-publication,
   or outcome-unknown. After an uncertain response, read the same release/request
   identity before retrying. Never bypass source checks with direct Storage writes.

## Create without duplicates

Start locally with `spaces init`, then build. Discover/list existing Spaces before
creating the intended remote identity with `LOCAL_NOTIS_MANAGE_SPACE`. Use a stable
UUID and reconcile an uncertain creation. Read back its revision and resources,
then verify/deploy with `--space-id`. A source-created database is committed with
its main view in that publication; no separate provisional database is necessary.

## What the checks prove

| Check | Proves | Does not prove |
| --- | --- | --- |
| Build | Current selected source/artifact and schema syntax | Runtime data or access |
| Verify | Frozen fixture rendering and current declarations/authorizations | Live record values, publication, sharing or visual quality |
| Live render | Read-only current view data, Markdown and full-height image | Mutation behavior or collaborative editing |
| Installed interaction | The specific checked host behavior and data readback | Store installation or production release |

`notis spaces screenshot <view-link> --width 390` captures an already deployed
view. `notis views render` saves Markdown and/or PNG with a new output path; read
the artifact, not only the command's success message. Missing output is not proof.

## Skills, resources and concurrent edits

Pulled Skill folders, `resources.json` and source share one release transaction.
Only changed content is sent; unrelated remote edits stay intact. A conflict
publishes nothing: pull fresh source into a new directory, merge the intended
change and preserve the new lock. Stale source/record/binding revisions must not
be replaced with guessed current values merely to force a write.

To restore older source, pull current identity and the desired historical
revision separately. Reapply the old content against the current lock and publish
a new revision. Source restoration does not revert user data or provider effects.

## Publication privacy and portability gate

Before an explicitly authorized Store publication:

1. Review the complete snapshot: source, listing, media, schema, selected starter
   rows, linked Skills/helpers and automations. Exclude personal data, account
   identifiers, credentials, local paths and private run logs. Use wholly fictional
   fixtures; redacting a name from real private content is insufficient.
2. Keep databases structure-only unless the user requested packaged examples.
   Store `--starter` is an explicit set of record keys per database, not a fixture
   selector. Never populate it from private notes, leads, history or folders.
3. Package the full dependency closure. Resolve the installer's own resources and
   connections; never keep publisher defaults. Preserve existing schedules and
   local customizations. Installation must not activate external deliveries.
4. Link a Set up Skill when setup is needed. It must work through native tools or
   the CLI in any harness, reconcile existing resources and be safe to rerun.
5. Use an independent isolated installer proof: install the exact listing version,
   verify remapped main views/relations and any claimed starter rows before setup,
   run setup twice, exercise fictional views and clean only run-created resources.
   Record exact identities, versions, results and cleanup in a private Notis
   record owned by the Space, never only in local files.
6. Run `spaces store publish <space-id> --dry-run` and review its diff. Execute
   only the authorized channel/publication, then read back the listing version
   and review state. Record the privacy audit and verification against that exact
   source revision in the same private record. Submission is not review approval
   or public availability.

`spaces store update <install-id> --dry-run` exposes a three-way update plan.
Resolve each explicit conflict with `keep_mine` or `take_theirs`; retain unrelated
local changes. Store publication and installed source deployment remain separate.

## Release history

Keep `CHANGELOG.md` newest first, with `## [Release title] - YYYY-MM-DD` headings
(or `{PR_MERGE_DATE}` before the release date is known). Source history belongs to
that Space; changing its local changelog does not change an already published
Store snapshot. Use the verified source revision, not the changelog title, as proof.
