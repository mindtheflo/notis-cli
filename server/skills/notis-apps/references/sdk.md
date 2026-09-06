## SDK Hook Reference

All hooks and components below are imported from `@notis/sdk`. `NotisProvider`
already installs `ShortcutProvider`; app code should not add a second provider.

| API | Signature | Description |
|-----|-----------|-------------|
| `useNotis()` | `() => { app, route, databases, collectionItem, resourceId, ready }` | App metadata, current route, selected collection item, decoded exact-resource id, ready state |
| `useTool<TArgs, TResult>(name)` | `(name: string) => { call, loading, error }` | Call a declared tool with app-defined argument/result types. Identical idempotent reads may use `call(args, { dedupe: true })`; never dedupe writes |
| `useTools()` | `() => { tools, loading }` | List available tools |
| `useNotisNavigation()` | `() => { toRoute, toDocument, toApp }` | Navigate between routes (including `toRoute(path, { resourceId })`), documents, or the app root |
| `useTopBarSearch(opts)` | `({ value, onChange, placeholder?, onSubmit? }) => { setLoading }` | Bind the current view to the Portal-owned top-bar search input |
| `useBackend()` | `() => { request }` | Raw backend request proxy with JWT auth |
| `useDatabaseSubscription(slug, opts?)` | `(slug: string, opts?) => { rows, documents, loading, error, refetch, live }` | Query a database and refetch it when its rows change. `live` is false on hosts without a change feed (temporary test harness, vite preview) -- keep a manual refresh for those |
| `useHandover()` | `() => { handover, pending, error, available }` | Open manager chat with app/resource context plus an optional starter prompt or declared skill. Omit `prompt` for a context-only composer. `available` is false on hosts with no chat -- fall back to a copyable prompt |
| `useCloudComputer()` | `() => { facts, loading, error, refresh }` | Read-only cloud computer facts: sandbox existence/status and whether the GitHub CLI is signed in. Requires `capabilities.cloudComputer: 'read'` plus the user's approval; `facts.available === false` means answer from the app's own fallback |
| `useActiveResource(resource)` | `(ContextResource \| null) => void` | Publish the record currently open in the app so manager handover and context menus stay grounded |
| `useCollectionInteractions(opts)` | `(opts) => CollectionInteractionController` | Keyboard navigation, active-row state, range/toggle selection, marquee selection, and action dispatch for collection UIs |
| `useShortcuts(definitions, opts?)` | `(definitions, opts?) => void` | Register scoped keyboard shortcuts. Editable targets are ignored unless explicitly allowed; use `ShortcutHints` to display them |
| `MarkdownEditor` | `(NotisMarkdownEditorProps) => ReactElement` | Use the host editor with app-owned persistence, stable `resourceKey`, revision-aware `onSave`, and optional `onUploadFile` returning a durable URL |
| `NotisSelectionBoundary` | `(NotisSelectionBoundaryProps) => ReactElement` | Attach structured, explicitly untrusted app/resource/selection context to selected content and copy operations |
| `SelectionCheckbox` / `SelectionMarquee` | components | Standard selection controls backed by `useCollectionInteractions` |
| `MultiSelectActionBar` | component | Standard bulk actions with pending/disabled state and shortcut support |

Import headless collection action types and helpers from
`@notis/sdk/interactions`. Keep an open detail view synchronized with
`useActiveResource`, and wrap its selectable content in
`NotisSelectionBoundary` so the manager receives both the active record and the
user's exact selection. For `MarkdownEditor`, keep `resourceKey` stable per
record, pass the latest revision back from `onSave`, reject revision conflicts
instead of overwriting newer data, and implement `onUploadFile` whenever the
editor should accept media or file blocks.

### App configuration additions

- `toolBindings` is only for provider-generated public tool names whose upstream
  action cannot be reconstructed. Keep the exact final public `name` in
  `tools`, then bind it to `providerToolName`; the public name remains the
  permission boundary.

### Typed tool calls

`useTool` accepts generic argument and result types. Query the database at dev time to discover actual property shapes, then keep those types in the app:

```tsx
type QueryTasksArgs = { database_id?: string; database_slug?: string; query: { page_size?: number } };
interface TaskDoc {
  title: string;
  properties: {
    Status: string;
    Priority: string;
    Due: string;
  };
};
type QueryTasksResult = { documents: TaskDoc[] };

const queryTasks = useTool<QueryTasksArgs, QueryTasksResult>('LOCAL_NOTIS_DATABASE_QUERY');
const result = await queryTasks.call({ database_id: 'tasks-db-id', query: { page_size: 25 } });
// result.documents[0].properties.Status is typed as string
```
