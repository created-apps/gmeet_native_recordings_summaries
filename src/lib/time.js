/**
 * meetings.meeting_time is `time without time zone`, so a meeting row only says
 * "10:30" -- it does not say 10:30 where. These helpers resolve a stored
 * date + time against a named IANA zone to a real instant, so scheduled slots
 * can be compared against the UTC timestamps Google returns.
 */

/**
 * How far the given instant's wall-clock reading in `timeZone` sits from UTC,
 * in milliseconds. DST-aware, because it asks Intl for that specific instant.
 */
function zoneOffsetMs(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const parts = {};

  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") {
      parts[part.type] = part.value;
    }
  }

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );

  return asUtc - date.getTime();
}

/**
 * "2026-09-30" + "10:30:00" in "Asia/Kolkata" -> the matching Date in UTC.
 */
function zonedDateTimeToUtc(dateStr, timeStr, timeZone) {
  const time = String(timeStr || "00:00:00").slice(0, 8);

  const naive = new Date(`${dateStr}T${time}Z`);

  if (Number.isNaN(naive.getTime())) {
    return null;
  }

  // Subtracting the offset at the naive instant is right except very near a DST
  // change, where the offset at the result differs -- so re-check and reapply.
  const firstPass = new Date(naive.getTime() - zoneOffsetMs(naive, timeZone));
  const refined = zoneOffsetMs(firstPass, timeZone);

  return new Date(naive.getTime() - refined);
}

module.exports = { zoneOffsetMs, zonedDateTimeToUtc };
