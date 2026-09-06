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

## Workflow

Follow the Release-only delivery steps in this guide, subject to the entrypoint’s user/repository policy precedence. Use `apps scaffolds list` to discover public Store starting
points, `apps init` to scaffold locally, and `apps pull` for existing source. App file operations go
through the CLI, never raw storage/database writes. Run all Notis commands through NPX.

## Testing

Build and automated stub verification precede release. `verify` and `screenshot` start temporary,
explicit test servers only: no folder discovery, watchers, Desktop registration, persistent roots,
consumer leases or Workspace mounting. They close server/browser resources at completion or interruption.
Build also enforces the design bar and refreshes the app's embedded SDK copy. Automated verification
checks every route at desktop (1280px) and phone (390px) widths, including nested boxes, text below
12px, lingering loading placeholders and horizontal overflow. Standalone verification writes a
local diagnostic report; deploy always verifies its own frozen snapshot, with no stamp or environment bypass.
After release, verify live runtime integration and open the installed bundle in Portal. Source edits
and Desktop restarts cannot change the running version.

### Screenshots

`apps screenshot` supports declared screenshot scenarios and stub fixtures. A scenario can set
`theme: 'dark'`; use `--raw` for uncomposited captures. Store screenshots and listing readiness
are required only for Publish to Store, never for Update app.

### Headless harness verification

Run `npx --package @notis_ai/cli@latest -- notis apps verify` after `npx --package @notis_ai/cli@latest -- notis apps build`. Use `--mode live` after deploy to exercise the real `/portal_views/runtime_query` with the CLI JWT instead of stub data; live mode also fails a route whose runtime calls all errored, which a well-behaved error state would otherwise hide. In a hosted sandbox, put `agent-browser` on the verification process's `PATH` with the combined-package command above. `--no-browser` only prints URLs for manual triage and does not satisfy the automated deployment gate.

#### What the harness catches that `npx --package @notis_ai/cli@latest -- notis apps build` does not

- Hooks that mount but throw on first read (`useTool` called with the wrong tool name or argument shape, accessing nested props that are undefined).
- Runtime database queries whose slug is not declared by the app, and collection routes that never query their configured collection database. Declared databases may also support automations or agent workflows, so ordinary routes do not need to query every app database.
- Tool names referenced by hooks but missing from `notis.config.ts -> tools`.
- Suspense / async boundaries that never resolve because a runtime stub returned the wrong shape.
- Render-time exceptions that the portal would surface as the `View crashed` error boundary.

#### What the harness does not catch

- Bugs that only manifest with real backend data (auth-scoped filters, RLS, malformed prod records). For those, swap the stub runtime for a real one that posts to `/portal_views/runtime_query` with a JWT.
- Pixel-level visual regressions beyond the automated design checks (the harness does flag nested boxes, sub-12px text, lingering loading placeholders, and horizontal overflow at 390px). For anything else, use `agent-browser screenshot` + a baseline compare.
- Bugs that depend on the portal's shadow-DOM stylesheet wrapping. The harness mounts in light DOM, so global Tailwind/shadcn classes work normally; portal-specific theme tokens injected as inline styles are not present.
