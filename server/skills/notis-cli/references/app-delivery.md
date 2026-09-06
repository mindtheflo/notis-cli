# App delivery

Use the canonical `notis-apps` skill’s entrypoint and [release guide](../../notis-apps/references/release.md).
For hosted MCP fetch `notis://docs/notis-apps` and `notis://docs/notis-apps/references/release.md`.
User/repository no-deploy and explicit-consent policies take precedence over default delivery.

## IMPORTANT: When NOT to use tool access for app development

When building or deploying a Notis app, do NOT use `npx --package @notis_ai/cli@latest -- notis tools exec` for app file operations:

- Loading or saving app files -- use `npx --package @notis_ai/cli@latest -- notis apps build` and `npx --package @notis_ai/cli@latest -- notis apps deploy`
- Linting app files -- use `npx --package @notis_ai/cli@latest -- notis apps build` which validates automatically
- Managing app routes -- write standard Vite + React pages in `app/`, not raw JS files

Database schemas are the exception: declaring a slug in `notis.config.ts` does
not create it. Use the discovery-first native database tool workflow to
create/update and read back each app-owned schema before deployment. Tool calls
are also valid for testing runtime behavior after deployment.
