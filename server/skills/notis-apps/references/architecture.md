# Platform boundaries

A Space is a place with Editors, resources and optional child Spaces. A view is
that Space's presentation. A collection is a view over native records. The Python
backend owns authority, schema validation, connections, billing and orchestration.

## Source and runtime

Use a Vite/React project with `@notis/sdk`; the selected source compiles to an ES
module and stylesheet. `defineSpaces` indexes independently deployable definitions;
`defineSpace` declares one Space. The CLI generates the manifest—edit source,
not generated metadata. [View authoring](views.md) owns its declaration contract.

The Portal renders authored code in a React/Shadow DOM host. Shadow DOM isolates
styles, not JavaScript authority. SDK hooks receive an opaque scoped runtime;
source has no account-wide tool, JWT or backend transport. Declare actions and
resource aliases; the backend resolves exact bindings and saved authorizations.
Renderers get read-only snapshots, not an editor room or reusable account credential.

Native viewer reads are different: `viewerReads: ['databases', 'skills']` lets a
signed-in viewer inspect only resources they can already reach, read-only. They
are unavailable to anonymous Sites. A shared database list uses `shows` instead.

## Ownership and sharing

Every database stays linked to at least one Space and has one main view. A link
makes the resource reachable to that Space's Editors; it is not a copy. The same
Skill may be edited through several Spaces without becoming several Skills.
A failed target never falls back to a different authority.

The protected owner and Editors of a Space and its ancestors can reach it.
Moving a subtree changes who can reach every child/resource; report the actual
access delta before moving. Removing an Editor or unlinking a resource revokes
future reads, writes and memory access through that path.

A Site is a scoped standalone website, not an Editor membership. Record Sites
stay pinned to their record, including views whose record param is not the
collection database. First-party body/properties/HTML are read-only snapshots.
Share controls, uploads, collaboration, agents, Skills and automations are not
available in that anonymous runtime. See the Site consequences below for its
declared reads, actions and billing.

## Consequences to explain before acting

For each requested change, explain who may act, who gains or loses access, what
happens to data and links, and the applicable defaults, limits and recovery
options below. Preserve conditional consequences even in a short answer;
translate implementation fields into their practical effect. Before an actual
change, explain its consequences and act only within the user's authorization.
Live tool schemas own the arguments.

- **Link** (`links.add` on the Skill, automation or database writer): Editors of
  that Space and of every Space above it gain the resource. It stays one resource
  with the same ID: nothing is copied, no grant or connection moves, and an edit
  shows through every reachable link. Requires Editor on the Space and edit rights
  on the resource.
- **Move** (`links.add` plus `links.remove` in one update): the new Space's people
  gain it; people who reached it only through the old link lose it. IDs, records,
  schema and bound automations are kept. **A database move across separate Space
  trees** requires an Editor of the database and of both Spaces. The added Space
  receives its main view (`main_view`) and its origin moves there. That main view
  stays pending until the Space deploys a record param with `main: true`;
  meanwhile, bare record links open that Space (`view_warning`).
- **Unlink**: people who reached the resource only through that link lose it. The
  last reachable Skill or automation link leaves it standalone for the remover, and
  an active automation is paused. A database's last Space link is refused
  (`database_last_space`): offer the move. `LOCAL_NOTIS_DATABASE_DELETE_DATABASE`
  refuses a database linked to a Space (`database_linked_to_space`); a database
  used only in one Space is deleted with that Space when its bin entry is deleted.
- **Move a Space** (`LOCAL_NOTIS_MANAGE_SPACE` `move`): Editors of the new parent
  gain the whole subtree; people who reached it only through the old parent lose it.
- **Bin** (`trash`, only after the user confirms): the subtree leaves everyone's
  Spaces for 30 days and keeps its links. Databases linked only inside it go too.
  A database also linked elsewhere stays usable there: the bin lends its main view
  to a published record-param view in a live Space and its origin to a reachable
  live link. Automations created only inside it pause. A record's child Space
  stays under its record, outside the bin, while another live Space still shows
  that record's database; it goes with the bin only when none does.
- **Restore** (`restore`): the same IDs, Editors, links and databases return, and
  paused automations resume. Lent main views and origins come back unless a
  decision was made meanwhile (a published main claim, an explicit move, a copy).
  A Space whose parent is still in the bin returns at the top level.
- **Delete now** (Portal Bin; no agent tool): removes the Spaces, their pages and the
  databases only they link, with every row whoever wrote it, and their stored files.
  Databases linked elsewhere stay. Skills and automations stay with a live Space
  that lists them or become standalone for the person who binned the Space.
  `bin_entry_in_use` names a Space that still uses one of its records; that Space
  must move, or be deleted from the bin, first.
- **Remove a member or leave** (Portal Share window; no agent tool): the person
  loses the subtree. Their own resources that the Space uses are kept for the Space
  first. Keep a copy (on by default) gives them a private copy of the pages,
  databases with their rows and Skills they lose, with automations paused, and
  switches their own Spaces' links to the copies; unchecked, those links become
  unavailable (see recovery below). The owner cannot be removed and hands
  ownership over before leaving.
- **Site** (Portal; no agent tool): anyone with the link, signed out. A Space Site is
  the Share window's "Publish as a site". One record uses its page's Share popover
  (Create public link, then Shared publicly with Copy link and Stop sharing) or
  "Publish this page as a site" in the Share window. Visitors reach only declared
  actions and reads. Any paid action or read is billed to the grant issuer, not
  the visitor. The Site never exposes an agent, Skill or automation, and a record
  Site cannot reach sibling records. Turning a Site off denies the next request.

**Unavailable-link recovery:** a failed link stays unavailable; it never silently
switches to another source of access. Explain the applicable choices: relink,
duplicate or remove it.

## Independent copies

A Space Store snapshot includes source, declared resources, linked Skill closure
and only explicitly selected fictional starter rows. An installation remaps IDs
and main-view claims to the installer's independent copy. Updates compare the
published baseline, new snapshot and local customizations; unresolved conflicts
stay explicit. [Delivery](release.md) owns validation and publication steps.
