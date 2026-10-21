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

### A call answers `protocol_required` or `invalid_protocol`

The call itself is malformed; nothing needs updating. Native Space and database tools need
`"protocol": 1` in their arguments. Add it (or correct it to the number `1`) and run the same call
again. The error names the field to fix in `field`.

### A command answers `client_update_required`

This Notis CLI or app is too old for Spaces or Skill sync. Update it (for the CLI, run the
`update_command` the answer gives), then run the same command again. Do not retry the old build.

### Deploy fails with "network_error" or "fetch failed"

Run `notis doctor` to verify the effective profile and endpoint. Read back the exact Space ID,
source revision and release state before retrying. An uncertain network response is not proof of rollback.
There is no direct storage deployment path. Repair authentication when needed without changing the
intended profile, then reconcile the previous outcome before starting a new release.

Localhost backends are a Notis-developer test lane owned by `./dev.sh` and its lease-backed profile.
Do not silently switch between that lane and a live account.

### A call fails with `network_error`, `network_timeout` or a 502, 503 or 504

The CLI already retries an interrupted tool call when repeating it is safe: a read, or a write that
carries an idempotency key (every `notis tools exec` and `exec-parallel` call does). It makes up to
3 attempts within the `--timeout-ms` budget, sends the same key each time so the server joins or
replays the first attempt, and reports one final result. A native write that answers
`document_outcome_unknown` or `record_file_outcome_unknown` is sent once more with identical
arguments and the same `request_id`, so its saved receipt decides whether it already happened.
`meta.attempts` on a success, or `error.details.attempts` on a failure, says how many attempts ran.

Do not wrap CLI calls in your own retry loop. When a call still fails after its attempts, run
`notis doctor`, then read back the target before deciding whether to run it again, and never repeat
a write with a new `request_id`. A `network_timeout` usually means the first attempt used the whole
budget: run the same command once with a longer `--timeout-ms`. Deploys are not retried
automatically; follow the deploy section above. Add `--no-retry` (or set `NOTIS_NO_RETRY=1`) only
when you need to see the first failure, for example while diagnosing the connection.

### Health or tool-roundtrip errors

Local scaffold/build and stub verification can run without an API connection (dependencies and
browser tooling must already be available). `link`, `pull`, `create`, `list`, `deploy`, live verification
and Store operations require the intended backend. Never bypass it.

### Stale bundle in Portal after an update

Every successful release gets a new integer deployment version. Read back that version, then use
normal refresh/navigation to load it. Never overwrite or decrement an existing deployment version.
