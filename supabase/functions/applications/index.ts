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
const BUCKET = "applicant-resumes";
const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const MAX_FORM_BYTES = MAX_RESUME_BYTES + 128 * 1024;
const NOTICE_VERSION = "2026-09-26-v1";
const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};
const EXTENSION_MIMES: Record<string, string> = Object.fromEntries(Object.entries(MIME_EXTENSIONS).map(([mime, ext]) => [ext, mime]));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const envJsonValue = (name: string): string => {
  try {
    const parsed = JSON.parse(Deno.env.get(name) || "{}");
    return String(parsed.default || "");
  } catch {
    return "";
  }
};
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
  return status === 204
    ? new Response(null, { status, headers })
    : new Response(JSON.stringify(body), { status, headers });
}

function fail(req: Request, status: number, message: string) {
  return response(req, status, { error: message });
}

function cleanName(value: unknown, max = 200): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function boundedRequest(req: Request, maxBytes: number): Promise<Request | null> {
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(req.url, { method: req.method, headers: req.headers, body: bytes });
}


async function loadActiveFlow(publishedId: string) {
  if (!admin) throw new Error("Application service is not configured.");
  const { data: publication, error: publicationError } = await admin
    .from("published_flows").select("id,flow_id,workspace_id,snapshot").eq("id", publishedId).maybeSingle();
  if (publicationError) throw publicationError;
  if (!publication) throw new Error("This job link is no longer available.");
  const { data: flow, error: flowError } = await admin
    .from("application_flows").select("id,workspace_id,publication_status,active_published_flow_id")
    .eq("id", publication.flow_id).eq("workspace_id", publication.workspace_id).maybeSingle();
  if (flowError) throw flowError;
  if (!flow || flow.publication_status !== "published" || flow.active_published_flow_id !== publication.id) {
    throw new Error("This job is no longer accepting applications.");
  }
  const { data: subscription, error: subscriptionError } = await admin.from("workspace_subscriptions")
    .select("status,current_period_end").eq("workspace_id", flow.workspace_id).maybeSingle();
  if (subscriptionError) throw subscriptionError;
  if (subscription?.status !== "active" || !subscription.current_period_end || Date.parse(subscription.current_period_end) <= Date.now()) {
    throw new Error("This job is no longer accepting applications.");
  }
  return { publication, flow, snapshot: publication.snapshot as Record<string, unknown> };
}

function parseJsonField<T>(form: FormData, key: string, fallback: T): T {
  const value = form.get(key);
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; }
  catch { throw new Error(`The application field '${key}' is invalid.`); }
}

async function validateApplicantSubmission(snapshot: Record<string, unknown>, input: {
  name: unknown;
  email: unknown;
  candidateInfo: unknown;
  answers: unknown;
  privacyAcknowledged: unknown;
  resume: File | null;
}) {
  const name = cleanName(input.name, 200);
  const email = cleanName(input.email, 254).toLowerCase();
  if (!name) throw new Error("Enter your full name.");
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (input.privacyAcknowledged !== "true") throw new Error("Confirm the privacy notice to continue.");

  const resume = input.resume;
  if (!(resume instanceof File) || resume.size < 1) throw new Error("Choose a resume before submitting your application.");
  if (resume.size > MAX_RESUME_BYTES) throw new Error("Your resume must be 10 MB or smaller.");
  const filename = cleanName(resume.name, 255).replace(/[\\/]/g, "_");
  const extension = filename.split(".").pop()?.toLowerCase() || "";
  const reportedType = resume.type.toLowerCase();
  const contentType = (!reportedType || reportedType === "application/octet-stream")
    ? EXTENSION_MIMES[extension]
    : reportedType;
  if (!MIME_EXTENSIONS[contentType] || extension !== MIME_EXTENSIONS[contentType]) throw new Error("Upload your resume as a PDF, DOC, or DOCX file.");
  const signature = new Uint8Array(await resume.slice(0, 1024).arrayBuffer());
  const startsWith = (bytes: number[]) => bytes.every((byte, index) => signature[index] === byte);
  const pdfSignature = Array.from(signature).some((_, index) => index <= signature.length - 5 &&
    signature[index] === 0x25 && signature[index + 1] === 0x50 && signature[index + 2] === 0x44 && signature[index + 3] === 0x46 && signature[index + 4] === 0x2d);
  const looksLikeExpectedFile = contentType === "application/pdf" ? pdfSignature
    : contentType === "application/msword" ? startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    : startsWith([0x50, 0x4b, 0x03, 0x04]) || startsWith([0x50, 0x4b, 0x05, 0x06]);
  if (!looksLikeExpectedFile) throw new Error("The selected file does not look like a valid PDF, DOC, or DOCX resume.");

  const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes as Array<Record<string, unknown>> : [];
  const edges = Array.isArray(snapshot.edges) ? snapshot.edges as Array<Record<string, unknown>> : [];
  const info = nodes.filter((node) => node.type === "candidateInfo");
  if (nodes.length < 2 || info.length !== 1 || nodes.length > 200 || edges.length > 400) throw new Error("This published job flow is invalid.");
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  const startEdges = edges.filter((edge) => edge.fromNodeId === info[0].id);
  if (startEdges.length !== 1) throw new Error("This published job flow is invalid.");
  let current = byId.get(String(startEdges[0].toNodeId));
  const submitted = Array.isArray(input.answers) ? input.answers as Array<Record<string, unknown>> : null;
  if (!submitted || submitted.length > 100) throw new Error("Some answers could not be validated.");
  let answerIndex = 0;
  let steps = 0;

  while (current && current.type !== "end") {
    if (++steps > 100) throw new Error("This published job flow is invalid.");
    const nodeId = String(current.id);
    const type = String(current.type);
    if (!["shortText", "singleChoice", "multiChoice"].includes(type)) throw new Error("This published job flow contains an unsupported question.");
    const responseItem = submitted[answerIndex++];
    if (!responseItem || responseItem.nodeId !== nodeId) throw new Error("Please complete each question before submitting.");
    const options = Array.isArray(current.options) ? current.options.map(String) : [];
    const answer = responseItem.answer;
    if (type === "shortText") {
      if (typeof answer !== "string" || !answer.trim() || answer.length > 4000) throw new Error("A written answer is missing or too long.");
    } else if (type === "singleChoice") {
      if (typeof answer !== "string" || !options.includes(answer)) throw new Error("Choose one of the listed options.");
    } else if (!Array.isArray(answer) || answer.length < 1 || answer.length > options.length || answer.some((item) => typeof item !== "string" || !options.includes(item)) || new Set(answer).size !== answer.length) {
      throw new Error("Choose at least one valid option.");
    }
    const outgoing = edges.filter((edge) => edge.fromNodeId === nodeId);
    const chosenEdge = type === "singleChoice"
      ? outgoing.find((edge) => edge.optionValue === answer)
      : outgoing.find((edge) => !edge.optionValue) || (outgoing.length === 1 ? outgoing[0] : null);
    if (!chosenEdge) throw new Error("The selected answer has no valid next step.");
    current = byId.get(String(chosenEdge.toNodeId));
  }
  if (!current || current.type !== "end" || answerIndex !== submitted.length) throw new Error("The application answers do not match this job flow.");

  const configured = snapshot.candidateInfoFields && typeof snapshot.candidateInfoFields === "object"
    ? snapshot.candidateInfoFields as Record<string, unknown> : {};
  const allowedOptional = new Set(["phone", "country", "address", "city", "linkedin", "portfolio", "workAuthorization", "pronouns"]);
  const rawInfo = input.candidateInfo && typeof input.candidateInfo === "object" && !Array.isArray(input.candidateInfo)
    ? input.candidateInfo as Record<string, unknown> : {};
  const candidateInfo: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawInfo)) {
    if (!allowedOptional.has(key) || configured[key] !== true) continue;
    const text = cleanName(value, key === "address" ? 300 : key === "linkedin" || key === "portfolio" ? 500 : 150);
    if (!text) continue;
    if (key === "linkedin" || key === "portfolio") {
      try {
        const parsed = new URL(text);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch { throw new Error(`Enter a valid ${key === "linkedin" ? "LinkedIn" : "portfolio"} URL.`); }
    }
    candidateInfo[key] = text;
  }

  const storedAnswers = submitted.map((item, index) => ({
    nodeId: String(item.nodeId), question: cleanName(byId.get(String(item.nodeId))?.label, 500), answer: item.answer, order: index + 1,
  }));
  return {
    name, email, candidateInfo, answers: storedAnswers,
    outcomeStatus: current.subtype === "disqualified" ? "failed" : "new",
    filename, contentType, resume,
  };
}

async function submitApplicant(req: Request, form: FormData) {
  if (!admin) return fail(req, 500, "Application service is not configured.");
  const publishedId = cleanName(form.get("publishedFlowId"), 100);
  const submissionKey = cleanName(form.get("submissionKey"), 100);
  if (!UUID_RE.test(publishedId) || !UUID_RE.test(submissionKey)) return fail(req, 400, "This application link is invalid.");
  if (cleanName(form.get("website"), 300)) return response(req, 200, { submitted: true, accepted: true });

  let active;
  let normalized;
  try {
    active = await loadActiveFlow(publishedId);
    normalized = await validateApplicantSubmission(active.snapshot, {
      name: form.get("name"), email: form.get("email"), candidateInfo: parseJsonField(form, "candidateInfo", {}),
      answers: parseJsonField(form, "answers", []), privacyAcknowledged: form.get("privacyAcknowledged"),
      resume: form.get("resume") instanceof File ? form.get("resume") as File : null,
    });
  } catch (error) {
    return fail(req, 400, error instanceof Error ? error.message : "The application could not be validated.");
  }

  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const userAgent = cleanName(req.headers.get("user-agent"), 200);
  const clientKeyHash = await sha256Hex(`${active.flow.id}|${ip}|${ip === "unknown" ? userAgent : ""}`);
  const { data: underLimit, error: limitError } = await admin.rpc("consume_applicant_submission_limit", { p_flow_id: active.flow.id, p_client_key_hash: clientKeyHash });
  if (limitError) return fail(req, 503, "Applications are temporarily unavailable. Please try again shortly.");
  if (!underLimit) return fail(req, 429, "Too many application attempts. Please wait before trying again.");

  const { data: existing, error: existingError } = await admin.from("applicants").select("id").eq("flow_id", active.flow.id).eq("submission_key", submissionKey).maybeSingle();
  if (existingError) return fail(req, 503, "Your application could not be checked. Please try again.");
  if (existing) return response(req, 200, { submitted: true, accepted: true });

  const resumePath = `${active.flow.workspace_id}/${active.flow.id}/${submissionKey}.${MIME_EXTENSIONS[normalized.contentType]}`;
  const file = normalized.resume;
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(resumePath, file, {
    contentType: normalized.contentType, cacheControl: "3600", upsert: false,
  });
  if (uploadError) return fail(req, 503, "Your resume could not be securely uploaded. Please try again.");

  const { error: insertError } = await admin.from("applicants").insert({
    id: submissionKey, submission_key: submissionKey,
    workspace_id: active.flow.workspace_id, flow_id: active.flow.id, published_flow_id: active.publication.id,
    candidate_name: normalized.name, candidate_email: normalized.email, candidate_info: normalized.candidateInfo,
    responses: normalized.answers, resume_path: resumePath, resume_filename: normalized.filename,
    resume_content_type: normalized.contentType, status: normalized.outcomeStatus,
    privacy_notice_version: NOTICE_VERSION, privacy_acknowledged_at: new Date().toISOString(),
  });
  if (insertError) {
    await admin.storage.from(BUCKET).remove([resumePath]);
    if (insertError.code === "23505") return response(req, 200, { submitted: true, accepted: true });
    return fail(req, 503, "Your application could not be saved. Please try again.");
  }
  return response(req, 200, { submitted: true, accepted: true });
}

async function deleteFlowForOwner(req: Request, body: Record<string, unknown>) {
  if (!admin) return fail(req, 500, "Application service is not configured.");
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!bearer) return fail(req, 401, "Sign in to delete this job flow.");
  const { data: auth, error: authError } = await admin.auth.getUser(bearer);
  if (authError || !auth.user) return fail(req, 401, "Your session expired. Sign in again.");
  const flowId = String(body.flowId || "");
  if (!UUID_RE.test(flowId)) return fail(req, 400, "This job flow is invalid.");
  const { data: flow, error: flowError } = await admin.from("application_flows").select("id,workspace_id").eq("id", flowId).maybeSingle();
  if (flowError) return fail(req, 503, "The job flow could not be checked.");
  let workspaceId = flow?.workspace_id as string | undefined;
  if (workspaceId) {
    const { data: workspace, error: workspaceError } = await admin.from("workspaces").select("id,owner_id").eq("id", workspaceId).maybeSingle();
    if (workspaceError || !workspace) return fail(req, 403, "You do not have access to this job flow.");
    if (workspace.owner_id !== auth.user.id) {
      const [{ data: membership, error: membershipError }, { data: subscription, error: subscriptionError }] = await Promise.all([
        admin.from("workspace_members").select("can_flows").eq("workspace_id", workspaceId).eq("user_id", auth.user.id).maybeSingle(),
        admin.from("workspace_subscriptions").select("status,current_period_end").eq("workspace_id", workspaceId).maybeSingle(),
      ]);
      const active = subscription?.status === "active" && Date.parse(subscription.current_period_end || "") > Date.now();
      if (membershipError || subscriptionError || !membership?.can_flows || !active) return fail(req, 403, "You do not have active Flow access to this workspace.");
    }
  } else {
    const { data: workspaces, error: workspaceError } = await admin.from("workspaces").select("id").eq("owner_id", auth.user.id).limit(1);
    if (workspaceError || !workspaces?.length) return fail(req, 403, "You do not have access to this workspace.");
    workspaceId = workspaces[0].id;
  }

  if (flow) {
    const { error: pauseError } = await admin.from("application_flows")
      .update({ publication_status: "draft", active_published_flow_id: null })
      .eq("id", flowId).eq("workspace_id", workspaceId);
    if (pauseError) return fail(req, 503, "New applications could not be paused.");
  }
  const folder = `${workspaceId}/${flowId}`;
  const paths: string[] = [];
  for (let offset = 0; offset < 10000; offset += 100) {
    const { data: files, error: listError } = await admin.storage.from(BUCKET).list(folder, { limit: 100, offset });
    if (listError) return fail(req, 503, "The flow's resume files could not be listed; no data was deleted.");
    paths.push(...(files || []).filter((file) => file.id).map((file) => `${folder}/${file.name}`));
    if (!files || files.length < 100) break;
  }

  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await admin.storage.from(BUCKET).remove(paths.slice(index, index + 100));
    if (error) return fail(req, 503, "Private resume cleanup failed; applicant records were kept. The job was paused. Retry delete to finish cleanup.");
  }
  if (flow) {
    const { error: deleteError } = await admin.from("application_flows").delete().eq("id", flowId).eq("workspace_id", workspaceId);
    if (deleteError) return fail(req, 503, `Resume files were removed, but the flow record could not be deleted: ${deleteError.message}`);
  }
  return response(req, 200, { deleted: true, resumesRemoved: true, remainingResumeCount: 0 });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return response(req, 204, {});
  if (req.method !== "POST") return fail(req, 405, "Use POST for this endpoint.");
  if (origin && !APP_ORIGINS.has(origin)) return fail(req, 403, "This application origin is not allowed.");
  if (!admin || !publicKey) return fail(req, 500, "Application service is not configured.");
  const suppliedKey = req.headers.get("apikey") || req.headers.get("x-api-key") || "";
  if (suppliedKey !== publicKey) return fail(req, 401, "Invalid application client.");
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_FORM_BYTES) return fail(req, 413, "The application and resume are too large.");
  const bounded = await boundedRequest(req, MAX_FORM_BYTES);
  if (!bounded) return fail(req, 413, "The application and resume are too large.");

  if (bounded.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
    try {
      const form = await bounded.formData();
      return await submitApplicant(req, form);
    } catch (error) {
      return fail(req, 400, error instanceof Error ? error.message : "The application request is invalid.");
    }
  }

  let body: Record<string, unknown>;
  try {
    const text = await bounded.text();
    if (text.length > 100_000) return fail(req, 413, "The application request is too large.");
    body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
  } catch {
    return fail(req, 400, "The application request is invalid.");
  }
  if (body.action === "listApplicantFlowLabels") {
    const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "";
    if (!bearer) return fail(req, 401, "Sign in to review applicants.");
    const { data: auth, error: authError } = await admin.auth.getUser(bearer);
    if (authError || !auth.user) return fail(req, 401, "Your session expired. Sign in again.");
    const { data: ownedWorkspace, error: ownerError } = await admin.from("workspaces").select("id").eq("owner_id", auth.user.id).maybeSingle();
    if (ownerError) return fail(req, 503, "Your workspace could not be checked.");
    let workspaceId = ownedWorkspace?.id as string | undefined;
    if (!workspaceId) {
      const { data: membership, error: memberError } = await admin.from("workspace_members")
        .select("workspace_id,can_applicants").eq("user_id", auth.user.id).maybeSingle();
      if (memberError) return fail(req, 503, "Your team access could not be checked.");
      workspaceId = membership?.workspace_id as string | undefined;
      if (!membership?.can_applicants || !workspaceId) return fail(req, 403, "You do not have Applicants access to a workspace.");
      const { data: plan, error: planError } = await admin.from("workspace_subscriptions").select("status,current_period_end").eq("workspace_id", workspaceId).maybeSingle();
      if (planError) return fail(req, 503, "Your workspace access could not be checked.");
      if (plan?.status !== "active" || Date.parse(plan.current_period_end || "") <= Date.now()) return fail(req, 403, "Active Premium access is required to review shared applicants.");
    }
    const { data: flowLabels, error: flowError } = await admin.from("application_flows")
      .select("id,job_title,company_name").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1000);
    if (flowError) return fail(req, 503, "Job filters could not be loaded.");
    return response(req, 200, { flows: (flowLabels || []).map((flow) => ({ id: flow.id, jobTitle: flow.job_title || "Untitled role", companyName: flow.company_name || "" })) });
  }
  if (body.action === "deleteFlow") return await deleteFlowForOwner(req, body);
  return fail(req, 400, "Unknown application action.");
});
