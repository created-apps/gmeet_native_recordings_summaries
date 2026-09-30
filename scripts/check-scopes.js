/**
 * Diagnostic: which delegated scopes does the service account actually hold?
 *
 * Domain-wide delegation is configured in the Workspace admin console, not in
 * this repo, so a missing scope only shows up as a 401 at runtime. This asks
 * Google directly for each scope and reports what it gets.
 *
 *   node scripts/check-scopes.js
 */

require("dotenv").config({ quiet: true });

const { google } = require("googleapis");

const REQUIRED = {
  "meetings.space.readonly": {
    scope: "https://www.googleapis.com/auth/meetings.space.readonly",
    used_for: "listing conference records, recordings and transcripts"
  },
  drive: {
    scope: "https://www.googleapis.com/auth/drive",
    used_for: "exporting transcript docs AND granting read access to files"
  }
};

async function main() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_BASE64 || !process.env.CALENDAR_EMAIL) {
    console.error("GOOGLE_SERVICE_ACCOUNT_BASE64 and CALENDAR_EMAIL must be set");

    process.exit(1);
  }

  const serviceAccount = JSON.parse(
    Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8")
  );

  console.log(`client_id : ${serviceAccount.client_id}`);
  console.log(`subject   : ${process.env.CALENDAR_EMAIL}\n`);

  let missing = 0;

  for (const [name, { scope, used_for }] of Object.entries(REQUIRED)) {
    const auth = new google.auth.JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: [scope],
      subject: process.env.CALENDAR_EMAIL
    });

    try {
      await auth.authorize();

      console.log(`  ok      ${name}  (${used_for})`);
    } catch {
      missing += 1;

      console.log(`  MISSING ${name}  (${used_for})`);
      console.log(`          add: ${scope}`);
    }
  }

  if (missing > 0) {
    console.log(
      `\n${missing} scope(s) missing. Add them to client_id ${serviceAccount.client_id} under` +
        "\nAdmin console > Security > Access and data control > API controls >" +
        "\nDomain-wide delegation. Paste the FULL list of scopes: editing an entry" +
        "\nreplaces it rather than appending."
    );

    process.exit(1);
  }

  console.log("\nAll required scopes are granted.");
}

main().catch(error => {
  console.error(error.message);

  process.exit(1);
});
