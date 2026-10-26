const { config } = require("./config");
const logger = require("./logger");

const GROUP_ID = /@g\.us$/;

/**
 * Which WhatsApp chat a meeting's recap goes to: its own group, whatever the
 * group's size. `final` says whether trying again can help. A meeting with no
 * group, or a group with no usable group_jid, is a data problem that will not fix
 * itself; a group that could not be read may just be a database blip (fetchGroup
 * logs the error and returns null), so that case stays retryable.
 *
 *   { chatId }
 *   { skip: "reason", final: true | false }
 */
function resolveGroupChat(groupId, group) {
  if (!groupId) {
    return { skip: "meeting has no group", final: true };
  }

  if (!group) {
    return { skip: "group could not be read", final: false };
  }

  const jid = String(group.group_jid ?? "").trim();

  if (!jid) {
    return { skip: "group has no group_jid", final: true };
  }

  if (!GROUP_ID.test(jid)) {
    return { skip: "group_jid is not a WhatsApp group id", final: true };
  }

  return { chatId: jid };
}

function clip(value, length = 200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, length);
}

/**
 * Post one text message to a WhatsApp group through Periskope's send-sync
 * endpoint, which waits for WhatsApp to accept or reject it. Never throws: the
 * caller records the outcome, and a failed post must not touch the email.
 *
 *   { sent: true,  status: "sent" | "queued", uniqueId }
 *   { sent: false, reason, ambiguous? }
 *
 * "queued" means Periskope took the message but WhatsApp had not answered inside
 * the wait; it is treated as sent so a retry cannot double-post. `ambiguous` is
 * set when our own timeout fired, i.e. the message may or may not have gone out.
 * Anything that is not a group id (@g.us) is refused, so a phone number can never
 * be messaged by mistake.
 */
async function sendGroupMessage({ chatId, message }) {
  if (!config.whatsapp.enabled || config.dryRun) {
    if (config.dryRun) {
      logger.info("dry run: would post to WhatsApp group", { chatId, text: message });
    } else {
      logger.info("whatsapp disabled, not posting", { chatId });
    }

    return { sent: false, reason: "whatsapp disabled" };
  }

  if (!GROUP_ID.test(String(chatId ?? ""))) {
    return { sent: false, reason: "not a WhatsApp group id" };
  }

  if (!config.periskope.apiKey) {
    return { sent: false, reason: "PERISKOPE_API_KEY is missing" };
  }

  const headers = {
    Authorization: `Bearer ${config.periskope.apiKey}`,
    "Content-Type": "application/json"
  };

  if (config.periskope.phone) {
    headers["x-phone"] = config.periskope.phone;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.periskope.requestTimeoutMs);

  try {
    const response = await fetch(`${config.periskope.baseUrl}/message/send-sync`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        chat_id: chatId,
        message,
        sync_timeout: config.periskope.syncTimeoutSeconds
      }),
      signal: controller.signal
    });

    const text = await response.text();

    let body = null;

    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON; the clipped text is used in the reason below.
    }

    if (response.ok) {
      if (body && (body.status === "sent" || body.status === "queued")) {
        return {
          sent: true,
          status: body.status,
          uniqueId: body.unique_id ?? body.message?.unique_id ?? null
        };
      }

      return { sent: false, reason: `unexpected Periskope response: ${clip(text)}` };
    }

    return {
      sent: false,
      reason: `Periskope ${response.status}: ${clip(body?.message ?? body?.error ?? text)}`
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { sent: false, ambiguous: true, reason: "Periskope request timed out" };
    }

    return { sent: false, reason: clip(error.cause?.code || error.message) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendGroupMessage, resolveGroupChat };
