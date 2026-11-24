import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { hashSecret, looksLikeSecret, MAX_PEOPLE, newChannelKey, newSecret, roomStatus, roomWindow } from "./logic.ts";

// Nellio meeting rooms (Phase 1 of plano-reunioes.md). JWT OFF: "join" is for anyone with the link (the secret after the #);
// "create" checks the signed-in person itself (they must be able to see the interview, the database policy decides) and needs an active plan.
// The video never passes here: this function only checks the secret and the time window, and hands out the Realtime channel name and
// short-lived TURN credentials from Cloudflare (secrets CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN, set in the Supabase dashboard).

const APP_ORIGINS = new Set([
  "https://soyfelps.github.io",
  "https://nellio.app",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
]);

function envJsonValue(name: string): string {
  try { return String(JSON.parse(Deno.env.get(name) || "{}").default || ""); }
  catch { return ""; }
}
const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || envJsonValue("SUPABASE_SECRET_KEYS");
const publicKey = envJsonValue("SUPABASE_PUBLISHABLE_KEYS") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const TURN_KEY_ID = Deno.env.get("CLOUDFLARE_TURN_KEY_ID") || "";
const TURN_TOKEN = Deno.env.get("CLOUDFLARE_TURN_API_TOKEN") || "";
const APP_URL = (Deno.env.get("PATHWAY_APP_URL") || "https://nellio.app/").replace(/\/?$/, "/");
const TURN_TTL_SECONDS = 4 * 3600;
// The page of the room. Production: nellio.app/meeting.html (its committed config talks to production). Staging has no site of its own,
// so its links go to the hidden test copy nellio.app/lab/room.html (which talks to staging) until MEETING_PAGE_URL says otherwise.
const STAGING_REF = "oaafcgkfaqgkfelkagsb";
const MEETING_PAGE = Deno.env.get("MEETING_PAGE_URL") || (projectUrl.includes(STAGING_REF) ? "https://nellio.app/lab/room.html" : `${APP_URL}meeting.html`);
const admin = projectUrl && serviceKey ? createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

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
const fail = (req: Request, status: number, message: string) => response(req, status, { error: message });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPEN_STATES = ["awaiting_schedule", "invited", "confirmed", "declined", "reschedule_requested"];

type IceServer = { urls: string | string[]; username?: string; credential?: string };

/** Short-lived TURN credentials (the long-term key stays here). Without them the room still works with direct connections only. */
async function turnServers(): Promise<IceServer[]> {
  if (!TURN_KEY_ID || !TURN_TOKEN) return [];
  for (const path of ["generate-ice-servers", "generate"]) {
    try {
      const result = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_KEY_ID}/credentials/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TURN_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
      });
      if (!result.ok) { console.error("meetings: Cloudflare TURN answered", result.status, path); continue; }
      const servers = (await result.json())?.iceServers;
      if (servers) return Array.isArray(servers) ? servers : [servers];
    } catch (error) { console.error("meetings: TURN failed", error instanceof Error ? error.message : error); }
  }
  return [];
}

async function planActive(workspaceId: string): Promise<boolean> {
  const { data, error } = await admin!.rpc("workspace_has_active_subscription", { p_workspace_id: workspaceId });
  if (error) throw error;
  return data === true;
}

async function context(interviewId: string) {
  const { data: iv } = await admin!.from("candidate_interviews").select("id,workspace_id,flow_id,state,kind,starts_at,time_zone,duration_minutes").eq("id", interviewId).maybeSingle();
  if (!iv) return null;
  const { data: flow } = await admin!.from("application_flows").select("job_title,company_id,interview_language").eq("id", iv.flow_id).maybeSingle();
  const { data: workspace } = await admin!.from("workspaces").select("name").eq("id", iv.workspace_id).maybeSingle();
  let companyName = workspace?.name || "";
  if (flow?.company_id) {
    const { data: company } = await admin!.from("workspace_companies").select("name").eq("id", flow.company_id).maybeSingle();
    if (company?.name) companyName = company.name;
  }
  const language = flow?.interview_language === "pt" || flow?.interview_language === "es" ? flow.interview_language : "en";
  return { iv: iv as Row, jobTitle: String(flow?.job_title || ""), companyName: String(companyName || ""), language };
}

// ---------------------------------------------------------------------------------------------------------------
/** A signed-in team member makes the room of an interview (one per interview) from the "Generate Nellio link" button of the schedule window.
    Only the hash of the secret is kept. When the room already exists: if the interview already carries its link (it was saved and sent),
    that same link is given back, so the link the candidate has keeps working; otherwise nobody has it yet, and a new secret replaces it. */
async function actionCreate(req: Request, body: Record<string, unknown>) {
  const token = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!token || !publicKey) return fail(req, 401, "Sign in to create a meeting room.");
  const { data: auth, error: authError } = await admin!.auth.getUser(token);
  if (authError || !auth.user) return fail(req, 401, "Your session expired. Sign in again.");
  const userClient: SupabaseClient = createClient(projectUrl, publicKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const interviewId = typeof body.interviewId === "string" && UUID_RE.test(body.interviewId) ? body.interviewId : "";
  if (!interviewId) return fail(req, 404, "The interview was not found.");
  // The person may review the candidates of this workspace: the database policy decides, not this code.
  const { data: seen, error } = await userClient.from("candidate_interviews").select("id,workspace_id,state,kind").eq("id", interviewId).maybeSingle();
  if (error) throw error;
  if (!seen) return fail(req, 404, "The interview was not found.");
  if (!OPEN_STATES.includes(seen.state)) return fail(req, 409, "This interview can no longer be changed.");
  // (no check of the format here: the window may be switching an in-person interview to online; a room nobody uses costs nothing)
  if (!(await planActive(seen.workspace_id))) return fail(req, 402, "An active plan is needed to schedule interviews.");
  const { data: existing, error: existingError } = await admin!.from("meeting_rooms").select("id,secret_hash").eq("interview_id", seen.id).maybeSingle();
  if (existingError) throw existingError;
  const secret = newSecret();
  if (existing) {
    const { data: saved } = await admin!.from("candidate_interviews").select("meeting_link").eq("id", seen.id).maybeSingle();
    const savedLink = String(saved?.meeting_link || "");
    const savedSecret = savedLink.includes("#") ? savedLink.slice(savedLink.lastIndexOf("#") + 1) : "";
    if (looksLikeSecret(savedSecret) && await hashSecret(savedSecret) === existing.secret_hash) return response(req, 200, { link: savedLink });
    const { error: updateError } = await admin!.from("meeting_rooms").update({ secret_hash: await hashSecret(secret), channel_key: newChannelKey(), created_by: auth.user.id }).eq("id", existing.id);
    if (updateError) throw updateError;
    return response(req, 201, { link: `${MEETING_PAGE}#${secret}` });
  }
  const { error: insertError } = await admin!.from("meeting_rooms").insert({
    workspace_id: seen.workspace_id, interview_id: seen.id, secret_hash: await hashSecret(secret), channel_key: newChannelKey(), created_by: auth.user.id,
  });
  if (insertError) {
    if (insertError.code === "23505") return fail(req, 409, "Something went wrong. Please try again.");
    throw insertError;
  }
  return response(req, 201, { link: `${MEETING_PAGE}#${secret}` });
}

/** Anyone with the link: what the room is, whether it is open, and (only when open) the channel and the TURN credentials. */
async function actionJoin(req: Request, body: Record<string, unknown>) {
  if (!looksLikeSecret(body.secret)) return fail(req, 404, "This meeting link was not found.");
  const { data: room } = await admin!.from("meeting_rooms").select("interview_id,channel_key").eq("secret_hash", await hashSecret(body.secret)).maybeSingle();
  if (!room) return fail(req, 404, "This meeting link was not found.");
  const ctx = await context(room.interview_id);
  if (!ctx) return fail(req, 404, "This meeting link was not found.");
  const status = roomStatus(ctx.iv.state, ctx.iv.starts_at);
  const window = ctx.iv.starts_at ? roomWindow(new Date(ctx.iv.starts_at)) : null;
  const view: Row = {
    status, language: ctx.language, jobTitle: ctx.jobTitle, companyName: ctx.companyName,
    startsAt: ctx.iv.starts_at, timeZone: ctx.iv.time_zone, durationMinutes: ctx.iv.duration_minutes,
    opensAt: window?.opensAt.toISOString() || null, closesAt: window?.closesAt.toISOString() || null, maxPeople: MAX_PEOPLE,
  };
  if (status === "open" && body.enter === true) {
    // The first person who enters marks the room as opened: from then on the interview can no longer be edited or cancelled (owner decision, 2026-11-24).
    const { data: first } = await admin!.from("candidate_interviews").update({ room_opened_at: new Date().toISOString() }).eq("id", ctx.iv.id).is("room_opened_at", null).select("id,workspace_id").maybeSingle();
    if (first) {
      const { error: eventError } = await admin!.from("candidate_interview_events").insert({ interview_id: first.id, workspace_id: first.workspace_id, kind: "room_opened", actor: "system", actor_user_id: null, data: {} });
      if (eventError) console.error("meetings: event not saved", eventError.message);
    }
    view.channel = `meeting:${room.channel_key}`;
    view.iceServers = await turnServers();
  }
  return response(req, 200, { room: view });
}

// ---------------------------------------------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return response(req, 204, {});
  if (req.method !== "POST") return fail(req, 405, "Method not allowed.");
  const origin = req.headers.get("origin") || "";
  if (origin && !APP_ORIGINS.has(origin)) return fail(req, 403, "This site is not allowed to use the meeting service.");
  if (!admin) return fail(req, 503, "The meeting service is not configured.");
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail(req, 400, "Send a valid request."); }
  if (!body || typeof body !== "object") return fail(req, 400, "Send a valid request.");
  try {
    if (body.action === "join") return await actionJoin(req, body);
    if (body.action === "create") return await actionCreate(req, body);
    return fail(req, 400, "Send a valid request.");
  } catch (error) {
    console.error("meetings: unexpected error", error instanceof Error ? error.message : error);
    return fail(req, 500, "Something went wrong. Please try again.");
  }
});
