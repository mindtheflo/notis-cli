## Anti-patterns -- NEVER do these

These are the most common mistakes agents make. Each one wastes time and produces broken results.

- **NEVER assume app deploys create databases for you** -- Create or update databases through native Notis database tools or the assistant first, then reference them by slug in `notis.config.ts`. Database creation requires the owning app to exist: pass its slug or id in the `app` argument of `LOCAL_NOTIS_DATABASE_UPSERT_DATABASE` (create the app first with `LOCAL_NOTIS_CREATE_APP` if needed). A database can only be referenced by the app that owns it.
- **NEVER bypass the supported workflow by manually stitching together low-level save or lint calls from a local workspace** -- Local agents should go through the NPX Notis CLI for `apps pull`, `apps build`, `apps verify`, `apps create`, `apps link`, and `apps deploy`.
- **NEVER use `apps pull` to clone a Store listing** -- `npx --package @notis_ai/cli@latest -- notis apps pull` only pulls source for an app the user can already access as an installed app. To fork a published Store app, run `npx --package @notis_ai/cli@latest -- notis apps init "My App" --from <slug>` instead: it downloads that app's source from the public registry, and installing the app first is not required.
- **One local/cloud delivery contract** -- The default permits Workspace delivery after checks only when user/repository policy allows it. Explicit read-only, preview-only and no-deploy requests prohibit remote mutations. Neither authorizes Store publication.
- **NEVER submit without explicit approval** -- A deploy request alone does not authorize Store submission. Run `npx --package @notis_ai/cli@latest -- notis apps publish --confirm-ready` only when the user confirms App Details is ready for Store review.
- **NEVER write raw `views/<slug>/index.js` files** -- Write standard React pages in `app/`.
- **NEVER invent `npx --package @notis_ai/cli@latest -- notis apps push` or bypass the review flow** -- Source moves through `apps pull` and `apps deploy`; `apps publish --confirm-ready` submits the deployed snapshot through the same authenticated review endpoint as App Details.
- **NEVER treat `apps deploy` as store submission** -- It updates the linked installed app for the current account or team scope only. Store submission is a separate, explicitly confirmed step.
- **NEVER explore server code or tool schemas to invent an alternative app workflow** -- Use the Notis CLI.
- **NEVER work around a missing `collection.sidebar` portal tree by rendering a duplicate sidebar inside the app** -- keep the route manifest as the source of truth and escalate the missing portal sidebar as a platform bug instead.
- **NEVER invent a custom visual language** -- Do not ship full-screen gradients, glassmorphism, bright neon palettes, or raw HTML controls as the primary UI. Apps should look like a natural extension of the portal.
- **NEVER hand-roll buttons/cards/badges when the scaffold already provides flat primitives** -- Prefer `@/components/ui/*` and portal token classes such as `bg-background`, `bg-muted`, and `text-muted-foreground`. Never add `border` or `shadow` classes to `Card`; a `Card` nested in a `Card` is flat automatically. See Design bar.

## Troubleshooting

### Common issues

- **Deploy transport failure**: Run `notis doctor` and read back the exact app/version. Never blindly retry an unknown outcome or write directly to storage.
- **App shows old code after deploy**: Bundle cache is stale. Hard refresh (Cmd+Shift+R) or clear site data in DevTools.
- **App is missing from Workspace**: Inspect its exact installed version. Unreleased containers have no runnable routes. A successful release appears through ordinary refresh/navigation.
- **`LOCAL_NOTIS_DATABASE_QUERY` returns empty documents**: Check that the database ID passed to the tool matches the intended database. Use `npx --package @notis_ai/cli@latest -- notis tools exec LOCAL_NOTIS_DATABASE_LIST_DATABASES --arguments '{}'` to verify the ID; use the database slug only as a fallback.
- **Properties are `undefined`**: Keep app-local result types for `useTool<TArgs, TResult>` and guard optional nested properties when reading live data.
