# gmeet-automation

Hourly cron service. Finds completed meetings that have been opted into
migration, pulls their Google Meet transcript, summarises it, and writes a row
into `meeting_summaries`.

## Setup

```bash
npm install
cp .env.example .env    # fill it in
```

Apply the migrations first — they add the tracking columns this service needs:

```bash
psql "$DATABASE_URL" -f sql/001_meetings_tracking_columns.sql
psql "$DATABASE_URL" -f sql/002_notification_columns.sql
```

Then:

```bash
npm start        # schedules the cron and runs once immediately
npm run once     # single pass, then exit (good for testing / external schedulers)
```

## Schema changes

`sql/001_meetings_tracking_columns.sql` adds to `public.meetings`:

| Column | Purpose |
| --- | --- |
| `currently_migrated` | opt-in flag; only `TRUE` rows are picked up |
| `summary_checked_at` | **the "has this been checked" marker** — `NULL` means still to do |
| `summary_status` | `processed` / `awaiting_transcript` / `no_transcript` / `no_conference` / `error` |
| `summary_error` | last error message |
| `summary_claimed_at` | claim marker so two workers never take the same row |
| `summary_claimed_by` | which worker holds the claim |

It also adds a plain lookup index on `meeting_summaries.meeting_id`. That column
is **not** unique, so the cron guards duplicates itself: before writing it reads
the existing row for the meeting and updates it, inserting only when there is
none.

## What a run does

1. Select up to `BATCH_SIZE` meetings where `status = 'completed'`,
   `currently_migrated = true`, `summary_checked_at IS NULL`, and a
   `google_meet_link` is set. Rows whose claim is older than
   `CLAIM_TIMEOUT_MINUTES` (a worker that died mid-run) become eligible again.
2. Claim each row with a conditional `UPDATE` — only one worker can win it.
3. Resolve the Meet link to conference records, keep only those falling in this
   occurrence's scheduled slot (see **Recurring meetings**), export every
   `FILE_GENERATED` transcript doc from Drive, and concatenate them in
   chronological order.
4. Send the transcript to Claude for `summary` + `homework` (same prompt the
   original `script.js` used).
5. Upsert into `meeting_summaries`.
6. If the recording exists, grant the student and mentor read access to the
   transcript doc and the recording, then email them the recap. If it does not,
   defer — the retry pass delivers once it lands (see **Sharing and email**).
7. Set `summary_checked_at`.

Every run then finishes with a retry pass over recaps that never went out.

Outcomes:

- **no conference records** → marked `no_conference`, not retried
- **conference but no transcript, call ended < `TRANSCRIPT_GRACE_HOURS` ago** →
  marked `awaiting_transcript`, claim released, retried next hour
- **conference but no transcript after the grace window** → marked
  `no_transcript`, not retried
- **error** (Google, Claude or DB) → claim released, `summary_checked_at` stays
  `NULL`, retried **every hour indefinitely** — there is no attempt cap

Runs never overlap: if the previous pass is still going, the tick is skipped.

## Recurring meetings

A recurring calendar event reuses **one Meet link for every occurrence**, so
filtering `conferenceRecords` by meeting code returns every session the series
ever had. Each meeting row is therefore matched to its own occurrence by time:

```
window = [ scheduled_start - MATCH_WINDOW_MINUTES,
           scheduled_start + duration_minutes + MATCH_WINDOW_MINUTES ]
```

`scheduled_start` comes from `meeting_date` + `meeting_time` read in
`MEETING_TIMEZONE` — that column is a bare `time` with no zone, so the zone has
to be supplied. Conferences overlapping the window are kept; everything else is
ignored.

This means:

- each occurrence gets only its own transcript, start time and duration
- a call that dropped and reconnected still merges into one summary
- a skipped week resolves to `no_conference` rather than borrowing another
  week's transcript

Sizing `MATCH_WINDOW_MINUTES`: too small and a call that started late is missed;
too large and back-to-back sessions on the same link bleed into each other. The
default of 45 minutes suits hourly slots. If a row has no usable
`meeting_date`/`meeting_time`, the window is skipped and every conference on the
link is used, with a warning logged.

## Sharing and email

After a summary is stored, the student (`student_id`) and mentor (`mentor_id`)
are each added as a **reader** on every transcript doc and recording file for
that occurrence, then sent one recap email containing the summary, the homework,
and links to those files.

**Nothing is shared or sent until the recording exists.** Meet publishes the
recording to Drive well after the transcript, so a meeting is commonly
summarised on one run and mailed a few runs later. Until then the meeting sits
with `summary_notify_error = 'waiting for recording'` and `summary_notified_at`
NULL, which is exactly what the retry pass looks for — it re-resolves the files
from Google each run and delivers as soon as the recording appears. Set
`REQUIRE_RECORDING=false` to send as soon as the transcript is summarised.

Two setup steps are required before this works:

1. **Add the `drive` scope.** Granting a permission is a write, so
   `drive.readonly` is not enough. Run `npm run check-scopes` to see exactly
   what the service account holds today.

   The full required set is just two scopes:

   | Scope | Covers |
   | --- | --- |
   | `https://www.googleapis.com/auth/meetings.space.readonly` | listing conference records, recordings, transcripts |
   | `https://www.googleapis.com/auth/drive` | exporting transcript docs **and** granting read access |

   `drive.file` does **not** work here — it only covers files the app itself
   created, and Meet owns these. `drive` is a superset of `drive.readonly`, so
   the old scope becomes redundant, though leaving it costs nothing.

   Add it in the admin console under **Security > Access and data control > API
   controls > Domain-wide delegation**. Editing an entry *replaces* its scope
   list, so paste all the scopes you want, not just the new one. Changes can
   take a few minutes to take effect.
2. **Check your Drive sharing policy.** If recipients are outside your Workspace
   domain, external sharing must be permitted or the share is rejected.

3. **Check who owns the files.** Meet saves recordings and transcripts into the
   *organizer's* Drive. The service account impersonates `CALENDAR_EMAIL`, so
   that account must itself have rights to share those files — if your meetings
   are organized by various mentors rather than by `CALENDAR_EMAIL`, sharing
   will fail with a permissions error even with the scope correct. Worth
   confirming against one real meeting before enabling mail.

Drive's own "X shared a file with you" notification is suppressed
(`sendNotificationEmail: false`) so people get one email from you, not three.

### Rolling it out safely

`MAIL_ENABLED` defaults to **false**, so a fresh deploy will summarise and share
nothing by mistake. Recommended order:

```bash
DRY_RUN=true npm run once     # logs every share and email, changes nothing
MAIL_ENABLED=true npm start   # once the log looks right
```

`DRY_RUN=true` needs no Google or SMTP credentials at all.

### When it fails

Sharing and email are **best effort**. By the time they run the summary is
already saved, and re-running would spend Claude tokens again — so a failure is
recorded rather than retried:

| Column | Meaning |
| --- | --- |
| `summary_notified_at` | the recap email went out |
| `summary_notify_error` | why it did not |

The meeting still settles as `processed`. Individual share failures (one bad
address, one deleted file) do not stop the other recipients or files, and are
counted in the run log as `shareFailures`.

### The notification retry pass

Every run ends with a second pass over meetings where `summary_status =
'processed'` **and** `summary_notified_at IS NULL`, retrying the share and the
email. It is cheap: the summary and homework are read back from
`meeting_summaries`, so **Claude is never called again** — only the Google calls
needed to re-resolve the file links.

It gives up after `NOTIFY_RETRY_HOURS` (default 24) measured from
`summary_checked_at`, so a permanently undeliverable meeting stops being retried
rather than being attempted forever.

This window is also what bounds the wait for a recording. A session that was
never recorded is summarised and stored, but **no recap is ever sent** — after
24 hours it simply stops being retried, leaving `waiting for recording` as the
recorded reason. Lengthen `NOTIFY_RETRY_HOURS` if your recordings routinely take
longer, or set `REQUIRE_RECORDING=false` if a transcript-only recap is better
than none.

The two passes can never collide: the main pass only selects rows where
`summary_checked_at IS NULL`, and this one only selects rows where it is set.
Rows are claimed with the same stale-claim mechanism.

One useful consequence: meetings processed while `MAIL_ENABLED=false` are
recorded with `summary_notify_error = 'mail disabled'`. Turn mail on within the
retry window and the next run delivers them, no manual step.

Recipients are read from `public.users` by id; a user with no `email` is skipped.
The greeting name uses `users.name`, falling back to the address.

## Field mapping into `meeting_summaries`

| Column | Source |
| --- | --- |
| `meeting_id` | `meetings.id` as text |
| `workspace_id` | `WORKSPACE_ID` env |
| `meeting_owner_email` | `CALENDAR_EMAIL` env |
| `meeting_type` | `MEETING_TYPE` env |
| `meeting_link` | `meetings.google_meet_link` |
| `meeting_title` | group name + meeting date, else `Mentor session — <date>` |
| `meeting_started_at` / `meeting_finished_at` | earliest / latest conference record times |
| `meeting_duration` | **minutes** between those two, falling back to `meetings.duration_minutes` |
| `student_id`, `mentor_id`, `group_id` | copied from `meetings` |
| `group_jid` | `groups.group_jid` |
| `summary`, `homework` | Claude |
| `resolved` | `false` |

`meeting_team_id` and `meeting_team_name` are left `NULL` — nothing in
`meetings` maps to them. Point them at a column and they can be filled in
[src/lib/processor.js](src/lib/processor.js).

## Environment

See [.env.example](.env.example). `CRON_SCHEDULE` defaults to `0 * * * *`
(top of every hour); `CRON_TIMEZONE` defaults to `UTC`; `TRANSCRIPT_GRACE_HOURS`
defaults to `24`; `MATCH_WINDOW_MINUTES` defaults to `45`; `MEETING_TIMEZONE`
falls back to `CRON_TIMEZONE`; `NOTIFY_RETRY_HOURS` defaults to `24`;
`REQUIRE_RECORDING` defaults to `true`.

Drive often publishes a transcript some time after the call ends, so a meeting
with a conference record but no transcript yet is **not** closed out. It is left
open with `summary_status = 'awaiting_transcript'` and retried every hour until
`TRANSCRIPT_GRACE_HOURS` past the conference end time, at which point it settles
as `no_transcript`.

## Files

- [src/index.js](src/index.js) — cron scheduler, overlap guard
- [src/lib/processor.js](src/lib/processor.js) — run loop and per-meeting logic
- [src/lib/repository.js](src/lib/repository.js) — all Supabase queries
- [src/lib/meet.js](src/lib/meet.js) — Google auth, conference + transcript fetching
- [src/lib/summarizer.js](src/lib/summarizer.js) — the Claude call
- [src/lib/drive.js](src/lib/drive.js) — granting read access to files
- [src/lib/mailer.js](src/lib/mailer.js) — SMTP delivery and the email template
- [src/lib/time.js](src/lib/time.js) — resolving `meeting_time` against a zone
- [scripts/check-scopes.js](scripts/check-scopes.js) — `npm run check-scopes`
