// Renders the recap email from fake data into preview/mail.html and
// preview/mail.txt. Needs no .env, and never touches Supabase, Google or SMTP.
//
//   npm run preview-mail
//   npm run preview-mail -- --scenario=many-homework

const fs = require("fs");
const path = require("path");
const { buildEmail, buildSubject } = require("../src/lib/emailTemplate");

const SUMMARY =
  "The class focused on understanding four metrics (MAE, RMSE, R², and MAPE) used to measure how well machine learning models work, and then trained a Random Forest model that performed better than the previous Linear Regression model.";

const HOMEWORK = [
  "• Review and understand the four metrics (MAE, RMSE, R², and MAPE) before the next class.",
  "• Experiment with changing the n_estimators and max_depth settings in the Random Forest model to find which numbers give the best results before the next class.",
  "• Research whether increasing the number of trees in a Random Forest model always leads to better performance before the next class."
];

const transcript = n => ({ url: `https://docs.google.com/document/d/sample-${n}/edit` });
const recording = n => ({ url: `https://drive.google.com/file/d/sample-${n}/view` });

const scenarios = {
  full: {
    title: "Mentor session — 2026-10-06",
    summary: SUMMARY,
    homework: HOMEWORK.join("\n"),
    transcriptDocs: [transcript(1)],
    recordings: [recording(1)]
  },
  "no-homework": {
    title: "Mentor session — 2026-10-06",
    summary: SUMMARY,
    homework: "No homework was clearly assigned.",
    transcriptDocs: [transcript(1)],
    recordings: [recording(1)]
  },
  "many-homework": {
    title: "Mentor session — 2026-10-06",
    summary: SUMMARY,
    homework: [...HOMEWORK, ...HOMEWORK].join("\n"),
    transcriptDocs: [transcript(1)],
    recordings: [recording(1)]
  },
  "no-recording": {
    title: "Mentor session — 2026-10-06",
    summary: SUMMARY,
    homework: HOMEWORK.join("\n"),
    transcriptDocs: [transcript(1)],
    recordings: []
  },
  "multi-links": {
    title: "Mentor session — 2026-10-06",
    summary: SUMMARY,
    homework: HOMEWORK.join("\n"),
    transcriptDocs: [transcript(1), transcript(2)],
    recordings: [recording(1), recording(2)]
  },
  "with-group": {
    title: "Data Science Batch — 2026-10-06",
    summary: SUMMARY,
    homework: HOMEWORK.join("\n"),
    transcriptDocs: [transcript(1)],
    recordings: [recording(1)]
  },
  "special-chars": {
    title: "Mentor <session> & recap — 2026-10-06",
    summary: 'We covered <b>bold</b> tags, "quotes" & ampersands in one sentence.',
    homework: "• Read <script>alert(1)</script> & report back.\n• Try x < y && y > z.",
    transcriptDocs: [transcript(1)],
    recordings: [recording(1)]
  }
};

const arg = process.argv.find(a => a.startsWith("--scenario="));
const name = arg ? arg.split("=")[1] : "full";

if (!scenarios[name]) {
  console.error(`Unknown scenario "${name}". Choose one of: ${Object.keys(scenarios).join(", ")}`);

  process.exit(1);
}

const body = buildEmail(scenarios[name]);
const outDir = path.join(__dirname, "..", "preview");

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "mail.html"), body.html);
fs.writeFileSync(path.join(outDir, "mail.txt"), body.text);

console.log(`Scenario "${name}" written to:`);
console.log(`  ${path.join(outDir, "mail.html")}`);
console.log(`  ${path.join(outDir, "mail.txt")}`);
console.log(`Subject: ${buildSubject(scenarios[name].title)}`);

const real = process.argv.includes("--real");

if (process.argv.includes("--send") || real) {
  send(buildSubject(scenarios[name].title), body).catch(error => {
    console.error(`Send failed: ${error.message}`);

    process.exit(1);
  });
}

/**
 * Sends through the real sendSummaryEmail() path.
 *
 *   --send                          to a local mail catcher (Mailpit) only
 *   --real --to=you@example.com     through the SMTP settings in .env, to that
 *                                   ONE address, for checking Gmail/Outlook
 *
 * The environment is set here, before config.js loads, and dotenv never
 * overrides a variable that is already set. Supabase, Google and Anthropic are
 * always replaced by placeholders, so nothing but the mail settings can be used.
 */
async function send(subject, mailBody) {
  const placeholders = {
    MAIL_ENABLED: "true",
    DRY_RUN: "false",
    GOOGLE_SERVICE_ACCOUNT_BASE64: "preview",
    CALENDAR_EMAIL: "preview@localhost",
    ANTHROPIC_API_KEY: "preview",
    SUPABASE_URL: "http://localhost",
    SUPABASE_SERVICE_ROLE_KEY: "preview"
  };

  let recipient = "preview@localhost";
  let subjectLine = subject;

  if (real) {
    const toArg = process.argv.find(a => a.startsWith("--to="));
    recipient = toArg ? toArg.split("=")[1].trim() : "";

    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(recipient)) {
      throw new Error("--real needs exactly one address, e.g. --to=you@example.com");
    }

    subjectLine = `[PREVIEW] ${subject}`;

    Object.assign(process.env, placeholders);
  } else {
    const portArg = process.argv.find(a => a.startsWith("--port="));

    Object.assign(process.env, placeholders, {
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: portArg ? portArg.split("=")[1] : "1025",
      SMTP_SECURE: "false",
      SMTP_USER: "",
      SMTP_PASS: "",
      MAIL_FROM: "CreatED Preview <preview@localhost>",
      MAIL_REPLY_TO: ""
    });
  }

  const { config } = require("../src/lib/config");

  if (real && !config.smtp.host) {
    throw new Error("SMTP_HOST is empty in .env, so there is nothing to send through");
  }

  const { sendSummaryEmail } = require("../src/lib/mailer");

  const result = await sendSummaryEmail({
    to: [recipient],
    subject: subjectLine,
    body: mailBody
  });

  if (!result.sent) {
    throw new Error(result.reason || "not sent");
  }

  console.log(
    real
      ? `Sent to ${recipient} via ${config.smtp.host}`
      : `Sent to the local catcher on 127.0.0.1:${config.smtp.port} (inbox: http://localhost:8025)`
  );
}
