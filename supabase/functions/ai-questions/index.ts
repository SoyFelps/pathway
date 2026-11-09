import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createQuestion } from "./gemini.ts";

// Writes ONE AI interview question from the job description, for the signed-in person who edits the job. The browser sends the description and the
// questions that are in the field right now (the draft); this function never reads or writes a job. The Gemini key lives only here, in the project
// secret GEMINI_API_KEY_FOR_QUESTIONS (a different key in staging and in production, same name). Nothing is stored, and the job text is never logged.

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
const MAX_BODY_BYTES = 60_000;

function envJsonValue(name: string): string {
  try { return String(JSON.parse(Deno.env.get(name) || "{}").default || ""); }
  catch { return ""; }
}
const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || envJsonValue("SUPABASE_SECRET_KEYS");
const geminiKey = Deno.env.get("GEMINI_API_KEY_FOR_QUESTIONS") || "";
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
const fail = (req: Request, status: number, code: string, message: string) => response(req, status, { error: message, code });

/** The owner, or a member allowed to edit jobs. (Members also need the plan to be active, which the Premium check below covers for everyone.) */
async function mayEditJobs(userId: string, workspaceId: string): Promise<boolean> {
  const { data: workspace, error } = await admin!.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle();
  if (error) throw error;
  if (!workspace) return false;
  if (workspace.owner_id === userId) return true;
  const { data: member, error: memberError } = await admin!.from("workspace_members").select("can_flows").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  if (memberError) throw memberError;
  return member?.can_flows === true;
}

async function premiumActive(workspaceId: string): Promise<boolean> {
  const { data, error } = await admin!.from("workspace_subscriptions").select("status,current_period_end").eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw error;
  return data?.status === "active" && Date.parse(data.current_period_end || "") > Date.now();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return response(req, 204, null);
  if (req.method !== "POST") return fail(req, 405, "method", "Use POST.");
  if (!admin || !geminiKey) return fail(req, 503, "not_configured", "The AI question service is not configured.");

  const token = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!token) return fail(req, 401, "signed_out", "Sign in to use AI.");
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return fail(req, 401, "signed_out", "Your session expired. Sign in again.");

  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return fail(req, 413, "too_large", "The request is too large.");
    body = JSON.parse(text);
  } catch { return fail(req, 400, "bad_request", "The request could not be read."); }
  const workspaceId = typeof body.workspaceId === "string" && UUID_RE.test(body.workspaceId) ? body.workspaceId : "";
  if (!workspaceId) return fail(req, 400, "bad_request", "The request could not be read.");

  try {
    if (!(await mayEditJobs(authData.user.id, workspaceId))) return fail(req, 403, "forbidden", "You are not allowed to edit jobs in this workspace.");
    if (!(await premiumActive(workspaceId))) return fail(req, 403, "premium_required", "Writing questions with AI needs a paid plan.");
    const result = await createQuestion({ jobTitle: body.jobTitle, description: body.description, existing: body.existing }, { apiKey: geminiKey });
    return response(req, 200, result);
  } catch (error) {
    console.error("ai-questions failed:", error instanceof Error ? error.message : "unknown error"); // never the job text, the key or Google's reply
    return fail(req, 502, "ai_unavailable", "The AI could not answer right now.");
  }
});
