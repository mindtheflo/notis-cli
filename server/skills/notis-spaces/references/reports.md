# Notis Reports

A report is either a saved page or an interactive view, not a separate UI system:

- **Saved page or report** (self-contained HTML, or a finished report the user
  wants to keep): a page in the most appropriate Space, by default a note in the
  **Notis reports** folder of **Notis Notes**. See [Save an HTML page or report](#save-an-html-page-or-report).
- **Interactive report** (typed params such as a period, live data reads): an
  independently authored Space view with its own source, data declarations and
  memory policy. Editing one report must not replace an unrelated view.

Pages and reports saved before Spaces are kept in Notis Notes too, with their
stored format: HTML pages open full screen and preserved report records render
as reports. If sibling references are unavailable in your harness, load
`notis-spaces` by name.

## Read an existing report

Use native data tools when they answer the question. For live figures, charts,
filters, HTML or visual inspection, load `notis-spaces` and follow its
[Read and render](reading.md) guide (hosted MCP:
`notis://docs/notis-spaces/references/reading.md`).

Resolve the exact report period and current view link with `LOCAL_NOTIS_FIND_VIEWS`,
then render it with `LOCAL_NOTIS_RENDER_VIEW`. Inspect Markdown and image output.
Reading does not regenerate historical figures or authorize source/data changes.

## Save an HTML page or report

Save the page in the most appropriate Space: the one the user names, or the
Space the work belongs to when it keeps pages. Otherwise save it in the
**Notis reports** folder of **Notis Notes** (or the Notes folder the user names);
the Save HTML Skill creates the folder when it is missing. "All notes" hides these notes; each
folder shows everything in it.

1. Save it with the Skill that Space ships for its pages. In Notes that is the
   **Save HTML** Skill: it creates the note (title, type "Report" or "HTML page",
   folder), uploads the original bytes with the generic native file tool,
   attaches the returned file with a separate revision-checked update, reads the
   note back and returns its link. This guide does not duplicate that workflow.
2. A correction updates the same page through the same Skill, never a
   near-duplicate. A report record preserved from before Spaces cannot be
   rewritten by any tool: save the corrected version as a new page in the same
   folder and keep the original.
3. Upload success alone is not a saved page, and a file URL is not the page link.
   Return the page's link in its Space, which opens it full screen.
4. Keep the page private. Only when asked, use Share to create a public link for
   that one page. A report preserved from before Spaces cannot be shared.
5. When the page goes to Notes and Notis Notes is not installed, suggest
   installing it. Never save the page outside a Space: no website, public paste
   or file host, or sandbox download link. There is no separate HTML or report
   save tool.

## Create or revise an interactive report

1. Reconcile identity first. Find the existing report Space for a requested
   correction. Preserve the selected identity and revision; a similarly named
   report is not the same artifact.
2. For a new independent report, follow `notis-spaces` [View authoring](views.md),
   [Design](design.md) and [Delivery](release.md).
   Declare the report's period/selection as typed params, its real data in `shows`
   or declared actions, clear source context, and a suitable memory policy.
3. Choose captured results, live reads or both according to the user's request.
   Historical results stay captured unless revision was requested. Keep units,
   periods, method and source links visible. Provide `<RenderChartData>` with the
   actual chart values for precise Markdown extraction.
4. Build, verify with fictional fixtures and inspect EN/FR at 390px/1440px. Then
   deploy the checked source within the user's authorization, read back its revision
   and render the actual saved view. A preview is not the deliverable of record.
5. Return the current view-qualified link and the exact verification boundary.
   Store publication is separate from saving the authorized report Space update.

## Optional passive feedback

Use [Context sharing](context.md) for selected text,
comments or annotations the user wants to bring back to an agent. Feedback is
reference context, not execution approval, and does not itself send a message.
