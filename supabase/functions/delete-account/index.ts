import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const APP_ORIGINS = new Set([
  "https://soyfelps.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
]);

function envJsonValue(name: string): string {
  try {
    const parsed = JSON.parse(Deno.env.get(name) || "{}");
    return String(parsed.default || "");
  } catch {
    return "";
  }
}

const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || envJsonValue("SUPABASE_SECRET_KEYS");
const publicKey = envJsonValue("SUPABASE_PUBLISHABLE_KEYS") || Deno.env.get("SUPABASE_ANON_KEY") || "sb_publishable_YReNH0qn4Y68VHnCjpqg7g_x9lsdu_I";
const admin = projectUrl && serviceKey
  ? createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

function response(req: Request, status: number, body: unknown) {
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

function fail(req: Request, status: number, message: string) {
  return response(req, status, { error: message });
}

async function revokeAccountInvitations(userId: string, email: string): Promise<string | null> {
  if (!admin) return "Account service is not configured.";
  const normalizedEmail = email.toLowerCase();

  // Pending links created by this account must stop working when its manager leaves.
  const { error: sentError } = await admin.from("workspace_invitations")
    .update({ status: "revoked" }).eq("invited_by", userId).eq("status", "pending");
  if (sentError) return "Pending invitations could not be revoked.";

  // Remove invitation history tied to this account and pending invitations addressed to its email.
  const { error: acceptedError } = await admin.from("workspace_invitations")
    .delete().eq("accepted_user_id", userId);
  if (acceptedError) return "Invitation records could not be removed.";
  const { error: receivedError } = await admin.from("workspace_invitations")
    .delete().eq("invited_email", normalizedEmail).eq("status", "pending");
  if (receivedError) return "Pending invitations addressed to this account could not be removed.";
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return response(req, 204, {});
  if (req.method !== "POST") return fail(req, 405, "Use POST for this endpoint.");
  const origin = req.headers.get("origin") || "";
  if (origin && !APP_ORIGINS.has(origin)) return fail(req, 403, "This application origin is not allowed.");
  if (!admin || !projectUrl || !publicKey) return fail(req, 503, "Account deletion is not configured yet.");

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 4096) return fail(req, 413, "The request is too large.");
  let body: Record<string, unknown>;
  try {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > 4096) return fail(req, 413, "The request is too large.");
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail(req, 400, "The request body must be an object.");
    body = parsed as Record<string, unknown>;
  } catch {
    return fail(req, 400, "The request body must be valid JSON.");
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (!password || password.length > 1024) return fail(req, 400, "Enter your password to confirm account deletion.");

  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!bearer) return fail(req, 401, "Sign in again before deleting your account.");
  const { data: auth, error: authError } = await admin.auth.getUser(bearer);
  if (authError || !auth.user) return fail(req, 401, "Your session expired. Sign in again.");
  if (!auth.user.email) return fail(req, 400, "This account has no email address to verify.");

  // Validate the password through Supabase Auth using only the public key; never log or persist it.
  const verifier = createClient(projectUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let verifiedUserId = "";
  try {
    const { data, error } = await verifier.auth.signInWithPassword({ email: auth.user.email, password });
    if (error) {
      const status = Number((error as { status?: number }).status || 0);
      if (status === 429) return fail(req, 429, "Too many password attempts. Wait a moment and try again.");
      if (status >= 500) return fail(req, 503, "Password verification is temporarily unavailable. Try again.");
      return fail(req, 401, "Password verification failed. Check your password and try again.");
    }
    verifiedUserId = data.user?.id || "";
  } catch {
    return fail(req, 503, "Password verification is temporarily unavailable. Try again.");
  } finally {
    try { await verifier.auth.signOut({ scope: "local" }); } catch { /* The temporary verification session is never returned to the browser. */ }
  }
  if (verifiedUserId !== auth.user.id) return fail(req, 401, "Password verification failed. Check your password and try again.");

  const [{ data: ownedWorkspace, error: ownerError }, { data: membership, error: memberError }] = await Promise.all([
    admin.from("workspaces").select("id,name").eq("owner_id", auth.user.id).maybeSingle(),
    admin.from("workspace_members").select("workspace_id,member_email").eq("user_id", auth.user.id).maybeSingle(),
  ]);
  if (ownerError || memberError) return fail(req, 503, "Workspace access could not be verified. Your account was not deleted.");
  if (ownedWorkspace && membership) return fail(req, 409, "This account has conflicting workspace roles. No data was changed; contact support.");

  let workspaceDeleted = false;
  if (ownedWorkspace) {
    // Reuse the existing owner-only cleanup, which cancels Stripe before deleting workspace data and resumes.
    let billingResponse: Response;
    try {
      billingResponse = await fetch(`${projectUrl.replace(/\/$/, "")}/functions/v1/billing`, {
        method: "POST",
        headers: { apikey: publicKey, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteWorkspace" }),
      });
    } catch {
      return fail(req, 503, "We could not confirm workspace cleanup, so account deletion did not continue. The workspace or subscription may already have been removed or canceled. Refresh and retry to finish safely.");
    }
    let billingResult: Record<string, unknown> = {};
    try {
      const parsed = await billingResponse.json();
      if (parsed && typeof parsed === "object") billingResult = parsed as Record<string, unknown>;
    } catch { /* The stable error below avoids forwarding internal billing details. */ }
    if (!billingResponse.ok || billingResult.deleted !== true) {
      return fail(req, 503, "Workspace cleanup did not finish, so account deletion did not continue. If you had a subscription, it may already have been canceled. Refresh and retry to finish safely, or contact support.");
    }
    workspaceDeleted = true;
  }

  const invitationError = await revokeAccountInvitations(auth.user.id, auth.user.email);
  if (invitationError) {
    const message = workspaceDeleted
      ? "The workspace was deleted, but invitation cleanup did not finish. Refresh and retry account deletion."
      : `Your account was not deleted. ${invitationError}`;
    return fail(req, 503, message);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(auth.user.id, false);
  if (deleteError) {
    console.error("Supabase Auth account deletion failed", { status: Number((deleteError as { status?: number }).status || 0) });
    const message = workspaceDeleted
      ? "The workspace was deleted, but account deletion could not finish. Refresh and retry Delete account; the workspace will not be recreated."
      : "Your account could not be deleted. No workspace data was removed; try again or contact support.";
    return fail(req, 503, message);
  }

  return response(req, 200, { deleted: true, workspace_deleted: workspaceDeleted });
});
