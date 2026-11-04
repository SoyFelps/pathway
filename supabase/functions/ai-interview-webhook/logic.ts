// Pure rules of the AI-interview integration (what may be sent, retries, how Witcher's notices change a row, signature check).
// This file is copied into each AI-interview function folder; tests/ai_interview_functions.test.js checks the copies are
// identical. No Deno or network access: tested in Node.

export const TICK_BATCH = 10;
export const DELETE_BATCH = 20;
export const LEASE_SECONDS = 120; // while one run works on a row, no other run takes it
export const MAX_SEND_ATTEMPTS = 6;
export const BLOCKED_RECHECK_SECONDS = 60;
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const SEND_RETRY_SECONDS = [30, 60, 120, 300, 600];

/** Seconds to wait before trying to send again after `attempts` failures; null when it is time to give up (state `failed`). */
export function sendRetryDelaySeconds(attempts: number): number | null {
  if (attempts >= MAX_SEND_ATTEMPTS) return null;
  return SEND_RETRY_SECONDS[Math.min(Math.max(attempts, 1) - 1, SEND_RETRY_SECONDS.length - 1)];
}

/** Erasing an interview in Witcher is never given up (privacy), but the wait grows to at most one hour. */
export function deletionRetryDelaySeconds(attempts: number): number {
  return Math.min(3600, 60 * 2 ** Math.min(Math.max(attempts, 1) - 1, 6));
}

export type BlockReason = "no_questions" | "no_plan" | "no_company_name" | "no_language";

/** The languages an AI interview can be held in (Witcher supports exactly these). */
export const INTERVIEW_LANGUAGES = ["en", "pt", "es"] as const;
export type InterviewLanguage = typeof INTERVIEW_LANGUAGES[number];
export const isInterviewLanguage = (value: unknown): value is InterviewLanguage => (INTERVIEW_LANGUAGES as readonly string[]).includes(String(value));
export type SendVerdict = { ok: true } | { ok: false; action: "drop" } | { ok: false; action: "block"; reason: BlockReason };

/**
 * Whether a waiting interview may be created now. The card must still be in the AI Interview column (otherwise the row is
 * dropped), the job needs its questions, the workspace needs an active Premium plan, and the job needs a language (the one of the job
 * description, detected or chosen in the job editor): nothing is sent in a language nobody decided.
 */
export function checkSendable(input: { questions: unknown; premium: boolean; stillInColumn: boolean; companyName: string; language: unknown }): SendVerdict {
  if (!input.stillInColumn) return { ok: false, action: "drop" };
  const questions = cleanQuestions(input.questions);
  if (questions.length === 0) return { ok: false, action: "block", reason: "no_questions" };
  if (!input.premium) return { ok: false, action: "block", reason: "no_plan" };
  if (!input.companyName.trim()) return { ok: false, action: "block", reason: "no_company_name" };
  if (!isInterviewLanguage(input.language)) return { ok: false, action: "block", reason: "no_language" };
  return { ok: true };
}

/** The job's questions as plain strings (same limits as the database check). */
export function cleanQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim().slice(0, 500))
    .filter((item) => item.length >= 3)
    .slice(0, 5);
}

export interface CreateInput {
  id: string; // the ai_interviews id: also the externalId, so a retried call never creates a second interview
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  companyName: string;
  logoUrl: string | null;
  color?: string | null; // the company's primary colour (#rrggbb); Witcher paints the interview page and e-mail with it
  questions: unknown;
  language: InterviewLanguage; // the language of the job description: Witcher talks, expects the answers and writes in it
}

export function buildCreateBody(input: CreateInput): Record<string, unknown> {
  return {
    externalId: input.id,
    candidate: { name: input.candidateName, email: input.candidateEmail },
    jobTitle: input.jobTitle,
    company: {
      name: input.companyName,
      ...(input.logoUrl ? { logoUrl: input.logoUrl } : {}),
      ...(/^#[0-9a-fA-F]{6}$/.test(input.color || "") ? { color: String(input.color).toLowerCase() } : {}),
    },
    questions: cleanQuestions(input.questions),
    language: input.language,
  };
}

/** Public address of a company logo (the bucket is public); null when the company has none. */
export function companyLogoUrl(projectUrl: string, logoPath: string | null | undefined): string | null {
  if (!logoPath || !projectUrl) return null;
  const encoded = logoPath.split("/").map(encodeURIComponent).join("/");
  return `${projectUrl.replace(/\/$/, "")}/storage/v1/object/public/company-logos/${encoded}`;
}

export type InterviewState = "pending" | "blocked" | "invited" | "in_progress" | "completed" | "cancelled" | "abandoned" | "expired" | "failed";

/** Witcher's status word as the state kept here (`created` means its first e-mail did not leave yet: still ours to retry). */
export function stateFromWitcher(status: unknown): InterviewState | null {
  switch (status) {
    case "created": return "pending";
    case "invited": return "invited";
    case "in_progress": return "in_progress";
    case "completed": return "completed";
    case "cancelled": return "cancelled";
    case "abandoned": return "abandoned";
    case "expired": return "expired";
    default: return null;
  }
}

const ADVANCE_FROM: Record<string, InterviewState[]> = {
  completed: ["pending", "invited", "in_progress", "completed", "failed"],
  abandoned: ["pending", "invited", "in_progress", "failed"],
  expired: ["pending", "invited", "failed"],
  cancelled: ["pending", "invited", "in_progress", "failed"],
  in_progress: ["pending", "invited", "failed"],
  invited: ["pending", "failed"],
};

/** A late or repeated notice never moves a row backwards (a completed interview does not become "invited" again). */
export function canAdvance(current: string, next: InterviewState): boolean {
  return (ADVANCE_FROM[next] ?? []).includes(current as InterviewState);
}

export interface WitcherInterviewView {
  id?: unknown;
  status?: unknown;
  impression?: unknown;
  evaluationReady?: unknown;
  completedAt?: unknown;
}

export interface RowUpdate {
  state: InterviewState;
  impression: "positive" | "mixed" | "negative" | null;
  evaluation_ready: boolean;
  completed_at: string | null;
  lease_until: null;
  last_error: null;
}

/** What a Witcher notice (or a live `get`) changes in the row, or null when it must be ignored. */
export function updateFromWitcher(current: { state: string; completed_at?: string | null }, view: WitcherInterviewView): RowUpdate | null {
  const next = stateFromWitcher(view.status);
  if (!next || next === "pending") return null;
  if (!canAdvance(current.state, next)) return null;
  const completed = next === "completed";
  return {
    state: next,
    impression: completed && (view.impression === "positive" || view.impression === "mixed" || view.impression === "negative") ? view.impression : null,
    evaluation_ready: completed && view.evaluationReady === true,
    completed_at: completed ? (typeof view.completedAt === "string" ? view.completedAt : current.completed_at ?? new Date().toISOString()) : null,
    lease_until: null,
    last_error: null,
  };
}

const toHex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

/** `v1=<hex>`: HMAC-SHA256 of `<timestamp>.<body>`, the same as Witcher's `signBody`. */
export async function expectedSignature(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `v1=${toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)))}`;
}

/** Checks a Witcher call: a fresh timestamp and the right signature. A missing secret or header always fails. */
export async function verifyWebhook(
  secret: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  body: string,
  nowSeconds: number,
): Promise<boolean> {
  if (!secret || !timestampHeader || !signatureHeader || !/^\d{9,12}$/.test(timestampHeader)) return false;
  const timestamp = Number(timestampHeader);
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  return timingSafeEqual(await expectedSignature(secret, timestamp, body), signatureHeader.trim());
}

/** Friendly texts for the errors Witcher can answer to a re-send, cancel or retry. */
export function witcherErrorMessage(code: unknown): string {
  switch (code) {
    case "resend_limit": return "This invitation has already been re-sent the maximum number of times.";
    case "resend_too_soon": return "The invitation was sent recently. It can be re-sent once every 24 hours.";
    case "not_resendable": return "The candidate has already started or finished, so the e-mail cannot be re-sent.";
    case "not_cancellable": return "This interview can no longer be cancelled.";
    case "not_reevaluable": return "This evaluation does not need to be redone.";
    case "ai_not_configured": return "The AI assistant is not available right now. Try again later.";
    case "not_found": return "The interview was not found.";
    default: return "The interview service did not answer. Try again in a moment.";
  }
}
