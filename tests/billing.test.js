const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('free accounts see upgrade controls instead of publish actions across editor and flow menu', () => {
  const builder = read('builder.js');
  assert.match(builder, /Upgrade to publish/);
  assert.match(builder, /subscription\?\.active \? 'Publish' : 'Upgrade to publish'/);
  assert.match(builder, /if \(!subscription\?\.active\) \{ openSubscriptionPage\(\); return; \}/);
  assert.match(builder, /renderPlanControl\(\)/);
  assert.match(builder, /id="upgrade-to-publish"/);
  assert.match(builder, /function renderSubscriptionPage\(\)/);
  assert.match(builder, /subscription-layout/);
  assert.match(builder, /subscription-benefit/);
  assert.match(builder, /subscription-checkout-form/);
  assert.match(builder, /Back to workspace/);
  assert.match(builder, /US\$ 24\.90/);
  assert.match(builder, /Payments are simulated; no real charge will be made/);
  assert.doesNotMatch(builder, /showSubscriptionModal/);
  assert.match(builder, /function refreshSubscriptionAfterCheckout\(\)/);
  assert.match(builder, /getSubscriptionState\(workspace\.id\)/);
  assert.match(builder, /Premium is active\. You can now publish job flows\./);
  assert.match(builder, /<span class="status-dot"><\/span>Premium/);
});

test('My Plan shows account status and keeps future Premium billing actions disabled', () => {
  const builder = read('builder.js');
  assert.match(builder, /data-route="my-plan"/);
  assert.match(builder, /function renderMyPlan\(\)/);
  assert.match(builder, /requestedPage === 'my-plan'/);
  assert.match(builder, /subscription\?\.active/);
  assert.match(builder, /id="my-plan-upgrade"/);
  assert.match(builder, /Payment history/);
  assert.match(builder, /Change the card used for your subscription/);
  assert.match(builder, /Cancel subscription/);
  assert.match(builder, /class="btn plan-placeholder" disabled/);
  assert.match(builder, /These billing actions are placeholders for now/);
  assert.match(builder, /subscriptionReturnPage === 'my-plan'/);
});

test('header loads Stripe.js directly and checkout form uses the configured beta', () => {
  const html = read('index.html');
  const builder = read('builder.js');
  assert.match(html, /builder\.js\?v=my-plan-20260927/);
  assert.match(html, /https:\/\/js\.stripe\.com\/dahlia\/stripe\.js/);
  assert.match(html, /stripe-config\.js/);
  assert.match(builder, /betas: \['custom_checkout_payment_form_1'\]/);
  assert.match(builder, /initCheckoutFormSdk\(\{[\s\S]*clientSecret[\s\S]*appearance/);
  assert.match(builder, /createForm\(\{ layout: 'expanded' \}\)/);
  assert.match(builder, /actions\.confirm\(\{ formConfirmEvent: event \}\)/);
});

test('upgrade opens Stripe Checkout directly and sends the active Supabase access token', () => {
  const builder = read('builder.js');
  const backend = read('backend.js');
  assert.match(builder, /addEventListener\('click', openSubscriptionPage\)/);
  assert.match(builder, /const clientSecret = await window\.PathwayBackend\.createCheckoutSession\(\)/);
  assert.doesNotMatch(builder, /Continue to secure checkout|id="start-checkout"/);
  assert.match(backend, /Authorization: `Bearer \$\{session\.access_token\}`/);
});

test('Checkout Session is server-created as a recurring embedded form using the Checkout Studio parameters', () => {
  const edge = read('supabase/functions/billing/index.ts');
  for (const value of [
    'ui_mode: "form"', 'mode: "subscription"', 'billing_address_collection: "auto"',
    'phone_number_collection: { enabled: false }', 'automatic_tax: { enabled: false }',
    'payment_method_collection: "always"', 'submit_type: "auto"',
    'integration_identifier: "custom_embedded_web_0001"', 'STRIPE_PRICE_ID', 'price_1UKFrzLxHJwAlJp9n6W70f8k',
    'client_secret: session.client_secret', 'custom_checkout_payment_form_preview=v1'
  ]) assert.ok(edge.includes(value), `missing configured Stripe value: ${value}`);
  assert.match(edge, /auth\.getUser\(bearer\)/);
  assert.ok(edge.includes('match(/^Bearer\\s+(.+)$/i)'), 'billing must parse a normal Bearer authorization header');
  assert.ok(!edge.includes('match(/^Bearer\\\\s+(.+)$/i)'), 'billing must not match a literal backslash-s sequence');
  assert.match(edge, /subscription_data: \{ metadata: \{ workspace_id: workspace\.id \} \}/);
  assert.doesNotMatch(edge, /sk_(?:test|live)_[A-Za-z0-9]+/);
});

test('signed Stripe subscription webhooks update entitlements and automatically unpublish when access ends', () => {
  const edge = read('supabase/functions/billing-webhook/index.ts');
  assert.match(edge, /constructEventAsync\(rawBody, signature, signingSecret/);
  for (const type of ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.payment_failed']) {
    assert.ok(edge.includes(type), `missing handled billing event: ${type}`);
  }
  assert.match(edge, /from\("workspace_subscriptions"\)\.upsert/);
  assert.match(edge, /subscription\.items\?\.data/);
  assert.match(edge, /function subscriptionPeriodEnd\(/);
  assert.match(edge, /current_period_end/);
  assert.match(edge, /if \(!hasAccess\)[\s\S]*publication_status: "draft", active_published_flow_id: null/);
});

test('database gates block direct publication without active billing and public intake checks paid status', () => {
  const migration = read('supabase/migrations/20260926195500_stripe_subscription_publication_gates.sql');
  const applications = read('supabase/functions/applications/index.ts');
  assert.match(migration, /create table public\.workspace_subscriptions/);
  assert.match(migration, /workspace owners can read their subscription status/);
  assert.match(migration, /published_flows_require_paid_subscription/);
  assert.match(migration, /application_flows_require_paid_subscription/);
  assert.match(migration, /workspace_has_active_subscription\(pf\.workspace_id\)/);
  assert.match(migration, /workspace_has_active_subscription\(f\.workspace_id\)/);
  assert.match(applications, /from\("workspace_subscriptions"\)[\s\S]*status[\s\S]*current_period_end/);
  assert.match(applications, /subscription\?\.status !== "active"/);
  assert.match(applications, /This job is no longer accepting applications\./);
});

test('Stripe server secrets and live configuration requirements are documented without committing secret keys', () => {
  const todo = read('STRIPE_INTEGRATION_TODO.md');
  const config = read('stripe-config.js');
  assert.match(todo, /STRIPE_SECRET_KEY/);
  assert.match(todo, /STRIPE_PRICE_ID/);
  assert.match(todo, /STRIPE_WEBHOOK_SECRET/);
  assert.match(todo, /price_1UKFrzLxHJwAlJp9n6W70f8k/);
  assert.match(config, /pk_test_51UK1fJLxHJwAlJp9/);
  assert.doesNotMatch(config, /sk_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+/);
});
