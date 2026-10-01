const { supabase } = require("./supabase");
const { config } = require("./config");
const logger = require("./logger");

const MEETING_COLUMNS = [
  "id",
  "student_id",
  "mentor_id",
  "group_id",
  "meeting_date",
  "meeting_time",
  "google_meet_link",
  "duration_minutes",
  "summary_checked_at",
  "status"
].join(", ");

/**
 * Completed, opted-in meetings this cron has not finished with yet. Rows whose
 * claim has gone stale (a worker died mid-run) become eligible again.
 *
 * Every filter below is ANDed -- PostgREST combines top-level query params with
 * AND, and the .or() is a single self-contained group that is itself ANDed in.
 * The resulting SQL is:
 *
 *   WHERE status = 'completed'
 *     AND currently_migrated = true
 *     AND summary_checked_at IS NULL
 *     AND google_meet_link IS NOT NULL
 *     AND (summary_claimed_at IS NULL OR summary_claimed_at < :staleBefore)
 */
async function fetchPendingMeetings() {
  const staleBefore = new Date(
    Date.now() - config.claimTimeoutMinutes * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("meetings")
    .select(MEETING_COLUMNS)
    .eq("status", "completed")
    .eq("currently_migrated", true)
    .is("summary_checked_at", null)
    .not("google_meet_link", "is", null)
    .or(`summary_claimed_at.is.null,summary_claimed_at.lt.${staleBefore}`)
    .order("meeting_date", { ascending: true })
    .limit(config.batchSize);

  if (error) {
    throw new Error(`Failed to fetch pending meetings: ${error.message}`);
  }

  return data || [];
}

/**
 * Take the row. The WHERE clause is what makes this safe against a second
 * worker: only one UPDATE can match an unclaimed (or stale) row.
 */
async function claimMeeting(meetingId) {
  const staleBefore = new Date(
    Date.now() - config.claimTimeoutMinutes * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("meetings")
    .update({
      summary_claimed_at: new Date().toISOString(),
      summary_claimed_by: config.workerId
    })
    .eq("id", meetingId)
    .is("summary_checked_at", null)
    .or(`summary_claimed_at.is.null,summary_claimed_at.lt.${staleBefore}`)
    .select("id");

  if (error) {
    throw new Error(`Failed to claim meeting ${meetingId}: ${error.message}`);
  }

  return (data || []).length > 0;
}

async function releaseMeeting(meetingId) {
  const { error } = await supabase
    .from("meetings")
    .update({ summary_claimed_at: null, summary_claimed_by: null })
    .eq("id", meetingId);

  if (error) {
    logger.warn("failed to release claim", { meetingId, error: error.message });
  }
}

/**
 * Record why a meeting is still outstanding without closing it: summary_checked_at
 * stays NULL so the next run picks it up, and the claim is dropped.
 */
/**
 * Meetings that were summarised but whose recap never went out. Bounded by
 * notifyRetryHours so a permanently undeliverable meeting stops being retried.
 *
 * These rows all have summary_checked_at set, and the main pass only selects
 * rows where it is NULL, so the two passes can never contend for the same row.
 */
async function fetchMeetingsAwaitingNotification() {
  const staleBefore = new Date(
    Date.now() - config.claimTimeoutMinutes * 60 * 1000
  ).toISOString();

  const retryFrom = new Date(
    Date.now() - config.notifyRetryHours * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("meetings")
    .select(MEETING_COLUMNS)
    .eq("summary_status", "processed")
    .is("summary_notified_at", null)
    .gte("summary_checked_at", retryFrom)
    .or(`summary_claimed_at.is.null,summary_claimed_at.lt.${staleBefore}`)
    .order("summary_checked_at", { ascending: true })
    .limit(config.notifyBatchSize);

  if (error) {
    throw new Error(`Failed to fetch meetings awaiting notification: ${error.message}`);
  }

  return data || [];
}

async function claimNotification(meetingId) {
  const staleBefore = new Date(
    Date.now() - config.claimTimeoutMinutes * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("meetings")
    .update({
      summary_claimed_at: new Date().toISOString(),
      summary_claimed_by: config.workerId
    })
    .eq("id", meetingId)
    .is("summary_notified_at", null)
    .or(`summary_claimed_at.is.null,summary_claimed_at.lt.${staleBefore}`)
    .select("id");

  if (error) {
    throw new Error(`Failed to claim notification ${meetingId}: ${error.message}`);
  }

  return (data || []).length > 0;
}

/** The stored summary, so a resend never re-runs (and re-bills) Claude. */
async function fetchSummaryRow(meetingId) {
  const { data, error } = await supabase
    .from("meeting_summaries")
    .select("summary, homework, meeting_title")
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    throw new Error(`Failed to read summary for ${meetingId}: ${error.message}`);
  }

  return (data || [])[0] || null;
}

async function markMeetingPending(meetingId, status) {
  const { error } = await supabase
    .from("meetings")
    .update({
      summary_status: status,
      summary_claimed_at: null,
      summary_claimed_by: null
    })
    .eq("id", meetingId);

  if (error) {
    throw new Error(`Failed to mark meeting ${meetingId} pending: ${error.message}`);
  }
}

async function markMeetingChecked(meetingId, status, errorMessage) {
  const { error } = await supabase
    .from("meetings")
    .update({
      summary_checked_at: new Date().toISOString(),
      summary_status: status,
      summary_error: errorMessage || null
    })
    .eq("id", meetingId);

  if (error) {
    throw new Error(`Failed to mark meeting ${meetingId} checked: ${error.message}`);
  }
}

async function fetchGroup(groupId) {
  if (!groupId) {
    return null;
  }

  const { data, error } = await supabase
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .maybeSingle();

  if (error) {
    logger.warn("failed to fetch group", { groupId, error: error.message });

    return null;
  }

  return data || null;
}

/**
 * meeting_id is not unique on meeting_summaries, so there is no ON CONFLICT to
 * lean on. Look for a row this cron already wrote for the meeting and update it;
 * only insert when there is none. A meeting is claimed while this runs, so no
 * other worker can be writing the same meeting_id at the same time.
 */
/**
 * Email addresses for the meeting's student and mentor. Ids that resolve to no
 * user, or to a user with no address, are dropped -- a missing address must not
 * stop the rest of the recipients being served.
 */
async function fetchRecipients(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];

  if (ids.length === 0) {
    return [];
  }

  const { data, error } = await supabase.from("users").select("*").in("id", ids);

  if (error) {
    throw new Error(`Failed to fetch recipients: ${error.message}`);
  }

  return (data || [])
    .filter(user => user.email)
    .map(user => ({
      id: user.id,
      email: String(user.email).trim(),
      name: user.name || user.email
    }));
}

async function markMeetingNotified(meetingId, errorMessage) {
  const { error } = await supabase
    .from("meetings")
    .update({
      summary_notified_at: errorMessage ? null : new Date().toISOString(),
      summary_notify_error: errorMessage || null
    })
    .eq("id", meetingId);

  if (error) {
    logger.warn("failed to record notification state", {
      meetingId,
      error: error.message
    });
  }
}

/**
 * Backfill the recording link. The summary row is written as soon as the
 * transcript is summarised, which is usually before Meet has published the
 * recording -- so meeting_link is filled in later, by the retry pass, once the
 * file actually exists.
 */
async function updateSummaryMeetingLink(meetingId, meetingLink) {
  const { error } = await supabase
    .from("meeting_summaries")
    .update({ meeting_link: meetingLink })
    .eq("meeting_id", meetingId)
    .is("meeting_link", null);

  if (error) {
    logger.warn("failed to backfill recording link", {
      meetingId,
      error: error.message
    });
  }
}

async function upsertSummary(row) {
  const { data: existing, error: readError } = await supabase
    .from("meeting_summaries")
    .select("id")
    .eq("meeting_id", row.meeting_id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (readError) {
    throw new Error(
      `Failed to look up summary for ${row.meeting_id}: ${readError.message}`
    );
  }

  if (existing && existing.length > 0) {
    const { error } = await supabase
      .from("meeting_summaries")
      .update(row)
      .eq("id", existing[0].id);

    if (error) {
      throw new Error(`Failed to update summary for ${row.meeting_id}: ${error.message}`);
    }

    return { action: "updated", id: existing[0].id };
  }

  const { data: inserted, error } = await supabase
    .from("meeting_summaries")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to insert summary for ${row.meeting_id}: ${error.message}`);
  }

  return { action: "inserted", id: inserted.id };
}

module.exports = {
  fetchPendingMeetings,
  claimMeeting,
  releaseMeeting,
  markMeetingChecked,
  markMeetingPending,
  fetchGroup,
  fetchRecipients,
  fetchMeetingsAwaitingNotification,
  claimNotification,
  fetchSummaryRow,
  markMeetingNotified,
  upsertSummary,
  updateSummaryMeetingLink
};
