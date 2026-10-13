const nodemailer = require("nodemailer");
const { config } = require("./config");
const logger = require("./logger");
const { buildEmail } = require("./emailTemplate");

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
