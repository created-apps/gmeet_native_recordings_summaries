const { getDrive } = require("./meet");
const logger = require("./logger");
const { config } = require("./config");

/**
 * Give one person read access to one Drive file.
 *
 * sendNotificationEmail is false on purpose: recipients get our own SMTP mail
 * instead of a separate "X shared a file with you" from Drive.
 *
 * Re-granting an existing permission is a no-op that Drive accepts, so this is
 * safe to run again on a retry.
 */
async function shareFile(drive, fileId, email) {
  await drive.permissions.create({
    fileId,
    sendNotificationEmail: false,
    supportsAllDrives: true,
    requestBody: {
      type: "user",
      role: config.drive.role,
      emailAddress: email
    }
  });
}

/**
 * Share every file with every recipient, best effort. One failure (a file
 * deleted, an address outside a domain the sharing policy allows) must not stop
 * the others, so failures are collected and returned rather than thrown.
 */
async function shareFiles(fileIds, emails) {
  const shared = [];
  const failures = [];

  if (fileIds.length === 0 || emails.length === 0) {
    return { shared, failures };
  }

  // Only authenticate when we are actually going to write something.
  const drive = config.dryRun ? null : await getDrive();

  for (const fileId of fileIds) {
    for (const email of emails) {
      if (config.dryRun) {
        logger.info("dry run: would share file", { fileId, email });

        shared.push({ fileId, email });

        continue;
      }

      try {
        await shareFile(drive, fileId, email);

        shared.push({ fileId, email });
      } catch (error) {
        const message = error.response?.data?.error?.message || error.message;

        failures.push({ fileId, email, error: message });

        logger.warn("failed to share file", { fileId, email, error: message });
      }
    }
  }

  return { shared, failures };
}

module.exports = { shareFiles };
