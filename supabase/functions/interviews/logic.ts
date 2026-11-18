// Pure rules of the interview function (no Deno, no network): input checks, the secret of the answer page and the candidate's answers.
// The time windows (not in the past, at most 6 months ahead, suggestions up to 30 days after the interview) are enforced by the
// database (trigger candidate_interview_check_times) and its messages are passed on; this file only checks the shape of the input.

import { multiLine, singleLine } from "./email.ts";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const LOCAL_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** The states in which an interview is on and the candidate can still answer. */
export const OPEN_STATES = ["invited", "confirmed", "declined", "reschedule_requested"] as const;

export interface ScheduleInput {
  kind: "online" | "in_person";
  localStart: string;
  timeZone: string;
  durationMinutes: number;
  meetingLink: string | null;
  address: string | null;
  notes: string | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Checks and cleans what the recruiter typed in the "Schedule interview" modal. */
export function parseScheduleInput(body: Record<string, unknown>): Parsed<ScheduleInput> {
  const kind = body.kind === "online" || body.kind === "in_person" ? body.kind : null;
  if (!kind) return { ok: false, error: "Choose online or in person." };
  const localStart = typeof body.localStart === "string" ? body.localStart.trim() : "";
  if (!LOCAL_TIME_RE.test(localStart) || Number.isNaN(Date.parse(localStart + ":00Z"))) return { ok: false, error: "Choose a valid day and time." };
  const timeZone = singleLine(body.timeZone, 64);
  if (!timeZone) return { ok: false, error: "Choose the time zone." };
  const duration = Number(body.durationMinutes);
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) return { ok: false, error: "The duration must be between 5 minutes and 8 hours." };
  const notes = multiLine(body.notes, 1000) || null;
  if (kind === "online") {
    const link = singleLine(body.meetingLink, 500);
    if (!/^https?:\/\/\S+$/i.test(link)) return { ok: false, error: "Enter a meeting link that starts with http:// or https://." };
    return { ok: true, value: { kind, localStart, timeZone, durationMinutes: duration, meetingLink: link, address: null, notes } };
  }
  const address = singleLine(body.address, 300);
  if (address.length < 3) return { ok: false, error: "Enter the address of the interview." };
  return { ok: true, value: { kind, localStart, timeZone, durationMinutes: duration, meetingLink: null, address, notes } };
}

export type Answer = { response: "confirm" } | { response: "decline"; note: string | null } | { response: "reschedule"; note: string | null; times: string[] };

/** Checks what the candidate sent on the answer page. */
export function parseAnswer(body: Record<string, unknown>): Parsed<Answer> {
  const note = multiLine(body.note, 1000) || null;
  if (body.response === "confirm") return { ok: true, value: { response: "confirm" } };
  if (body.response === "decline") return { ok: true, value: { response: "decline", note } };
  if (body.response === "reschedule") {
    const raw = Array.isArray(body.proposedTimes) ? body.proposedTimes : [];
    if (raw.length > 3) return { ok: false, error: "You can suggest up to 3 times." };
    const times: string[] = [];
    for (const item of raw) {
      const local = typeof item === "string" ? item : (item && typeof item === "object" ? String((item as Record<string, unknown>).local ?? "") : "");
      if (!LOCAL_TIME_RE.test(local.trim())) return { ok: false, error: "Each suggested time must look like 2026-12-03T14:00." };
      if (!times.includes(local.trim())) times.push(local.trim());
    }
    if (!times.length && !note) return { ok: false, error: "Suggest at least one time or write a message." };
    return { ok: true, value: { response: "reschedule", note, times } };
  }
  return { ok: false, error: "Choose one of the answers." };
}

/** The state the interview takes after the candidate's answer. */
export function stateAfter(answer: Answer): "confirmed" | "declined" | "reschedule_requested" {
  return answer.response === "confirm" ? "confirmed" : answer.response === "decline" ? "declined" : "reschedule_requested";
}

/** Confirming an interview that is already confirmed changes nothing (no second notice to the recruiter). */
export function isRepeat(state: string, answer: Answer): boolean {
  return answer.response === "confirm" && state === "confirmed";
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A new secret for an answer-page link: 32 random bytes. Only its hash is stored. */
export function newToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 of the secret, in hex (64 characters), as stored in candidate_interview_tokens.token_hash. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A token is 43 characters of base64url; anything else is refused before it reaches the database. */
export function looksLikeToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** Title of the calendar event, in the job language. */
export function eventTitle(language: "en" | "pt" | "es", job: string, company: string): string {
  const prefix = language === "pt" ? "Entrevista" : language === "es" ? "Entrevista" : "Interview";
  return `${prefix}: ${job} – ${company}`;
}
