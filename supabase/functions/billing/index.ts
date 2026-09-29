import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@^22";
import { createClient } from "npm:@supabase/supabase-js@2";

const STRIPE_API_VERSION = "2026-03-25.dahlia; custom_checkout_payment_form_preview=v1";
const APP_ORIGINS = new Set([
  "https://soyfelps.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
]);
const envJsonValue = (name: string): string => {
  try { const parsed = JSON.parse(Deno.env.get(name) || "{}"); return String(parsed.default || ""); }
  catch { return ""; }
};
const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") || "";
// This public Stripe Price ID is a test-mode fallback; override it via an Edge Function secret for production.
const stripePriceId = Deno.env.get("STRIPE_PRICE_ID") || "price_1UKFrzLxHJwAlJp9n6W70f8k";
const appUrl = Deno.env.get("PATHWAY_APP_URL") || "https://soyfelps.github.io/pathway/";
const projectUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || envJsonValue("SUPABASE_SECRET_KEYS");
const stripe = stripeSecret
  ? new Stripe(stripeSecret, { apiVersion: STRIPE_API_VERSION as never })
  : null;
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

function stripeObjectId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof (value as { id: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

function safeCardSummary(value: unknown, customerId: string) {
  if (!value || typeof value !== "object") return null;
  const method = value as Record<string, unknown>;
  if (stripeObjectId(method.customer) !== customerId) return null;
  if (method.type !== "card" && method.object !== "card") return null;
  const card = (method.object === "card" ? method : method.card) as Record<string, unknown> | null;
  if (!card) return null;
  const last4 = typeof card.last4 === "string" ? card.last4 : "";
  const month = Number(card.exp_month);
  const year = Number(card.exp_year);
  if (!/^\d{4}$/.test(last4) || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000) return null;
  const rawBrand = card.display_brand || card.brand;
  const brand = typeof rawBrand === "string" && /^[a-z0-9 _-]{1,24}$/i.test(rawBrand) ? rawBrand : "Card";
  return { brand, last4, exp_month: month, exp_year: year };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return response(req, 204, {});
  if (req.method !== "POST") return fail(req, 405, "Use POST for this endpoint.");
  const origin = req.headers.get("origin") || "";
  if (origin && !APP_ORIGINS.has(origin)) return fail(req, 403, "This application origin is not allowed.");
  if (!admin || !stripe) return fail(req, 503, "Billing is not configured yet.");

  let action = "checkout";
  try {
    const body = await req.json();
    if (body && typeof body.action === "string") action = body.action;
  } catch {
    return fail(req, 400, "The request body must be valid JSON.");
  }
  if (action !== "checkout" && action !== "cancelSubscription" && action !== "resumeSubscription" && action !== "createPaymentMethodUpdateSession" && action !== "getPaymentMethodSummary" && action !== "syncPaymentMethodFromCustomer") return fail(req, 400, "This billing action is not supported.");

  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!bearer) return fail(req, 401, "Sign in to manage your subscription.");
  const { data: auth, error: authError } = await admin.auth.getUser(bearer);
  if (authError || !auth.user) return fail(req, 401, "Your session expired. Sign in again.");

  const { data: workspace, error: workspaceError } = await admin
    .from("workspaces").select("id,name").eq("owner_id", auth.user.id).maybeSingle();
  if (workspaceError || !workspace) return fail(req, 403, "Your workspace could not be verified.");

  const { data: existing, error: subscriptionError } = await admin
    .from("workspace_subscriptions").select("status,current_period_end,cancel_at_period_end,stripe_customer_id,stripe_subscription_id")
    .eq("workspace_id", workspace.id).maybeSingle();
  if (subscriptionError) return fail(req, 503, "Your subscription status could not be checked.");
  const periodEnd = existing?.current_period_end ? Date.parse(existing.current_period_end) : 0;

  if (action === "cancelSubscription") {
    if (!existing?.stripe_subscription_id) return fail(req, 409, "No active subscription was found for this workspace.");
    if (existing.cancel_at_period_end) {
      return response(req, 200, {
        status: existing.status,
        current_period_end: existing.current_period_end,
        cancel_at_period_end: true,
      });
    }
    if (existing.status !== "active" || periodEnd <= Date.now()) {
      return fail(req, 409, "Only an active subscription can be scheduled for cancellation.");
    }

    try {
      const current = await stripe.subscriptions.retrieve(existing.stripe_subscription_id);
      if (current.status !== "active" || stripeObjectId(current.customer) !== existing.stripe_customer_id) {
        return fail(req, 409, "The Stripe subscription no longer matches this workspace's active plan.");
      }
      if (current.metadata?.workspace_id !== workspace.id) {
        return fail(req, 403, "The Stripe subscription could not be verified for this workspace.");
      }
      const updated = await stripe.subscriptions.update(existing.stripe_subscription_id, { cancel_at_period_end: true });
      return response(req, 200, {
        status: updated.status,
        current_period_end: existing.current_period_end,
        cancel_at_period_end: Boolean(updated.cancel_at_period_end),
      });
    } catch (error) {
      console.error("Stripe period-end cancellation request failed", error);
      return fail(req, 502, "Stripe could not schedule the subscription cancellation. Please try again.");
    }
  }

  if (action === "resumeSubscription") {
    if (!existing?.stripe_subscription_id || !existing.cancel_at_period_end) {
      return fail(req, 409, "No scheduled cancellation was found for this workspace.");
    }
    if (existing.status !== "active" || periodEnd <= Date.now()) {
      return fail(req, 409, "Only an active subscription can have its cancellation removed.");
    }

    try {
      const current = await stripe.subscriptions.retrieve(existing.stripe_subscription_id);
      if (current.status !== "active" || stripeObjectId(current.customer) !== existing.stripe_customer_id) {
        return fail(req, 409, "The Stripe subscription no longer matches this workspace's active plan.");
      }
      if (current.metadata?.workspace_id !== workspace.id) {
        return fail(req, 403, "The Stripe subscription could not be verified for this workspace.");
      }
      const updated = current.cancel_at_period_end
        ? await stripe.subscriptions.update(existing.stripe_subscription_id, { cancel_at_period_end: false })
        : current;
      const { error: syncError } = await admin.from("workspace_subscriptions")
        .update({ status: updated.status, current_period_end: existing.current_period_end, cancel_at_period_end: false })
        .eq("workspace_id", workspace.id);
      if (syncError) {
        console.error("Subscription renewal was restored in Stripe but could not be synced to Pathway", syncError);
        return fail(req, 503, "Stripe restored your renewal, but Pathway is still syncing. Refresh the page in a moment.");
      }
      return response(req, 200, {
        status: updated.status,
        current_period_end: existing.current_period_end,
        cancel_at_period_end: Boolean(updated.cancel_at_period_end),
      });
    } catch (error) {
      console.error("Stripe renewal restoration request failed", error);
      return fail(req, 502, "Stripe could not remove the scheduled cancellation. Please try again.");
    }
  }

  if (action === "syncPaymentMethodFromCustomer") {
    if (!existing?.stripe_customer_id || !existing.stripe_subscription_id) return fail(req, 409, "An active Stripe subscription was not found for this workspace.");
    if (existing.status !== "active" || periodEnd <= Date.now()) return fail(req, 409, "An active subscription is required to update its payment method.");
    try {
      const current = await stripe.subscriptions.retrieve(existing.stripe_subscription_id, { expand: ["default_payment_method"] });
      if (current.status !== "active" || stripeObjectId(current.customer) !== existing.stripe_customer_id) return fail(req, 409, "The Stripe subscription no longer matches this workspace's active plan.");
      if (current.metadata?.workspace_id !== workspace.id) return fail(req, 403, "The Stripe subscription could not be verified for this workspace.");
      const customer = await stripe.customers.retrieve(existing.stripe_customer_id, { expand: ["invoice_settings.default_payment_method"] });
      if ("deleted" in customer && customer.deleted) return fail(req, 409, "The Stripe customer for this workspace is no longer available.");
      const customerMethod = customer.invoice_settings?.default_payment_method;
      const customerMethodId = stripeObjectId(customerMethod);
      const customerSourceId = stripeObjectId(customer.default_source);
      if (customerMethodId) {
        const method = typeof customerMethod === "string" ? await stripe.paymentMethods.retrieve(customerMethodId) : customerMethod;
        if (stripeObjectId(method.customer) !== existing.stripe_customer_id) return fail(req, 403, "The selected payment method could not be verified for this workspace.");
        if (method.type !== "card") return fail(req, 409, "The selected payment method is not a card and cannot be shown in My Plan.");
        if (stripeObjectId(current.default_payment_method) !== customerMethodId) {
          await stripe.subscriptions.update(existing.stripe_subscription_id, { default_payment_method: customerMethodId });
        }
      } else if (customerSourceId && stripeObjectId(current.default_source) !== customerSourceId) {
        const source = await stripe.customers.retrieveSource(existing.stripe_customer_id, customerSourceId);
        if (stripeObjectId(source.customer) !== existing.stripe_customer_id || source.object !== "card") return fail(req, 409, "Stripe did not return a supported default card for this workspace.");
        await stripe.subscriptions.update(existing.stripe_subscription_id, { default_source: customerSourceId });
      } else if (!customerMethodId) {
        return fail(req, 409, "Stripe did not return a new default card to apply to this subscription.");
      }
      return response(req, 200, { payment_method: await (async () => {
        const updated = await stripe.subscriptions.retrieve(existing.stripe_subscription_id, { expand: ["default_payment_method"] });
        let summary = safeCardSummary(updated.default_payment_method, existing.stripe_customer_id);
        if (!summary && updated.default_payment_method) {
          const methodId = stripeObjectId(updated.default_payment_method);
          if (methodId) summary = safeCardSummary(await stripe.paymentMethods.retrieve(methodId), existing.stripe_customer_id);
        }
        if (!summary && updated.default_source) {
          const sourceId = stripeObjectId(updated.default_source);
          if (sourceId) summary = safeCardSummary(await stripe.customers.retrieveSource(existing.stripe_customer_id, sourceId), existing.stripe_customer_id);
        }
        return summary;
      })() });
    } catch (error) {
      console.error("Stripe customer-to-subscription payment method sync failed", error);
      return fail(req, 502, "Stripe could not sync the updated card to this subscription. Please try again.");
    }
  }

  if (action === "getPaymentMethodSummary") {
    if (!existing?.stripe_customer_id || !existing.stripe_subscription_id) return fail(req, 409, "An active Stripe subscription was not found for this workspace.");
    if (existing.status !== "active" || periodEnd <= Date.now()) return fail(req, 409, "An active subscription is required to view its payment method.");
    try {
      const current = await stripe.subscriptions.retrieve(existing.stripe_subscription_id, { expand: ["default_payment_method"] });
      if (current.status !== "active" || stripeObjectId(current.customer) !== existing.stripe_customer_id) {
        return fail(req, 409, "The Stripe subscription no longer matches this workspace's active plan.");
      }
      if (current.metadata?.workspace_id !== workspace.id) return fail(req, 403, "The Stripe subscription could not be verified for this workspace.");

      let summary = safeCardSummary(current.default_payment_method, existing.stripe_customer_id);
      if (!summary && current.default_payment_method) {
        const methodId = stripeObjectId(current.default_payment_method);
        if (methodId) summary = safeCardSummary(await stripe.paymentMethods.retrieve(methodId), existing.stripe_customer_id);
      }
      if (!summary && current.default_source) {
        const sourceId = stripeObjectId(current.default_source);
        if (sourceId) summary = safeCardSummary(await stripe.customers.retrieveSource(existing.stripe_customer_id, sourceId), existing.stripe_customer_id);
      }
      if (!summary && !current.default_payment_method && !current.default_source) {
        const customer = await stripe.customers.retrieve(existing.stripe_customer_id, { expand: ["invoice_settings.default_payment_method"] });
        if (!("deleted" in customer && customer.deleted)) {
          const customerDefault = customer.invoice_settings?.default_payment_method;
          summary = safeCardSummary(customerDefault, existing.stripe_customer_id);
          if (!summary && customerDefault) {
            const methodId = stripeObjectId(customerDefault);
            if (methodId) summary = safeCardSummary(await stripe.paymentMethods.retrieve(methodId), existing.stripe_customer_id);
          }
          if (!summary && customer.default_source) {
            const sourceId = stripeObjectId(customer.default_source);
            if (sourceId) summary = safeCardSummary(await stripe.customers.retrieveSource(existing.stripe_customer_id, sourceId), existing.stripe_customer_id);
          }
        }
      }
      return response(req, 200, { payment_method: summary });
    } catch (error) {
      console.error("Stripe default payment method summary retrieval failed", error);
      return fail(req, 502, "The current payment method could not be loaded. Please try again.");
    }
  }

  if (action === "createPaymentMethodUpdateSession") {
    if (!existing?.stripe_customer_id || !existing.stripe_subscription_id) {
      return fail(req, 409, "An active Stripe subscription was not found for this workspace.");
    }
    if (existing.status !== "active" || periodEnd <= Date.now()) {
      return fail(req, 409, "An active subscription is required to update its payment method.");
    }

    try {
      const current = await stripe.subscriptions.retrieve(existing.stripe_subscription_id);
      if (current.status !== "active" || stripeObjectId(current.customer) !== existing.stripe_customer_id) {
        return fail(req, 409, "The Stripe subscription no longer matches this workspace's active plan.");
      }
      if (current.metadata?.workspace_id !== workspace.id) {
        return fail(req, 403, "The Stripe subscription could not be verified for this workspace.");
      }
      const returnUrl = new URL("index.html", appUrl);
      returnUrl.hash = "my-plan";
      const completedReturnUrl = new URL(returnUrl.href);
      completedReturnUrl.searchParams.set("billing", "payment-method-updated");
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: existing.stripe_customer_id,
        return_url: returnUrl.href,
        flow_data: {
          type: "payment_method_update",
          after_completion: {
            type: "redirect",
            redirect: { return_url: completedReturnUrl.href },
          },
        },
      });
      return response(req, 200, { url: portalSession.url });
    } catch (error) {
      console.error("Stripe payment method portal session creation failed", error);
      return fail(req, 502, "Stripe could not open the secure payment method page. Please try again.");
    }
  }

  if (existing?.status === "active" && periodEnd > Date.now()) {
    return fail(req, 409, "Your workspace already has an active subscription.");
  }
  if (!stripePriceId) return fail(req, 503, "Checkout is not configured yet.");

  try {
    const returnUrl = new URL("index.html", appUrl);
    returnUrl.searchParams.set("checkout", "complete");
    const session = await stripe.checkout.sessions.create({
      ui_mode: "form",
      mode: "subscription",
      billing_address_collection: "auto",
      phone_number_collection: { enabled: false },
      automatic_tax: { enabled: false },
      payment_method_collection: "always",
      submit_type: "auto",
      integration_identifier: "custom_embedded_web_0001",
      line_items: [{ price: stripePriceId, quantity: 1 }],
      return_url: returnUrl.href,
      customer: existing?.stripe_customer_id || undefined,
      customer_email: existing?.stripe_customer_id ? undefined : auth.user.email || undefined,
      client_reference_id: workspace.id,
      metadata: { workspace_id: workspace.id },
      subscription_data: { metadata: { workspace_id: workspace.id } },
    });
    if (!session.client_secret) return fail(req, 502, "Stripe did not return a Checkout form secret.");
    return response(req, 200, { client_secret: session.client_secret });
  } catch (error) {
    console.error("Stripe Checkout Session creation failed", error);
    return fail(req, 502, "The subscription checkout could not be started.");
  }
});
