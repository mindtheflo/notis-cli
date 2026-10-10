# Troubleshooting

Start with the actual failing operation and its exact Space, source/record
revision and current target. [Delivery](release.md) owns the release sequence.

| Failure | Check |
| --- | --- |
| Build rejects a view | Required `specVersion`, path, descriptions, params, executable shows and memory; use the file/line diagnostic. |
| Main-view conflict | Inspect current database links/main view. Move the existing claim explicitly or retain it; do not remove main just to publish. |
| Source creation fails | Check its canonical schema and same-view main record param. Verify creates no resource; promotion is atomic. |
| View-link warning after a successful write | Use `FIND_VIEWS` with the returned record key. The write is already committed; do not insert again. |
| Empty list or missing properties | Inspect the live schema, filter, authorized binding and returned projection. Distinguish a successful empty result from a denied/failed read. |
| Verification fails on a read | Add the exact fictional case to the selected fixture file. Never fill missing fixtures with live private data. |
| A caught write-on-load fails rendering | Remove the side effect from initial rendering. A read-only check cannot authorize writes. |
| Stale binding/schema/record | Read current state, preserve the original receipt/intent and merge the intended edit. Do not overwrite concurrent changes. |
| Old code in Workspace | Read the published revision and requested bundle; source edits or restarting Desktop do not deploy it. |
| Uncertain deployment | Run `notis doctor`, read the same Space and release/request identity, then reconcile before retrying. |
| Screenshot misses content | Inspect actual inner scrolling, lazy data and frame layout; keep full-height limits and treat a failed capture as unverified. |
| Site unexpectedly has editor controls | Recheck the anonymous scoped runtime. A Site cannot borrow an ambient signed-in session or another record's authority. |
| Memory hit looks current but access/freshness is unknown | Render its current link and verify the relevant value. Do not release historical content from an unverified read set. |

For visual defects, compare the installed page at 390px and 1440px in EN/FR,
including loading, empty and error states. A standalone harness cannot certify
the Portal parent layout, collaboration or public Site behavior.
