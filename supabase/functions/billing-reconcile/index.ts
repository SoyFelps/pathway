import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@^22";
import { createClient } from "npm:@supabase/supabase-js@2";
import { deleteCompaniesExcept } from "./plan-cleanup.ts";
import { type NoticeKind, sendDowngradeNotice } from "./downgrade-email.ts";
import { compareSubscriptions, type DatabaseSubscription, type Finding, hasAccess, planOfPrice, reportText, type StripeSubscription } from "./compare.ts";

// Daily check that the subscriptions in the database say what Stripe says. A database job wakes this function once a day (07:00 UTC).
// Stripe is the source of truth: a difference is corrected here the same way the webhook would have (the subscription fields, and the job
// pages go back to draft when the plan gives no access), and a report is e-mailed to RECONCILE_REPORT_TO when there is anything to tell.
// Ambiguous cases (another customer, another workspace, a subscription for a workspace that is gone) are only reported, never corrected.
// It is harmless to call by hand: it only brings the database in line with Stripe, and it does nothing if it already ran in the last 30 minutes.

const STRIPE_API_VERSION = "2026-03-25.dahlia; custom_checkout_payment_form_preview=v1";
const MAX_SUBSCRIPTIONS = 5000; // a ceiling, so a mistake can never turn into an endless loop
const THROTTLE_MS = 30 * 60 * 1000;

const envJsonValue = (name: string): string => {
  try { const parsed = JSON.parse(Deno.env.get(name) || "{}"); return String(parsed.default || ""); }
  catch { return ""; }
};
const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") || "";
// The price Pathway sold before the plans existed (US$ 24.90) counts as Agency (owner decision, 2026-11-09).
const LEGACY_PRICE_ID = Deno.env.get("STRIPE_PRICE_ID") || "price_1UKFrzLxHJwAlJp9n6W70f8k";
const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || envJsonValue("SUPABASE_SECRET_KEYS");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const EMAIL_FROM_ADDRESS = Deno.env.get("EMAIL_FROM") || "onboarding@resend.dev";
const APP_URL = Deno.env.get("PATHWAY_APP_URL") || "https://soyfelps.github.io/pathway/";
const REPORT_TO = Deno.env.get("RECONCILE_REPORT_TO") || ""; // who gets the report: decided later, nothing is sent while it is empty
const stripe = stripeSecret ? new Stripe(stripeSecret, { apiVersion: STRIPE_API_VERSION as never }) : null;
const admin = projectUrl && serviceKey
  ? createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

const objectId = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof (value as { id: unknown }).id === "string") return (value as { id: string }).id;
  return null;
};

/** The earliest valid item boundary, as the webhook does (the API version removed the subscription-level field). */
function periodEndSeconds(subscription: Record<string, unknown>): number | null {
  const items = (subscription.items as { data?: Array<{ current_period_end?: number }> } | undefined)?.data || [];
  const ends = items.map((item) => item.current_period_end).filter((value): value is number => Number.isFinite(value));
  if (ends.length) return Math.min(...ends);
  const direct = subscription.current_period_end;
  return typeof direct === "number" && Number.isFinite(direct) ? direct : null;
}

function planOfSubscriptionItems(subscription: Record<string, unknown>): "business" | "agency" | null {
  const items = (subscription.items as { data?: Array<{ price?: { id?: string; lookup_key?: string | null } }> } | undefined)?.data || [];
  for (const item of items) {
    const plan = planOfPrice(item.price, LEGACY_PRICE_ID);
    if (plan) return plan;
  }
  return null;
}

function snapshot(subscription: Record<string, unknown>): StripeSubscription {
  const end = periodEndSeconds(subscription);
  const metadata = (subscription.metadata ?? {}) as Record<string, string>;
  return {
    id: String(subscription.id),
    customerId: objectId(subscription.customer),
    status: String(subscription.status),
    periodEnd: end === null ? null : new Date(end * 1000).toISOString(),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    workspaceId: metadata.workspace_id || null,
    plan: planOfSubscriptionItems(subscription),
  };
}

async function listStripeSubscriptions(): Promise<StripeSubscription[]> {
  const found: StripeSubscription[] = [];
  for await (const subscription of stripe!.subscriptions.list({ status: "all", limit: 100 })) {
    found.push(snapshot(subscription as unknown as Record<string, unknown>));
    if (found.length >= MAX_SUBSCRIPTIONS) break;
  }
  return found;
}

/**
 * The scheduled downgrades from Agency to Business whose date has come (plano-planos.md, phase 4a). Stripe changed the price at the renewal and
 * the webhook wrote plan = business; only then are the companies that were not chosen deleted, in batches (a big company may take several
 * runs). A change without a valid company to keep, or whose workspace is not on Business yet, is left alone and tried again on the next run.
 */
async function runDueDowngrades(): Promise<{ done: number; waiting: number }> {
  const summary = { done: 0, waiting: 0 };
  const { data: due, error } = await admin!.from("workspace_plan_changes")
    .select("id,workspace_id,keep_company_id,stripe_schedule_id").in("status", ["scheduled", "running"]).lte("effective_at", new Date().toISOString()).limit(20);
  if (error) throw error;
  for (const change of due ?? []) {
    try {
      if (!change.keep_company_id) { summary.waiting++; await admin!.from("workspace_plan_changes").update({ last_error: "keep_company_missing" }).eq("id", change.id); continue; }
      const { data: subscription } = await admin!.from("workspace_subscriptions").select("status,plan,current_period_end").eq("workspace_id", change.workspace_id).maybeSingle();
      const onBusiness = subscription?.status === "active" && subscription.plan === "business" && Date.parse(subscription.current_period_end || "") > Date.now();
      if (!onBusiness) { summary.waiting++; await admin!.from("workspace_plan_changes").update({ last_error: "not_on_business_yet" }).eq("id", change.id); continue; }
      await admin!.from("workspace_plan_changes").update({ status: "running", last_error: null }).eq("id", change.id);
      const result = await deleteCompaniesExcept(admin, change.workspace_id, change.keep_company_id, Date.now() + 30_000);
      if (result.finished) {
        if (change.stripe_schedule_id) { try { await stripe!.subscriptionSchedules.release(change.stripe_schedule_id); } catch { /* already released */ } }
        await admin!.from("workspace_plan_changes").update({ status: "done", finished_at: new Date().toISOString() }).eq("id", change.id);
        summary.done++;
      } else summary.waiting++;
    } catch (cleanupError) {
      console.error("Scheduled downgrade failed for a workspace:", cleanupError instanceof Error ? cleanupError.message : "unknown error");
      await admin!.from("workspace_plan_changes").update({ last_error: "cleanup_failed" }).eq("id", change.id);
      summary.waiting++;
    }
  }
  return summary;
}

/**
 * The reminders of a scheduled downgrade (phase 4b): one in the last 7 days and one in the last 2 days before the date. The job runs once a day, so
 * each window is met by exactly one run. A change scheduled inside a window needs no reminder for it (the confirmation e-mail has just said it).
 * A failed e-mail is simply tried again on the next run and never touches the downgrade itself.
 */
async function runDowngradeReminders(): Promise<void> {
  const DAY = 86_400_000;
  const now = Date.now();
  const { data: pending, error } = await admin!.from("workspace_plan_changes")
    .select("id,workspace_id,keep_company_id,effective_at,created_at,notice_week_sent_at,notice_day_sent_at").eq("status", "scheduled").gt("effective_at", new Date(now).toISOString()).limit(200);
  if (error) throw error;
  for (const change of pending ?? []) {
    const effective = Date.parse(change.effective_at);
    const created = Date.parse(change.created_at);
    const left = effective - now;
    const jobs: Array<{ kind: NoticeKind; column: string }> = [];
    if (left <= 2 * DAY && !change.notice_day_sent_at && created <= effective - 2 * DAY) jobs.push({ kind: "day", column: "notice_day_sent_at" });
    else if (left <= 7 * DAY && left > 2 * DAY && !change.notice_week_sent_at && created <= effective - 7 * DAY) jobs.push({ kind: "week", column: "notice_week_sent_at" });
    for (const job of jobs) {
      if (await sendDowngradeNotice(admin, change, job.kind, { resendKey: RESEND_API_KEY, emailFrom: EMAIL_FROM_ADDRESS, appUrl: APP_URL })) {
        await admin!.from("workspace_plan_changes").update({ [job.column]: new Date().toISOString() }).eq("id", change.id);
      }
    }
  }
}

async function takeJobPagesOffline(workspaceId: string) {
  const { error } = await admin!.from("application_flows")
    .update({ publication_status: "draft", active_published_flow_id: null })
    .eq("workspace_id", workspaceId).eq("publication_status", "published");
  if (error) throw error;
}

/** Returns "done" when the correction was applied, otherwise why not. */
async function apply(finding: Finding, now: Date): Promise<string> {
  if (finding.kind === "review") return "review";
  const target = finding.target;
  if (finding.kind === "fix") {
    // Only if nobody changed the row since it was read: if the webhook got there first, there is nothing left to do.
    const { data, error } = await admin!.from("workspace_subscriptions")
      .update({ status: target.status, current_period_end: target.periodEnd, cancel_at_period_end: target.cancelAtPeriodEnd, ...(target.plan ? { plan: target.plan } : {}) })
      .eq("workspace_id", finding.workspaceId).eq("stripe_subscription_id", finding.subscriptionId).eq("updated_at", finding.databaseUpdatedAt)
      .select("workspace_id");
    if (error) throw error;
    if (!data?.length) return "changed_meanwhile";
  } else {
    const { error } = await admin!.from("workspace_subscriptions").upsert({
      workspace_id: finding.workspaceId,
      stripe_customer_id: target.customerId,
      stripe_subscription_id: finding.subscriptionId,
      status: target.status,
      current_period_end: target.periodEnd,
      cancel_at_period_end: target.cancelAtPeriodEnd,
      ...(target.plan ? { plan: target.plan } : {}),
    }, { onConflict: "workspace_id", ignoreDuplicates: true });
    if (error) throw error;
  }
  if (!hasAccess(target.status, target.periodEnd, now)) await takeJobPagesOffline(finding.workspaceId);
  return "done";
}

async function sendReport(subject: string, text: string): Promise<boolean> {
  if (!REPORT_TO || !RESEND_API_KEY) return false;
  try {
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM_ADDRESS.includes("<") ? EMAIL_FROM_ADDRESS : `Pathway <${EMAIL_FROM_ADDRESS}>`, to: [REPORT_TO], subject, text }),
    });
    if (!result.ok) console.error("Reconciliation report refused:", result.status);
    return result.ok;
  } catch (error) {
    console.error("Reconciliation report failed:", error instanceof Error ? error.message : "unknown error");
    return false;
  }
}

async function run(): Promise<Response> {
  const now = new Date();
  const { data: last, error: lastError } = await admin!.from("billing_reconcile_runs").select("finished_at").not("finished_at", "is", null)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (lastError) throw lastError;
  if (last?.finished_at && now.getTime() - Date.parse(last.finished_at) < THROTTLE_MS) return reply(200, { skipped: "ran_recently" });

  const { data: started, error: startError } = await admin!.from("billing_reconcile_runs").insert({}).select("id").single();
  if (startError) throw startError;
  try {
    const { data: rows, error } = await admin!.from("workspace_subscriptions")
      .select("workspace_id,stripe_customer_id,stripe_subscription_id,status,current_period_end,cancel_at_period_end,plan,updated_at");
    if (error) throw error;
    const remote = await listStripeSubscriptions();
    const database = (rows ?? []) as DatabaseSubscription[];
    // Which workspaces exist, only for the subscriptions Stripe has and the database does not.
    const known = new Set(database.map((row) => row.stripe_subscription_id));
    const candidates = [...new Set(remote.filter((item) => !known.has(item.id) && item.workspaceId).map((item) => item.workspaceId as string))];
    const existing = new Set<string>();
    if (candidates.length) {
      const { data: workspaces, error: workspaceError } = await admin!.from("workspaces").select("id").in("id", candidates);
      if (workspaceError) throw workspaceError;
      for (const workspace of workspaces ?? []) existing.add(workspace.id);
    }
    const { findings, summary } = compareSubscriptions(database, remote, existing, now);
    const applied: Record<string, string> = {};
    for (const finding of findings) {
      if (finding.kind === "review") continue;
      applied[`${finding.workspaceId}:${finding.subscriptionId}`] = await apply(finding, now);
    }
    const needsReport = findings.length > 0;
    const emailed = needsReport ? await sendReport("Pathway: Stripe reconciliation found differences", reportText(summary, findings, applied)) : false;
    const { error: finishError } = await admin!.from("billing_reconcile_runs").update({
      finished_at: new Date().toISOString(),
      checked: summary.checked, fixed: Object.values(applied).filter((value) => value === "done").length, review: summary.reviews, skipped_recent: summary.skippedRecent,
      report: needsReport ? { findings: findings.map((finding) => ({ ...finding, target: undefined })), applied } : null,
      emailed,
    }).eq("id", started.id);
    if (finishError) throw finishError;
    return reply(200, { checked: summary.checked, inSync: summary.inSync, corrected: Object.values(applied).filter((value) => value === "done").length, review: summary.reviews, skippedRecent: summary.skippedRecent, emailed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("Stripe reconciliation failed:", message);
    await admin!.from("billing_reconcile_runs").update({ finished_at: new Date().toISOString(), error: message.slice(0, 300) }).eq("id", started.id);
    return reply(500, { error: "reconciliation_failed" });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  if (!stripe || !admin) return reply(503, { error: "not_configured" });
  try {
    try { await runDowngradeReminders(); } catch (reminderError) { console.error("Downgrade reminders failed:", reminderError instanceof Error ? reminderError.message : "unknown error"); }
    try { await runDueDowngrades(); } catch (downgradeError) { console.error("Scheduled downgrades failed:", downgradeError instanceof Error ? downgradeError.message : "unknown error"); }
    return await run();
  } catch (error) {
    console.error("billing-reconcile error:", error instanceof Error ? error.message : "unknown error");
    return reply(500, { error: "server_error" });
  }
});
