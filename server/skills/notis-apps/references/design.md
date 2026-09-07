## Building an App

### Design defaults

- Start from the closest Store scaffold (`apps scaffolds list`, then `apps init
  --from <slug>`), or preserve the existing app's good patterns.
- Make the main task obvious. Use compact spacing, readable text, plain page
  titles, Phosphor icons, and the scaffold's buttons, filters, rows, and cards.
- Match Notis in light and dark mode. Use theme tokens and restrained accents;
  prefer flat surfaces and selection tints over decorative boxes and shadows.
- Choose the right layout: `notis-app-shell` for ordinary content;
  `notis-app-split`, `notis-app-pane-list`, and `notis-app-pane-detail` for a
  full-viewport list and reader. Keep reading text comfortably sized. Let mobile
  stack or adapt the content rather than squeeze a desktop layout onto a phone.
- Let Notis own navigation, folder trees, and search. Use `PageHeading`,
  `NativeSelect`, `.list-row`, and `useTopBarSearch` instead of duplicating chrome.
- Prefer inline optimistic edits for simple changes, with rollback on failure.
  Use a dialog for multi-field edits or destructive confirmation.

Build enforces the existing design rules and reports violations by file/line.
Use those diagnostics to fix specific problems; passing them does not establish
that the design is good. See [troubleshooting](troubleshooting.md) when needed.

### Look at the result

Run build and verification, then inspect screenshots of the affected view at a
normal desktop width and a phone width. For new layouts or theme changes, check
both themes. Keep the review focused on the task, not a new report or approval cycle:

- Does the layout use the available viewport correctly, including while loading?
- Do sizing, spacing, text, and scrolling look right? Is anything clipped or overflowing?
- Do loading placeholders match the real content instead of changing the layout?
- Does the main interaction work, and do empty/error states explain what to do?

Use temporary fixtures to expose slow reads, empty results, and errors where
relevant; do not alter real user records for a screenshot. Actually inspect the
images, fix what is wrong, and recheck the affected state. After an authorized
release, repeat the affected-view check inside Notis as described in
[Delivery](release.md). A standalone harness is not proof of the host layout.

### Step 1: Define the config

Use `~/.notis/apps/<slug>` by default, or pass the user's intended directory to
`apps init` / `apps pull`. Avoid a parent workspace that selects an unrelated CLI
profile. Keep the exact installed identity when editing; do not rename a machine
slug just to correct its display title.

Create `notis.config.ts` with:
- **name** -- Stable machine identity in lowercase kebab-case, such as `link-building`; do not use display casing here
- **title** -- Human-facing app name with deliberate casing, such as `Link Building`; preserve brands and acronyms exactly
- **databases** -- Slug references to existing Notis databases
- **routes** -- Route-first sidebar entries with explicit `slug`, optional `parentSlug`, and optional `collection.sidebar` tree config
- **tools** -- Final tool names the app can call at runtime. Discover tools with `notis tools search "<what you need>"`, inspect their schemas with `notis tools describe <tool>`, and copy the returned final names into this list. Examples include `LOCAL_NOTIS_DATABASE_QUERY`, `LOCAL_NOTIS_MONID_RUN`, `GMAIL_SEND_EMAIL`, `LOCAL_POSTFORME_CREATE_POST`, and `LOCAL_MCP_<SERVER>_<TOOL>`. App code calls each declared name directly through `useTool`; it does not wrap provider or MCP calls in `COMPOSIO_MULTI_EXECUTE_TOOL`. Access stays scoped to the signed-in user's own connections, native database tools stay scoped to the app's databases unless `capabilities.workspaceDatabases: 'read'` is granted, and metered tools use the CLI-equivalent credit-cap and fail-closed usage-billing path.

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
| First read, no successful data | Keep headings/navigation/layout visible; use content-shaped skeletons only in missing regions, with the same pane bounds as the loaded view. No page spinner or whole-page `Loading...`. |
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

### Step 3: Root layout

```tsx
import { NotisProvider } from '@notis/sdk';
import '@notis/sdk/styles.css';
import './globals.css';

export default function AppShell({ children }: { children: React.ReactNode }) {
  return <NotisProvider>{children}</NotisProvider>;
}
```
