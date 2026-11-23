# Comments in Space views

The comment pieces of the SDK ([SDK reference](sdk.md)) and the agents that answer comments.

## Comment pieces

Every Space page has comments: Notis stores them itself, one store for all
Spaces, and lists them in the host Comments panel beside the chat. Never
create, bind or declare a Comments database, never add comment columns, and
never write comment rows with native writes or `useNativeMutation`. Selected
words on any page offer Cite and Comment without any code. Comments exist on
Space pages only (Notes pages included). While comments are off for the
viewer, or on a Site, a link or a preview, every comment piece renders
nothing: never build a fallback comment list or your own comment box.

Add comment code only when comments should sit on something more than words
of the page: `useComments` with `CommentPane`, `CommentPins` and
`CommentToolBar`.

```tsx
const comments = useComments({
  anchors: slides.map(s => ({ id: s.id, recordKey: s.recordKey, order: s.order, title: s.title })),
  anchorKey: slide?.recordKey ?? null,
  words: { anchorLabel: { en: 'Slide {n}', fr: 'Diapo {n}' } }, // names "New comment on Slide 2"
});
// <CommentPins controller={comments} anchorKey={slide.recordKey} /> over the stage
// <CommentToolBar controller={comments} />  <CommentPane controller={comments} />
```

- `useComments` takes no database. `scope` is the page (record) the comments
  belong to; leave it out to use the record the page has open (a record page,
  or the record a declared record param such as `page` names, the `main` one
  first), or the Space home. It takes no database, columns or author options.
- Mount `<CommentPane controller={comments} />` once anywhere in the view: it
  draws in the host panel, not where it is mounted.
- The host and the server own the rest: who wrote a comment (never set an
  author or let people pick one), archive (shown Done) and delete with Undo,
  editing your own comment, the Open/Done/All filter, the Goes to line and To
  chip that name the thread a comment goes to, attachments (pictures and
  files on every comment, nothing to add), `comment=` links, waiting counts
  and push. On someone else's comment people only archive, reopen, delete
  (with edit rights) or answer it.
- `modes`: any of `text`, `point`, `box`, `items`, `time`, `page` (listed in
  that order). Default: `point` and `box` when there are anchors, `items`
  when you pass `onStartItems`, `time` when you pass `currentTime`, and
  `page`. `<CommentToolBar controller={comments} />` puts one button per mode
  on the page, toggled with C (`toggleKey`, or `pinned` to keep it shown);
  Escape cancels a mode; on a phone it draws above the card in the layer root,
  so a parent's hidden overflow never clips it. `onStartItems()`: show your own
  picker, then call `comments.startItems(anchors)`; the comment names its
  items and shows under each of them. `currentTime()`: the recording's moment in
  seconds.
- `order` on the pane: `'newest'` (default), `'oldest'`, `'anchor'` or a
  comparator. `groupBy`: a function returning `{ key, label }` per thread,
  or false. A controller on the Space home groups by page, named by
  `scopeNames`; a scoped one is flat.
- `focusKey` defaults to the `comment` view param, so a link with
  `comment=<root id>` opens that thread; null turns it off.

## Agents and comments

Space agents wake on comments with `on: 'comments'` in the Space source; it
needs no resource and takes no `columns`:

```ts
agents: [{ id: 'editor', on: 'comments', event: 'created', thread: 'best_match',
           runtime: 'notis', skill: 'address-feedback', wake: 'all' }]
```

`event` is `created` (default) or `changed`, `wake` is `all` or `sent` (only
replies to and answers of the agent's own comments), `thread` is `best_match`
or `space`, `runtime` is `notis` or `cloud_computer`, `skill` names a linked
Skill. `on: { database: <alias> }` is for agents that watch a real
database's rows, never comments.

Agents read and write comments only with `LOCAL_NOTIS_SPACE_COMMENT_THREADS`
(`protocol` 2; operations `list`, `thread`, `comment`, `reply`, `edit`, `delete`,
`restore`, `answer`, `links`, `link`, `unlink`, `waiting`, `best_match`,
`viewer`, `page_link`; parameters `space`, `page` (a record key, `home` or
`all`), `status`, `limit`, `before`, `view`, `anchor`, `comment_id`, `body`, `needs`, `options`,
`recommended`, `option_details`, `answer_to`, `answer`, `files`). A question
with choices (`needs: "choice"`) shows one row per option, like a question in
a conversation: keep each option a short name, name the one you recommend in
`recommended` (it gets the Recommended tag and Enter picks it) and say what
an option means in one line with `option_details` (`{"<option>": "<line>"}`).
`list` on a whole Space answers its open comment threads, newest first and
each with its replies, 50 at a time (`status` `done` or `all` for the others,
`next` back as `before` for the ones after, `counts` for the totals), never
every comment the Space ever held.
Never query or upsert comments through a database tool. Agents never archive: that is the people's. An agent's
comment is signed with its band name and never wakes it; the Notis
assistant never writes comments itself (`orchestrator_comments_refused`)
and starts a sub-agent for comment work. Through the Notis CLI, every
comment needs the writing agent's band name (`NOTIS_AGENT_NAME` or
`--agent-name`, such as `fred-and-the-machine`, never a harness or product
name; see the notis-cli skill), or it is refused (`agent_name_required`),
plus its own id (`NOTIS_AGENT_ID`) and the name of the thread it works in
(`NOTIS_AGENT_THREAD_NAME`). A comment thread such an agent outside Notis
wrote in last stays with it: replies there wake no Notis agent, the Goes to
line names it "outside Notis", and the card says when it has not read the
latest reply yet. A comment's files open from the
`url` its read returns, for an hour; read it again for a fresh one.
