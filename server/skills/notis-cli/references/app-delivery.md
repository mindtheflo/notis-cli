# Space delivery

Use the canonical `notis-apps` skill's entrypoint and [release guide](../../notis-apps/references/release.md).
For hosted MCP fetch `notis://docs/notis-apps` and `notis://docs/notis-apps/references/release.md`.
User/repository no-deploy and explicit-consent policies take precedence over default delivery.

## IMPORTANT: When NOT to use tool access for Space development

When building or deploying a Space, do NOT use `npx --package @notis_ai/cli@latest -- notis tools exec` for source operations:

- Loading, building or publishing source -- use `notis spaces pull`, `spaces build`, `spaces verify`, `spaces preview`, `spaces deploy` and `spaces promote` as the release guide orders them
- Validating views -- `spaces build` and `spaces verify` check declarations, fixtures and renders
- Writing pages -- write standard Vite + React views with `@notis/sdk`, not raw JS files

Database schemas have two routes: the native database tool (create with `links.add`
and `main_view`), or a `create` declaration in Space source that the deploy applies
atomically. Tool calls are also valid for testing runtime behavior after deployment.
`notis apps` is the legacy App group for accounts not yet moved to Spaces; a legacy
App cannot declare Skills.
