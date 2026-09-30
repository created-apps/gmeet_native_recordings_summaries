require("dotenv").config();

function required(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is missing`);
  }

  return value;
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
