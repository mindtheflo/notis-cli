# Offline fixtures for Space views

Declare a `verificationFixtures` JSON source with `actions` and optional `context`,
`shown`, `viewerReads`, `documentBodies`, `recordViews`, `images`. Cases match exact action
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
`context` sets how verify opens the view: `params` (the opening view params,
a flat object of text, numbers or true/false), `now` (an ISO time that pins the clock, so a view showing
how old its data is can be checked with a later `now`) and `skeletonParams`
(other params whose loading skeletons are measured too). Verify always draws
the view in English and in French, so `locale` no longer changes the
screenshots (still accepted). To check several states in one run, declare
`contexts` instead of `context`: 1 to 4 entries `{name, params, now, locale}`
with unique lowercase names (`a-z`, `0-9`, `-`, `_`), for example
`[{"name": "week", "params": {"period": "week"}}, {"name": "opened",
"params": {"open": "<row uuid>"}}]`. Verify renders each one at both widths
and languages (`.notis/view-<key>.<name>-<width>-<locale>.png`), measures the
loading skeleton of each, and for one whose params open a list item (`open`)
also saves the reader while the item loads
(`.notis/pending-<key>.<name>.reader-<width>-<locale>.png`); with one context
the names leave out `.<name>`, and a `context` whose params open an item gets the
reader screenshot too. The `shown`, `actions` and other cases are shared by
every context.
A photo or cover shows in verify when `images` maps the exact URL a fixture
row holds to a picture next to the fixtures: `{"images":
{"https://example.com/meal.jpg": "./photos/meal.jpg"}}` (png, jpg, webp, gif
or avif, at most 32 of 2 MB each and 16 MB in all); an image it cannot load
fails verify with its URL. These pictures are published with the Space's
source, so use ones you may share.
Keep every fixture fictional and include every load-time read. Failed or missing
fixtures fail verification; there is no fallback to the user's real account.
