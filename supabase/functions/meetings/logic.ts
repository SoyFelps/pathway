// Pure rules of the meeting rooms (no Deno, no network), so they can be tested in Node.

/** The room opens this many minutes before the interview and closes this many hours after it starts (owner decisions, 2026-11-21). */
export const OPEN_BEFORE_MINUTES = 30;
export const CLOSE_AFTER_HOURS = 24;
export const MAX_PEOPLE = 4;

export type RoomStatus = "open" | "early" | "closed" | "cancelled" | "unscheduled";

export function roomWindow(startsAt: Date): { opensAt: Date; closesAt: Date } {
  return {
    opensAt: new Date(startsAt.getTime() - OPEN_BEFORE_MINUTES * 60_000),
    closesAt: new Date(startsAt.getTime() + CLOSE_AFTER_HOURS * 3600_000),
  };
}

/** Whether the room can be entered now. A cancelled interview closes it; one with no date yet is not open. */
export function roomStatus(state: string, startsAt: string | null, now: Date = new Date()): RoomStatus {
  if (state === "cancelled") return "cancelled";
  if (!startsAt || state === "awaiting_schedule") return "unscheduled";
  const { opensAt, closesAt } = roomWindow(new Date(startsAt));
  if (now < opensAt) return "early";
  if (now > closesAt) return "closed";
  return "open";
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A new secret for a room link: 32 random bytes (43 characters). Only its hash is stored. */
export function newSecret(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The Realtime channel of a room: random and unrelated to the secret, so the secret never travels through Realtime. */
export function newChannelKey(): string {
  return [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function looksLikeSecret(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

