// The recap email's look. Pure functions, no config or network, so the preview
// script can render it without any environment variables.

// Hosted in Supabase Storage (public bucket). Swap here if they ever move.
const ASSETS = {
  header:
    "https://mxynzemoflahdhgduplt.supabase.co/storage/v1/object/public/brochures/Thank_you.jpg"
};

const NO_HOMEWORK = "No homework was clearly assigned.";

// Dark-mode overrides. Apple Mail / iOS Mail / Outlook use the media query;
// Outlook.com and its apps mark elements with data-ogsb (background) and
// data-ogsc (text colour) instead, so the same rules are emitted for both.
// Gmail's phone apps ignore both and invert colours themselves.
function darkRules(bg, fg) {
  return [
    `${bg}.em-card{background-color:#26252b!important}`,
    `${fg}.em-text{color:#e8eaf6!important}`,
    `${bg}.em-banner{background-color:#2b3a6e!important}`,
    `${fg}.em-banner{color:#ffffff!important}`,
    `${bg}.em-btn{background-color:#8ab4f8!important}`,
    `${fg}.em-btn a{color:#0a1044!important}`,
    `${bg}.em-footer{background-color:#3a3200!important}`,
    `${fg}.em-footer{color:#f3efd8!important}`,
    `${fg}.em-arrow{color:#ffda1e!important}`
  ].join("");
}

const NAVY = "#0a1044";
const FONT = "Arial, Helvetica, sans-serif";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const VIEW_ACCESS_NOTE =
  "You have been given view access to these files with your Google account.";

const ADDRESS =
  "CreatED Wing A 501 Waterford, Cd Barfiwala Road, Zalawad Nagar, Juhu Lane, Vile Parle West Mumbai, Maharashtra 400058 India.";

function copyright() {
  return `Copyright (C) ${new Date().getFullYear()} CreatED. All rights reserved.`;
}

function introText(summary) {
  return `That was a genuinely useful session. ${
    summary || "No summary available."
  } Here is your recap, and what to do next.`;
}

/**
 * Homework arrives from Claude as a bullet list in a single string. Returns one
 * entry per line, bullets stripped. Returns [] when nothing was assigned (empty,
 * or Claude's own "No homework was clearly assigned." answer).
 */
function parseHomework(homework) {
  const items = String(homework || "")
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*[•\-*]\s*/, "").trim())
    .filter(Boolean);

  if (items.length === 1 && items[0].toLowerCase() === NO_HOMEWORK.toLowerCase()) {
    return [];
  }

  return items;
}

/**
 * Each homework line becomes one arrow + text row. When nothing was assigned a
 * plain line is shown instead, so there is never an arrow pointing at nothing.
 */
function renderHomework(homework) {
  const items = parseHomework(homework);

  if (items.length === 0) {
    return `<p class="em-text" style="margin:0 0 16px;text-align:left;color:${NAVY}">${NO_HOMEWORK}</p>`;
  }

  // The arrow is a text character (not an image) so its colour can follow the
  // light/dark theme.
  const rows = items
    .map(
      item => `<tr>
  <td class="em-arrow" aria-hidden="true" width="42" valign="top" style="width:42px;padding:0 0 16px;color:${NAVY};font-family:${FONT};font-size:24px;line-height:22px;text-align:left">&rarr;</td>
  <td class="em-text" valign="top" style="padding:0 0 16px;color:${NAVY};font-size:16px;line-height:1.4;text-align:left">${escapeHtml(item)}</td>
</tr>`
    )
    .join("\n");

  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
${rows}
</table>`;
}

/**
 * One pill button per link, numbered when there is more than one. Plain table
 * markup (no VML), so Outlook shows square corners but the button still works.
 */
function renderButtons(label, links) {
  return links
    .map((link, index) => {
      const text = `${label}${links.length > 1 ? ` ${index + 1}` : ""}`;

      return `<tr>
  <td align="center" style="padding:0 0 16px">
    <table role="presentation" width="266" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:266px">
      <tr>
        <td align="center" class="em-btn" bgcolor="#649cf4" style="background-color:#649cf4;border-radius:25px"><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener" style="display:block;padding:9px 8px;color:#ffffff;text-decoration:none;font-family:${FONT};font-size:16px;font-weight:700;line-height:22px">${escapeHtml(text)}</a></td>
      </tr>
    </table>
  </td>
</tr>`;
    })
    .join("\n");
}

/** The blue gradient heading bar. bgcolor is the fallback for clients without gradients. */
function banner(text) {
  return `<tr>
  <td style="padding:0 24px 16px">
    <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" bgcolor="#d6e8fd" class="em-banner ers-fs-240" style="background-color:#d6e8fd;border-radius:12px;padding:24px;color:${NAVY};font-size:24px;font-weight:700;line-height:1.4;text-align:center">${text}</td>
      </tr>
    </table>
  </td>
</tr>`;
}

function renderHtml({ title, summary, homework, transcriptDocs, recordings }) {
  // Transcript first, Recording directly below. A kind with no links renders
  // nothing, and with neither the whole block is dropped (no empty gap).
  const buttons = [
    renderButtons("OPEN TRANSCRIPT", transcriptDocs),
    renderButtons("WATCH RECORDING", recordings)
  ]
    .filter(Boolean)
    .join("\n");

  const buttonsRow = buttons
    ? `<tr>
          <td style="padding:0 24px">
            <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
              ${buttons}
            </table>
          </td>
        </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(title)}</title>
  <style>body{margin:0;padding:0}table{mso-table-lspace:0;mso-table-rspace:0}@media(max-width:550px){.ers-fs-240{font-size:20px!important}}@media (prefers-color-scheme: dark){${darkRules("", "")}}${darkRules("[data-ogsb] ", "[data-ogsc] ")}</style>
</head>
<body style="margin:0;padding:0;width:100%;-webkit-text-size-adjust:100%">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr>
    <td align="center">
      <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" class="em-card" style="width:100%;max-width:600px;border-collapse:separate;border-radius:16px;overflow:hidden;background-color:#ffffff;font-family:${FONT};color:${NAVY};font-size:16px;line-height:1.4">
        <tr>
          <td><img src="${ASSETS.header}" alt="CreatED: thanks for your time" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:16px 16px 0 0"></td>
        </tr>
        <tr><td style="height:24px;line-height:24px;font-size:0">&nbsp;</td></tr>
        ${banner("A QUICK RECAP")}
        <tr>
          <td class="em-text" style="padding:0 24px 16px;text-align:center;color:${NAVY};font-size:16px;line-height:1.4">${escapeHtml(introText(summary))}</td>
        </tr>
        ${banner("NEXT STEPS TO COVER")}
        <tr>
          <td style="padding:0 24px 16px;color:${NAVY};font-size:16px;line-height:1.4">
            ${renderHomework(homework)}
          </td>
        </tr>
        ${buttonsRow}
        <tr>
          <td align="center" class="em-footer" bgcolor="#ffe27a" style="background-color:#ffe27a;padding:32px 24px;border-radius:0 0 16px 16px;color:${NAVY};font-size:12px;line-height:1.6;text-align:center">
            ${VIEW_ACCESS_NOTE}<br><br>
            Our mailing address is:<br><a style="color:inherit;text-decoration:none;pointer-events:none">${ADDRESS}</a><br><br>
            <i>${copyright()}</i>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function buildEmail({ title, summary, homework, transcriptDocs, recordings }) {
  const html = renderHtml({ title, summary, homework, transcriptDocs, recordings });

  const items = parseHomework(homework);

  const textLines = [
    "A QUICK RECAP",
    "",
    introText(summary),
    "",
    "NEXT STEPS TO COVER",
    "",
    ...(items.length > 0 ? items.map(item => `- ${item}`) : [NO_HOMEWORK]),
    ""
  ];

  const linkLines = (label, links) =>
    links.map(
      (link, index) => `${label}${links.length > 1 ? ` ${index + 1}` : ""}: ${link.url}`
    );

  const links = [
    ...linkLines("Open transcript", transcriptDocs),
    ...linkLines("Watch recording", recordings)
  ];

  if (links.length > 0) {
    textLines.push(...links, "");
  }

  textLines.push(
    VIEW_ACCESS_NOTE,
    "",
    "Our mailing address is:",
    ADDRESS,
    "",
    copyright()
  );

  return { html, text: textLines.join("\n") };
}

module.exports = { buildEmail };
