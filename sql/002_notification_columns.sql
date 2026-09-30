-- Tracks the share + email step, which runs after the summary is stored.
--
-- summary_notified_at  : when the recap email went out. NULL means it did not.
-- summary_notify_error : why it did not, if it failed.
--
-- A failed notification does NOT reopen the meeting: the summary is already
-- saved and re-running would spend Claude tokens again. These columns are the
-- record for a manual resend.

alter table public.meetings
  add column if not exists summary_notified_at timestamp with time zone,
  add column if not exists summary_notify_error text;
