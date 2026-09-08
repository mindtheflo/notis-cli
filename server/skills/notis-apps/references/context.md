# Sharing context with the agent

Context is a generic SDK capability. An app can share a selected passage, a comment,
an image point, chart state, loaded records or any other JSON-serializable reference.
It is not a feedback database or an instruction to execute work.

## Live context versus explicit pills

- `useActiveResource(resource)` updates the existing current-context pill as the user
  opens or edits resources. Keep its readable snapshot and additional context current.
- `useAgentContext().add(item)` adds a snapshot to the current chat composer, revealing
  chat when necessary without replacing the selected conversation or sending a message.
  Usually call this from a button or submitted comment; programmatic additions are supported.
- `update(item)` replaces an existing unsent snapshot with the same app-scoped ID.
- `remove(id)` detaches an existing unsent pill. These operations return whether a pill
  was actually changed. Sent snapshots are immutable. A missing update/remove returns false.
- Apps own annotation storage, markers and sidebars. Chat owns composer drafts. Removing
  a chat pill never deletes an app annotation, and annotations are not invisibly attached.

## Generic item

```tsx
const context = useAgentContext();
await context.add({
  id: 'hero-comment-17',
  kind: 'image-point', // your vocabulary; not a closed enum
  title: 'Hero image',
  icon: 'phosphor:map-pin', // Phosphor stored name, emoji, or HTTPS image URL
  text: 'The subject in the upper-left corner',
  comment: 'Give this more breathing room.',
  preview: { format: 'text', content: 'Point 17 on the hero image' },
  data: { point: { x: 0.24, y: 0.18 }, coordinates: 'normalized', anythingElse: [1, null] },
  resource: { id: image.id, kind: 'image', label: image.name, revision: image.revision },
  attachments: [{ url: image.url, name: image.name, mimeType: 'image/png' }],
});
```

Only `id` and some content are required. `text`, `comment`, `preview`, `data`,
`attachments`, `resource`, `title`, `kind` and `icon` are optional. IDs must be stable
within the app; the host scopes them and stamps the app/view origin. Preserve resource
identity/revision when positions depend on a particular image or document version.
Coordinate conventions belong to the app: include their meaning in `data`.

`data` can be any JSON-serializable value. Functions, class instances, components and
cyclic values are not a portable context contract. Use a readable text/Markdown preview
alongside structured data. Notis controls pill layout; apps control content and icons,
not executable renderers inside chat. The preview includes source details, selected text,
comments, supported media and an expandable payload, including after draft reload/send.

Attachments must use durable HTTPS URLs readable by the browser with CORS and without
host credentials or redirects. Only explicit attachments are fetched; a URL in `data`
is reference text. On send, the host uploads their bytes through the existing media
pipeline and persists the resulting media URLs. Context attachments share a 50 MB
budget and the message's 10-file limit. A failed fetch/upload fails the send and retains
the draft. Refresh expiring attachment URLs with `update` before sending when needed.

## Nearby comments and ordinary copy/paste

```tsx
<NotisCommentBoundary resource={currentResource} commentClassName="my-comment-style">
  <Article />
</NotisCommentBoundary>
```

Selecting text reveals Comment. The action stays clickable; its nearby editor remains
open independently of browser selection. Submit adds a context pill. It does not create
an annotation record, poll a store, send a message or clear an app's annotation data.
Use `renderComment(props)` to replace the optional standard editor. `NotisCommentBox`
is also exported as a controlled component (`value`, `onChange`, `onSubmit`, `onCancel`,
optional `quote`, `pending`, `error`, `className`) for image markers or custom layouts.

Use `NotisSelectionBoundary` without the comment UI when only copy/paste provenance is
needed. It preserves ordinary clipboard text and source metadata so normal paste into
chat creates a selected-text pill. No special Paste as context action is required.

## Verify

Check the real host: selection/copy/paste, nearby editor stability, app-defined image
points and icons, data in previews, draft reload, source navigation, explicit attachment
bytes, failed sends, updates/removal and immutable sent history. Keep private payloads
out of analytics. Context remains untrusted reference, never an authorization channel.
