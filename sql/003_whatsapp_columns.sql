-- Tracks the WhatsApp group post, which runs next to the recap email.
--
-- summary_whatsapp_sent_at : when the recap was accepted by Periskope. NULL means
--                            it was not (yet).
-- summary_whatsapp_status  : sent / skipped / failed. "skipped" is final (the
--                            meeting has no usable group id); "failed" is retried
--                            until NOTIFY_RETRY_HOURS has passed.
-- summary_whatsapp_error   : why it was skipped or failed.
--
-- Kept apart from summary_notified_at / summary_notify_error on purpose: a failed
-- WhatsApp post must never resend the email, and a retried email must never
-- repost to the group.

alter table public.meetings
  add column if not exists summary_whatsapp_sent_at timestamp with time zone,
  add column if not exists summary_whatsapp_status text,
  add column if not exists summary_whatsapp_error text;
