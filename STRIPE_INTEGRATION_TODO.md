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

Stripe.js is loaded directly from `https://js.stripe.com/dahlia/stripe.js`, initialized with beta `custom_checkout_payment_form_1`, and rendered in the dedicated Pathway subscription page.

## Supabase deployment and Stripe webhook

Target Supabase project: **PathwayAPP** (`gftnghlkuiuhuwyaajdn`).

1. **Completed:** applied migration `20260926195500_stripe_subscription_publication_gates.sql`. This approved cutover changed every then-published flow to Draft and cleared active public URLs. Existing applicant and resume records were preserved. After subscribing, owners can republish with fresh links.
2. **Completed:** deployed `billing` (JWT verification on), `billing-webhook` (platform JWT off; Stripe signature verification inside the function), and updated `applications` (public candidate intake still requires the public API key, plus active paid entitlement).
3. **Completed:** created this active **test-mode** webhook endpoint in the confirmed Stripe test account:
   - Endpoint ID: `we_1UKG77LxHJwAlJp9MUj1C1Lh`
   - URL: `https://gftnghlkuiuhuwyaajdn.supabase.co/functions/v1/billing-webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
4. **Completed and verified:** Stripe sent signed subscription events to the test endpoint; Supabase accepted the signature and processed them. `STRIPE_WEBHOOK_SECRET` and the matching test-mode `STRIPE_SECRET_KEY` are therefore configured for `billing-webhook`.
5. **Completed:** the active test subscription writes its period end to the workspace. Stripe API `2026-03-25.dahlia` moved period dates to `items.data[].current_period_end`; the webhook now reads that field (and remains compatible with the older top-level field).
6. **Completed:** the test-mode subscription is active through **October 27, 2026**. The app displays Premium and enables the Publish action. The checkout used Stripe test mode; it did not charge real money.
7. **Completed:** the static site is pushed to `main`; GitHub Pages serves the subscription page and cache-busted billing controls. Before accepting real payments, replace the test publishable key and Price with matching live-mode values, configure the live secret key only in Supabase, create a separate live webhook endpoint with a live `whsec_…` secret, and enable Payment method updates in the live Stripe Customer Portal configuration.
Subscription status is synchronized from signed webhook events. A subscription grants publication access only while Stripe reports `active` and its paid period has not ended. When access ends, published flows are returned to Draft; public lookup, database triggers, and applicant intake all deny expired/unpaid publications. Draft creation, editing, and preview remain free.

## Validation

- `node --test tests/*.test.js` — automated tests for publication gates, billing UI, Checkout config, webhooks, and applicant handling.
- Confirm the Payment method action opens Stripe's hosted update flow and returns the signed-in user to My Plan.
- Confirm checkout displays **US$ 24.90 monthly** before the user confirms payment.
- Verified: successful test checkout writes an active `workspace_subscriptions` entitlement and unlocks the Publish control.
- Verify subscription expiration/cancellation returns flows to Draft and disables public links, while preserving existing application and resume records.
- Verify invalid webhook signatures are rejected.

## Customer Portal — Payment method updates

- **Test mode is configured:** My Plan requests a short-lived Stripe Customer Portal session dedicated to `payment_method_update`. Stripe hosts the card form; Pathway never receives or stores card numbers. A successful update redirects the customer to My Plan.
- The active default test configuration is `bpc_1UKzHRLxHJwAlJp9pHXQfvJE` in the configured Stripe test account. It enables payment-method updates only; subscription cancellation/changes, billing-information updates, and invoice history are disabled there.
- The billing Edge Function verifies the signed-in workspace owner, active Stripe subscription, Stripe customer ID, and subscription `workspace_id` metadata before creating a portal session.
- My Plan retrieves the active subscription's effective default using Stripe's precedence (`subscription.default_payment_method`/`default_source`, then the customer invoice default only when the subscription has no override). It returns only card brand, last four, and expiry to the signed-in owner; the full PAN and CVC are never returned to Pathway.
- After a completed Portal update, the authenticated return handler applies the newly selected customer default to that workspace's subscription, because Stripe's `payment_method_update` portal flow updates the customer default and an explicit subscription default otherwise takes precedence. The update does not alter price or issue a new invoice.
- **Before live payments:** create/enable a live Customer Portal configuration with **Payment methods → Let your customer update their payment method information**. Portal configurations are mode-specific; do not reuse the test configuration in live mode.
- My Plan now displays Stripe invoices for the workspace's current and previous Pathway subscriptions (10 per page, with older invoices loaded on request), including number, date, amount, status, and hosted invoice/PDF links where available. The authenticated billing endpoint verifies the owner, Stripe customer, and each subscription's workspace metadata before returning a field-limited result; unrelated customer invoices and unfinalized drafts are excluded.

Resources: [Stripe API keys](https://docs.stripe.com/keys), [Stripe products and prices](https://docs.stripe.com/products-prices/manage-prices), [embedded form quickstart](https://docs.stripe.com/checkout/form/quickstart), [Stripe webhook docs](https://docs.stripe.com/webhooks), [Supabase Stripe webhook example](https://supabase.com/docs/guides/functions/examples/stripe-webhooks).
