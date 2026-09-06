## Building an App

### Step 1: Define the config

Create `notis.config.ts` with:
- **name** -- Stable machine identity in lowercase kebab-case, such as `link-building`; do not use display casing here
- **title** -- Human-facing app name with deliberate casing, such as `Link Building`; preserve brands and acronyms exactly
- **databases** -- Slug references to existing Notis databases
- **routes** -- Route-first sidebar entries with explicit `slug`, optional `parentSlug`, and optional `collection.sidebar` tree config
- **tools** -- Final tool names the app can call at runtime. Use the shared discovery flow (`COMPOSIO_SEARCH_TOOLS`, then `COMPOSIO_GET_TOOL_SCHEMAS`) while building the app, and copy the returned final names into this list. Examples include `LOCAL_NOTIS_DATABASE_QUERY`, `LOCAL_NOTIS_MONID_RUN`, `GMAIL_SEND_EMAIL`, `LOCAL_POSTFORME_CREATE_POST`, and `LOCAL_MCP_<SERVER>_<TOOL>`. App code calls each declared name directly through `useTool`; it does not wrap provider or MCP calls in `COMPOSIO_MULTI_EXECUTE_TOOL`. Access stays scoped to the signed-in user's own connections, native database tools stay scoped to the app's databases unless `capabilities.workspaceDatabases: 'read'` is granted, and metered tools use the CLI-equivalent credit-cap and fail-closed usage-billing path.

For collection-backed sidebars, use the route schema directly:

```ts
routes: [
  {
    path: '/',
    slug: 'notes',
    name: 'Notes',
    icon: 'phosphor:note-pencil',
    default: true,
    collection: {
      database: 'notes',
      titleProperty: 'Title',
      parentProperty: 'Parent note',
      sidebar: {
        mode: 'tree',
        allowCreate: true,
      },
    },
  },
]
```

Use the same page template for the root Notes route and collection/sub-collection detail states. The portal sidebar injects live collection items under the static route row when `collection.sidebar.mode === 'tree'`.

For arbitrary app-owned resources that are not Notis collection rows, set `resourceDeepLinks: true` on the route. Read the decoded `?resource=` identifier from `useNotis().resourceId`, and link between routes with `toRoute('/inbox', { resourceId })`. Keep collection links on `?item=`. Publish external preview/source links as the resource `url`; the host separately supplies the exact Notis review link as `active_resource.view_url` for opted-in routes. Handle missing or deleted identifiers with a safe view-level fallback.

### Step 2: Build pages

Standard React pages in `app/`. Use generic SDK tool hooks for data and build on top of the scaffolded flat components and portal shell classes (`notis-app-shell` for ordinary pages, `notis-app-split` for list-plus-detail pages, `notis-app-surface` for a flat panel):

```tsx
import { useDocuments, ViewSkeleton } from '@notis/sdk';
import { Card } from '@/components/ui/card';

export default function TasksPage() {
  const tasks = useDocuments('tasks', { pageSize: 25 });
  return <section className="space-y-4 p-6">
    <h1 className="text-xl font-semibold">Tasks</h1>
    {tasks.error && <p role="alert">{tasks.error.message} <button onClick={tasks.refetch}>Retry</button></p>}
    {tasks.loading ? <ViewSkeleton variant="table" rows={5} /> : tasks.hasData ? (
      tasks.documents.length ? tasks.documents.map((task) => (
        <Card key={task.id} className="p-4"><h2>{task.title || 'Untitled'}</h2></Card>
      )) : <p>No tasks yet.</p>
    ) : null}
  </section>;
}
```

### Instant-view loading contract (required)

Build a client-side, multi-route app with one persistent `app/layout.tsx` shell. Navigate with `useNotisNavigation`; never use a document reload for an internal route. “SPA” means preserving that shell and reusing reads, **not** mounting every page or fetching every database at startup.

| State | Required UI |
| --- | --- |
| First read, no successful data | Keep headings/navigation/layout visible; use content-shaped skeletons only in missing regions. No page spinner or whole-page `Loading...`. |
| Cached view / successful empty result | Render synchronously from the shared SDK cache. Empty results are real cached results. |
| Background refresh | Keep current content and selection. Never replace populated content with a skeleton; do not drive the top-bar spinner from mount/refetch state. |
| Explicit Save / Upload / submitted search | Progress belongs in that button or affected section. Disable only the conflicting action. |
| Failed read | Show a scoped error and Retry; keep usable cached content. Never show an empty-state message before `hasData` is true. |

Use `useDocuments`, `useDocument`, `useDatabaseSchema`, and `useDatabaseSubscription` for native reads. `loading` means no first successful response; `isFetching` includes silent refresh. Do not copy their data into mount-only state, clear rows on error, or gate the entire app on `isFetching`.

For another **explicitly identified idempotent read**, use `useToolQuery<Result>(toolName, exactArguments, { readOnly: true })`, or `useQuery(keyArray, readCallback, { readOnly: true })`. Include every filter, selected resource, pagination option, and other input in the key. Call tools within a custom read with `{ readOnly: true, dedupe: true }`; the same SQL/shell tool can also perform writes, so never mark a whole toolkit read-only. Leave mutations as ordinary `useTool` actions.

`useQueryClient().prefetch(keyArray, readCallback, { readOnly: true })` prepares small known reads after the current view has rendered or on hover/focus. It shares the host's two-request speculative budget. Match the exact foreground query key. Never prefetch a mutation, login/polling action, provider sweep, `fetchAll` query, or an aggregate that fans out into more requests. Do not invent tool names to prepare a view. Older hosts safely fall back to uncached hook-local reads and skip prefetch.

Caches belong to the host's in-memory account/environment/app/version/effective-permission scope. Do not add module-global or `localStorage` caches of user data. Writes and realtime events invalidate reads; logout, access loss, and updates retire scopes. Preserve the last successful snapshot on an ordinary network failure.

### Discovering database schema

Before writing app code, inspect the database schema to know what properties exist:

```bash
npx --package @notis_ai/cli@latest -- notis tools search "list Notis databases"
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_LIST_DATABASES --arguments '{}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_GET_DATABASE --arguments '{"database_slug":"social_media_calendar"}'
npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_QUERY --arguments '{"database_id":"social-media-calendar-db-id","query":{"page_size":1}}'
```

Prefer the database `id` returned by `LOCAL_NOTIS_DATABASE_LIST_DATABASES` or `LOCAL_NOTIS_DATABASE_GET_DATABASE` when calling `LOCAL_NOTIS_DATABASE_QUERY`; use `database_slug` only as a fallback.

Use `LOCAL_NOTIS_DATABASE_GET_DATABASE` through `useTool` when an app needs schema detail at runtime. Keep database-specific result and property helper types inside the app code.
For document writes, declare the generated canonical tool for the target database, such as `LOCAL_NOTIS_DATABASE_UPSERT_TASKS`, and call it through `useTool`. Pass flat property values; the server wraps them:

```tsx
const upsertTask = useTool<Record<string, unknown>, { document?: { id: string } }>('LOCAL_NOTIS_DATABASE_UPSERT_TASKS');

await upsertTask.call({
  title: 'My Task',
  Status: 'Todo',
  Priority: 'P1',
  Due: '2025-04-01',
  Done: false,
  Count: 5,
});
```

Do NOT pass Notion-style wrappers (`{select: {name: "Todo"}}`) when upserting.

### Design bar (enforced)

Every page must read as a native, flat Notis page. `npx --package @notis_ai/cli@latest -- notis apps build` and the deploy endpoint fail on the banned patterns below with the exact file and line; the only override is an inline `// notis-design-allow: <rule-id> <reason>` comment on the line before (reason required, at least 12 characters). Do not work around a failure by moving the markup elsewhere; fix it.

Banned in `app/` and `components/` (form controls in `components/ui/{input,textarea,checkbox,switch,button}.tsx` are exempt):

- Four-side `border` boxes, `border-dashed`, `divide-*`, `<hr>`, thick `border-l-2` bars, `ring-*` as a box or selection indicator (`focus-visible:ring-2` on controls is fine).
- `shadow-*` on panels, tiles, rows, or bubbles. Only a floating popover or menu may use `shadow-lg` together with `bg-popover`.
- Tailwind palette hues (`emerald-500`, `slate-200`, ...), hex colors, gradients, `backdrop-blur`, `font-serif`.
- Uppercase `tracking-wide` eyebrows and marketing headlines. Page titles are plain nouns matching the route ("Dashboard", "Meetings").
- Text below 12px (`text-[11px]`); use `text-xs` at minimum and `text-sm` for body.
- `Badge variant="outline"`, raw `<select>`, in-app search inputs, duplicate sidebars, untouched scaffold placeholder copy.
- Loading text ("Loading...") or whole-page spinners. Keep headings visible and render `Skeleton` / `ViewSkeleton` from `@notis/sdk` only in the missing region (see the Instant-view contract).

Use instead:

- `Card` from the scaffold: a flat `bg-muted` panel that becomes `bg-background` when nested. Page sections can also be plain `h2` + content with `space-y-8`.
- `.list-row` / `.list-row-selected` from `@notis/sdk/styles.css` for rows and table bodies (tinted on mobile, transparent with hover tint on desktop, selection by tint). Tables are flat on the page: `text-xs` muted header, `text-sm` rows, no wrapping panel.
- Stats as bare figures: `text-xs` label over `text-2xl font-semibold tabular-nums`. Tiles (`rounded-2xl bg-muted p-5`) only when they are the page's single grouping device.
- `PageHeading` for the header, `NativeSelect` for filters, `Badge` variants `default | secondary | destructive`, tokens only (`text-foreground`, `text-muted-foreground`, `text-primary`, `bg-primary/10`, `text-destructive`, `bg-destructive/10`), `tabular-nums` on numbers, `min-w-0` on every grid item that can hold long text.
- One hairline (`border-t` / `border-b border-border`) between major sections or large list entries is the only allowed line.
- List-plus-detail pages are full-bleed: `notis-app-split` with `notis-app-pane-list` (tinted, one `border-r` hairline, fixed width on desktop, stacked on mobile) and `notis-app-pane-detail` (`bg-background`), never the centered `notis-app-shell`.
- Respect the portal theme in both modes. Never hardcode dark mode or an app palette.
- For Notes-style apps, the folder tree belongs to the portal sidebar when configured via `collection.sidebar`. The page content should complement that chrome, not duplicate or replace it.
- Do not render any search input inside the app (in-page search rails, "Ask Notis…" pills, command-palette-style bars, etc.). The portal already owns the top-bar search field. Wire your view to it with `useTopBarSearch({ value, onChange, placeholder, onSubmit })` from `@notis/sdk` and let the page filter or refetch on the values it receives. Use its `setLoading` only for an explicit submitted search, never initial view loading or background refresh.

### Sidebar invariants

- When a user asks for folders, sections, or hierarchy in the app sidebar, express that through `routes` and `collection.sidebar` in `notis.config.ts`.
- Treat an existing collection-tree sidebar as a locked structural requirement unless the user explicitly asks to change navigation architecture.
- If the sidebar appears missing for the installed app, do not silently redesign around it. Preserve the manifest contract, call out the discrepancy, and treat it as a portal/runtime bug.

### Step 3: Root layout

```tsx
import { NotisProvider } from '@notis/sdk';
import '@notis/sdk/styles.css';
import './globals.css';

export default function AppShell({ children }: { children: React.ReactNode }) {
  return <NotisProvider>{children}</NotisProvider>;
}
```
