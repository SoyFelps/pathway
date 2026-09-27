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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return response(req, 204, {});
  if (req.method !== "POST") return fail(req, 405, "Use POST for this endpoint.");
  const origin = req.headers.get("origin") || "";
  if (origin && !APP_ORIGINS.has(origin)) return fail(req, 403, "This application origin is not allowed.");
  if (!admin || !stripe || !stripePriceId) return fail(req, 503, "Checkout is not configured yet.");

  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!bearer) return fail(req, 401, "Sign in to start a subscription.");
  const { data: auth, error: authError } = await admin.auth.getUser(bearer);
  if (authError || !auth.user) return fail(req, 401, "Your session expired. Sign in again.");

  const { data: workspace, error: workspaceError } = await admin
    .from("workspaces").select("id,name").eq("owner_id", auth.user.id).maybeSingle();
  if (workspaceError || !workspace) return fail(req, 403, "Your workspace could not be verified.");

  const { data: existing, error: subscriptionError } = await admin
    .from("workspace_subscriptions").select("status,current_period_end,stripe_customer_id")
    .eq("workspace_id", workspace.id).maybeSingle();
  if (subscriptionError) return fail(req, 503, "Your subscription status could not be checked.");
  const periodEnd = existing?.current_period_end ? Date.parse(existing.current_period_end) : 0;
  if (existing?.status === "active" && periodEnd > Date.now()) {
    return fail(req, 409, "Your workspace already has an active subscription.");
  }

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
