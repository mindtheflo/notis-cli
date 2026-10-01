# Agent intelligence levels

This is one shared contract for repository skills and account-installed skills.
Read it from the `contract` field returned by `LOCAL_NOTIS_GET_INTELLIGENCE_POLICY`,
directly as a native tool or through the authenticated Notis CLI. The same response
contains current harness mappings and a `contract_revision` fingerprint. No local
repository document is a runtime prerequisite. This bundled guide is the source
served by that lookup, not a separate environment-specific contract.

Skills request **low**, **medium**, or **high**. They never maintain model names,
version pins, family aliases, effort tables, or price scorecards. The current
Notis runtime policy is the source of truth, on every operating system and host.

## Choosing a level

| Level | Work |
| --- | --- |
| **low** | Bounded extraction, classification against a supplied rubric, formatting, and repetitive generation from complete inputs. |
| **medium** | Synthesis, writing and reviewing prose from supplied evidence, and moderately complex bounded work. |
| **high** | The skill default when unspecified: complex reasoning, investigation, coding, code review, and orchestration. |

These are skill defaults, not changes to account or product defaults. The user's
explicit instruction for this invocation wins: level, exact model, effort,
harness, or inheritance from the current session. Preserve the scope of that
override; never save a lasting preference unless asked. Maximum-depth requests
are invocation overrides, not a fourth Notis level.

## Resolve at execution time

Discover **get current Notis intelligence policy for each harness** through the
Notis tool catalogue. The read-only tool is `LOCAL_NOTIS_GET_INTELLIGENCE_POLICY`:

```bash
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_GET_INTELLIGENCE_POLICY \
  --arguments '{"harness":"codex","level":"low"}'
```

Omit arguments to read all levels. Harness keys are `notis`, `codex`, and
`claude_code`. A local Mac, Windows host, cloud sandbox, or CI runner uses the
same contract. Cursor or another host must identify its actual execution engine;
it must not pretend to be a supported harness based on installed binaries.

The projection is generated from the backend native intelligence configuration and external-harness policy. It contains no
second mapping. Weekly policy changes therefore require no skill edits.

- Resolve **both model and reasoning effort**. Level names are not effort names.
- Resolve once per delegated job; keep its `policy_revision` and selection stable
  through claim, generation, retry and completion. A new job gets a fresh policy.
- Explicit user choices override the selection; validate them with the executing
  harness. Never substitute another model, buy API capacity, or change accounts
  because a selection is unavailable.
- Validate the request against advertised harness capabilities. Policy is not
  evidence of entitlement, quota, installed support or successful execution.
- Use native `intelligence_mode` when the Notis delegation interface supports it.
  External launchers translate the returned selection into their supported options.
- Do not downgrade or restart the main session to enforce a skill default.
- A single-model harness can inherit its current configuration and disclose that
  the requested level was not applied. Unknown or unavailable mappings are not
  permission to guess a model. Automated launchers that require an exact selection
  stop before claiming jobs or producing side effects and explain the missing policy.
- Before this lookup is deployed, use a current runtime-injected policy if present;
  otherwise use the transparent inheritance behavior above. Do not copy a temporary
  model table into skills as a rollout workaround.

## Modalities, product assertions and provenance

Image, speech, video, embedding and provider-research engines are capabilities,
not interchangeable text-reasoning levels. Skills discover the current native
capability and let its backend select the engine. External scripts requiring an
exact provider-specific identifier must resolve current supported configuration
or take an explicit invocation override; they must not pass `low` as an engine ID.

Test specs assert behavior against the current backend configuration, rather than
freezing last month's model names. Preserve exact comparisons: derive the expected
identifier from the owning policy or tool configuration, then compare the receipt.
Do not weaken a routing test to merely check that some model name exists.

Persist **the actual model that ran**, not an intelligence level. Resolve before
claiming jobs when the identifier participates in a prompt hash or lease contract.
Verify execution readback before certifying provenance; aliases and requested
settings are not actual-model receipts. Preserve historical evidence and existing
records. Do not rewrite an old receipt as today's policy.

## Subscription execution

A level chooses intelligence, not payment authority. Use the current harness's
sub-agents or the user's subscription CLI. The existing direct-provider approval
boundary remains in the workspace/account provider-approval policy.

For subscription CLI subprocesses, remove provider API-key/base-URL variables
from the child environment. Preserve native subscription credentials; never log
out or rewrite account authentication to enforce a level. Check the harness's
execution/authentication readback. Resolve only once per job, batch bounded items
where appropriate, and keep existing concurrency and usage limits.
