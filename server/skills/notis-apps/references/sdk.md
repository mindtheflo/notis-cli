# SDK reference for Space views

Import hooks/components from `@notis/sdk`; configuration helpers are in
`@notis/sdk/config`. `NotisProvider` already installs shortcut support. Use the
scoped host runtime—source never owns an account credential or backend transport.

## Records and declared reads

| API | Use |
| --- | --- |
| `useViewParams<typeof definition>()` | `{params, invalid, missing, declared, ready}` for declared typed URL params. Unknown names are dropped; invalid values use their declared default. |
| `useShown<Row>(name, options?)` | Execute the native list in `shows[name]` with current params. Options: `sorts`, `pageSize`, `offset`, `includeContent`; result includes `data`, `loading`, `hasData`, `error`, `refetch`. |
| `useShownAvailable(name)` | Check whether this host exposes the declared native list. A record Site can expose only its exact server-pinned row scope. |
| `useAction<Inputs, Result>(name)` / `useActionQuery<Result>(name, inputs)` | Call a declared action; identify read-only calls explicitly and retain request IDs/revisions for writes. Never call account-wide tools from a Space. |
| `useNativeDocumentBody(binding, recordKey, {readAction, writeAction?, enabled?})` | Markdown body adapter. Keep drafts in the view; save with the original content, record/schema revisions and stable request ID. Rich editing normally uses `DocumentEditor`. |
| `useNotis()` | Host resource, Space/app labels, route and ready state. Use `resource.id` for the current Space identity. |

```tsx
const { resource } = useNotis();
const nav = useNotisNavigation();
const { params } = useViewParams<typeof definition>();
const rows = useShown<{ record_key: string; title: string | null }>('notes');
// In the row's click handler:
nav.toSpace(resource.id, { recordKey: row.record_key });
// In the record branch:
<DocumentPage recordKey={params.note} breadcrumb={[{ label: 'All notes', onSelect: () => nav.toSpace(resource.id) }]} />
```

Keep hooks unconditional. Preserve cached content during refresh; `loading` is
first-read state, not every fetch. Use [Design](design.md#instant-view-loading-contract-required)
for loading/error/empty states and explicit read caching.

## First-party record components

| Component | Contract |
| --- | --- |
| `<DocumentPage recordKey>` | The full page of a record that is the view's main content (a note, a document): breadcrumb, Saving or Saved, '...' menu, cover, icon, title, meta strip, properties that save automatically, collaborative body. Slots `breadcrumb`, `actions`, `menuItems`, `aboveBody`, `belowBody`; toggles `share` (off by default), `header`, `meta`, `properties`, `width`; `onSaved`; `layout` to rearrange its parts. Pair with `DocumentPageSkeleton` and `usePrefetchRecord()`. Until the Notis CLI you build with exports it (`spaces build` replaces the Space's `packages/sdk` with the CLI's own SDK, and older ones have no `DocumentPage`, so the import fails the build), reach the same host page through `useNotisRuntime().ui?.DocumentPage` and fall back to `DocumentEditor` when it is missing, as the Notes Spaces do in `lib/document-page.tsx`. |
| `<DocumentEditor recordKey>` | Native collaborative body, properties, images and attachments. With separate properties use `showProperties={false}`. |
| `<RecordProperties recordKey>` | Native revision-checked property editing. |
| `<HtmlFrame recordKey>` | Attached HTML under viewer CSP and an opaque-origin sandbox. Source cannot relax that boundary. |
| `<ReportFrame recordKey>` | A report row's saved independent implementation in its database's current view. |
| `<ShareControl recordKey>` | Private/shared record Site, copy link and revoke. |

The published Space declares the database binding; the server rechecks record
scope and binding revision. A Site exposes read-only body/property snapshots and
HTML for its pinned record, including a declared non-collection record param.
It has no upload, collaboration credential, authoring controls or sharing mutation.
Preview source does not gain live record editing. No app-owned credentials or
filesystem URLs belong in component props.

## Navigation

`useNotisNavigation()` exposes `toSpace(spaceId, {recordKey?, params?})` and
`toNamedSpace(alias, {recordKey?, params?})`. Prefer declared portable navigation
aliases for sibling destinations; the host resolves them under current access.
Use declared params for view state, for example `{params: {project: key, period: 'week'}}`.
The destination drops unknown params and authorizes referenced records. Changing
a slug cannot change identity. Agents cite current server-returned links.

## Viewer-only exploration

`viewerReads: ['databases', 'skills']` permits read-only inspection of what the
signed-in viewer already reaches. It creates no shared grant. Use
`useViewerReadAvailable(family)`, `useViewerDatabases`, `useViewerSkills`, or
`useViewerRead(operation, input)`. Anonymous Sites cannot use these families.
Explicit synthetic `viewerReads` fixtures stand in for the viewer's reads offline.

## The viewer's cloud computer

`cloudComputer: 'shell'` (or `'read'` for facts only) lets a page run one command
or write one file on the signed-in viewer's own cloud computer, after that viewer
allows it in the Portal prompt. Use `useCloudComputerShell()`: check `level`, call
`requestApproval()` when `approved` is false (either level; the facts of
`useCloudComputer()` are read again once allowed), then, when `available` (`shell`),
`run(command, options)` or
`upload({ path, content, content_encoding: 'base64', mode: 0o600 })`. Never put
secrets in a command; send them as upload content. A run is never repeated for one
request key: pass `requestId` (run option, or `request_id` in the upload) when the
page retries a run itself; `cloud_computer_already_ran` means it already ran. The
approval covers only the exact code the viewer allowed, so every new release asks again. Keep a fallback (a Manager
draft) for Sites, previews offline and viewers who do not allow it. Declare it only
when the page's core controls run on the cloud computer.

## Visual data and Markdown

`<RenderChartData title columns rows>` adds a semantic table for the chart without
a second visible table. Give it the same labels/values used by the chart. The
renderer never guesses exact numbers from SVG/canvas geometry: a chart without
`RenderChartData` contributes only its accessible name to the Markdown.

An optional `markdown` source module exports a pure function of `{params, shown}`.
It must describe the rendered selection and its actual data. Ordinary rendering
extracts tables, lists, controls and visible document/HTML content automatically.

## Host interactions and context

- `useHandover()` exposes `{handover, available, pending, error}`. Call a declared
  linked Skill with `handover({skill, prompt})`; fall back when no agent UI exists.
- `useTopBarSearch` registers a host-owned search field. Do not duplicate host chrome.
- `useActiveResource` publishes the current resource; `useAgentContext`,
  `NotisSelectionBoundary`, `NotisCommentBoundary` and `NotisCommentBox` support
  explicit reference context. [Context sharing](context.md) owns the contract.
- `useCollectionInteractions`, selection components and `MultiSelectActionBar`
  support native collection interactions. `Dialog` supplies themed top-layer
  dialogs, focus handling and shortcut isolation.
- `MarkdownEditor` is for a view-owned Markdown draft/persistence adapter. Native
  documents use `DocumentEditor` so collaboration and file authority stay with Notis.

## Offline fixtures

Declare a `verificationFixtures` JSON source with `actions` and optional `context`,
`shown`, `viewerReads`, `documentBodies`, `recordViews`. Cases match exact action
inputs/list params. Record views use `{operation: 'record'|'html'|'report', record_key,
result}`; native record snapshots require `writable: false` and no authoring target.
Keep every fixture fictional and include every load-time read. Failed or missing
fixtures fail verification; there is no fallback to the user's real account.
