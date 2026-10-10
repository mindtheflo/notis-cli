# Database discovery and creation

Use `LOCAL_NOTIS_DATABASE_LIST_DATABASES` to find accessible databases, then
`LOCAL_NOTIS_DATABASE_GET_DATABASE` for schema and current native authority. A
name or slug helps discovery; use the returned exact identity for further work.
A slug shared by several databases you can reach answers `database_slug_ambiguous`
with each `database_id` and its Spaces: choose with the user, then keep that ID.
Inspect property descriptions, types, option IDs and relation targets before
filtering or writing. Keep the returned target intact, including binding pins.

## Database creation has two supported routes

**Native tool.** Discover/inspect `LOCAL_NOTIS_DATABASE_UPSERT_DATABASE`. With
`protocol: 1`, creation requires a stable `request_id`, `links.add` with at least
one Space and its current revision, and `main_view: {space_id, param}` naming a
Space linked in that call. The database and link are created together. That
Space's next source deploy must declare the record param with `main: true`.
Until then, bare record links open the Space and write results carry `view_warning`.

**Space source.** Declare `resources.<alias> = {kind: 'database', create: {name,
schema, starterRows?}}` and a main record param for that alias in the same view.
Promotion creates the database/link/main/source atomically. Build/verify does not
create anything. See [View authoring](../../notis-apps/references/views.md).

Every database keeps a main view and at least one Space. To move it, add the new
link and remove the old one in a single resource mutation; unlinking the final
Space is refused with `database_last_space`. Moving into another Space tree also
sets `main_view` in the added Space and needs an Editor of both Spaces; the main
view stays pending (`view_warning`) until that Space deploys it. Reuse the current
IDs instead of making an equivalent duplicate. Explain who gains or loses access
first ([consequences](../../notis-apps/references/architecture.md#consequences-to-explain-before-acting)).

## Schema edits

Use the exact `target`, `schema_revision` and stable `request_id` from discovery.
Only whole-database Editors change shared definitions. `rename` preserves a
property's ID and values; remove-plus-add is not a rename. Merge choice options
by default; replacing the complete option set can make old stored values unreadable.

A relation must specify the exact target database. For Space authoring, also
resolve its same-Space relation binding when required; a description does not
grant access or define the target. Native writes validate the related record's
identity and visibility inside that binding.

Source `create` declarations apply only once. Later changes use the native schema
tool; `spaces pull` refreshes source from the live schema instead of reapplying an
old creation schema. Keep schemas, source and tests aligned after intentional edits.

## Deleting databases

`LOCAL_NOTIS_DATABASE_DELETE_DATABASE` permanently deletes a database and every
row, and cannot be undone. Use it only when the user asked for that database to be
removed, with the exact `database_id` from `LOCAL_NOTIS_DATABASE_LIST_DATABASES`.
It refuses while another database has a relation property pointing to it or an
automation is triggered by it, and lists them; remove those first (delete the
relation property with `LOCAL_NOTIS_DATABASE_UPSERT_DATABASE`, action `remove`).
It also refuses every database linked to a Space (`database_linked_to_space`): a
Space database cannot be deleted directly, so offer to move it instead. A database
used only in one Space is deleted with that Space when its bin entry is deleted.
A legacy App database its App declares is refused with `database_declared_by_app`.
