import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { callWitcher, type WitcherConfig } from "./witcher.ts";
import { updateFromWitcher, witcherErrorMessage } from "./logic.ts";

// What the signed-in reviewer does with an AI interview: look at it (live from Witcher), re-send the e-mail, cancel the
// invitation, invite again after a cancelled one, redo an evaluation the AI could not write, or retry a failed send. The browser never talks to Witcher and
// never holds its key. Every action is checked against the person's Candidates permission (and Premium where it costs
// something) before anything is sent. Sending the first invitation is done by the worker in `ai-interview-webhook`.

const APP_ORIGINS = new Set([
  "https://soyfelps.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function envJsonValue(name: string): string {
  try { return String(JSON.parse(Deno.env.get(name) || "{}").default || ""); }
  catch { return ""; }
}
const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || envJsonValue("SUPABASE_SECRET_KEYS");
const publicKey = envJsonValue("SUPABASE_PUBLISHABLE_KEYS") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const witcher: WitcherConfig = { url: Deno.env.get("WITCHER_API_URL") || "", apiKey: Deno.env.get("WITCHER_API_KEY") || "" };
const admin = projectUrl && serviceKey
  ? createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

function response(req: Request, status: number, body: unknown): Response {
  const origin = req.headers.get("origin") || "";
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin" });
  if (origin && APP_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, apikey, x-client-info, content-type");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return status === 204 ? new Response(null, { status, headers }) : new Response(JSON.stringify(body), { status, headers });
}
const fail = (req: Request, status: number, message: string, extra: Record<string, unknown> = {}) => response(req, status, { error: message, ...extra });

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

async function authenticate(req: Request): Promise<{ userClient: SupabaseClient } | Response> {
  if (!admin || !publicKey || !witcher.url || !witcher.apiKey) return fail(req, 503, "The AI interview service is not configured.");
  const token = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!token) return fail(req, 401, "Sign in to use AI interviews.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return fail(req, 401, "Your session expired. Sign in again.");
  const userClient = createClient(projectUrl, publicKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userClient };
}

const ROW_COLUMNS = "id,workspace_id,flow_id,candidate_email,applicant_id,state,blocked_reason,send_at,witcher_interview_id,impression,evaluation_ready,completed_at,created_at";

/** The row, only if the person may review the candidates of its workspace (the database policy decides, not this code). */
async function visibleRow(userClient: SupabaseClient, body: Record<string, unknown>): Promise<Row | null> {
  const id = typeof body.aiInterviewId === "string" && UUID_RE.test(body.aiInterviewId) ? body.aiInterviewId : "";
  if (id) {
    const { data, error } = await userClient.from("ai_interviews").select(ROW_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }
  const flowId = typeof body.flowId === "string" && UUID_RE.test(body.flowId) ? body.flowId : "";
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!flowId || !email) return null;
  const { data, error } = await userClient.from("ai_interviews").select(ROW_COLUMNS)
    .eq("flow_id", flowId).eq("candidate_email", email).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

async function premiumActive(workspaceId: string): Promise<boolean> {
  const { data, error } = await admin!.from("workspace_subscriptions").select("status,current_period_end").eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw error;
  return data?.status === "active" && Date.parse(data.current_period_end || "") > Date.now();
}

function publicRow(row: Row) {
  return {
    id: row.id, flowId: row.flow_id, email: row.candidate_email, state: row.state, blockedReason: row.blocked_reason,
    sendAt: row.send_at, impression: row.impression, evaluationReady: row.evaluation_ready, completedAt: row.completed_at, createdAt: row.created_at,
  };
}

/** Moves the row to what Witcher says, if that is news. Returns the row as it is afterwards. */
async function syncRow(row: Row, view: Record<string, unknown>): Promise<Row> {
  const update = updateFromWitcher(row as { state: string; completed_at?: string | null }, view);
  if (!update) return row;
  const { data, error } = await admin!.from("ai_interviews").update(update).eq("id", row.id).select(ROW_COLUMNS).maybeSingle();
  if (error) throw error;
  return data ?? row;
}

async function actionStatus(req: Request, userClient: SupabaseClient, body: Record<string, unknown>) {
  let row = await visibleRow(userClient, body);
  if (!row) return response(req, 200, { interview: null });
  if (!row.witcher_interview_id || ["pending", "blocked", "failed", "cancelled"].includes(row.state)) {
    return response(req, 200, { interview: publicRow(row), live: null });
  }
  const result = await callWitcher(witcher, "get", { externalId: row.id });
  if (result.status === 404) return response(req, 200, { interview: publicRow(row), live: null });
  if (!result.ok) return response(req, 200, { interview: publicRow(row), live: null, liveError: witcherErrorMessage(result.json.error) });
  row = await syncRow(row, { ...result.json, impression: result.json.impression, evaluationReady: Boolean(result.json.evaluation) && result.json.impression != null });
  const live: Record<string, unknown> = {
    status: result.json.status, inviteCount: result.json.inviteCount, resendsLeft: result.json.resendsLeft, lastInviteAt: result.json.lastInviteAt,
    expiresAt: result.json.expiresAt, startedAt: result.json.startedAt, completedAt: result.json.completedAt,
  };
  if (result.json.status === "completed") {
    live.evaluation = result.json.evaluation ?? null;
    live.impression = result.json.impression ?? null;
    live.languageFlag = result.json.languageFlag === true;
    live.messages = Array.isArray(result.json.messages) ? result.json.messages : [];
  }
  return response(req, 200, { interview: publicRow(row), live });
}

async function actionResend(req: Request, userClient: SupabaseClient, body: Record<string, unknown>) {
  const row = await visibleRow(userClient, body);
  if (!row) return fail(req, 404, "The interview was not found.");
  if (row.state !== "invited" || !row.witcher_interview_id) return fail(req, 409, "The e-mail can only be re-sent before the candidate starts.");
  if (!(await premiumActive(row.workspace_id))) return fail(req, 402, "Re-sending needs an active Premium plan.");
  const result = await callWitcher(witcher, "resend", { externalId: row.id });
  if (!result.ok) return fail(req, result.status === 409 ? 409 : 502, witcherErrorMessage(result.json.error), { code: result.json.error ?? null, retryAt: result.json.retryAt ?? null });
  return response(req, 200, { ok: true, emailSent: result.json.emailSent === true, resendsLeft: result.json.resendsLeft ?? null, lastInviteAt: result.json.lastInviteAt ?? null });
}

async function actionCancel(req: Request, userClient: SupabaseClient, body: Record<string, unknown>) {
  const row = await visibleRow(userClient, body);
  if (!row) return fail(req, 404, "The interview was not found.");
  if (row.state === "pending" || row.state === "blocked") {
    // Never sent: nothing exists in Witcher, so the waiting row simply goes away.
    const { error } = await admin!.from("ai_interviews").delete().eq("id", row.id).in("state", ["pending", "blocked"]);
    if (error) throw error;
    return response(req, 200, { ok: true, state: null });
  }
  if (row.state === "cancelled") return response(req, 200, { ok: true, state: "cancelled" });
  if (!["invited", "in_progress"].includes(row.state)) return fail(req, 409, witcherErrorMessage("not_cancellable"));
  const result = await callWitcher(witcher, "cancel", { externalId: row.id });
  if (!result.ok) {
    if (result.status === 409) {
      // It finished in the meantime: bring the row up to date and tell the person why nothing was cancelled.
      const live = await callWitcher(witcher, "get", { externalId: row.id });
      if (live.ok) await syncRow(row, { ...live.json, evaluationReady: Boolean(live.json.evaluation) && live.json.impression != null });
    }
    return fail(req, result.status === 409 ? 409 : 502, witcherErrorMessage(result.json.error), { code: result.json.error ?? null });
  }
  const { error } = await admin!.from("ai_interviews").update({ state: "cancelled", impression: null, evaluation_ready: false }).eq("id", row.id);
  if (error) throw error;
  return response(req, 200, { ok: true, state: "cancelled" });
}

async function actionReevaluate(req: Request, userClient: SupabaseClient, body: Record<string, unknown>) {
  const row = await visibleRow(userClient, body);
  if (!row) return fail(req, 404, "The interview was not found.");
  if (row.state !== "completed" || !row.witcher_interview_id) return fail(req, 409, witcherErrorMessage("not_reevaluable"));
  if (!(await premiumActive(row.workspace_id))) return fail(req, 402, "Redoing an evaluation needs an active Premium plan.");
  const result = await callWitcher(witcher, "reevaluate", { externalId: row.id });
  if (!result.ok) return fail(req, result.status === 409 ? 409 : 502, witcherErrorMessage(result.json.error), { code: result.json.error ?? null });
  return response(req, 202, { ok: true, reevaluating: true });
}

// The only way to invite a candidate again after a cancelled, abandoned or expired interview (the "Invite again" button). It
// creates a new interview that is sent at once and does not depend on the column the candidate is in. The earlier one stays as history.
async function actionReinvite(req: Request, userClient: SupabaseClient, body: Record<string, unknown>) {
  const row = await visibleRow(userClient, body);
  if (!row) return fail(req, 404, "The interview was not found.");
  const { data: latest, error: latestError } = await admin!.from("ai_interviews").select("id,state")
    .eq("flow_id", row.flow_id).eq("candidate_email", row.candidate_email).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (latestError) throw latestError;
  if (!latest || latest.id !== row.id) return fail(req, 409, "There is already a newer interview for this candidate. Refresh and look at it.");
  if (!["cancelled", "abandoned", "expired"].includes(row.state)) return fail(req, 409, "A new invitation can only be sent after the earlier one was cancelled, left or expired.");
  if (!(await premiumActive(row.workspace_id))) return fail(req, 402, "Inviting needs an active Premium plan.");
  const { data: application, error: applicationError } = await admin!.from("applicants").select("id")
    .eq("flow_id", row.flow_id).ilike("candidate_email", row.candidate_email.replace(/[\\%_]/g, (character: string) => `\\${character}`))
    .order("submitted_at", { ascending: false }).limit(1).maybeSingle();
  if (applicationError) throw applicationError;
  const { data: created, error } = await admin!.from("ai_interviews")
    .insert({ workspace_id: row.workspace_id, flow_id: row.flow_id, candidate_email: row.candidate_email, applicant_id: application?.id ?? row.applicant_id, state: "pending", send_at: new Date().toISOString(), manual: true })
    .select("id").single();
  if (error) {
    if (error.code === "23505") return fail(req, 409, "There is already an interview in progress for this candidate. Refresh and look at it.");
    throw error;
  }
  return response(req, 200, { ok: true, id: created.id });
}

async function actionRetry(req: Request, userClient: SupabaseClient, body: Record<string, unknown>) {
  const row = await visibleRow(userClient, body);
  if (!row) return fail(req, 404, "The interview was not found.");
  if (row.state !== "failed" && row.state !== "blocked") return fail(req, 409, "There is nothing to retry.");
  const { error } = await admin!.from("ai_interviews")
    .update({ state: "pending", blocked_reason: null, attempts: 0, last_error: null, lease_until: null, send_at: new Date().toISOString() })
    .eq("id", row.id).in("state", ["failed", "blocked"]);
  if (error) throw error;
  return response(req, 200, { ok: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return response(req, 204, null);
  if (req.method !== "POST") return fail(req, 405, "Use POST.");
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad body");
    body = parsed as Record<string, unknown>;
  } catch {
    return fail(req, 400, "The request was not understood.");
  }
  try {
    switch (body.action) {
      case "status": return await actionStatus(req, auth.userClient, body);
      case "resend": return await actionResend(req, auth.userClient, body);
      case "cancel": return await actionCancel(req, auth.userClient, body);
      case "reevaluate": return await actionReevaluate(req, auth.userClient, body);
      case "retry": return await actionRetry(req, auth.userClient, body);
      case "reinvite": return await actionReinvite(req, auth.userClient, body);
      default: return fail(req, 400, "Unknown action.");
    }
  } catch (error) {
    console.error("ai-interview error:", error instanceof Error ? error.message : "unknown error");
    return fail(req, 500, "Something went wrong. Try again.");
  }
});

