const { config } = require("./config");
const logger = require("./logger");
const { getMeetingArtifacts } = require("./meet");
const { zonedDateTimeToUtc } = require("./time");
const { shareFiles } = require("./drive");
const { buildEmail, buildSubject, sendSummaryEmail } = require("./mailer");
const { summarizeTranscript } = require("./summarizer");
const { sendGroupMessage, resolveGroupChat } = require("./periskope");
const { buildWhatsappMessage } = require("./whatsappMessage");
const {
  fetchPendingMeetings,
  claimMeeting,
  releaseMeeting,
  markMeetingChecked,
  markMeetingPending,
  fetchGroup,
  fetchRecipients,
  fetchParentRecipients,
  fetchMeetingsAwaitingNotification,
  claimNotification,
  fetchSummaryRow,
  markMeetingNotified,
  markMeetingWhatsapp,
  upsertSummary,
  updateSummaryMeetingLink
} = require("./repository");

function durationMinutes(startedAt, finishedAt, fallbackMinutes) {
  if (startedAt && finishedAt) {
    return Math.round(
      (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000
    );
  }

  return fallbackMinutes ?? null;
}

function buildTitle(meeting, group) {
  if (group && group.name) {
    return `${group.name} — ${meeting.meeting_date}`;
  }

  return `Mentor session — ${meeting.meeting_date}`;
}

/**
 * The slot this specific occurrence was scheduled for, widened on both sides.
 * Returns null when the row has no usable date/time, in which case every
 * conference on the link is considered (the old behaviour).
 */
function occurrenceWindow(meeting) {
  const scheduledStart = zonedDateTimeToUtc(
    meeting.meeting_date,
    meeting.meeting_time,
    config.meetingTimezone
  );

  if (!scheduledStart) {
    logger.warn("no usable scheduled time, matching all conferences", {
      meetingId: meeting.id
    });

    return null;
  }

  const padMs = config.matchWindowMinutes * 60 * 1000;
  const durationMs = (meeting.duration_minutes || 60) * 60 * 1000;

  return {
    start: scheduledStart.getTime() - padMs,
    end: scheduledStart.getTime() + durationMs + padMs
  };
}

/** True when a cut-off is set and the meeting is dated before it (YYYY-MM-DD compares as text). */
function isBefore(meeting, fromDate) {
  return Boolean(fromDate) && String(meeting.meeting_date) < fromDate;
}

/**
 * Post the recap in the meeting's own WhatsApp group. Independent of the email:
 * it records its outcome on its own columns, never throws, and so can neither
 * block nor repeat the email. Does nothing while WHATSAPP_ENABLED is off (and
 * records nothing, so switching it on later only affects meetings notified from
 * then on). A dry run logs the message and records nothing.
 *
 *   sent    -> final
 *   skipped -> final (no usable group id for the meeting)
 *   failed  -> picked up again by the retry pass until NOTIFY_RETRY_HOURS
 */
async function postRecapToWhatsapp(meeting, artifacts, summary, homework) {
  if (!config.whatsapp.enabled) {
    return;
  }

  if (["sent", "skipped"].includes(meeting.summary_whatsapp_status)) {
    return;
  }

  // Older meetings (already in the queue when WhatsApp went live) are left alone.
  // Nothing is recorded, so they are never picked up for a post later either.
  if (isBefore(meeting, config.whatsapp.fromDate)) {
    logger.info("whatsapp post not made: meeting is before WHATSAPP_FROM_DATE", {
      meetingId: meeting.id,
      meetingDate: meeting.meeting_date,
      fromDate: config.whatsapp.fromDate
    });

    return;
  }

  const record = async (status, reason) => {
    if (!config.dryRun) {
      await markMeetingWhatsapp(meeting.id, status, reason);
    }
  };

  try {
    const group = await fetchGroup(meeting.group_id);
    const target = resolveGroupChat(meeting.group_id, group);

    if (target.skip) {
      await record(target.final ? "skipped" : "failed", target.skip);

      logger.warn("whatsapp post not made", {
        meetingId: meeting.id,
        reason: target.skip,
        final: target.final
      });

      return;
    }

    const result = await sendGroupMessage({
      chatId: target.chatId,
      message: buildWhatsappMessage({
        meetingDate: meeting.meeting_date,
        summary,
        homework,
        transcriptDocs: artifacts.transcriptDocs,
        recordings: artifacts.recordings
      })
    });

    if (config.dryRun) {
      return;
    }

    if (result.sent) {
      await record("sent", null);

      logger.info("whatsapp posted", {
        meetingId: meeting.id,
        status: result.status,
        uniqueId: result.uniqueId
      });

      return;
    }

    await record("failed", result.reason || "whatsapp not sent");

    logger.warn("whatsapp post failed", {
      meetingId: meeting.id,
      reason: result.reason,
      ambiguous: Boolean(result.ambiguous)
    });
  } catch (error) {
    await record("failed", error.message);

    logger.error("whatsapp post errored", { meetingId: meeting.id, error: error.message });
  }
}

/**
 * Deliver the recap: the email to the student and mentor (parent in Cc), and the
 * post in the WhatsApp group. Best effort by design: the summary is already saved
 * at this point, so a failure is recorded on the meeting rather than thrown,
 * which would re-run the (paid) summarisation next hour.
 *
 * Nothing is shared or sent until the recording exists, so people get one message
 * with every artefact rather than one now and another later. The retry pass
 * re-resolves artefacts each run and delivers once it appears.
 *
 * The two channels are independent. Each is skipped once it has succeeded, so a
 * retry for one never repeats the other. An email error is rethrown only after the
 * WhatsApp step has run, so the callers record it exactly as before.
 */
async function notify(meeting, artifacts, summary, homework, title) {
  if (config.requireRecording && artifacts.recordings.length === 0) {
    await markMeetingNotified(meeting.id, "waiting for recording");

    logger.info("recording not ready, deferring recap", { meetingId: meeting.id });

    return;
  }

  let emailError = null;

  if (!meeting.summary_notified_at) {
    try {
      await sendRecapEmail(meeting, artifacts, summary, homework, title);
    } catch (error) {
      emailError = error;
    }
  }

  await postRecapToWhatsapp(meeting, artifacts, summary, homework);

  if (emailError) {
    throw emailError;
  }
}

/**
 * Give the student, mentor and parent read access to the transcript doc and
 * recording, then email the student and mentor with the parent in Cc.
 */
async function sendRecapEmail(meeting, artifacts, summary, homework, title) {
  const recipients = await fetchRecipients([meeting.student_id, meeting.mentor_id]);

  if (recipients.length === 0) {
    await markMeetingNotified(meeting.id, "no recipients with an email address");

    logger.warn("no recipients to notify", { meetingId: meeting.id });

    return;
  }

  const emails = recipients.map(recipient => recipient.email);

  // The student's parent is CC'd and shared the same files. Anyone already in
  // To (a parent who is also the student's or mentor's address) is left out.
  // Meetings dated before PARENT_CC_FROM_DATE are emailed without a parent.
  const parents = isBefore(meeting, config.parentCc.fromDate)
    ? []
    : await fetchParentRecipients(meeting.student_id);

  const toAddresses = new Set(emails.map(email => email.toLowerCase()));

  const ccEmails = parents
    .map(parent => parent.email)
    .filter(email => !toAddresses.has(email.toLowerCase()));

  const fileIds = [
    ...artifacts.transcriptDocs.map(doc => doc.fileId),
    ...artifacts.recordings.map(recording => recording.fileId)
  ];

  const { failures } = await shareFiles(fileIds, [...emails, ...ccEmails]);

  const body = buildEmail({
    title,
    summary,
    homework,
    transcriptDocs: artifacts.transcriptDocs,
    recordings: artifacts.recordings
  });

  const result = await sendSummaryEmail({
    to: emails,
    cc: ccEmails,
    subject: buildSubject(title),
    body
  });

  await markMeetingNotified(
    meeting.id,
    result.sent ? null : result.reason || "email not sent"
  );

  logger.info("notified", {
    meetingId: meeting.id,
    recipients: emails.length,
    cc: ccEmails.length,
    files: fileIds.length,
    shareFailures: failures.length,
    emailSent: result.sent
  });
}

async function processMeeting(meeting) {
  const window = occurrenceWindow(meeting);

  const artifacts = await getMeetingArtifacts(meeting.google_meet_link, window);

  if (artifacts.conferences.length === 0) {
    // Nobody ever joined this link, so there is nothing to summarise.
    await markMeetingChecked(meeting.id, "no_conference", null);

    logger.info("no conference record", { meetingId: meeting.id });

    return "no_conference";
  }

  if (!artifacts.transcript) {
    // Drive can publish a transcript well after the call ends, so keep the
    // meeting open until the grace window has passed.
    const endedAt = artifacts.finishedAt || artifacts.startedAt;

    const graceEndsAt = endedAt
      ? new Date(endedAt).getTime() + config.transcriptGraceHours * 60 * 60 * 1000
      : 0;

    if (Date.now() < graceEndsAt) {
      await markMeetingPending(meeting.id, "awaiting_transcript");

      logger.info("transcript not ready, will retry", {
        meetingId: meeting.id,
        retryUntil: new Date(graceEndsAt).toISOString()
      });

      return "awaiting_transcript";
    }

    await markMeetingChecked(meeting.id, "no_transcript", null);

    logger.info("no transcript after grace window", { meetingId: meeting.id });

    return "no_transcript";
  }

  const [{ summary, homework, notify: hasContent }, group] = await Promise.all([
    summarizeTranscript(artifacts.transcript),
    fetchGroup(meeting.group_id)
  ]);

  if (!hasContent) {
    // Claude judged the transcript empty, a placeholder, or too short to tell
    // what happened. Nothing is saved or sent, and no retry is queued.
    await markMeetingChecked(meeting.id, "no_transcript", null);

    logger.info("transcript has no usable content", { meetingId: meeting.id });

    return "no_transcript";
  }

  const written = await upsertSummary({
    meeting_id: meeting.id,
    workspace_id: config.workspaceId,
    meeting_owner_email: config.google.calendarEmail,
    meeting_type: config.meetingType,
    // The Drive recording, not the Meet link. Null here when the recording has
    // not been published yet; the retry pass backfills it.
    meeting_link: artifacts.recordings[0]?.url ?? null,
    meeting_title: buildTitle(meeting, group),
    meeting_started_at: artifacts.startedAt,
    meeting_finished_at: artifacts.finishedAt,
    meeting_duration: durationMinutes(
      artifacts.startedAt,
      artifacts.finishedAt,
      meeting.duration_minutes
    ),
    student_id: meeting.student_id,
    mentor_id: meeting.mentor_id,
    group_id: meeting.group_id,
    group_jid: group?.group_jid ?? null,
    summary,
    homework,
    resolved: false
  });

  const title = buildTitle(meeting, group);

  try {
    await notify(meeting, artifacts, summary, homework, title);
  } catch (error) {
    const message = error.message;

    await markMeetingNotified(meeting.id, message);

    logger.error("notification failed", { meetingId: meeting.id, error: message });
  }

  await markMeetingChecked(meeting.id, "processed", null);

  logger.info("summary stored", {
    meetingId: meeting.id,
    summaryId: written.id,
    action: written.action
  });

  return "processed";
}

/**
 * Second pass: meetings that were summarised but whose recap never went out.
 * The summary is read back from meeting_summaries rather than regenerated, so a
 * resend costs nothing at Claude -- only the Google calls to re-resolve the
 * file links. Bounded by NOTIFY_RETRY_HOURS.
 */
async function retryNotifications() {
  const meetings = await fetchMeetingsAwaitingNotification();

  if (meetings.length === 0) {
    return { notified: 0, failed: 0, skipped: 0 };
  }

  const counts = { notified: 0, failed: 0, skipped: 0 };

  for (const meeting of meetings) {
    const claimed = await claimNotification(meeting.id);

    if (!claimed) {
      counts.skipped += 1;

      continue;
    }

    try {
      const stored = await fetchSummaryRow(meeting.id);

      if (!stored) {
        await markMeetingNotified(meeting.id, "no summary row to send");

        counts.failed += 1;

        continue;
      }

      const artifacts = await getMeetingArtifacts(
        meeting.google_meet_link,
        occurrenceWindow(meeting)
      );

      if (artifacts.recordings.length > 0) {
        await updateSummaryMeetingLink(meeting.id, artifacts.recordings[0].url);
      }

      await notify(
        meeting,
        artifacts,
        stored.summary,
        stored.homework,
        stored.meeting_title || buildTitle(meeting, null)
      );

      counts.notified += 1;
    } catch (error) {
      const message = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;

      await markMeetingNotified(meeting.id, message);

      counts.failed += 1;

      logger.error("notification retry failed", {
        meetingId: meeting.id,
        error: message
      });
    } finally {
      await releaseMeeting(meeting.id);
    }
  }

  logger.info("notification retries finished", counts);

  return counts;
}

async function runOnce() {
  const startedAt = Date.now();

  const meetings = await fetchPendingMeetings();

  logger.info("run started", { pending: meetings.length, worker: config.workerId });

  const counts = {
    processed: 0,
    awaiting_transcript: 0,
    no_transcript: 0,
    no_conference: 0,
    error: 0,
    skipped: 0
  };

  for (const meeting of meetings) {
    const claimed = await claimMeeting(meeting.id);

    if (!claimed) {
      counts.skipped += 1;

      continue;
    }

    try {
      const outcome = await processMeeting(meeting);

      counts[outcome] += 1;
    } catch (error) {
      const message = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;

      counts.error += 1;

      logger.error("meeting failed", { meetingId: meeting.id, error: message });

      // Leave summary_checked_at NULL so the next run retries it.
      await releaseMeeting(meeting.id);
    }
  }

  const retries = await retryNotifications();

  logger.info("run finished", {
    ...counts,
    retried_notifications: retries.notified,
    retried_failures: retries.failed,
    ms: Date.now() - startedAt
  });

  return { ...counts, retries };
}

module.exports = { runOnce, processMeeting, retryNotifications };
