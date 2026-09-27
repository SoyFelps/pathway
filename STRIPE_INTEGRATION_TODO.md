# Stripe integration setup

Pathway's **test-mode monthly subscription** and embedded Checkout Form are implemented and deployed. Checkout will be ready for end-to-end testing after the Stripe webhook signing secret is added to Supabase and the existing API secret is verified to be the matching test key.

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

1. **Completed:** applied migration `20260926195500_stripe_subscription_publication_gates.sql`. This approved cutover changed every then-published flow to Draft and cleared active public URLs. Existing applicant and resume records were preserved. After subscribing, owners can republish with fresh links.
2. **Completed:** deployed `billing` (JWT verification on), `billing-webhook` (platform JWT off; Stripe signature verification inside the function), and updated `applications` (public candidate intake still requires the public API key, plus active paid entitlement).
3. **Completed:** created this active **test-mode** webhook endpoint in the confirmed Stripe test account:
   - Endpoint ID: `we_1UKG77LxHJwAlJp9MUj1C1Lh`
   - URL: `https://gftnghlkuiuhuwyaajdn.supabase.co/functions/v1/billing-webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
4. **Still required:** in Stripe's endpoint details, reveal and copy this endpoint's `whsec_…` signing secret. In Supabase → **Edge Function Secrets**, add/update `STRIPE_WEBHOOK_SECRET` with that value. Keep it out of this repository and chat.
5. The user said the Stripe API secret is already stored in Supabase, but its name and test/live mode were not verified. In Supabase → Edge Function Secrets, confirm `STRIPE_SECRET_KEY` contains the matching test-mode `sk_test_…` key. Never disclose that key. Supabase's built-in URL and service-role secret are used at runtime.
6. The static site is pushed to `main`; GitHub Pages returned HTTP 200 and serves `stripe-config.js` with the supplied test publishable key. After setting the webhook secret, complete an end-to-end test. Use Stripe's test card `4242 4242 4242 4242`, any future expiry date, and any CVC.
7. Before accepting real payments, replace the test publishable key and Price with matching live-mode values, configure the live secret key only in Supabase, and create a separate live webhook endpoint with a live `whsec_…` secret.

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
