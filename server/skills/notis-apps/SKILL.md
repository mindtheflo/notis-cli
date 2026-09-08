---
name: notis-apps
description: Design and package Notis apps, or inspect their live views and resources. Use when users want an installable Notis app or need rendered content, charts, or filters that ordinary data tools do not provide.
feature_flag: store
mcp_resource: true
mcp_tool_patterns: ["LOCAL_NOTIS_INSTALL_APP"]
mcp_references: ["references/release.md", "references/architecture.md", "references/design.md", "references/sdk.md", "references/troubleshooting.md", "references/reading.md", "references/context.md"]
---

# Notis Apps

Build apps that feel native to Notis: compact, readable, responsive, and useful.
Use Vite + React, `@notis/sdk`, and the existing scaffold components. Use the Notis
CLI for app operations: `npx --package @notis_ai/cli@latest -- notis ...`.

## Read existing apps and resources

Use ordinary data tools for straightforward reads. When the task needs a live
render, chart, filter, or visual inspection, follow [Read Notis web content](references/reading.md).
It covers apps, views, reports, HTML and file documents without requiring the
user to open Portal or Desktop. Use the agent's available browser capability;
this is not an app build, deployment, or Portal editing-context workflow.

## Build → inspect → fix → deliver

For every app UI create/edit task, read both [Design](references/design.md) and
[Delivery](references/release.md). Then:

1. **Understand the result.** Identify the main user action and the requested
   change. For a reported visual bug, describe what is wrong in the actual
   screen before editing. Preserve what already works.
2. **Start from native patterns.** Pull the existing app or choose the closest
   Store scaffold. Use the appropriate page layout instead of inventing a new
   visual system. Make routine choices yourself; ask only for missing decisions
   that materially change the result.
3. **Build, look, improve.** Run build and verification, then actually inspect
   the rendered app. Follow the short visual check in the design guide. Fix what
   is wrong and recheck the affected screen; a passing build is not visual approval.
4. **Deliver the checked result.** Follow the delivery guide and existing user
   authorization. Confirm the released result inside Notis before calling it
   verified. Say plainly what is local, deployed, or still unverified.

## Keep these boundaries

- User and repository instructions take precedence, including preview-only,
  no-deploy, and explicit-consent requirements. Store publication is separate.
- Preserve the exact app identity, account/team scope, permissions, and user data.
  Reconcile an uncertain release instead of blindly retrying it.
- Use SDK hooks and declared tools. Let Notis own its sidebar, search, runtime,
  and rendering boundary; do not query host DOM or recreate that chrome in the app.

## References — only as needed

- [SDK hooks](references/sdk.md): reads, edits, selection, and navigation.
- [App contracts](references/architecture.md): configuration, packaging, and data ownership.
- [Troubleshooting](references/troubleshooting.md): a specific failure or mismatch.

The CLI distributes this skill and its references from the canonical product
source. Do not maintain competing copies.

## Shared views, independent reports and feedback

Use a shared app view when many records should share one implementation. Use
`notis-reports` when an app-owned record needs its own independently authored
SDK presentation. A report is not a new app, and changing it must not deploy or
replace shared app routes. The agent chooses live data versus captured results.

Share selected text, comments, loaded resources or app-defined annotations through
[generic context pills](references/context.md). Apps own annotation storage and
presentation; the chat owns unsent context drafts. Passive context is not execution approval.
