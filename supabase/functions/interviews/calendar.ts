// "Add to my calendar" helpers for human interviews: an .ics file and the Google and Outlook links.
// Pure functions with no Deno or network access, so they can be unit-tested in Node.
// The e-mail carries NO attachment (owner decision, 2026-11-19); these are used by the candidate's answer page.

export interface CalendarEvent {
  /** Stable id of the interview; it must not change when the interview is edited. */
  uid: string;
  /** Grows by one on every edit (RFC 5545 SEQUENCE). */
  sequence?: number;
  startsAt: Date;
  durationMinutes: number;
  title: string;
  description?: string;
  location?: string;
  /** The page of the interview (the candidate's answer page). */
  url?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 20261201T170000Z */
export function icsUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function endOf(ev: CalendarEvent): Date {
  return new Date(ev.startsAt.getTime() + ev.durationMinutes * 60_000);
}

/** RFC 5545 text escaping: backslash, semicolon, comma and line breaks. */
export function icsEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line to 75 octets, continuation lines start with one space. Never cuts inside a character. */
export function icsFold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = "";
      curBytes = 0;
      limit = 74; // the leading space counts
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** The .ics file. No METHOD line on purpose: it is a file to import, not an invitation to answer by e-mail. */
export function buildIcs(ev: CalendarEvent, now: Date = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nellio//Interview//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${ev.uid}@nellio.app`,
    `SEQUENCE:${ev.sequence ?? 0}`,
    `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${icsUtc(ev.startsAt)}`,
    `DTEND:${icsUtc(endOf(ev))}`,
    `SUMMARY:${icsEscape(ev.title)}`,
  ];
  if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
  if (ev.url) lines.push(`URL:${ev.url}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

/** Google Calendar "template" link (official URL format, no API and no sign-in on our side). */
export function googleCalendarUrl(ev: CalendarEvent): string {
  const p = new URLSearchParams({ action: "TEMPLATE", text: ev.title, dates: `${icsUtc(ev.startsAt)}/${icsUtc(endOf(ev))}` });
  const details = [ev.description, ev.url].filter(Boolean).join("\n\n");
  if (details) p.set("details", details);
  if (ev.location) p.set("location", ev.location);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/** Outlook on the web "compose event" deep link. */
export function outlookCalendarUrl(ev: CalendarEvent): string {
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const p = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: ev.title, startdt: iso(ev.startsAt), enddt: iso(endOf(ev)) });
  const body = [ev.description, ev.url].filter(Boolean).join("\n\n");
  if (body) p.set("body", body);
  if (ev.location) p.set("location", ev.location);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${p.toString()}`;
}
