import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@^22";
import { createClient } from "npm:@supabase/supabase-js@2";

const STRIPE_API_VERSION = "2026-03-25.dahlia; custom_checkout_payment_form_preview=v1";
const envJsonValue = (name: string): string => {
  try { const parsed = JSON.parse(Deno.env.get(name) || "{}"); return String(parsed.default || ""); }
  catch { return ""; }
};
const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") || "";
const signingSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || envJsonValue("SUPABASE_SECRET_KEYS");
const stripe = stripeSecret
  ? new Stripe(stripeSecret, { apiVersion: STRIPE_API_VERSION as never })
  : null;
const admin = projectUrl && serviceKey
  ? createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const cryptoProvider = Stripe.createSubtleCryptoProvider();

type SubscriptionSnapshot = {
  id: string;
  customer: string | { id: string } | null;
  status: string;
  current_period_end?: number;
  items?: { data?: Array<{ current_period_end?: number }> };
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string>;
};

function objectId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof (value as { id: unknown }).id === "string") return (value as { id: string }).id;
  return null;
}

function subscriptionPeriodEnd(subscription: SubscriptionSnapshot): number | null {
  // Stripe API version 2025-03-31.basil removed subscription-level period fields.
  // For subscriptions with multiple items, use the earliest valid item boundary.
  const itemEnds = (subscription.items?.data || [])
    .map(item => item.current_period_end)
    .filter((value): value is number => Number.isFinite(value));
  if (itemEnds.length) return Math.min(...itemEnds);
  return Number.isFinite(subscription.current_period_end) ? subscription.current_period_end! : null;
}

async function cancelSubscriptionForDeletedWorkspace(subscriptionId: string) {
  if (!stripe) throw new Error("Stripe is not configured.");
  const current = await stripe.subscriptions.retrieve(subscriptionId);
  if (current.status === "canceled" || current.status === "incomplete_expired") return;
  await stripe.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false });
}

async function syncSubscription(subscription: SubscriptionSnapshot, workspaceId: string, customerId?: string | null) {
  if (!admin) throw new Error("Subscription database is not configured.");
  const { data: workspace, error: workspaceError } = await admin.from("workspaces")
    .select("id").eq("id", workspaceId).maybeSingle();
  if (workspaceError) throw workspaceError;
  if (!workspace) {
    await cancelSubscriptionForDeletedWorkspace(subscription.id);
    return;
  }
  const validStatuses = new Set(["active", "trialing", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]);
  const status = validStatuses.has(subscription.status) ? subscription.status : "incomplete";
  const periodEndTimestamp = subscriptionPeriodEnd(subscription);
  const periodEnd = periodEndTimestamp ? new Date(periodEndTimestamp * 1000).toISOString() : null;
  const normalizedCustomerId = customerId || objectId(subscription.customer);
  const { data: current, error: currentError } = await admin.from("workspace_subscriptions")
    .select("stripe_subscription_id,status,current_period_end").eq("workspace_id", workspaceId).maybeSingle();
  if (currentError) throw currentError;
  const currentHasAccess = current?.status === "active" && current.current_period_end
    && Date.parse(current.current_period_end) > Date.now();
  if (currentHasAccess && current.stripe_subscription_id !== subscription.id) return;
  const { error } = await admin.from("workspace_subscriptions").upsert({
    workspace_id: workspaceId,
    stripe_customer_id: normalizedCustomerId,
    stripe_subscription_id: subscription.id,
    status,
    current_period_end: periodEnd,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
  }, { onConflict: "workspace_id" });
  if (error) throw error;

  const hasAccess = status === "active" && Boolean(periodEnd && Date.parse(periodEnd) > Date.now());
  if (!hasAccess) {
    const { error: deactivateError } = await admin.from("application_flows")
      .update({ publication_status: "draft", active_published_flow_id: null })
      .eq("workspace_id", workspaceId).eq("publication_status", "published");
    if (deactivateError) throw deactivateError;
  }
}

async function workspaceForCustomer(customerId: string | null): Promise<string | null> {
  if (!admin || !customerId) return null;
  const { data, error } = await admin.from("workspace_subscriptions").select("workspace_id")
    .eq("stripe_customer_id", customerId).maybeSingle();
  if (error) throw error;
  return data?.workspace_id || null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Use POST", { status: 405 });
  if (!stripe || !signingSecret || !admin) return new Response("Webhook is not configured", { status: 503 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing Stripe signature", { status: 400 });

  let event: Stripe.Event;
  try {
    const rawBody = await req.text();
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, signingSecret, undefined, cryptoProvider);
  } catch (error) {
    console.warn("Stripe webhook signature verification failed", error);
    return new Response("Invalid Stripe signature", { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = objectId(session.subscription);
      const workspaceId = session.metadata?.workspace_id || session.client_reference_id;
      if (session.mode === "subscription" && subscriptionId && workspaceId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await syncSubscription(subscription as unknown as SubscriptionSnapshot, workspaceId, objectId(session.customer));
      }
    } else if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
      const eventSubscription = event.data.object as unknown as SubscriptionSnapshot;
      let subscription: SubscriptionSnapshot = eventSubscription;
      if (event.type !== "customer.subscription.deleted") {
        subscription = await stripe.subscriptions.retrieve(eventSubscription.id) as unknown as SubscriptionSnapshot;
      }
      const workspaceId = subscription.metadata?.workspace_id || await workspaceForCustomer(objectId(subscription.customer));
      if (workspaceId) await syncSubscription(subscription, workspaceId);
    } else if (["invoice.paid", "invoice.payment_failed"].includes(event.type)) {
      const invoice = event.data.object as unknown as Record<string, unknown>;
      const parent = invoice.parent && typeof invoice.parent === "object" ? invoice.parent as Record<string, unknown> : {};
      const details = parent.subscription_details && typeof parent.subscription_details === "object"
        ? parent.subscription_details as Record<string, unknown> : {};
      const subscriptionId = objectId(invoice.subscription) || objectId(details.subscription);
      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId) as unknown as SubscriptionSnapshot;
        const workspaceId = subscription.metadata?.workspace_id || await workspaceForCustomer(objectId(subscription.customer));
        if (workspaceId) await syncSubscription(subscription, workspaceId);
      }
    }
    return Response.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed", { eventId: event.id, type: event.type, error });
    return new Response("Webhook processing failed", { status: 500 });
  }
});
