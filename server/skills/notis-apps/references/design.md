## Building an App

### Design defaults

- Start from `notis spaces init`, or preserve the existing Space’s good patterns.
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
  Use SDK `Dialog` for multi-field edits or destructive confirmation; keep its actions app-owned.

Build enforces the existing design rules and reports violations by file/line.
Use those diagnostics to fix specific problems; passing them does not establish
that the design is good. See [troubleshooting](troubleshooting.md) when needed.

### Controls and side panels

- **Keep controls with what they control.** Filters, counts, and Create belong
  above the list; record actions belong inside the detail panel. Only controls
  that affect both panes belong above both.
- **Align sibling panes.** Start the list and detail panel at the same height,
  with consistent header spacing and control sizes.
- **Keep secondary actions quiet.** Put occasional destructive actions in an
  overflow menu, retaining their confirmation step.

For example, a ticket view has two side-by-side panes: **Tickets / New ticket →
filters → list**, and **ticket ID / actions / close → details**.

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

### Define the view and build its UI

Start from `notis spaces init` or pull the exact existing Space. Follow
[View authoring](views.md) for params, lists, resources and memory rather than
inventing another routing or database contract. Keep the project’s layout,
`@notis/sdk/styles.css`, and scaffold components. The host supplies the runtime;
a layout must not install a second empty `NotisProvider`.

Use `useShown` for the native lists declared in `shows`, `useActionQuery` for a
declared read action, and first-party record components for the selected record.
Keep labels in EN/FR locale-keyed copy. Use the locale provided by the runtime;
format numbers, dates and empty/error text consistently with it.

### Instant-view loading contract (required)

Build client-first Space views with a persistent shared layout where appropriate. Navigate with `useNotisNavigation`; never use a document reload for an internal view change. “SPA” means preserving that shell and reusing reads, **not** mounting every page or fetching every database at startup.

| State | Required UI |
| --- | --- |
| First read, no successful data | Keep headings/navigation/layout visible; use content-shaped skeletons only in missing regions, with the same pane bounds as the loaded view. No page spinner or whole-page `Loading...`. |
| Cached view / successful empty result | Render synchronously from the shared SDK cache. Empty results are real cached results. |
| Background refresh | Keep current content and selection. Never replace populated content with a skeleton; do not drive the top-bar spinner from mount/refetch state. |
| Explicit Save / Upload / submitted search | Progress belongs in that button or affected section. Disable only the conflicting action. |
| Failed read | Show a scoped error and Retry; keep usable cached content. Never show an empty-state message before `hasData` is true. |

Use `useShown` for declared native lists and `useActionQuery` for declared read actions. `loading` means no first successful response; `isFetching` includes silent refresh. Do not copy their data into mount-only state, clear rows on error, or gate the entire app on `isFetching`.

For another **explicitly identified idempotent read**, use `useActionQuery<Result>(actionId, exactInputs)`, or `useQuery(keyArray, readCallback, { readOnly: true })`. Include every filter, selected resource, pagination option, and other input in the key. Call declared read actions within a custom read with `{ readOnly: true, dedupe: true }`; the same SQL/shell tool can also perform writes, so never mark a whole toolkit read-only. Leave mutations as explicit `useAction` calls with stable request IDs and current revisions.

`useQueryClient().prefetch(keyArray, readCallback, { readOnly: true })` prepares small known reads after the current view has rendered or on hover/focus. It shares the host's two-request speculative budget. Match the exact foreground query key. Never prefetch a mutation, login/polling action, provider sweep, `fetchAll` query, or an aggregate that fans out into more requests. Do not invent tool names to prepare a view. Older hosts safely fall back to uncached hook-local reads and skip prefetch.

Caches belong to the host's in-memory account/environment/app/version/effective-permission scope. Do not add module-global or `localStorage` caches of user data. Writes and realtime events invalidate reads; logout, access loss, and updates retire scopes. Preserve the last successful snapshot on an ordinary network failure.

### Discovering schemas and writing records

Before editing a view, inspect its live database schema and current options with
native tools through the CLI. Source refers to resources by portable alias;
backend authority resolves exact physical IDs. Keep database-specific result
types in the view, and preserve stable property IDs when labels change.

At runtime use declared actions or first-party record components. Native writes
carry current schema/record revisions and a stable request ID. An uncertain
response keeps that original intent for reconciliation; a new ID is a new effect.
Use the generated row tool only from the agent/tool surface after discovery, not
as an account-wide transport inside authored Space code.
