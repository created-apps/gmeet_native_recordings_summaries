-- Columns the gmeet-automation cron needs on public.meetings.
--
-- currently_migrated : opt-in flag. Only meetings with TRUE are picked up.
-- summary_checked_at : set once the cron has finished with the meeting, whatever
--                      the outcome. This is the "has this been checked" marker,
--                      so a NULL value means still to do.
-- summary_status     : why it finished — processed / no_transcript / no_conference / error.
-- summary_error      : last error message, for debugging.
-- summary_claimed_at : claim marker so two workers never process the same row.
-- summary_claimed_by : which worker holds the claim.

alter table public.meetings
  add column if not exists currently_migrated boolean not null default false,
  add column if not exists summary_checked_at timestamp with time zone,
  add column if not exists summary_status text,
  add column if not exists summary_error text,
  add column if not exists summary_claimed_at timestamp with time zone,
  add column if not exists summary_claimed_by text;

-- The cron's hot path: pending, migrated, completed meetings.
create index if not exists idx_meetings_summary_pending
  on public.meetings using btree (meeting_date)
  where (
    currently_migrated = true
    and status = 'completed'
    and summary_checked_at is null
  );

-- meeting_summaries.meeting_id holds meetings.id as text. It is not unique --
-- a meeting may legitimately have more than one summary row -- so this is a
-- plain lookup index. The cron guards against duplicates itself: it reads the
-- existing row for a meeting and updates it rather than inserting a second one.
create index if not exists idx_meeting_summaries_meeting_id
  on public.meeting_summaries using btree (meeting_id);
