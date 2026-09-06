## Supporting commands

- `npx --package @notis_ai/cli@latest -- notis whoami` — confirm which account and endpoint a command will target
- `npx --package @notis_ai/cli@latest -- notis doctor` — verify CLI config, auth, routing, and API reachability before relying on the CLI
- `npx --package @notis_ai/cli@latest -- notis describe <command...>` — get the exact command contract for first-class CLI commands

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
