# Offline fixtures for Space views

Declare a `verificationFixtures` JSON source with `actions` and optional `context`,
`shown`, `viewerReads`, `documentBodies`, `recordViews`. Cases match exact action
inputs/list params. Each `useShown` name maps to an array of `{params, result}` cases:

```json
{
  "actions": {},
  "shown": {
    "tasks": [{"params": {"status": "inbox"}, "result": {"rows": []}}]
  }
}
```

Use your declared list names and exact initial params (including defaults); add a
case for every load-time list read. A `useNativeCount` read is an `actions` case of
the binding's query action: `{"inputs": {"request": {"filter": ..., "mode": "count"}},
"result": {"count": 3, "schema_revision": 1}}` (no `filter` key when it has none). Put fictional rows in `result.rows` to verify
populated states. Record views use `{operation: 'record'|'html'|'report', record_key,
result}`; native record snapshots require `writable: false` and no authoring target.
A record view fixture needs a declared native database resource; a record param is
optional (a list row's `HtmlFrame` takes none). An `HtmlFrame` preview reads
`{operation: 'html', record_key: '<row uuid>', result: {record_key: '<same uuid>',
html: '<!doctype html>...', title: 'Optional'}}` and renders that HTML in the live
sandbox and viewer CSP, sized by its `className` (a 1920x1080 slide box shows the
real slide in verify screenshots); popups and network stay blocked offline.
When a view reads a record view its fixtures lack, verify names the view, the read,
the record key and the missing field, and prints a valid entry to copy.
`context` sets how verify opens the view: `params` (the opening view params),
`locale` (`"fr"` renders the data screenshots in French; run verify once with
it to check French with data), `now` (an ISO time that pins the clock, so a
view showing how old its data is can be checked with a later `now`) and
`skeletonParams` (other params whose loading skeletons are measured too).
Keep every fixture fictional and include every load-time read. Failed or missing
fixtures fail verification; there is no fallback to the user's real account.
