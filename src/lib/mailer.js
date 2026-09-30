const nodemailer = require("nodemailer");
const { config } = require("./config");
const logger = require("./logger");

let transport = null;

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth:
        config.smtp.user && config.smtp.pass
          ? { user: config.smtp.user, pass: config.smtp.pass }
          : undefined
    });
  }

  return transport;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Homework arrives from Claude as a bullet list in a single string. Render it as
 * real list items when it looks like one, otherwise as a paragraph.
 */
function renderHomework(homework) {
  if (!homework) {
    return "<p>No homework was clearly assigned.</p>";
  }

  const items = String(homework)
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*[•\-*]\s*/, "").trim())
    .filter(Boolean);

  if (items.length === 0) {
    return "<p>No homework was clearly assigned.</p>";
  }

  if (items.length === 1) {
    return `<p>${escapeHtml(items[0])}</p>`;
  }

  return `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderLinks(label, links) {
  if (links.length === 0) {
    return "";
  }

  const rows = links
    .map(
      (link, index) =>
        `<li><a href="${escapeHtml(link.url)}">${escapeHtml(label)}${
          links.length > 1 ? ` ${index + 1}` : ""
        }</a></li>`
    )
    .join("");

  return `<ul>${rows}</ul>`;
}

function buildEmail({ title, summary, homework, transcriptDocs, recordings }) {
  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 15px; line-height: 1.55; color: #16191d;">
    <h2 style="margin: 0 0 4px;">${escapeHtml(title)}</h2>
    <p style="color: #6b7280; margin: 0 0 24px;">Here is a recap of your session.</p>

    <h3 style="margin: 0 0 6px;">Summary</h3>
    <p style="margin: 0 0 24px;">${escapeHtml(summary || "No summary available.")}</p>

    <h3 style="margin: 0 0 6px;">Homework</h3>
    <div style="margin: 0 0 24px;">${renderHomework(homework)}</div>

    ${
      transcriptDocs.length > 0
        ? `<h3 style="margin: 0 0 6px;">Transcript</h3>${renderLinks("Open transcript", transcriptDocs)}`
        : ""
    }

    ${
      recordings.length > 0
        ? `<h3 style="margin: 16px 0 6px;">Recording</h3>${renderLinks("Watch recording", recordings)}`
        : ""
    }

    <p style="color: #6b7280; font-size: 13px; margin-top: 28px;">
      You have been given view access to these files with your Google account.
    </p>
  </body>
</html>`;

  const textLines = [
    title,
    "",
    "Summary",
    summary || "No summary available.",
    "",
    "Homework",
    homework || "No homework was clearly assigned.",
    ""
  ];

  for (const doc of transcriptDocs) {
    textLines.push(`Transcript: ${doc.url}`);
  }

  for (const recording of recordings) {
    textLines.push(`Recording: ${recording.url}`);
  }

  return { html, text: textLines.join("\n") };
}

async function sendSummaryEmail({ to, subject, body }) {
  if (to.length === 0) {
    return { sent: false, reason: "no recipients" };
  }

  if (!config.mail.enabled || config.dryRun) {
    logger.info("mail disabled, not sending", { to, subject });

    return { sent: false, reason: "mail disabled" };
  }

  const info = await getTransport().sendMail({
    from: config.mail.from,
    to: to.join(", "),
    replyTo: config.mail.replyTo || undefined,
    subject,
    text: body.text,
    html: body.html
  });

  return { sent: true, messageId: info.messageId };
}

module.exports = { buildEmail, sendSummaryEmail };
