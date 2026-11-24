import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { hashSecret, looksLikeSecret, MAX_PEOPLE, newChannelKey, newSecret, roomStatus, roomWindow } from "./logic.ts";
import {
  buildMinutesRequest, buildTranscribeRequest, callGemini, type Language, mergeTranscript, MINUTES_MODELS, parseMinutes, parseUtterances, type Role,
  TRANSCRIBE_MODELS, transcriptText, usageOf,
} from "./transcribe.ts";

// Nellio meeting rooms (plano-reunioes.md). JWT OFF: "join" is for anyone with the link (the secret after the #);
// "create" checks the signed-in person itself (they must be able to see the interview, the database policy decides) and needs an active plan.
// The video never passes here: this function only checks the secret and the time window, and hands out the Realtime channel name and
// short-lived TURN credentials from Cloudflare (secrets CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN, set in the Supabase dashboard).
// Phase 3 (transcription and minutes): a person who sends their session along is "team" (they must be able to see the interview); anyone else
// is the candidate, who accepts or refuses the transcription before entering. Each browser sends pieces of its own microphone ("audio"), each
// piece is transcribed by Gemini (secret GEMINI_API_KEY_FOR_MEETINGS) and its audio deleted; when the meeting ends the transcript is put in order
// and the minutes are written ("tick", woken every minute by the database job meeting-transcription-tick, or "end" by the team).

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
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY_FOR_MEETINGS") || "";
const APP_URL = (Deno.env.get("PATHWAY_APP_URL") || "https://nellio.app/").replace(/\/?$/, "/");
const TURN_TTL_SECONDS = 4 * 3600;
// The page of the room. Production: nellio.app/meeting.html (its committed config talks to production). Staging has no site of its own,
// so its links go to the hidden test copy nellio.app/lab/room.html (which talks to staging) until MEETING_PAGE_URL says otherwise.
const STAGING_REF = "oaafcgkfaqgkfelkagsb";
const MEETING_PAGE = Deno.env.get("MEETING_PAGE_URL") || (projectUrl.includes(STAGING_REF) ? "https://nellio.app/lab/room.html" : `${APP_URL}meeting.html`);
const AUDIO_BUCKET = "meeting-audio";
const MAX_AUDIO_BYTES = 5_000_000;
const MAX_SEGMENTS_PER_INTERVIEW = 3000;
const admin = projectUrl && serviceKey ? createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function response(req: Request, status: number, body: unknown): Response {
  const origin = req.headers.get("origin") || "";
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin" });
  if (origin && APP_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, apikey, x-client-info, content-type, x-meeting-secret, x-speaker-key, x-speaker-name, x-started-at, x-duration-ms");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return status === 204 ? new Response(null, { status, headers }) : new Response(JSON.stringify(body), { status, headers });
}
const fail = (req: Request, status: number, message: string) => response(req, status, { error: message });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPEN_STATES = ["awaiting_schedule", "invited", "confirmed", "declined", "reschedule_requested"];

/** Work that goes on after the answer was sent (transcribing a piece); without the edge runtime it simply runs before answering. */
function later(work: Promise<unknown>): Promise<void> | void {
  const guarded = work.catch((error) => console.error("meetings: background work failed", error instanceof Error ? error.message : error));
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") { runtime.waitUntil(guarded); return; }
  return guarded.then(() => {});
}

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
  const { data: iv } = await admin!.from("candidate_interviews")
    .select("id,workspace_id,flow_id,state,kind,starts_at,time_zone,duration_minutes,meeting_link,transcription_enabled,minutes_enabled,transcription_consent_at,transcription_refused_at")
    .eq("id", interviewId).maybeSingle();
  if (!iv) return null;
  const { data: flow } = await admin!.from("application_flows").select("job_title,company_id,interview_language").eq("id", iv.flow_id).maybeSingle();
  const { data: workspace } = await admin!.from("workspaces").select("name").eq("id", iv.workspace_id).maybeSingle();
  let companyName = workspace?.name || "";
  if (flow?.company_id) {
    const { data: company } = await admin!.from("workspace_companies").select("name").eq("id", flow.company_id).maybeSingle();
    if (company?.name) companyName = company.name;
  }
  const language: Language = flow?.interview_language === "pt" || flow?.interview_language === "es" ? flow.interview_language : "en";
  return { iv: iv as Row, jobTitle: String(flow?.job_title || ""), companyName: String(companyName || ""), language };
}
type Context = NonNullable<Awaited<ReturnType<typeof context>>>;

/** The room and its interview from the secret of the link (null when the link is unknown). */
async function roomFromSecret(secret: unknown) {
  if (!looksLikeSecret(secret)) return null;
  const { data: room } = await admin!.from("meeting_rooms").select("interview_id,channel_key").eq("secret_hash", await hashSecret(secret)).maybeSingle();
  if (!room) return null;
  const ctx = await context(room.interview_id);
  return ctx ? { room, ctx } : null;
}

/** The signed-in person, when the request carries a session AND that person may see this interview (team); otherwise null (the candidate). */
async function teamMember(req: Request, interviewId: string): Promise<string | null> {
  const token = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!token || !publicKey || token === publicKey) return null;
  const { data: auth, error } = await admin!.auth.getUser(token);
  if (error || !auth.user) return null;
  const userClient = createClient(projectUrl, publicKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: seen } = await userClient.from("candidate_interviews").select("id").eq("id", interviewId).maybeSingle();
  return seen ? auth.user.id : null;
}

const transcriptionOn = (ctx: Context) => ctx.iv.transcription_enabled === true && ctx.iv.kind === "online";

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

async function transcriptRow(interviewId: string): Promise<Row | null> {
  const { data } = await admin!.from("meeting_transcripts").select("state,ended_at").eq("interview_id", interviewId).maybeSingle();
  return data;
}

/** Anyone with the link: what the room is, whether it is open, and (only when open) the channel and the TURN credentials.
    A team member (session sent along) is "team"; anyone else is the candidate, who must accept the transcription first when it is on. */
async function actionJoin(req: Request, body: Record<string, unknown>) {
  const found = await roomFromSecret(body.secret);
  if (!found) return fail(req, 404, "This meeting link was not found.");
  const { room, ctx } = found;
  const teamId = await teamMember(req, ctx.iv.id);
  const role: Role = teamId ? "team" : "candidate";
  let status: string = roomStatus(ctx.iv.state, ctx.iv.starts_at);
  // The candidate who refused the transcription does not enter (the interview became "Denied the interview").
  if (role === "candidate" && ctx.iv.transcription_refused_at && status !== "cancelled") status = "refused";
  const window = ctx.iv.starts_at ? roomWindow(new Date(ctx.iv.starts_at)) : null;
  const transcription = transcriptionOn(ctx);
  const tr = transcription ? await transcriptRow(ctx.iv.id) : null;
  const consentNeeded = role === "candidate" && transcription && !ctx.iv.transcription_consent_at;
  const view: Row = {
    status, language: ctx.language, jobTitle: ctx.jobTitle, companyName: ctx.companyName,
    startsAt: ctx.iv.starts_at, timeZone: ctx.iv.time_zone, durationMinutes: ctx.iv.duration_minutes,
    opensAt: window?.opensAt.toISOString() || null, closesAt: window?.closesAt.toISOString() || null, maxPeople: MAX_PEOPLE,
    role, transcription, transcriptionEnded: Boolean(tr?.ended_at), consentNeeded,
  };
  if (status === "open" && body.enter === true && !consentNeeded) {
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

/** The candidate accepts or refuses the transcription on the entry screen. Refusing makes the interview "declined" (Denied the interview). */
async function actionConsent(req: Request, body: Record<string, unknown>) {
  const found = await roomFromSecret(body.secret);
  if (!found) return fail(req, 404, "This meeting link was not found.");
  const { ctx } = found;
  const status = roomStatus(ctx.iv.state, ctx.iv.starts_at);
  if (status !== "open" && status !== "early") return fail(req, 409, "This meeting room is not open.");
  if (!transcriptionOn(ctx)) return response(req, 200, { ok: true });
  if (body.accept === true) {
    const { data: first } = await admin!.from("candidate_interviews").update({ transcription_consent_at: new Date().toISOString() }).eq("id", ctx.iv.id).is("transcription_consent_at", null).select("id").maybeSingle();
    if (first) await addEvent(ctx.iv, "transcription_accepted", "candidate");
    return response(req, 200, { ok: true });
  }
  if (body.accept !== false) return fail(req, 400, "Send a valid request.");
  const now = new Date().toISOString();
  const becomesDeclined = ctx.iv.state === "invited" || ctx.iv.state === "confirmed";
  const patch: Row = { transcription_refused_at: now };
  if (becomesDeclined) Object.assign(patch, { state: "declined", responded_at: now, notice_at: now, notice_reason: null, response_note: null, proposed_times: [] });
  const { data: changed, error } = await admin!.from("candidate_interviews").update(patch).eq("id", ctx.iv.id).eq("state", ctx.iv.state).is("transcription_refused_at", null).select("id").maybeSingle();
  if (error) throw error;
  if (changed) await addEvent(ctx.iv, "transcription_refused", "candidate");
  return response(req, 200, { ok: true });
}

async function addEvent(iv: Row, kind: string, actor: "recruiter" | "candidate" | "system", actorUserId: string | null = null) {
  const { error } = await admin!.from("candidate_interview_events").insert({ interview_id: iv.id, workspace_id: iv.workspace_id, kind, actor, actor_user_id: actorUserId, data: {} });
  if (error) console.error("meetings: event not saved", error.message);
}

/** Opens (or reopens) the transcript of an interview and notes that audio is still coming. */
async function touchTranscript(iv: Row) {
  const now = new Date().toISOString();
  const { data: existing } = await admin!.from("meeting_transcripts").select("state").eq("interview_id", iv.id).maybeSingle();
  if (!existing) {
    await admin!.from("meeting_transcripts").upsert({ interview_id: iv.id, workspace_id: iv.workspace_id, state: "recording", last_audio_at: now }, { onConflict: "interview_id", ignoreDuplicates: true });
    return;
  }
  // A meeting that goes on after its transcript was written (people came back): the transcript and minutes are written again at the end.
  await admin!.from("meeting_transcripts").update({ state: existing.state === "processing" ? "processing" : "recording", last_audio_at: now, updated_at: now }).eq("interview_id", iv.id);
}

/** Who may send audio now: the transcription is on and not ended, the room is open; team (session) or the candidate who accepted. */
async function audioSender(req: Request, secret: unknown) {
  const found = await roomFromSecret(secret);
  if (!found) return { error: fail(req, 404, "This meeting link was not found.") };
  const { ctx } = found;
  if (roomStatus(ctx.iv.state, ctx.iv.starts_at) !== "open") return { error: fail(req, 409, "This meeting room is not open.") };
  if (!transcriptionOn(ctx)) return { error: fail(req, 409, "This meeting is not transcribed.") };
  const tr = await transcriptRow(ctx.iv.id);
  if (tr?.ended_at) return { error: fail(req, 409, "The transcription of this meeting was ended.") };
  const teamId = await teamMember(req, ctx.iv.id);
  if (!teamId && !ctx.iv.transcription_consent_at) return { error: fail(req, 403, "Accept the transcription to join the meeting.") };
  return { ctx, teamId };
}

/** One piece of one person's microphone (raw audio in the body; who, when and how long in the headers). Stored, then transcribed right away. */
async function actionAudio(req: Request) {
  // The audio is always read BEFORE any answer: answering a refusal while the browser is still sending the body leaves the connection
  // hanging (seen 2026-11-24). Anything announced as too large is refused before reading it.
  if (Number(req.headers.get("content-length") || 0) > MAX_AUDIO_BYTES) return fail(req, 413, "This piece of audio is too large.");
  const audio = new Uint8Array(await req.arrayBuffer());
  const allowed = await audioSender(req, req.headers.get("x-meeting-secret"));
  if (allowed.error) return allowed.error;
  const { ctx, teamId } = allowed as { ctx: Context; teamId: string | null };
  const speakerKey = String(req.headers.get("x-speaker-key") || "");
  let speakerName = "";
  try { speakerName = decodeURIComponent(String(req.headers.get("x-speaker-name") || "")).replace(/\s+/g, " ").trim().slice(0, 60); } catch { speakerName = ""; }
  const startedAt = Date.parse(String(req.headers.get("x-started-at") || ""));
  const durationMs = Math.round(Number(req.headers.get("x-duration-ms")));
  const mimeType = String(req.headers.get("content-type") || "").split(",")[0].trim().slice(0, 80);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(speakerKey) || !speakerName || !Number.isFinite(startedAt) || !Number.isFinite(durationMs) || durationMs < 500 || durationMs > 600_000 || !/^audio\/(webm|ogg|mp4|mpeg|aac|wav)/i.test(mimeType)) {
    return fail(req, 400, "Send a valid request.");
  }
  if (Math.abs(startedAt - Date.now()) > 30 * 60_000) return fail(req, 400, "Send a valid request.");
  // Someone who already spoke as the hiring team is never turned into the candidate: without a valid session now (it expired during the
  // meeting) the piece is refused, the room page renews the session and sends it again (bug seen in the 4-person test, 2026-11-24).
  if (!teamId) {
    const { count: asTeam } = await admin!.from("meeting_audio_segments").select("id", { count: "exact", head: true }).eq("interview_id", ctx.iv.id).eq("speaker_key", speakerKey).eq("speaker_role", "team");
    if ((asTeam ?? 0) > 0) return fail(req, 401, "Your session expired. Sign in again.");
  }
  if (!audio.length || audio.length > MAX_AUDIO_BYTES) return fail(req, 413, "This piece of audio is too large.");
  const { count } =await admin!.from("meeting_audio_segments").select("id", { count: "exact", head: true }).eq("interview_id", ctx.iv.id);
  if ((count ?? 0) >= MAX_SEGMENTS_PER_INTERVIEW) return fail(req, 429, "Too many pieces of audio for this meeting.");
  const id = crypto.randomUUID();
  const path = `${ctx.iv.workspace_id}/${ctx.iv.id}/${id}`;
  const { error: uploadError } = await admin!.storage.from(AUDIO_BUCKET).upload(path, audio, { contentType: mimeType, upsert: false });
  if (uploadError) { console.error("meetings: audio not stored", uploadError.message); return fail(req, 500, "Something went wrong. Please try again."); }
  const { error } = await admin!.from("meeting_audio_segments").insert({
    id, workspace_id: ctx.iv.workspace_id, interview_id: ctx.iv.id, speaker_key: speakerKey, speaker_name: speakerName,
    speaker_role: teamId ? "team" : "candidate", speaker_user_id: teamId, started_at: new Date(startedAt).toISOString(), duration_ms: durationMs,
    mime_type: mimeType, bytes: audio.length, storage_path: path,
  });
  if (error) { await admin!.storage.from(AUDIO_BUCKET).remove([path]); throw error; }
  await touchTranscript(ctx.iv);
  later(transcribeSegment(id));
  return response(req, 200, { ok: true });
}

/** A piece with nobody speaking is not sent (it would cost tokens for nothing); the browser only says the meeting is still going on. */
async function actionAlive(req: Request, body: Record<string, unknown>) {
  const allowed = await audioSender(req, body.secret);
  if (allowed.error) return allowed.error;
  await touchTranscript((allowed as { ctx: Context }).ctx.iv);
  return response(req, 200, { ok: true });
}

/** A team member ends the transcription (the meeting may go on without it): the transcript and minutes are written now. */
async function actionEnd(req: Request, body: Record<string, unknown>) {
  const found = await roomFromSecret(body.secret);
  if (!found) return fail(req, 404, "This meeting link was not found.");
  const { ctx } = found;
  const teamId = await teamMember(req, ctx.iv.id);
  if (!teamId) return fail(req, 403, "Only the hiring team can end the transcription.");
  const now = new Date().toISOString();
  const { data: existing } = await admin!.from("meeting_transcripts").select("ended_at").eq("interview_id", ctx.iv.id).maybeSingle();
  if (existing?.ended_at) return response(req, 200, { ok: true });
  if (existing) await admin!.from("meeting_transcripts").update({ ended_at: now, updated_at: now }).eq("interview_id", ctx.iv.id);
  else await admin!.from("meeting_transcripts").insert({ interview_id: ctx.iv.id, workspace_id: ctx.iv.workspace_id, state: "recording", ended_at: now });
  await addEvent(ctx.iv, "transcription_ended", "recruiter", teamId);
  later(finalize(ctx.iv.id));
  return response(req, 200, { ok: true });
}

// ---------------------------------------------------------------------------------------------------------------
// Transcription
/** Transcribes one piece (claimed once per attempt, at most 3 attempts); its audio is deleted as soon as it is transcribed, or after the last failure. */
async function transcribeSegment(id: string) {
  if (!GEMINI_KEY) { console.error("meetings: GEMINI_API_KEY_FOR_MEETINGS is not configured"); return; }
  const { data: seg } = await admin!.from("meeting_audio_segments").select("*").eq("id", id).eq("state", "pending").maybeSingle();
  if (!seg || seg.attempts >= 3) return;
  const { data: claimed } = await admin!.from("meeting_audio_segments").update({ attempts: seg.attempts + 1 }).eq("id", id).eq("attempts", seg.attempts).eq("state", "pending").select("id").maybeSingle();
  if (!claimed) return;
  const removeAudio = async () => { if (seg.storage_path) await admin!.storage.from(AUDIO_BUCKET).remove([seg.storage_path]); };
  try {
    const { data: file, error } = await admin!.storage.from(AUDIO_BUCKET).download(seg.storage_path);
    if (error || !file) throw new Error("audio_missing");
    const audio = encodeBase64(new Uint8Array(await file.arrayBuffer()));
    const { answer, model } = await callGemini(buildTranscribeRequest(audio, seg.mime_type, seg.speaker_role), GEMINI_KEY, TRANSCRIBE_MODELS);
    const utterances = parseUtterances(answer, seg.duration_ms);
    const usage = usageOf(answer);
    await admin!.from("meeting_audio_segments").update({ state: "done", utterances, model, input_tokens: usage.input, output_tokens: usage.output, storage_path: null }).eq("id", id);
    await removeAudio();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "failed";
    console.error("meetings: piece not transcribed", reason);
    if (seg.attempts + 1 >= 3 || reason === "audio_missing") {
      await admin!.from("meeting_audio_segments").update({ state: "failed", storage_path: null }).eq("id", id);
      await removeAudio();
    }
  }
}

/** When the meeting is over: every piece in time order becomes the transcript, then the minutes (when the switch is on). Runs once per ending. */
async function finalize(interviewId: string) {
  const { count: waiting } = await admin!.from("meeting_audio_segments").select("id", { count: "exact", head: true }).eq("interview_id", interviewId).eq("state", "pending").lt("attempts", 3);
  if ((waiting ?? 0) > 0) return; // pieces still being transcribed: the next tick comes back
  const now = new Date().toISOString();
  const { data: claimed } = await admin!.from("meeting_transcripts").update({ state: "processing", updated_at: now }).eq("interview_id", interviewId).eq("state", "recording").select("interview_id").maybeSingle();
  if (!claimed) return;
  try {
    const ctx = await context(interviewId);
    if (!ctx) return;
    const { data: segments } = await admin!.from("meeting_audio_segments").select("started_at,duration_ms,speaker_name,speaker_role,utterances,input_tokens,output_tokens,state").eq("interview_id", interviewId).order("started_at");
    const list = segments || [];
    const lines = mergeTranscript(list.filter((s: Row) => s.state === "done").map((s: Row) => ({ startedAt: s.started_at, name: s.speaker_name, role: s.speaker_role, utterances: s.utterances })));
    const patch: Row = {
      transcript: lines,
      audio_seconds: Math.round(list.reduce((sum: number, s: Row) => sum + (s.duration_ms || 0), 0) / 1000),
      transcript_input_tokens: list.reduce((sum: number, s: Row) => sum + (s.input_tokens || 0), 0),
      transcript_output_tokens: list.reduce((sum: number, s: Row) => sum + (s.output_tokens || 0), 0),
      minutes: null, minutes_input_tokens: null, minutes_output_tokens: null, error: null,
    };
    if (ctx.iv.minutes_enabled && lines.length) {
      const { answer } = await callGemini(buildMinutesRequest(transcriptText(lines, ctx.language, ctx.iv.time_zone || "UTC"), ctx.language, ctx.jobTitle), GEMINI_KEY, MINUTES_MODELS);
      const usage = usageOf(answer);
      Object.assign(patch, { minutes: parseMinutes(answer), minutes_input_tokens: usage.input, minutes_output_tokens: usage.output });
    }
    await admin!.from("meeting_transcripts").update({ ...patch, state: "done", processed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("interview_id", interviewId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "failed";
    console.error("meetings: transcript not finished", reason);
    await admin!.from("meeting_transcripts").update({ state: "failed", error: reason.slice(0, 200), updated_at: new Date().toISOString() }).eq("interview_id", interviewId);
  }
}

/** Every minute (database job), only when something is due: pieces that were not transcribed yet, then meetings that are over. Harmless by hand. */
async function actionTick(req: Request) {
  const old = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data: pending } = await admin!.from("meeting_audio_segments").select("id").eq("state", "pending").lt("attempts", 3).lt("created_at", old).order("created_at").limit(20);
  for (const seg of pending || []) await transcribeSegment(seg.id);
  const quiet = new Date(Date.now() - 6 * 60_000).toISOString();
  const { data: due } = await admin!.from("meeting_transcripts").select("interview_id,ended_at,last_audio_at").eq("state", "recording").or(`ended_at.not.is.null,last_audio_at.lt.${quiet}`).limit(5);
  for (const item of due || []) await finalize(item.interview_id);
  return response(req, 200, { transcribed: (pending || []).length, finished: (due || []).length });
}

// ---------------------------------------------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return response(req, 204, {});
  if (req.method !== "POST") return fail(req, 405, "Method not allowed.");
  const origin = req.headers.get("origin") || "";
  if (origin && !APP_ORIGINS.has(origin)) return fail(req, 403, "This site is not allowed to use the meeting service.");
  if (!admin) return fail(req, 503, "The meeting service is not configured.");
  try {
    if (/^audio\//i.test(req.headers.get("content-type") || "")) return await actionAudio(req);
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return fail(req, 400, "Send a valid request."); }
    if (!body || typeof body !== "object") return fail(req, 400, "Send a valid request.");
    if (body.action === "join") return await actionJoin(req, body);
    if (body.action === "create") return await actionCreate(req, body);
    if (body.action === "consent") return await actionConsent(req, body);
    if (body.action === "alive") return await actionAlive(req, body);
    if (body.action === "end") return await actionEnd(req, body);
    if (body.action === "tick") return await actionTick(req);
    return fail(req, 400, "Send a valid request.");
  } catch (error) {
    console.error("meetings: unexpected error", error instanceof Error ? error.message : error);
    return fail(req, 500, "Something went wrong. Please try again.");
  }
});
