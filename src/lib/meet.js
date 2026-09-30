const { google } = require("googleapis");
const { config } = require("./config");
const logger = require("./logger");

// drive (not drive.readonly) is required: granting permissions is a write.
// This scope must also be added to the service account's domain-wide delegation
// entry in the Workspace admin console, or every call 401s.
const SCOPES = [
  "https://www.googleapis.com/auth/meetings.space.readonly",
  "https://www.googleapis.com/auth/drive"
];

let authPromise = null;

function getMeetCode(url) {
  const trimmed = String(url || "").trim();

  const match = trimmed.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);

  if (match) {
    return match[1];
  }

  if (/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(trimmed)) {
    return trimmed;
  }

  throw new Error(`Invalid Google Meet URL: ${url}`);
}

async function getDrive() {
  const auth = await getGoogleAuth();

  return google.drive({ version: "v3", auth });
}

async function getGoogleAuth() {
  if (!authPromise) {
    const serviceAccount = JSON.parse(
      Buffer.from(config.google.serviceAccountBase64, "base64").toString("utf8")
    );

    const auth = new google.auth.JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: SCOPES,
      subject: config.google.calendarEmail
    });

    authPromise = auth.authorize().then(() => auth);
  }

  return authPromise;
}

function extractTranscriptText(text) {
  const startMarker = "📖 Transcript";
  const endMarker = "Transcription ended after";

  const startIndex = text.indexOf(startMarker);
  const endIndex = text.indexOf(endMarker, startIndex === -1 ? 0 : startIndex);

  let body = text;

  if (startIndex !== -1) {
    body = text.slice(startIndex + startMarker.length, endIndex === -1 ? undefined : endIndex);
  }

  const transcript = body
    .replace(/^\s*\d{1,2} \w{3}, \d{4}\s*$/gm, "")
    .replace(/^\s*Meeting .*? - Transcript\s*$/gm, "")
    .replace(/^\s*\d{2}:\d{2}:\d{2}\s*$/gm, "")
    .replace(/\r?\n{3,}/g, "\n\n")
    .trim();

  return transcript || null;
}

async function exportTranscript(drive, documentId) {
  try {
    const response = await drive.files.export({
      fileId: documentId,
      mimeType: "text/plain"
    });

    return extractTranscriptText(String(response.data || ""));
  } catch (error) {
    logger.warn("transcript export failed", {
      documentId,
      error: error.response?.data || error.message
    });

    return null;
  }
}

function emptyArtifacts(meetingCode) {
  return {
    meetingCode,
    conferences: [],
    startedAt: null,
    finishedAt: null,
    transcriptDocs: [],
    recordings: [],
    transcript: null
  };
}

function overlapsWindow(conference, window) {
  if (!window) {
    return true;
  }

  const start = conference.startTime ? new Date(conference.startTime).getTime() : null;

  if (start === null) {
    return false;
  }

  const end = conference.endTime ? new Date(conference.endTime).getTime() : start;

  return start < window.end && end > window.start;
}

/**
 * Collapse the conferences held on a Meet link into one record: the earliest
 * start, the latest end, and all transcript text concatenated in order.
 *
 * A recurring calendar event reuses ONE Meet link for every occurrence, so
 * filtering by meeting code alone returns every session the series ever had.
 * `window` narrows that to the occurrence being processed; several conferences
 * may still match when a single call dropped and reconnected, and those are
 * correctly merged.
 */
async function getMeetingArtifacts(meetUrl, window) {
  const meetingCode = getMeetCode(meetUrl);

  const auth = await getGoogleAuth();
  const meet = google.meet({ version: "v2", auth });
  const drive = google.drive({ version: "v3", auth });

  const conferenceResponse = await meet.conferenceRecords.list({
    filter: `space.meeting_code="${meetingCode}"`,
    pageSize: 100
  });

  const conferences = conferenceResponse.data.conferenceRecords || [];

  if (conferences.length === 0) {
    return emptyArtifacts(meetingCode);
  }

  const matched = conferences.filter(conference => overlapsWindow(conference, window));

  if (matched.length === 0) {
    return emptyArtifacts(meetingCode);
  }

  const sorted = matched.sort(
    (a, b) => new Date(a.startTime || 0) - new Date(b.startTime || 0)
  );

  const chunks = [];
  const collected = [];
  const transcriptDocs = [];
  const recordings = [];

  for (const conference of sorted) {
    const parent = conference.name;

    const [transcriptsResponse, recordingsResponse] = await Promise.all([
      meet.conferenceRecords.transcripts.list({ parent, pageSize: 100 }),
      meet.conferenceRecords.recordings.list({ parent, pageSize: 100 })
    ]);

    for (const recording of recordingsResponse.data.recordings || []) {
      const fileId = recording.driveDestination?.file;

      if (!fileId) {
        continue;
      }

      recordings.push({
        fileId,
        url:
          recording.driveDestination?.exportUri ||
          `https://drive.google.com/file/d/${fileId}/view`
      });
    }

    const transcripts = transcriptsResponse.data.transcripts || [];

    for (const transcript of transcripts) {
      const documentId = transcript.docsDestination?.document;

      if (transcript.state !== "FILE_GENERATED" || !documentId) {
        continue;
      }

      transcriptDocs.push({
        fileId: documentId,
        url:
          transcript.docsDestination?.exportUri ||
          `https://docs.google.com/document/d/${documentId}/edit`
      });

      const text = await exportTranscript(drive, documentId);

      if (text) {
        chunks.push(text);
      }
    }

    collected.push({
      conferenceRecord: parent,
      startTime: conference.startTime || null,
      endTime: conference.endTime || null
    });
  }

  const startedAt = sorted[0].startTime || null;
  const finishedAt = sorted[sorted.length - 1].endTime || null;

  return {
    meetingCode,
    conferences: collected,
    startedAt,
    finishedAt,
    transcriptDocs,
    recordings,
    transcript: chunks.length > 0 ? chunks.join("\n\n") : null
  };
}

module.exports = { getMeetCode, getMeetingArtifacts, extractTranscriptText, getDrive };
