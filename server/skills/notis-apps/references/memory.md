# Memory policy

Choose what is useful to retrieve, not everything the view can display. Every view
sets `memory: {markdown, attachments, screenshot, snapshots}` explicitly. Records
follow their database's main-view policy; views can also keep snapshots. Copies
are per person, built under that person's current access, on paid plans.

| Content | Turn on for | Usually leave off for |
| --- | --- | --- |
| Markdown | Human-written notes, meetings, journal entries, task titles and tickets | Bulk observations, leads and run logs |
| Attachments | Information inside scans, receipts, meal/document photos and meaningful release media | Decorative covers and generated chart exports |
| Screenshot | Charts, maps, calendars and visual boards | Prose and wide tables already captured as Markdown |

Record Markdown serializes labeled properties, relation/select titles and the
collaboration sidecar's BlockNote Markdown without a browser. Attachment ingestion
sends attached files for extraction. Screenshots render the record in its main view.

## Snapshot timing

```ts
memory: {
  markdown: true,
  attachments: false,
  screenshot: true,
  snapshots: ['on_render', { scheduled: '0 7 * * 1' }],
},
```

- `on_render`: keep a snapshot when an agent/check/export renders the view. Good
  for a live dashboard or connected-service view; not a background polling loop.
- `{scheduled: '<five-field UTC cron>'}`: history at the data's useful pace. Use a
  fixed minute. A weekly dashboard need not produce hundreds of daily snapshots.
- `{on_change: {debounceSeconds: 300}}`: a view over slowly changing native data;
  the debounce is 60–86,400 seconds. Avoid it for busy automated row streams.
- `[]`: no view snapshots. Use this on a list whose human-written records already
  enter memory individually. Forms and utilities normally disable all three content
  switches and use `snapshots: []`.

A view with paid connected-service reads uses **on-render only**. Background
snapshots cannot perform paid reads; an empty or denied render is not a snapshot.

Examples: Notes enables record Markdown and meaningful attachments, not screenshots;
Tasks enables record Markdown, not duplicate list snapshots; SEO observations disable
row indexing while the summary dashboard gets a scheduled visual snapshot. Write a
clear description/readableContext so a hit explains the captured view and period.

## Read memory as a pointer to evidence

Hits identify `source` (record or view snapshot), current view `link`/`main_link`,
`captured_at`, content type and `fresh`. Records compare captured/current revisions;
view snapshots report `data_changed_since` when that can be established. An unknown
freshness or withheld excerpt is not current data.

When a hit is stale, freshness is unknown, or the answer is sensitive (identity
numbers, money), render its returned `render` link with `LOCAL_NOTIS_RENDER_VIEW`.
Read the relevant value from fresh Markdown or the screenshot and cite the current
view-qualified link. An old index URL or matching title is insufficient. Access
loss must exclude the old copy/content; never bypass it with another person's view.
