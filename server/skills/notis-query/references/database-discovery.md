## Native Database Workflow

### Listing databases

Use `LOCAL_NOTIS_DATABASE_LIST_DATABASES` (`notis_list_databases` in legacy
underscore-form references) when:

- you need to confirm which native databases exist
- you need the database ID or slug before querying or choosing an upsert tool
- you need database metadata such as name, description, or document counts
- the orchestrator asks what is available in the user's workspace

Always inspect the user's native Notis databases before creating schema updates or choosing where to save work.

### Creating databases

Use `LOCAL_NOTIS_DATABASE_UPSERT_DATABASE` (`notis_upsert_database` in legacy
underscore-form references) to create or update native databases.

Every native database must belong to a Notis app. When creating a database,
pass the owning app's slug or id in the `app` field; if the user has no
suitable app yet, create one first with `LOCAL_NOTIS_CREATE_APP`. Updates do
not need the `app` field.

Define schemas with appropriate property types:

- `title`
- `rich_text`
- `select`
- `multi_select`
- `status`
- `checkbox`
- `date`
- `number`
- `url`
- `email`
- `phone_number`
- `relation`

When adding or updating a `relation` property, always pass the target database explicitly with `database_id`. Do not rely on description text to imply the relation target.

Example relation update:

```json
{
  "operation": "update",
  "database_id": "tasks-db-id",
  "properties": [
    {
      "property_id": "prop_list",
      "name": "List",
      "action": "update",
      "type": "relation",
      "database_id": "lists-db-id",
      "description": "Relation to Lists"
    }
  ]
}
```

### Deleting databases

Use `LOCAL_NOTIS_DATABASE_DELETE_DATABASE` only when the user asked for a database
to be removed: it permanently deletes the database and every row, and cannot be
undone. Pass the exact `database_id` from `LOCAL_NOTIS_DATABASE_LIST_DATABASES`.
The tool refuses while another database has a relation property pointing to it or
an automation is triggered by it, and lists them; remove those first (delete the
relation property with `LOCAL_NOTIS_DATABASE_UPSERT_DATABASE`, action `remove`).
It also refuses a database its app declares, because the app recreates it empty the
next time it loads: remove it from the app's databases and deploy, or delete the app.
