import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const APP_ORIGINS = new Set([
  "https://soyfelps.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
]);
const TOKEN_RE = /^[a-f0-9]{64}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function envJsonValue(name: string): string {
  try { return String(JSON.parse(Deno.env.get(name) || "{}").default || ""); }
  catch { return ""; }
}
const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || envJsonValue("SUPABASE_SECRET_KEYS");
const publicKey = envJsonValue("SUPABASE_PUBLISHABLE_KEYS") || Deno.env.get("SUPABASE_ANON_KEY") || "sb_publishable_YReNH0qn4Y68VHnCjpqg7g_x9lsdu_I";
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
function fail(req: Request, status: number, message: string): Response { return response(req, status, { error: message }); }
function cleanText(value: unknown, max = 254): string { return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max); }
function normalizePermissions(value: unknown) {
  const permissions = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    can_flows: permissions.flows !== false,
    can_applicants: permissions.applicants !== false,
    can_manage_team: permissions.team !== false,
  };
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function createInviteToken(): string {
  const random = crypto.getRandomValues(new Uint8Array(32));
  return [...random].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authenticate(req: Request): Promise<{ user: { id: string; email?: string; email_confirmed_at?: string | null; user_metadata?: Record<string, unknown> }; token: string; userClient: SupabaseClient } | Response> {
  if (!admin || !publicKey) return fail(req, 500, "Team service is not configured.");
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!token) return fail(req, 401, "Sign in to use team features.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return fail(req, 401, "Your session expired. Sign in again.");
  const userClient = createClient(projectUrl, publicKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { user: { id: data.user.id, email: data.user.email, email_confirmed_at: data.user.email_confirmed_at, user_metadata: data.user.user_metadata || {} }, token, userClient };
}

async function getWorkspaceContext(userId: string) {
  if (!admin) throw new Error("Team service is not configured.");
  const { data: ownerWorkspace, error: ownerError } = await admin.from("workspaces")
    .select("id,name,created_at,owner_id").eq("owner_id", userId).maybeSingle();
  if (ownerError) throw ownerError;
  if (ownerWorkspace) {
    const { data: subscription, error } = await admin.from("workspace_subscriptions")
      .select("status,current_period_end").eq("workspace_id", ownerWorkspace.id).maybeSingle();
    if (error) throw error;
    const premiumActive = subscription?.status === "active" && Date.parse(subscription.current_period_end || "") > Date.now();
    return { workspace: ownerWorkspace, isOwner: true, member: null, premiumActive };
  }
  const { data: member, error: memberError } = await admin.from("workspace_members")
    .select("id,workspace_id,user_id,member_email,can_flows,can_applicants,can_manage_team,created_at")
    .eq("user_id", userId).maybeSingle();
  if (memberError) throw memberError;
  if (!member) return { workspace: null, isOwner: false, member: null, premiumActive: false };
  const { data: workspace, error: workspaceError } = await admin.from("workspaces")
    .select("id,name,created_at,owner_id").eq("id", member.workspace_id).maybeSingle();
  if (workspaceError) throw workspaceError;
  const { data: subscription, error: subscriptionError } = await admin.from("workspace_subscriptions")
    .select("status,current_period_end").eq("workspace_id", member.workspace_id).maybeSingle();
  if (subscriptionError) throw subscriptionError;
  const premiumActive = subscription?.status === "active" && Date.parse(subscription.current_period_end || "") > Date.now();
  const safeMember = {
    id: member.id,
    userId: member.user_id,
    email: member.member_email,
    can_flows: member.can_flows,
    can_applicants: member.can_applicants,
    can_manage_team: member.can_manage_team,
    created_at: member.created_at,
  };
  return { workspace: workspace ? { id: workspace.id, name: workspace.name, created_at: workspace.created_at, owner_id: workspace.owner_id } : null, isOwner: false, member: safeMember, premiumActive };
}

async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return response(req, 204, {});
  if (req.method !== "POST") return fail(req, 405, "Use POST for this endpoint.");
  if (origin && !APP_ORIGINS.has(origin)) return fail(req, 403, "This application origin is not allowed.");
  if (!admin || !publicKey) return fail(req, 500, "Team service is not configured.");
  const suppliedKey = req.headers.get("apikey") || req.headers.get("x-api-key") || "";
  if (suppliedKey !== publicKey) return fail(req, 401, "Invalid application client.");
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 20_000) return fail(req, 413, "The team request is too large.");
    body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid request");
  } catch { return fail(req, 400, "The team request is invalid."); }

  if (body.action === "previewInvitation") {
    const token = cleanText(body.token, 128);
    if (!TOKEN_RE.test(token)) return fail(req, 400, "This invitation link is invalid.");
    const hash = await sha256Hex(token);
    const { data: invitation, error } = await admin.from("workspace_invitations")
      .select("workspace_id,invited_email,expires_at,status").eq("token_hash", hash).maybeSingle();
    if (error) return fail(req, 503, "This invitation could not be checked.");
    if (!invitation || invitation.status !== "pending" || Date.parse(invitation.expires_at) <= Date.now()) {
      return fail(req, 404, "This invitation has expired, been revoked, or was already used.");
    }
    const [{ data: workspace, error: workspaceError }, { data: subscription, error: subscriptionError }] = await Promise.all([
      admin.from("workspaces").select("name").eq("id", invitation.workspace_id).maybeSingle(),
      admin.from("workspace_subscriptions").select("status,current_period_end").eq("workspace_id", invitation.workspace_id).maybeSingle(),
    ]);
    if (workspaceError || subscriptionError) return fail(req, 503, "This invitation could not be checked.");
    const premiumActive = subscription?.status === "active" && Date.parse(subscription.current_period_end || "") > Date.now();
    if (!premiumActive || !workspace) return fail(req, 403, "This workspace no longer has active Premium access. Ask its owner to restore Premium.");
    return response(req, 200, { workspaceName: workspace.name, invitedEmail: invitation.invited_email, expiresAt: invitation.expires_at });
  }

  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const { user, userClient } = auth;

  try {
    if (body.action === "context") {
      const context = await getWorkspaceContext(user.id);
      return response(req, 200, { ...context, isMember: Boolean(context.member), canCreateWorkspace: !context.workspace });
    }

    if (body.action === "acceptInvitation") {
      if (!user.email_confirmed_at) return fail(req, 403, "Confirm the invited email address before joining this workspace.");
      const token = cleanText(body.token, 128);
      if (!TOKEN_RE.test(token)) return fail(req, 400, "This invitation link is invalid.");
      const { data, error } = await userClient.rpc("accept_team_invitation", { p_token_hash: await sha256Hex(token) });
      if (error) return fail(req, 403, error.message || "The invitation could not be accepted.");
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.workspace_id) return fail(req, 503, "The team invitation could not be confirmed.");
      const userMetadata = { ...(auth.user.user_metadata || {}), pathway_team_invite_pending: false };
      try { await admin.auth.admin.updateUserById(user.id, { user_metadata: userMetadata }); } catch { /* membership is authoritative; invite token is already single-use */ }
      return response(req, 200, { accepted: true, workspaceId: result.workspace_id, workspaceName: result.workspace_name });
    }

    if (body.action === "acceptPendingInvitation") {
      if (!user.email_confirmed_at) return fail(req, 403, "Confirm your email address before joining a workspace.");
      if (user.user_metadata?.pathway_team_invite_pending !== true) {
        return response(req, 200, { accepted: false, reason: "no_pending_invitation" });
      }
      const email = cleanText(user.email).toLowerCase();
      if (!email) return fail(req, 403, "The confirmed account email could not be verified.");
      const { data: invitation, error: invitationError } = await admin.from("workspace_invitations")
        .select("token_hash").eq("invited_email", email).eq("status", "pending")
        .gt("expires_at", new Date().toISOString()).maybeSingle();
      if (invitationError) return fail(req, 503, "The pending workspace invitation could not be checked.");
      if (!invitation) {
        const userMetadata = { ...(user.user_metadata || {}), pathway_team_invite_pending: false };
        try { await admin.auth.admin.updateUserById(user.id, { user_metadata: userMetadata }); } catch { /* marker is advisory; no invitation remains */ }
        return response(req, 200, { accepted: false, reason: "no_pending_invitation" });
      }
      const { data, error } = await userClient.rpc("accept_team_invitation", { p_token_hash: invitation.token_hash });
      if (error) return fail(req, 403, error.message || "The invitation could not be accepted.");
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.workspace_id) return fail(req, 503, "The team invitation could not be confirmed.");
      const userMetadata = { ...(user.user_metadata || {}), pathway_team_invite_pending: false };
      try { await admin.auth.admin.updateUserById(user.id, { user_metadata: userMetadata }); } catch { /* membership is authoritative; invitation is single-use */ }
      return response(req, 200, { accepted: true, workspaceId: result.workspace_id, workspaceName: result.workspace_name });
    }

    const context = await getWorkspaceContext(user.id);
    if (!context.workspace) return fail(req, 403, "This account does not belong to a workspace. Accept a team invitation or create your own workspace first.");
    const workspaceId = context.workspace.id;
    const isOwner = context.isOwner;
    const canManage = isOwner || (context.premiumActive && Boolean(context.member?.can_manage_team));
    const requireManager = () => canManage || fail(req, 403, "You do not have permission to manage this team.");

    if (body.action === "createInvitation") {
      const permissionDenied = requireManager();
      if (permissionDenied instanceof Response) return permissionDenied;
      if (!context.premiumActive) return fail(req, 403, "An active Premium plan is required to invite team members.");
      let appUrl: URL;
      try { appUrl = new URL(cleanText(body.appUrl, 500)); }
      catch { return fail(req, 400, "The Pathway return address is invalid."); }
      if (!APP_ORIGINS.has(appUrl.origin) || appUrl.username || appUrl.password || appUrl.search || appUrl.hash || !/(?:^|\/)(?:index\.html|pathway\/)?$/.test(appUrl.pathname)) {
        return fail(req, 400, "The Pathway return address is not allowed.");
      }
      const email = cleanText(body.email).toLowerCase();
      const permissions = normalizePermissions(body.permissions);
      const token = createInviteToken();
      const { data, error } = await userClient.rpc("create_team_invitation", {
        p_workspace_id: workspaceId,
        p_email: email,
        p_token_hash: await sha256Hex(token),
        p_can_flows: permissions.can_flows,
        p_can_applicants: permissions.can_applicants,
        p_can_manage_team: permissions.can_manage_team,
      });
      if (error) return fail(req, 400, error.message || "The invitation could not be created.");
      const inviteUrl = new URL(appUrl.href);
      inviteUrl.hash = `team-invite=${token}`;
      return response(req, 200, { invitation: Array.isArray(data) ? data[0] : data, url: inviteUrl.href });
    }

    if (body.action === "listTeam") {
      if (!isOwner && !context.premiumActive) {
        return response(req, 200, {
          workspace: { id: context.workspace.id, name: context.workspace.name }, isOwner: false,
          premiumActive: false, canManage: false, members: [], invitations: [], seatsUsed: 0, seatLimit: 3,
        });
      }
      if (!canManage) {
        const { data: ownMembership, error: ownError } = await admin.from("workspace_members")
          .select("id,user_id,member_email,can_flows,can_applicants,can_manage_team,created_at")
          .eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
        if (ownError) return fail(req, 503, "Your team membership could not be loaded.");
        return response(req, 200, {
          workspace: { id: context.workspace.id, name: context.workspace.name }, isOwner: false,
          premiumActive: true, canManage: false, members: ownMembership ? [ownMembership] : [],
          invitations: [], seatsUsed: 0, seatLimit: 3,
        });
      }
      await admin.from("workspace_invitations").update({ status: "expired" })
        .eq("workspace_id", workspaceId).eq("status", "pending").lte("expires_at", new Date().toISOString());
      const [membersResult, invitesResult] = await Promise.all([
        admin.from("workspace_members").select("id,user_id,member_email,can_flows,can_applicants,can_manage_team,created_at").eq("workspace_id", workspaceId).order("created_at"),
        admin.from("workspace_invitations").select("id,invited_email,can_flows,can_applicants,can_manage_team,status,expires_at,created_at").eq("workspace_id", workspaceId).eq("status", "pending").order("created_at", { ascending: false }),
      ]);
      if (membersResult.error || invitesResult.error) return fail(req, 503, "Team members could not be loaded.");
      const ownerResult = await admin.auth.admin.getUserById(context.workspace.owner_id);
      if (ownerResult.error) return fail(req, 503, "The workspace owner could not be loaded.");
      const pendingCount = invitesResult.data?.filter((invite) => Date.parse(invite.expires_at) > Date.now()).length || 0;
      return response(req, 200, {
        workspace: { id: context.workspace.id, name: context.workspace.name },
        owner: { userId: context.workspace.owner_id, email: ownerResult.data.user?.email || null },
        isOwner, premiumActive: context.premiumActive, canManage: true,
        members: membersResult.data || [],
        invitations: invitesResult.data || [],
        seatsUsed: (membersResult.data?.length || 0) + pendingCount,
        seatLimit: 3,
      });
    }

    if (body.action === "updateMemberPermissions") {
      const permissionDenied = requireManager();
      if (permissionDenied instanceof Response) return permissionDenied;
      const memberId = cleanText(body.memberId, 64);
      if (!UUID_RE.test(memberId)) return fail(req, 400, "Choose a valid team member.");
      const p = normalizePermissions(body.permissions);
      const { data, error } = await userClient.rpc("update_team_member_permissions", {
        p_workspace_id: workspaceId, p_member_id: memberId,
        p_can_flows: p.can_flows, p_can_applicants: p.can_applicants, p_can_manage_team: p.can_manage_team,
      });
      if (error) return fail(req, 400, error.message || "Permissions could not be saved.");
      return response(req, 200, { updated: Boolean(data) });
    }

    if (body.action === "updateInvitationPermissions") {
      const permissionDenied = requireManager();
      if (permissionDenied instanceof Response) return permissionDenied;
      const invitationId = cleanText(body.invitationId, 64);
      if (!UUID_RE.test(invitationId)) return fail(req, 400, "Choose a valid invitation.");
      const p = normalizePermissions(body.permissions);
      const { data, error } = await admin.from("workspace_invitations").update({
        can_flows: p.can_flows, can_applicants: p.can_applicants, can_manage_team: p.can_manage_team,
      }).eq("id", invitationId).eq("workspace_id", workspaceId).eq("status", "pending").select("id").maybeSingle();
      if (error || !data) return fail(req, 400, "Pending invitation could not be updated.");
      return response(req, 200, { updated: true });
    }

    if (body.action === "revokeInvitation") {
      const permissionDenied = requireManager();
      if (permissionDenied instanceof Response) return permissionDenied;
      const invitationId = cleanText(body.invitationId, 64);
      if (!UUID_RE.test(invitationId)) return fail(req, 400, "Choose a valid invitation.");
      const { data, error } = await userClient.rpc("revoke_team_invitation", { p_workspace_id: workspaceId, p_invitation_id: invitationId });
      if (error) return fail(req, 400, error.message || "Invitation could not be revoked.");
      return response(req, 200, { revoked: Boolean(data) });
    }

    if (body.action === "removeMember") {
      const permissionDenied = requireManager();
      if (permissionDenied instanceof Response) return permissionDenied;
      const memberId = cleanText(body.memberId, 64);
      if (!UUID_RE.test(memberId)) return fail(req, 400, "Choose a valid team member.");
      const { data, error } = await userClient.rpc("remove_team_member", { p_workspace_id: workspaceId, p_member_id: memberId });
      if (error) return fail(req, 400, error.message || "Team member could not be removed.");
      return response(req, 200, { removed: Boolean(data) });
    }

    if (body.action === "leaveTeam") {
      if (isOwner) return fail(req, 403, "The workspace owner cannot leave their own team.");
      const { data, error } = await userClient.rpc("leave_workspace_team", { p_workspace_id: workspaceId });
      if (error) return fail(req, 400, error.message || "You could not leave this team.");
      return response(req, 200, { left: Boolean(data) });
    }

    return fail(req, 400, "Unknown team action.");
  } catch (error) {
    return fail(req, 500, error instanceof Error ? error.message : "The team request failed.");
  }
}

Deno.serve(handle);
