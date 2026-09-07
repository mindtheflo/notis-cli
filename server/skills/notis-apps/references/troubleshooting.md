## Troubleshooting

Start with the failing screen or operation. Do not invent a second app workflow;
use the [delivery guide](release.md) and supported Notis CLI commands.

- **App looks wrong despite passing checks:** open it inside Notis and compare
  the affected region with the request. Check loading and loaded states, viewport
  sizing, scrolling, and theme. A standalone harness does not reproduce the host's
  parent layout or shadow boundary. Do not assume the cause from a screenshot alone.
- **Build reports a design violation:** use the scaffold component or theme token
  suggested by the diagnostic. Fix the reported file/line rather than hiding the
  pattern elsewhere. Existing validator exceptions are for justified cases, not a
  shortcut around visual review.
- **The configured sidebar is missing:** preserve `routes` and `collection.sidebar`;
  investigate the host mismatch instead of duplicating the sidebar in app code.
- **The app shows old code or is missing from Workspace:** check the exact installed
  app/version and requested bundle first. Local source edits and Desktop restarts
  do not update a released app. Refresh after confirming the correct release exists.
- **Deploy transport failure:** run `notis doctor` and read back the exact app/version.
  Reconcile the outcome before retrying; do not bypass the backend with storage writes.
- **Database query is empty or properties are undefined:** inspect the actual schema,
  database ID, and returned property shape through the CLI. Keep types in the app,
  guard optional fields, and distinguish an error from a successful empty result.
