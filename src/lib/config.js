require("dotenv").config();

function required(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is missing`);
  }

  return value;
}

/**
 * A YYYY-MM-DD cut-off from the environment. Empty means no limit. A value that is
 * not a date becomes one no meeting reaches, so a typo switches the feature off
 * instead of opening it to old meetings.
 */
function cutoffDate(name) {
  const value = String(process.env[name] || "").trim();

  if (!value) {
    return "";
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "9999-12-31";
}

const config = {
  google: {
    serviceAccountBase64: required("GOOGLE_SERVICE_ACCOUNT_BASE64"),
    calendarEmail: required("CALENDAR_EMAIL")
  },

  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5"
  },

  supabase: {
    url: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY")
  },

  cron: {
    schedule: process.env.CRON_SCHEDULE || "0 * * * *",
    timezone: process.env.CRON_TIMEZONE || "UTC"
  },

  batchSize: Number(process.env.BATCH_SIZE || 25),
  claimTimeoutMinutes: Number(process.env.CLAIM_TIMEOUT_MINUTES || 30),

  // How long after a conference ends we keep re-checking for a transcript that
  // Drive has not published yet.
  transcriptGraceHours: Number(process.env.TRANSCRIPT_GRACE_HOURS || 24),

  // A recurring series shares one Meet link, so each meeting row is matched to
  // the conference in its own scheduled slot, widened by this many minutes on
  // each side to allow for calls that start late or run over.
  matchWindowMinutes: Number(process.env.MATCH_WINDOW_MINUTES || 45),

  // Zone that meetings.meeting_time (a bare `time`) should be read in.
  meetingTimezone:
    process.env.MEETING_TIMEZONE || process.env.CRON_TIMEZONE || "UTC",

  drive: {
    // reader | commenter
    role: process.env.DRIVE_SHARE_ROLE || "reader"
  },

  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || ""
  },

  mail: {
    // Off by default: turning this on starts sending real mail to real people.
    enabled: String(process.env.MAIL_ENABLED || "false") === "true",
    from: process.env.MAIL_FROM || "",
    replyTo: process.env.MAIL_REPLY_TO || ""
  },

  // Posting the recap to the meeting's WhatsApp group through Periskope. Off by
  // default for the same reason as mail: turning it on messages real groups.
  whatsapp: {
    enabled: String(process.env.WHATSAPP_ENABLED || "false") === "true",

    // Meetings dated before this are never posted to WhatsApp, so meetings already
    // in the queue when this goes live are left alone.
    fromDate: cutoffDate("WHATSAPP_FROM_DATE")
  },

  // The student's parent is CC'd (and shared the files) only on meetings dated on
  // or after this, so meetings already in the queue are emailed as they always were.
  parentCc: {
    fromDate: cutoffDate("PARENT_CC_FROM_DATE")
  },

  periskope: {
    apiKey: process.env.PERISKOPE_API_KEY || "",
    // Optional. For groups Periskope picks a connected phone that is in the group.
    phone: process.env.PERISKOPE_PHONE || "",
    baseUrl: (process.env.PERISKOPE_BASE_URL || "https://api.periskope.app/v1").replace(
      /\/+$/,
      ""
    ),
    // How long Periskope waits for WhatsApp to accept the message (1 to 60).
    syncTimeoutSeconds: Number(process.env.PERISKOPE_SYNC_TIMEOUT_SECONDS || 20),
    // Our own cut-off for the HTTP call, a little longer than the wait above.
    requestTimeoutMs: Number(
      process.env.PERISKOPE_REQUEST_TIMEOUT_MS ||
        (Number(process.env.PERISKOPE_SYNC_TIMEOUT_SECONDS || 20) + 10) * 1000
    )
  },

  // Hold the recap until Drive has published the recording. Meet writes the
  // recording well after the transcript, so this normally defers by a few runs.
  requireRecording: String(process.env.REQUIRE_RECORDING || "true") === "true",

  // A processed meeting whose recap never went out is retried for this long,
  // measured from when the summary was stored.
  notifyRetryHours: Number(process.env.NOTIFY_RETRY_HOURS || 24),
  notifyBatchSize: Number(process.env.NOTIFY_BATCH_SIZE || 25),

  // Logs what it would share and send, changes nothing outside the database.
  dryRun: String(process.env.DRY_RUN || "false") === "true",

  workspaceId: process.env.WORKSPACE_ID || null,
  meetingType: process.env.MEETING_TYPE || null,

  workerId: `${require("os").hostname()}:${process.pid}`
};

module.exports = { config };
