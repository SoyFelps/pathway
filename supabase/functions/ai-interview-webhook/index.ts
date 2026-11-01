import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { callWitcher, type WitcherConfig } from "./witcher.ts";
import {
  BLOCKED_RECHECK_SECONDS,
  buildCreateBody,
  checkSendable,
  companyLogoUrl,
  deletionRetryDelaySeconds,
  DELETE_BATCH,
  LEASE_SECONDS,
  sendRetryDelaySeconds,
  stateFromWitcher,
  TICK_BATCH,
  updateFromWitcher,
  verifyWebhook,
} from "./logic.ts";

// Two jobs, both called by machines (no user JWT):
//  1. The signed notices from Witcher (an interview finished, was left, or expired): checked with WITCHER_WEBHOOK_SECRET.
//  2. The "tick" a database job sends every 10 seconds: creates the interviews that are due (10 seconds after a card was moved
//     into the AI Interview column) and erases in Witcher the interviews of deleted candidates, jobs and workspaces. A tick
//     carries no secret and is harmless to call by hand: it only works on rows that are already due.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function envJsonValue(name: string): string {
  try { return String(JSON.parse(Deno.env.get(name) || "{}").default || ""); }
  catch { return ""; }
}
const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || envJsonValue("SUPABASE_SECRET_KEYS");
const webhookSecret = Deno.env.get("WITCHER_WEBHOOK_SECRET") || "";
const witcher: WitcherConfig = { url: Deno.env.get("WITCHER_API_URL") || "", apiKey: Deno.env.get("WITCHER_API_KEY") || "" };
const admin = projectUrl && serviceKey
  ? createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const inSeconds = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

// ---------------------------------------------------------------------------------------------------------------
// 1. Notices from Witcher
async function handleNotice(rawBody: string): Promise<Response> {
  let payload: { event?: unknown; interview?: Record<string, unknown> };
  try { payload = JSON.parse(rawBody); } catch { return reply(400, { error: "invalid_body" }); }
  const interview = payload.interview;
  const id = typeof interview?.externalId === "string" ? interview.externalId : "";
  if (!interview || !UUID_RE.test(id)) return reply(200, { ignored: "unknown_interview" }); // not one of ours (test data): never retried
  const { data: row, error } = await admin!.from("ai_interviews").select("id,state,completed_at,notice_at,witcher_interview_id").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!row) return reply(200, { ignored: "unknown_interview" }); // the candidate was deleted meanwhile
  const update = updateFromWitcher(row as { state: string; completed_at?: string | null }, interview);
  if (!update) return reply(200, { ignored: "nothing_to_change" });
  const extra: Record<string, unknown> = {};
  if (update.state === "completed" && !row.notice_at) extra.notice_at = new Date().toISOString(); // the bell rings once per interview
  if (!row.witcher_interview_id && typeof interview.id === "string" && UUID_RE.test(interview.id)) extra.witcher_interview_id = interview.id;
  const { error: updateError } = await admin!.from("ai_interviews").update({ ...update, ...extra }).eq("id", id);
  if (updateError) throw updateError;
  return reply(200, { ok: true, state: update.state });
}

// ---------------------------------------------------------------------------------------------------------------
// 2. The worker
async function leaseDueRows(): Promise<Row[]> {
  const now = new Date().toISOString();
  const { data: due, error } = await admin!.from("ai_interviews").select("id")
    .in("state", ["pending", "blocked"]).lte("send_at", now).or(`lease_until.is.null,lease_until.lt.${now}`)
    .order("send_at").limit(TICK_BATCH);
  if (error) throw error;
  if (!due?.length) return [];
  const { data: rows, error: leaseError } = await admin!.from("ai_interviews")
    .update({ lease_until: inSeconds(LEASE_SECONDS) })
    .in("id", due.map((row) => row.id)).in("state", ["pending", "blocked"]).lte("send_at", now).or(`lease_until.is.null,lease_until.lt.${now}`)
    .select("id,workspace_id,flow_id,candidate_email,applicant_id,state,witcher_interview_id,attempts,manual");
  if (leaseError) throw leaseError;
  return rows ?? [];
}

/** The candidate's applications in this job, newest first (the e-mail is compared without regard to case). */
async function applicationsOf(row: Row): Promise<Row[]> {
  const pattern = row.candidate_email.replace(/[\\%_]/g, (character: string) => `\\${character}`);
  const { data, error } = await admin!.from("applicants").select("id,candidate_name,status,submitted_at")
    .eq("flow_id", row.flow_id).ilike("candidate_email", pattern).order("submitted_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function premiumActive(workspaceId: string): Promise<boolean> {
  const { data, error } = await admin!.from("workspace_subscriptions").select("status,current_period_end").eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw error;
  return data?.status === "active" && Date.parse(data.current_period_end || "") > Date.now();
}

/** The row left the waiting states while we worked (moved out, deleted): what we created in Witcher must go too. */
async function eraseOrphan(rowId: string) {
  await callWitcher(witcher, "delete", { externalId: rowId });
}

async function finishRow(row: Row, update: Record<string, unknown>, createdInWitcher: boolean): Promise<boolean> {
  const { data, error } = await admin!.from("ai_interviews").update({ lease_until: null, ...update })
    .eq("id", row.id).in("state", ["pending", "blocked"]).select("id");
  if (error) throw error;
  const applied = (data?.length ?? 0) > 0;
  if (!applied && createdInWitcher) await eraseOrphan(row.id);
  return applied;
}

async function retryLater(row: Row, code: string, extra: Record<string, unknown> = {}) {
  const attempts = (row.attempts ?? 0) + 1;
  const delay = sendRetryDelaySeconds(attempts);
  await finishRow(row, {
    attempts,
    last_error: code.slice(0, 200),
    ...(delay === null ? { state: "failed" } : { state: "pending", send_at: inSeconds(delay) }),
    ...extra,
  }, false);
}

async function sendRow(row: Row): Promise<"sent" | "blocked" | "dropped" | "retry" | "failed"> {
  const { data: flow, error: flowError } = await admin!.from("application_flows")
    .select("id,job_title,interview_questions,company_id,workspace_id").eq("id", row.flow_id).maybeSingle();
  if (flowError) throw flowError;
  if (!flow) { await admin!.from("ai_interviews").delete().eq("id", row.id).in("state", ["pending", "blocked"]); return "dropped"; }

  const [{ data: workspace, error: workspaceError }, applications, premium] = await Promise.all([
    admin!.from("workspaces").select("name").eq("id", row.workspace_id).maybeSingle(),
    applicationsOf(row),
    premiumActive(row.workspace_id),
  ]);
  if (workspaceError) throw workspaceError;
  let company: Row | null = null;
  if (flow.company_id) {
    const { data, error } = await admin!.from("workspace_companies").select("name,logo_path").eq("id", flow.company_id).maybeSingle();
    if (error) throw error;
    company = data;
  }
  const companyName = String(company?.name || workspace?.name || "");
  const verdict = checkSendable({
    questions: flow.interview_questions,
    premium,
    // An interview made on purpose with "Invite again" is sent whatever column the card is in.
    stillInColumn: row.manual === true || applications.some((application) => application.status === "ai_interview"),
    companyName,
  });
  if (!verdict.ok) {
    if (verdict.action === "drop") {
      await admin!.from("ai_interviews").delete().eq("id", row.id).in("state", ["pending", "blocked"]);
      return "dropped";
    }
    // Checked again every minute while the card stays in the column: the interview goes out by itself once this is fixed.
    await finishRow(row, { state: "blocked", blocked_reason: verdict.reason, send_at: inSeconds(BLOCKED_RECHECK_SECONDS), attempts: 0, last_error: null }, false);
    return "blocked";
  }

  const person = applications.find((application) => application.id === row.applicant_id) ?? applications[0];
  // The first e-mail may not have left on an earlier try: then the interview already exists in Witcher and only needs a re-send.
  const result = row.witcher_interview_id
    ? await callWitcher(witcher, "resend", { externalId: row.id })
    : await callWitcher(witcher, "create", buildCreateBody({
      id: row.id,
      candidateName: String(person?.candidate_name || row.candidate_email),
      candidateEmail: row.candidate_email,
      jobTitle: flow.job_title,
      companyName,
      logoUrl: companyLogoUrl(projectUrl, company?.logo_path),
      questions: flow.interview_questions,
    }));

  if (!result.ok) {
    // 400: Witcher refused the data itself, and trying again cannot help. Anything else (network, 5xx, 401) is retried.
    if (result.status === 400) {
      await finishRow(row, { state: "failed", last_error: String(result.json.error || "invalid_request") }, false);
      return "failed";
    }
    if (result.status === 409 && row.witcher_interview_id) {
      // "Not resendable": the candidate already did something with the first e-mail. Take what Witcher says as the truth.
      const live = await callWitcher(witcher, "get", { externalId: row.id });
      const next = stateFromWitcher(live.json.status);
      if (live.ok && next && next !== "pending") {
        await finishRow(row, { state: next, witcher_interview_id: row.witcher_interview_id, attempts: 0, last_error: null }, false);
        return "sent";
      }
    }
    await retryLater(row, `witcher_${result.status || "unreachable"}`);
    return "retry";
  }

  const witcherId = typeof result.json.id === "string" && UUID_RE.test(result.json.id) ? result.json.id : row.witcher_interview_id;
  const next = stateFromWitcher(result.json.status);
  const emailLeft = result.json.emailSent === true || (next !== null && next !== "pending");
  if (!emailLeft) {
    // Created, but the e-mail did not leave (the e-mail service is down): try the re-send later.
    await retryLater(row, "email_not_sent", { witcher_interview_id: witcherId });
    return "retry";
  }
  const applied = await finishRow(row, {
    state: next && next !== "pending" ? next : "invited",
    witcher_interview_id: witcherId,
    attempts: 0,
    last_error: null,
    blocked_reason: null,
  }, !row.witcher_interview_id);
  return applied ? "sent" : "dropped";
}

async function eraseQueued(): Promise<{ erased: number; pending: number }> {
  const now = new Date().toISOString();
  const { data: queued, error } = await admin!.from("ai_interview_deletions").select("id,ai_interview_id,attempts")
    .lte("next_at", now).order("next_at").limit(DELETE_BATCH);
  if (error) throw error;
  let erased = 0;
  let pending = 0;
  for (const item of queued ?? []) {
    // Push the next try out first, so an overlapping tick leaves this row alone.
    await admin!.from("ai_interview_deletions").update({ next_at: inSeconds(LEASE_SECONDS) }).eq("id", item.id);
    const result = await callWitcher(witcher, "delete", { externalId: item.ai_interview_id });
    if (result.ok) {
      const { error: removeError } = await admin!.from("ai_interview_deletions").delete().eq("id", item.id);
      if (removeError) throw removeError;
      erased++;
    } else {
      const attempts = item.attempts + 1;
      await admin!.from("ai_interview_deletions")
        .update({ attempts, last_error: `witcher_${result.status || "unreachable"}`, next_at: inSeconds(deletionRetryDelaySeconds(attempts)) }).eq("id", item.id);
      pending++;
    }
  }
  return { erased, pending };
}

const CANCEL_RETRY_SECONDS = 60;

/**
 * Interviews that were sent but not started when the workspace lost its plan (the database sets cancel_requested_at): cancelled in
 * Witcher, so the link stops working. A failed try is repeated every minute; if the plan came back meanwhile, or the candidate started,
 * nothing is cancelled. An interview already in progress is never cut: the candidate finishes.
 */
async function cancelForPlan(): Promise<number> {
  const now = new Date().toISOString();
  const { data: due, error } = await admin!.from("ai_interviews").select("id,workspace_id,state,completed_at")
    .eq("state", "invited").not("cancel_requested_at", "is", null).lte("cancel_requested_at", now).limit(TICK_BATCH);
  if (error) throw error;
  let cancelled = 0;
  for (const row of due ?? []) {
    // Push the next try out first, so an overlapping tick leaves this row alone; a failure below simply keeps that delay.
    await admin!.from("ai_interviews").update({ cancel_requested_at: inSeconds(CANCEL_RETRY_SECONDS) }).eq("id", row.id);
    if (await premiumActive(row.workspace_id)) {
      await admin!.from("ai_interviews").update({ cancel_requested_at: null }).eq("id", row.id);
      continue;
    }
    const live = await callWitcher(witcher, "get", { externalId: row.id });
    const gone = live.status === 404; // nothing exists in Witcher: only the row here needs to change
    if (!gone && !live.ok) continue;
    const witcherState = gone ? "invited" : stateFromWitcher(live.json.status);
    if (witcherState === "invited" || witcherState === "pending") {
      if (!gone) {
        const result = await callWitcher(witcher, "cancel", { externalId: row.id });
        if (!result.ok && result.status !== 409) continue;
        if (!result.ok) { await syncAfterRace(row, live.json); continue; }
      }
      const { error: cancelError } = await admin!.from("ai_interviews")
        .update({ state: "cancelled", cancel_reason: "plan", impression: null, evaluation_ready: false, cancel_requested_at: null })
        .eq("id", row.id).eq("state", "invited");
      if (cancelError) throw cancelError;
      cancelled++;
    } else {
      await syncAfterRace(row, live.json);
    }
  }
  return cancelled;
}

/** The candidate moved on before the cancellation (started, finished, left): take what Witcher says and stop trying to cancel. */
async function syncAfterRace(row: Row, view: Record<string, unknown>) {
  const update = updateFromWitcher(row as { state: string; completed_at?: string | null }, view);
  const { error } = await admin!.from("ai_interviews").update({ ...(update ?? {}), cancel_requested_at: null }).eq("id", row.id);
  if (error) throw error;
}

async function tick(): Promise<Response> {
  if (!witcher.url || !witcher.apiKey) return reply(200, { skipped: "witcher_not_configured" });
  const counts: Record<string, number> = { sent: 0, blocked: 0, dropped: 0, retry: 0, failed: 0 };
  for (const row of await leaseDueRows()) {
    try {
      counts[await sendRow(row)]++;
    } catch (error) {
      console.error("sending an interview failed:", error instanceof Error ? error.message : "unknown error");
      await admin!.from("ai_interviews").update({ lease_until: null, last_error: "internal_error" }).eq("id", row.id);
      counts.retry++;
    }
  }
  const cancelledForPlan = await cancelForPlan();
  return reply(200, { ...counts, cancelledForPlan, ...(await eraseQueued()) });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  if (!admin) return reply(503, { error: "not_configured" });
  const rawBody = await req.text();
  if (rawBody.length > 64 * 1024) return reply(413, { error: "too_large" });
  try {
    const timestamp = req.headers.get("x-witcher-timestamp");
    const signature = req.headers.get("x-witcher-signature");
    if (signature || timestamp) {
      if (!webhookSecret) return reply(503, { error: "not_configured" });
      if (!(await verifyWebhook(webhookSecret, timestamp, signature, rawBody, Math.floor(Date.now() / 1000)))) {
        console.warn("Witcher notice refused: bad signature or stale timestamp");
        return reply(401, { error: "invalid_signature" });
      }
      return await handleNotice(rawBody);
    }
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(rawBody); } catch { /* handled below */ }
    if (parsed && parsed.action === "tick") return await tick();
    return reply(400, { error: "invalid_request" });
  } catch (error) {
    console.error("ai-interview-webhook error:", error instanceof Error ? error.message : "unknown error");
    return reply(500, { error: "server_error" });
  }
});
