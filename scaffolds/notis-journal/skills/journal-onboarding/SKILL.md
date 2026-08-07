---
name: journal-onboarding
description: "Set up the Journal morning and evening automations and run their check-ins. Use when onboarding someone to the Journal daily practice, changing their check-in schedule, or when a Journal automation asks to run the morning or evening check-in."
---

# Journal Daily Practice

The Journal is a five-minute daily practice captured entirely in conversation. Notis asks, the user answers, and the `journal_entries` database fills itself — the app only displays. There are two rituals:

- **Morning check-in** — waking mood (1–7 pleasant scale + one adjective), how they're feeling, energy (1–10), motivation (1–10), three gratitudes, an intention for the day, and a daily affirmation.
- **Evening reflection** — whole-day mood (1–7 pleasant scale + one adjective), the day's highlight, what the day taught them, a gentle catch-up of anything the morning missed, and an optional free-form entry.

## Choose the Mode

- Use **setup mode** when the user is onboarding, asks to configure Journal check-ins, or wants to change the schedule.
- Use **morning-check mode** only when the request or automation prompt names it.
- Use **evening-check mode** only when the request or automation prompt names it.
- Never enter setup mode from a check-in run.

## Tone (applies to every mode)

Write like a warm, attentive companion — closer to a good therapist than to a form. Concrete rules:

- Sound like a person, not a survey. Weave the questions into one or two short messages instead of a numbered interrogation.
- Reference what they actually said, today or on recent days, when it helps ("this morning you said the demo had you excited — how did it go?").
- Never guilt-trip about missed days or missing fields. A skipped question is an answer; move on gracefully.
- Accept partial answers. Save what was given; the evening pass picks up morning leftovers, and anything still missing after that just stays blank.
- Keep it light: this is a check-in, not a medical assessment. Never diagnose, never analyze the user unprompted.

## The Pleasant Scale

Both moods use the same 1–7 scale (like Apple's State of Mind): 1 very unpleasant, 2 unpleasant, 3 slightly unpleasant, 4 neutral, 5 slightly pleasant, 6 pleasant, 7 very pleasant.

- Ask for it conversationally ("where does this morning land, 1 to 7, unpleasant to pleasant?") and store the integer.
- If the user answers with words only ("pretty good"), map it yourself (pretty good ≈ 5–6), confirm implicitly by restating ("logging that as a 6"), and store it.
- The adjective is the user's own word ("foggy", "electric", "flat") — store it lower-case in the matching `... Mood Word` property. If they give a sentence, pull the strongest adjective and keep the sentence in `Morning Feeling` (morning) or the free entry (evening).

## Writing to the Database

The native Notis database with slug `journal_entries` holds **one entry per local calendar day**:

- Find today's entry with `LOCAL_NOTIS_DATABASE_QUERY` and a structured filter on **Date** for the user's local day. Ignore archived entries. If duplicates exist, use the most recently updated one and mention the duplicate briefly; never merge or delete.
- Create it only if it does not exist, via `LOCAL_NOTIS_DATABASE_UPSERT_JOURNAL_ENTRIES` with `Name` = `Journal — YYYY-MM-DD` (local date) and `Date` = that day.
- Update by passing only the properties the user just answered. Never overwrite a field that already has a value unless the user explicitly corrects it.
- Properties: `Morning Mood` (1–7), `Morning Mood Word`, `Morning Feeling`, `Energy` (1–10), `Motivation` (1–10), `Gratitude 1..3`, `Intention`, `Affirmation`, `Day Mood` (1–7), `Day Mood Word`, `Highlight`, `Lesson`.
- The optional free-form entry goes in the document body: pass `content_markdown` (append to existing content rather than replacing it; set `replace` only when the body is empty).

## Setup Mode

### 1. Recommend the Routine

Briefly explain the two automations before asking for times:

- A **morning check-in** (recommend ~08:00) captures the waking mood, energy, motivation, gratitudes, intention, and affirmation while the day is still fresh.
- An **evening reflection** (recommend ~21:30) captures how the day actually felt, its highlight and lesson, catches up anything the morning missed, and offers space for a free entry.

Make clear both times are theirs to choose.

### 2. Ask for the Schedule

One compact question collecting: morning time, evening time, days of the week (default every day), timezone (unless confidently known), and delivery channel only when ambiguous. Do not create anything while any of these is unresolved.

### 3. Check Existing Setup

Use `LOCAL_NOTIS_LIST_REMINDERS` and `LOCAL_NOTIS_LIST_AUTOMATIONS` before writing anything — one full page of up to 100 items each, inspected locally, directly in the current assistant (no sub-agents, no repeated searches).

- Match existing items by purpose, not only name. Update a matching Journal morning or evening item instead of duplicating it.
- If an old Journal **reminder** exists from a previous version of this practice, replace it: create the morning automation and remove only that confirmed Journal reminder.
- Preserve unrelated reminders and automations.

### 4. Confirm Before Creating

Recap both local schedules, days, timezone, channel, and what each check-in will ask. Obtain explicit confirmation before creating or updating anything.

### 5. Create the Two Automations

Use `LOCAL_NOTIS_INSERT_AUTOMATION` (or `LOCAL_NOTIS_UPDATE_AUTOMATION` for a matching existing item) for **both** check-ins:

- Names: `Journal morning check-in` and `Journal evening reflection`.
- `schedule` triggers with standard five-field cron expressions derived from the confirmed local times and days. Recurrence lives only in `cron_expression`.
- Delivery only via `channel` and, when required, `channel_account_id`.
- **Enable cross-run context on both automations.** The evening reflection must see the morning conversation so it can follow up on what the user actually said — this consolidated thread is a core feature of the practice, not an option.
- Morning prompt, exactly:

  `Run /journal-onboarding in morning-check mode: hold this morning's Journal check-in and save the answers to today's journal_entries entry.`

- Evening prompt, exactly:

  `Run /journal-onboarding in evening-check mode: review today's journal_entries entry, hold the evening reflection, follow up on what the morning conversation actually said, and save the answers.`

Do not put scheduling or delivery instructions inside the prompts.

### 6. Report the Result

Return a concise summary: both local schedules, the delivery channel, created vs updated for each item, and the automation IDs or portal links. The native tools store recurring schedules as UTC cron expressions — convert from the user's IANA timezone, then verify the returned crons and the Portal-rendered local times. That read-back completes setup verification; do not launch extra agents or investigate scheduler internals.

## Morning-Check Mode

1. Find (or note the absence of) today's entry as described in *Writing to the Database*.
2. Open with one short, warm greeting that folds in the first questions. Cover, across at most two messages: waking mood (scale + their word), how they're feeling, energy and motivation (1–10 each), three gratitudes, what would make today great, and a daily affirmation.
3. If they stall on the affirmation, offer to shape one from what they just said — their words, not a canned quote.
4. Create or update today's entry with everything captured. Partial is fine; say nothing about the gaps (the evening picks them up).
5. Close in one line that reflects their intention back ("holding you to that walk — talk tonight").

## Evening-Check Mode

1. Read today's entry. Its filled fields plus the morning conversation (available through the automation's shared context) are your material.
2. Open by connecting to the morning — reference a real detail, then ask the evening questions. Example shape: "Evening — this morning you were grateful for the calm before the demo. Did that calm hold? How did the whole day feel, 1 to 7, and what one word would you give it?"
3. Cover: day mood (scale + adjective), highlight of the day, what the day taught them.
4. Then gently flag what the morning missed, grouped in one soft sentence ("we never got to your three gratitudes this morning — anything from today count?"). Ask only for genuinely missing fields; never re-ask populated ones.
5. Offer the optional free entry last, as an open door, not a task ("anything else about today you want kept? I'll write it down word for word").
6. Save all answers (properties + `content_markdown` for the free entry). If no entry exists at all, create it and run the whole check-in as a compact evening version.
7. If every field is already complete, just reflect the day back in a sentence and say goodnight — no questions.

## Guardrails

- Never create a second copy of the same automation, reminder, or daily entry.
- Never schedule anything without confirmed times, timezone, days, and destination.
- Never invent values the user did not give; never delete entries; never rewrite an existing free entry (append only).
- Never turn a check-in prompt into instructions to create another automation.
