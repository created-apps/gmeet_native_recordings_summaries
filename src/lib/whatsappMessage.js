// The recap as a WhatsApp message. Pure function, no config or network, so it can
// be printed and tested without any environment variables. Posted inside the
// meeting's own group, so the group name is deliberately not repeated.
const { parseHomework, NO_HOMEWORK } = require("./emailTemplate");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-06" -> "6 Oct 2026"; anything else -> null. */
function formatDate(meetingDate) {
  const match = String(meetingDate ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match || !MONTHS[Number(match[2]) - 1]) {
    return null;
  }

  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

function linkLines(label, links) {
  return links.map(
    (link, index) => `${label}${links.length > 1 ? ` ${index + 1}` : ""}: ${link.url}`
  );
}

function buildWhatsappMessage({ meetingDate, summary, homework, transcriptDocs, recordings }) {
  const date = formatDate(meetingDate);
  const items = parseHomework(homework);

  const lines = [
    date ? `*Session recap — ${date}*` : "*Session recap*",
    "",
    "*Quick recap*",
    summary || "No summary available.",
    "",
    "*Next steps*",
    ...(items.length > 0 ? items.map(item => `• ${item}`) : [NO_HOMEWORK])
  ];

  const links = [
    ...linkLines("Transcript", transcriptDocs || []),
    ...linkLines("Recording", recordings || [])
  ];

  if (links.length > 0) {
    lines.push("", ...links);
  }

  return lines.join("\n");
}

module.exports = { buildWhatsappMessage };
