# Stripe integration setup

The code is configured for Pathway's **test-mode monthly subscription** and an embedded Checkout Form. Checkout becomes usable after the updated database migration and Edge Functions are deployed and the required server-side secrets are available in Supabase.

## Stripe test product and price

| Field | Verified value |
|-------|----------------|
| Stripe product | `Assinatura Recorrente` (`prod_VKvjvb1JghDcZ4`) |
| Subscription price | `US$ 24.90 / month` |
| Stripe Price ID | `price_1UKFrzLxHJwAlJp9n6W70f8k` |
| Mode | Test (`livemode=false`) |
| Publishable key | Configured in `stripe-config.js`; safe for browser use |

The account's product/Price was verified read-only in the Stripe test account. The supplied publishable key belongs to that account's test keys.

## Server secrets

The user says the Stripe secret key is already stored in Supabase. I have not viewed or copied its value. Before testing, make sure the Supabase project's Edge Function secret is named exactly `STRIPE_SECRET_KEY` and contains the matching **test** secret (`sk_test_…`). Never commit or paste that key into this repository or chat.

`STRIPE_PRICE_ID` is a non-secret environment value. The billing function currently has the verified test Price ID as a fallback; set the same value in Supabase Edge Function secrets if you prefer not to depend on the code fallback. For live mode, replace both the publishable key and Price with corresponding live values, and set the live secret key only as a Supabase secret.

`STRIPE_WEBHOOK_SECRET` (`whsec_…`) is a separate webhook signing secret. It is not the Stripe API secret. It must be added to Supabase after the webhook endpoint is created in the Stripe test Dashboard.

## Configured Checkout parameters

**File:** [supabase/functions/billing/index.ts](supabase/functions/billing/index.ts)

| Parameter | Value |
|-----------|-------|
| `ui_mode` | `form` |
| `mode` | `subscription` |
| `billing_address_collection` | `auto` |
| `phone_number_collection` | `{ enabled: false }` |
| `automatic_tax` | `{ enabled: false }` |
| `payment_method_collection` | `always` |
| `submit_type` | `auto` |
| `integration_identifier` | `custom_embedded_web_0001` |
| `return_url` | The Pathway GitHub Pages app with `?checkout=complete` |
| Stripe API version | `2026-03-25.dahlia; custom_checkout_payment_form_preview=v1` |
| line item | `price_1UKFrzLxHJwAlJp9n6W70f8k`, quantity `1` |

Stripe.js is loaded directly from `https://js.stripe.com/dahlia/stripe.js`, initialized with beta `custom_checkout_payment_form_1`, and rendered in the Pathway subscription dialog.

## Supabase deployment and Stripe webhook

Target Supabase project: **PathwayAPP** (`gftnghlkuiuhuwyaajdn`).

1. Verify that the Supabase Edge Function secret `STRIPE_SECRET_KEY` is present and contains the matching `sk_test_…` key. Do not disclose it in chat. Supabase's built-in `SUPABASE_URL` and service-role secret are used by the functions at runtime.
2. **Approved cutover:** applying `20260926195500_stripe_subscription_publication_gates.sql` will change every currently published flow to Draft and clear its active public URL. Existing applicants and resumes remain. After subscribing, owners can republish, which creates fresh links.
3. Deploy `billing` with JWT verification enabled. Deploy `billing-webhook` with JWT verification disabled; the function validates the Stripe signature itself. Deploy the updated `applications` function.
4. In Stripe test mode → Developers/Workbench → Webhooks, add:
   `https://gftnghlkuiuhuwyaajdn.supabase.co/functions/v1/billing-webhook`
   Subscribe it to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
5. Copy the endpoint's `whsec_…` signing secret into Supabase Edge Function secrets under `STRIPE_WEBHOOK_SECRET`. Do not put it in the frontend or Git repository.
6. Test checkout in Stripe test mode before switching to live mode. Use Stripe's test card `4242 4242 4242 4242`, any future expiry date, and any CVC.
7. Push the updated static site to the GitHub Pages branch. Before accepting real payment, replace the test key/Price with live-mode ones and confirm the live webhook endpoint.

Subscription status is synchronized from signed webhook events. A subscription grants publication access only while Stripe reports `active` and its paid period has not ended. When access ends, published flows are returned to Draft; public lookup, database triggers, and applicant intake all deny expired/unpaid publications. Draft creation, editing, and preview remain free.

## Validation

- `node --test tests/*.test.js` — automated tests for publication gates, billing UI, Checkout config, webhooks, and applicant handling.
- Confirm checkout displays **US$ 24.90 monthly** before the user confirms payment.
- Verify successful test checkout writes an active `workspace_subscriptions` row and allows publishing.
- Verify subscription expiration/cancellation returns flows to Draft and disables public links, while preserving existing application and resume records.
- Verify invalid webhook signatures are rejected.

## Later phase

The separate **Payment** page for billing history, invoices, payment method updates, and cancellation controls remains intentionally deferred. Stripe's customer portal can be integrated in that phase.

Resources: [Stripe API keys](https://docs.stripe.com/keys), [Stripe products and prices](https://docs.stripe.com/products-prices/manage-prices), [embedded form quickstart](https://docs.stripe.com/checkout/form/quickstart), [Stripe webhook docs](https://docs.stripe.com/webhooks), [Supabase Stripe webhook example](https://supabase.com/docs/guides/functions/examples/stripe-webhooks).
