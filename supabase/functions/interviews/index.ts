import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { buildIcs, googleCalendarUrl, outlookCalendarUrl, type CalendarEvent } from "./calendar.ts";
import {
  buildCandidateEmail, buildRecruiterEmail, emailLanguage, formatWhen, languageOfProfile, singleLine,
  type BuiltEmail, type CandidateEmailKind, type InterviewDetails, type RecruiterEmailKind,
} from "./email.ts";
import {
  eventTitle, hashToken, isRepeat, looksLikeToken, newToken, OPEN_STATES, parseAnswer, parseScheduleInput, stateAfter, UUID_RE,
} from "./logic.ts";

// Human interviews (the "Interview" column): the recruiter schedules, edits, cancels and re-sends the invitation (signed in); the
// candidate opens the answer page from the e-mail and confirms, declines or asks for another time (no sign-in, only the secret of the
// link); every 5 minutes the database wakes the "tick" action, which sends the 24 h and 2 h reminders to confirmed interviews.
// The browser only READS the interviews (database policies); every change goes through here, as service role, after the checks below.
// Plan: D:\Pathway\plano-entrevistas.md.

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
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const EMAIL_FROM_ADDRESS = Deno.env.get("EMAIL_FROM") || "onboarding@resend.dev";
const APP_URL = (Deno.env.get("PATHWAY_APP_URL") || "https://nellio.app/").replace(/\/?$/, "/");
const admin = projectUrl && serviceKey
  ? createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

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
const fail = (req: Request, status: number, message: string, extra: Record<string, unknown> = {}) => response(req, status, { error: message, ...extra });

/** A rule of the database (errcode 22023) is shown as it is; anything else is logged and hidden behind a generic message. */
function databaseFailure(req: Request, error: { code?: string; message?: string }): Response {
  if (error.code === "22023" && error.message) return fail(req, 422, error.message);
  console.error("interviews: database error", error.code, error.message);
  return fail(req, 500, "Something went wrong. Please try again.");
}

// ---------------------------------------------------------------------------------------------------------------
// Data
async function loadContext(id: string) {
  const { data: iv, error } = await admin!.from("candidate_interviews").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!iv) return null;
  const [flowResult, workspaceResult, applicantResult] = await Promise.all([
    admin!.from("application_flows").select("id,workspace_id,job_title,company_id,interview_language,responsible_user_ids").eq("id", iv.flow_id).maybeSingle(),
    admin!.from("workspaces").select("id,name,owner_id").eq("id", iv.workspace_id).maybeSingle(),
    admin!.from("applicants").select("candidate_name").eq("flow_id", iv.flow_id).ilike("candidate_email", iv.candidate_email.replace(/[\\%_]/g, "\\$&")).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const flow: Row = flowResult.data || {};
  const workspace: Row = workspaceResult.data || {};
  let companyName = workspace.name || "";
  if (flow.company_id) {
    const { data: company } = await admin!.from("workspace_companies").select("name").eq("id", flow.company_id).maybeSingle();
    if (company?.name) companyName = company.name;
  }
  return {
    iv: iv as Row,
    flow,
    workspace,
    language: emailLanguage(flow.interview_language),
    jobTitle: String(flow.job_title || ""),
    companyName: String(companyName || ""),
    candidateName: String(applicantResult.data?.candidate_name || ""),
  };
}
type Context = NonNullable<Awaited<ReturnType<typeof loadContext>>>;

function detailsOf(iv: Row): InterviewDetails {
  return {
    kind: iv.kind, startsAt: new Date(iv.starts_at), durationMinutes: iv.duration_minutes, timeZone: iv.time_zone,
    meetingLink: iv.meeting_link, address: iv.address, notes: iv.notes,
  };
}

function calendarEventOf(ctx: Context): CalendarEvent {
  const iv = ctx.iv;
  const d = detailsOf(iv);
  const lines = [formatWhen(d.startsAt, d.durationMinutes, d.timeZone, ctx.language)];
  if (iv.notes) lines.push(String(iv.notes));
  return {
    uid: iv.id, sequence: iv.sequence, startsAt: d.startsAt, durationMinutes: d.durationMinutes,
    title: eventTitle(ctx.language, singleLine(ctx.jobTitle, 120), singleLine(ctx.companyName, 80)),
    description: lines.join("\n"), location: (d.kind === "online" ? d.meetingLink : d.address) || undefined,
  };
}

async function planActive(workspaceId: string): Promise<boolean> {
  const { data, error } = await admin!.rpc("workspace_has_active_subscription", { p_workspace_id: workspaceId });
  if (error) throw error;
  return data === true;
}

async function addEvent(iv: Row, kind: string, actor: "recruiter" | "candidate" | "system", actorUserId: string | null = null, data: Record<string, unknown> = {}) {
  const { error } = await admin!.from("candidate_interview_events").insert({ interview_id: iv.id, workspace_id: iv.workspace_id, kind, actor, actor_user_id: actorUserId, data });
  if (error) console.error("interviews: event not saved", error.message);
}

async function recentEvents(interviewId: string, kinds: string[], minutes: number): Promise<number> {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const { count } = await admin!.from("candidate_interview_events").select("id", { count: "exact", head: true }).eq("interview_id", interviewId).in("kind", kinds).gte("created_at", since);
  return count ?? 0;
}

/** Mints a new secret for the interview and returns the page address that carries it. Earlier links keep working until they expire. */
async function mintLink(iv: Row): Promise<string> {
  const token = newToken();
  const expires = new Date(Date.parse(iv.starts_at) + 7 * 24 * 3600_000).toISOString();
  const { error } = await admin!.from("candidate_interview_tokens").insert({ interview_id: iv.id, token_hash: await hashToken(token), expires_at: expires });
  if (error) throw error;
  return `${APP_URL}interview.html#${token}`;
}

async function refreshTokenExpiry(iv: Row) {
  const expires = new Date(Date.parse(iv.starts_at) + 7 * 24 * 3600_000).toISOString();
  await admin!.from("candidate_interview_tokens").update({ expires_at: expires }).eq("interview_id", iv.id);
}

// ---------------------------------------------------------------------------------------------------------------
// E-mail
async function sendMail(to: string, mail: BuiltEmail, idempotencyKey: string): Promise<boolean> {
  if (!RESEND_API_KEY) { console.log("interviews: e-mail skipped, RESEND_API_KEY is not configured."); return false; }
  try {
    const from = EMAIL_FROM_ADDRESS.includes("<") ? EMAIL_FROM_ADDRESS : `${mail.fromName} <${EMAIL_FROM_ADDRESS}>`;
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from, to: [to], subject: mail.subject, text: mail.text, html: mail.html }),
    });
    if (!result.ok) console.error("interviews: Resend refused the e-mail", result.status);
    return result.ok;
  } catch (error) {
    console.error("interviews: e-mail failed", error instanceof Error ? error.message : error);
    return false;
  }
}

async function sendToCandidate(ctx: Context, kind: CandidateEmailKind, keySuffix: string): Promise<boolean> {
  // A cancellation has no button, so it needs no new secret.
  const pageUrl = kind === "cancel" ? APP_URL : await mintLink(ctx.iv);
  const mail = buildCandidateEmail({
    kind, language: ctx.language, candidateName: ctx.candidateName, jobTitle: ctx.jobTitle, companyName: ctx.companyName,
    interview: detailsOf(ctx.iv), pageUrl,
  });
  return await sendMail(ctx.iv.candidate_email, mail, `interview-${kind}/${ctx.iv.id}/${keySuffix}`);
}

/** The people who hear about the interview: who scheduled it plus the people responsible for the job (the owner when nobody is named). */
async function recruiterRecipients(ctx: Context): Promise<Array<{ email: string; language: ReturnType<typeof languageOfProfile> }>> {
  const ids = new Set<string>();
  if (ctx.iv.scheduled_by) ids.add(ctx.iv.scheduled_by);
  for (const id of ctx.flow.responsible_user_ids || []) ids.add(id);
  if (!ids.size && ctx.workspace.owner_id) ids.add(ctx.workspace.owner_id);
  const { data: profiles } = await admin!.from("profiles").select("user_id,ui_language").in("user_id", [...ids]);
  const out: Array<{ email: string; language: ReturnType<typeof languageOfProfile> }> = [];
  for (const id of ids) {
    const { data } = await admin!.auth.admin.getUserById(id);
    const email = data?.user?.email;
    if (!email) continue;
    out.push({ email, language: languageOfProfile(profiles?.find((p: Row) => p.user_id === id)?.ui_language) });
  }
  return out;
}

async function notifyRecruiters(ctx: Context, kind: RecruiterEmailKind, keySuffix: string, extra: { message?: string | null; suggestedTimes?: string[] } = {}) {
  try {
    const event = calendarEventOf(ctx);
    for (const person of await recruiterRecipients(ctx)) {
      const mail = buildRecruiterEmail({
        kind, language: person.language, candidateName: ctx.candidateName, candidateEmail: ctx.iv.candidate_email, jobTitle: ctx.jobTitle, companyName: ctx.companyName,
        interview: detailsOf(ctx.iv), message: extra.message, suggestedTimes: extra.suggestedTimes, appUrl: `${APP_URL}#applicants`,
        calendarLinks: kind === "scheduled" ? { google: googleCalendarUrl(event), outlook: outlookCalendarUrl(event) } : undefined,
      });
      await sendMail(person.email, mail, `interview-recruiter-${kind}/${ctx.iv.id}/${keySuffix}/${person.email}`);
    }
  } catch (error) {
    console.error("interviews: recruiter e-mail failed", error instanceof Error ? error.message : error);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Views
function recruiterRow(iv: Row) {
  return {
    id: iv.id, flowId: iv.flow_id, email: iv.candidate_email, state: iv.state, kind: iv.kind, localStart: iv.local_start ? String(iv.local_start).slice(0, 16).replace(" ", "T") : null,
    timeZone: iv.time_zone, startsAt: iv.starts_at, durationMinutes: iv.duration_minutes, meetingLink: iv.meeting_link, address: iv.address, notes: iv.notes,
    sequence: iv.sequence, responseNote: iv.response_note, proposedTimes: iv.proposed_times || [], invitedAt: iv.invited_at, respondedAt: iv.responded_at,
  };
}

/** What the answer page shows. Never the e-mail address of the candidate, and the meeting details only while the interview is on. */
function candidateView(ctx: Context) {
  const iv = ctx.iv;
  const on = (OPEN_STATES as readonly string[]).includes(iv.state);
  const startsAt = new Date(iv.starts_at);
  const limit = new Date(startsAt.getTime() + 30 * 24 * 3600_000);
  const event = calendarEventOf(ctx);
  return {
    state: iv.state, language: ctx.language, candidateName: ctx.candidateName, jobTitle: ctx.jobTitle, companyName: ctx.companyName,
    kind: iv.kind, startsAt: iv.starts_at, timeZone: iv.time_zone, durationMinutes: iv.duration_minutes,
    when: formatWhen(startsAt, iv.duration_minutes, iv.time_zone, ctx.language),
    meetingLink: on ? iv.meeting_link : null, address: on ? iv.address : null, notes: on ? iv.notes : null,
    canRespond: on && startsAt.getTime() > Date.now(),
    responseNote: iv.response_note, proposedTimes: iv.proposed_times || [],
    suggestUntil: limit.toISOString(),
    suggestUntilDate: new Intl.DateTimeFormat("en-CA", { timeZone: iv.time_zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(limit),
    calendar: on ? { google: googleCalendarUrl(event), outlook: outlookCalendarUrl(event) } : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Recruiter actions (signed in)
async function authenticate(req: Request): Promise<{ userId: string; userClient: SupabaseClient } | Response> {
  if (!publicKey) return fail(req, 503, "The interview service is not configured.");
  const token = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!token) return fail(req, 401, "Sign in to schedule interviews.");
  const { data, error } = await admin!.auth.getUser(token);
  if (error || !data.user) return fail(req, 401, "Your session expired. Sign in again.");
  const userClient = createClient(projectUrl, publicKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId: data.user.id, userClient };
}

/** The interview, only if the person may review the candidates of its workspace (the database policy decides, not this code). */
async function visibleInterview(userClient: SupabaseClient, body: Record<string, unknown>): Promise<Row | null> {
  const id = typeof body.interviewId === "string" && UUID_RE.test(body.interviewId) ? body.interviewId : "";
  if (!id) return null;
  const { data, error } = await userClient.from("candidate_interviews").select("id,workspace_id,state").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

async function actionSchedule(req: Request, userId: string, userClient: SupabaseClient, body: Record<string, unknown>) {
  const seen = await visibleInterview(userClient, body);
  if (!seen) return fail(req, 404, "The interview was not found.");
  if (seen.state !== "awaiting_schedule" && !(OPEN_STATES as readonly string[]).includes(seen.state)) return fail(req, 409, "This interview can no longer be changed.");
  const parsed = parseScheduleInput(body);
  if (!parsed.ok) return fail(req, 400, parsed.error);
  if (!(await planActive(seen.workspace_id))) return fail(req, 402, "An active plan is needed to schedule interviews.");
  const v = parsed.value;
  const now = new Date().toISOString();
  const { data: before } = await admin!.from("candidate_interviews").select("sequence").eq("id", seen.id).maybeSingle();
  const { data: updated, error } = await admin!.from("candidate_interviews").update({
    state: "invited", kind: v.kind, local_start: v.localStart, time_zone: v.timeZone, duration_minutes: v.durationMinutes,
    meeting_link: v.meetingLink, address: v.address, notes: v.notes, sequence: (before?.sequence ?? 0) + 1, invited_at: now,
    responded_at: null, notice_at: null, response_note: null, proposed_times: [], reminder_24h_sent_at: null, reminder_2h_sent_at: null, scheduled_by: userId,
  }).eq("id", seen.id).eq("state", seen.state).select("*").maybeSingle();
  if (error) return databaseFailure(req, error);
  if (!updated) return fail(req, 409, "This interview can no longer be changed.");
  await refreshTokenExpiry(updated);
  const wasFirst = seen.state === "awaiting_schedule";
  await addEvent(updated, wasFirst ? "scheduled" : "updated", "recruiter", userId, { startsAt: updated.starts_at, kind: updated.kind });
  const ctx = await loadContext(updated.id);
  if (!ctx) return fail(req, 404, "The interview was not found.");
  const sent = await sendToCandidate(ctx, wasFirst ? "invite" : "update", String(updated.sequence));
  await notifyRecruiters(ctx, "scheduled", String(updated.sequence));
  return response(req, 200, sent ? { interview: recruiterRow(updated), emailSent: true } : { interview: recruiterRow(updated), emailSent: false, warning: "The interview was saved, but the e-mail could not be sent. Use Resend to try again." });
}

async function actionCancel(req: Request, userId: string, userClient: SupabaseClient, body: Record<string, unknown>) {
  const seen = await visibleInterview(userClient, body);
  if (!seen) return fail(req, 404, "The interview was not found.");
  if (!(OPEN_STATES as readonly string[]).includes(seen.state)) return fail(req, 409, "This interview can no longer be changed.");
  const { data: updated, error } = await admin!.from("candidate_interviews").update({ state: "cancelled", notice_at: null }).eq("id", seen.id).eq("state", seen.state).select("*").maybeSingle();
  if (error) return databaseFailure(req, error);
  if (!updated) return fail(req, 409, "This interview can no longer be changed.");
  await addEvent(updated, "cancelled", "recruiter", userId);
  const ctx = await loadContext(updated.id);
  const sent = ctx ? await sendToCandidate(ctx, "cancel", String(updated.sequence)) : false;
  return response(req, 200, sent ? { interview: recruiterRow(updated), emailSent: true } : { interview: recruiterRow(updated), emailSent: false, warning: "The interview was cancelled, but the e-mail could not be sent." });
}

async function actionResend(req: Request, userId: string, userClient: SupabaseClient, body: Record<string, unknown>) {
  const seen = await visibleInterview(userClient, body);
  if (!seen) return fail(req, 404, "The interview was not found.");
  if (!(OPEN_STATES as readonly string[]).includes(seen.state)) return fail(req, 409, "This interview can no longer be changed.");
  if (await recentEvents(seen.id, ["resent"], 60) >= 3) return fail(req, 429, "The e-mail was already sent again several times. Try again later.");
  const ctx = await loadContext(seen.id);
  if (!ctx) return fail(req, 404, "The interview was not found.");
  if (new Date(ctx.iv.starts_at).getTime() <= Date.now()) return fail(req, 409, "This interview has already taken place.");
  if (!(await planActive(ctx.iv.workspace_id))) return fail(req, 402, "An active plan is needed to schedule interviews.");
  await addEvent(ctx.iv, "resent", "recruiter", userId);
  const sent = await sendToCandidate(ctx, "invite", `resend-${Date.now()}`);
  return response(req, 200, sent ? { interview: recruiterRow(ctx.iv), emailSent: true } : { interview: recruiterRow(ctx.iv), emailSent: false, warning: "The e-mail could not be sent. Try again." });
}

// ---------------------------------------------------------------------------------------------------------------
// Candidate actions (no sign-in: the secret of the link is the key)
async function contextFromToken(req: Request, body: Record<string, unknown>): Promise<{ ctx: Context } | Response> {
  if (!looksLikeToken(body.token)) return fail(req, 404, "This invitation was not found.");
  const { data: row, error } = await admin!.from("candidate_interview_tokens").select("interview_id,expires_at").eq("token_hash", await hashToken(body.token)).maybeSingle();
  if (error) throw error;
  if (!row) return fail(req, 404, "This invitation was not found.");
  if (Date.parse(row.expires_at) <= Date.now()) return fail(req, 410, "This invitation is no longer available.");
  const ctx = await loadContext(row.interview_id);
  if (!ctx || ctx.iv.state === "awaiting_schedule") return fail(req, 404, "This invitation was not found.");
  return { ctx };
}

async function actionGet(req: Request, body: Record<string, unknown>) {
  const found = await contextFromToken(req, body);
  if (found instanceof Response) return found;
  return response(req, 200, { interview: candidateView(found.ctx) });
}

async function actionRespond(req: Request, body: Record<string, unknown>) {
  const found = await contextFromToken(req, body);
  if (found instanceof Response) return found;
  const { ctx } = found;
  const iv = ctx.iv;
  if (iv.state === "cancelled") return fail(req, 409, "This interview was cancelled.");
  if (!(OPEN_STATES as readonly string[]).includes(iv.state) || new Date(iv.starts_at).getTime() <= Date.now()) return fail(req, 409, "This interview has already taken place.");
  const parsed = parseAnswer(body);
  if (!parsed.ok) return fail(req, 400, parsed.error);
  const answer = parsed.value;
  if (isRepeat(iv.state, answer)) return response(req, 200, { interview: candidateView(ctx) });
  if (await recentEvents(iv.id, ["confirmed", "declined", "reschedule_requested"], 60) >= 10) return fail(req, 429, "Too many changes. Try again later.");
  const now = new Date().toISOString();
  const { data: updated, error } = await admin!.from("candidate_interviews").update({
    state: stateAfter(answer), responded_at: now, notice_at: now,
    response_note: answer.response === "confirm" ? null : answer.note,
    proposed_times: answer.response === "reschedule" ? answer.times.map((local) => ({ local })) : [],
  }).eq("id", iv.id).eq("state", iv.state).select("*").maybeSingle();
  if (error) return databaseFailure(req, error);
  if (!updated) return fail(req, 409, "This interview can no longer be changed.");
  const kind = answer.response === "confirm" ? "confirmed" : answer.response === "decline" ? "declined" : "reschedule_requested";
  await addEvent(updated, kind, "candidate", null, answer.response === "reschedule" ? { times: answer.times } : {});
  const fresh = { ...ctx, iv: updated };
  await notifyRecruiters(fresh, answer.response === "confirm" ? "confirmed" : answer.response === "decline" ? "declined" : "reschedule", String(Date.parse(now)),
    { message: answer.response === "confirm" ? null : answer.note, suggestedTimes: answer.response === "reschedule" ? answer.times : [] });
  return response(req, 200, { interview: candidateView(fresh) });
}

async function actionCalendar(req: Request, body: Record<string, unknown>) {
  const found = await contextFromToken(req, body);
  if (found instanceof Response) return found;
  if (!(OPEN_STATES as readonly string[]).includes(found.ctx.iv.state)) return fail(req, 409, "This interview was cancelled.");
  return response(req, 200, { filename: "interview.ics", content: buildIcs(calendarEventOf(found.ctx)) });
}

// ---------------------------------------------------------------------------------------------------------------
// Reminders: woken every 5 minutes by the database, only when one is due. Harmless to call by hand: each reminder is claimed once.
async function actionTick(req: Request) {
  const { data: due, error } = await admin!.rpc("candidate_interview_reminders_due");
  if (error) { console.error("interviews: tick failed", error.message); return fail(req, 500, "Something went wrong. Please try again."); }
  let sent = 0;
  for (const item of (due || []).slice(0, 50) as Array<{ interview_id: string; reminder: "24h" | "2h" }>) {
    const column = item.reminder === "24h" ? "reminder_24h_sent_at" : "reminder_2h_sent_at";
    const { data: claimed } = await admin!.from("candidate_interviews").update({ [column]: new Date().toISOString() }).eq("id", item.interview_id).eq("state", "confirmed").is(column, null).select("id").maybeSingle();
    if (!claimed) continue;
    const ctx = await loadContext(item.interview_id);
    const ok = ctx ? await sendToCandidate(ctx, item.reminder === "24h" ? "reminder24" : "reminder2", `${ctx.iv.sequence}`) : false;
    if (ok && ctx) { sent++; await addEvent(ctx.iv, item.reminder === "24h" ? "reminder_24h" : "reminder_2h", "system"); }
    else await admin!.from("candidate_interviews").update({ [column]: null }).eq("id", item.interview_id); // try again on the next tick
  }
  return response(req, 200, { sent });
}

// ---------------------------------------------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return response(req, 204, {});
  if (req.method !== "POST") return fail(req, 405, "Method not allowed.");
  const origin = req.headers.get("origin") || "";
  if (origin && !APP_ORIGINS.has(origin)) return fail(req, 403, "This site is not allowed to use the interview service.");
  if (!admin) return fail(req, 503, "The interview service is not configured.");
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail(req, 400, "Send a valid request."); }
  if (!body || typeof body !== "object") return fail(req, 400, "Send a valid request.");
  const action = String(body.action || "");
  try {
    if (action === "get") return await actionGet(req, body);
    if (action === "respond") return await actionRespond(req, body);
    if (action === "calendar") return await actionCalendar(req, body);
    if (action === "tick") return await actionTick(req);
    if (action === "schedule" || action === "cancel" || action === "resend") {
      const auth = await authenticate(req);
      if (auth instanceof Response) return auth;
      if (action === "schedule") return await actionSchedule(req, auth.userId, auth.userClient, body);
      if (action === "cancel") return await actionCancel(req, auth.userId, auth.userClient, body);
      return await actionResend(req, auth.userId, auth.userClient, body);
    }
    return fail(req, 400, "Send a valid request.");
  } catch (error) {
    console.error("interviews: unexpected error", error instanceof Error ? error.message : error);
    return fail(req, 500, "Something went wrong. Please try again.");
  }
});
