# Store publishing

Use this when the user asks to publish a Space, or an update to one, in the
Store. You prepare everything; the user chooses where it goes and presses
Publish on the submission page. Store publication stays separate from deploying
the installed Space ([Delivery](release.md)).

## Never publish for the user

There is no agent publish operation, and you never press, simulate or script
the Publish button. Only the page's Publish button publishes, after the user
picks Team or Public there. Asking you to publish means: prepare the submission
and send the page link. A team listing goes live as soon as the user presses
Publish; a public listing goes to the sandbox reviewer, and Notis messages the
user with its result.

## The flow

All steps use `LOCAL_NOTIS_MANAGE_SPACE`. Each answer is the submission view:
status, listing text, locales, sample rows and counts, screenshots, findings,
`can_publish`, `blocked_reason` and `link`.

1. **Prepare.** Call `store_prepare {space_id, request_id}` with the root of the
   tree to publish and a stable request ID. Notis copies the tree into the
   user's hidden Store review Space (the test copy, automations paused), pins
   the source revision, takes screenshots and runs the safety scan. Retry with
   the same request ID; never prepare twice to recover a lost answer.
2. **Write the listing** with `store_submission_update {submission_id, metadata,
   locales}`: name, tagline, description, category, icon and accent in
   `metadata` (English), and the French name, tagline and description in
   `locales.fr`. Say what the Space does for the person who installs it, from
   its views, databases and Skills. Write French as natural French (tu), not a
   word-for-word translation. No personal names, account details, customer or
   company data from the source.
3. **Write sample rows** with `store_submission_update {submission_id,
   sample_rows}` (see below), then read the screenshots. Pass
   `retake_screenshots: true` after sample rows or listing text change what the
   views show.
4. **Handle the findings** (see below): ask about privacy, fix the rest in the
   source Space, and list every fix.
5. **Send the link.** When `can_publish` is true, give the user the page
   `link`, one short line on what is ready, the fixes you made and their answers.
   If it stays false, say what still blocks it from `blocked_reason` and what
   they can do.

## Sample rows

- Up to 8 rows per database, keyed by database key: `{database_key:
  [{key, properties, body}]}`. Use only properties in that database's schema; a
  relation lists the `key` of another row in the same sample set. `body` is
  optional plain text (one paragraph per line); `key` is optional short text.
- Realistic and wholly synthetic: plausible titles, dates, amounts and states
  that show every main view working (a few statuses, a spread of dates, at
  least one row in each group a view shows).
- Never a real person's name, email address, phone number, company, address or
  account identifier, and never content copied or paraphrased from the user's
  own rows, notes, contacts or history. Use invented first names only when a
  field needs a person ("Alex", "Camille"), and no contact details at all.
- Sample rows exist only in the test copy and the published version. They never
  enter the source Space. Installs start with them, and the installer removes
  all of them with one click; updates never bring them back.

## Findings

Each finding has `id`, `check`, `severity` (`red` or `amber`), `privacy`,
`where`, `message`, `fix` and `status`. Publish needs no open red finding and no
unanswered privacy question.

**Privacy.** A finding with `privacy: true` is a candidate, not yet a question.
Judge whether it carries a real privacy risk for the publisher or for people in
their data: an outside host that would receive installers' data, an integration
or MCP call that reads private accounts, a read of Spaces outside the published
tree, a sharing change, personal data in the listing, screenshots or samples. A
candidate with no real risk is treated like any other finding. For each real
risk, ask the user one plain question naming what and where, with two choices:

- **Remove**: take it out of what is published.
- **Keep**: publish it as it is; Notis adds your note to the listing so
  installers see it.

Record their answer with `store_finding_answer {submission_id, finding_id,
answer: 'remove'|'keep', note, user_words}`. `user_words` are the user's own
words; `note` is the short listing sentence for a Keep, written in plain words.
Never answer a privacy question for the user.

**Everything else.** Fix each non-privacy red finding in the source Space
through the normal release path: pull, change, build, verify, deploy, read back
([Delivery](release.md)). Then call `store_prepare` again for the same Space
with a new request ID, so the open submission pins the new revision and scans
again. List every fix for the user: what was found, where, and what you changed.
A finding you cannot fix keeps Publish blocked; say so plainly. Amber findings
need no fix; mention the ones an installer would notice.

Test chats about the submission run on the test copy only; never write sample
rows, listing text or fixes for the listing into the source Space's data.

## Updates

Publishing an update follows the same flow: `store_prepare` on the same root
creates a new submission on the same listing, and Publish adds a new version to
it. Never create a second listing, a copy of the Space or a new Space to ship an
update. Installs that differ only in listing text or screenshots update
themselves; installs of a version that changes code or databases show an
Update available card and update when their owner chooses.

## Status

Read the submission with `store_submission_read {submission_id}`. `ready` means
the page can publish; `in_review` means the public review is running and Notis
will message the user with the result; `published` is live; `rejected` lists what
to fix, which starts again from step 4 with a new `store_prepare`.
