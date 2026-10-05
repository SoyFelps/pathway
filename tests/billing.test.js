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

test('My Plan shows account status and requires confirmation before scheduling cancellation', () => {
  const builder = read('builder.js');
  assert.match(builder, /data-route="my-plan"/);
  assert.match(builder, /function renderMyPlan\(\)/);
  assert.match(builder, /requestedPage === 'my-plan'/);
  assert.match(builder, /subscription\?\.active/);
  assert.match(builder, /id="my-plan-upgrade"/);
  assert.match(builder, /Payment history/);
  assert.match(builder, /Update your card securely through Stripe/);
  assert.match(builder, /id = 'update-payment-method'/);
  assert.match(builder, /createPaymentMethodUpdateSession\(\)/);
  assert.match(builder, /window\.location\.assign\(portalUrl\)/);
  assert.ok(builder.includes("query.get('billing') === 'payment-method-updated'"));
  assert.match(builder, /Cancel subscription/);
  assert.match(builder, /class="btn plan-placeholder" disabled/);
  assert.match(builder, /historyButton\.id = 'payment-history-toggle'/);
  assert.match(builder, /id="payment-history-panel"/);
  assert.match(builder, /Load older invoices/);
  assert.match(builder, /subscriptionReturnPage === 'my-plan'/);
  assert.match(builder, /function showCancelSubscriptionConfirmation\(\)/);
  assert.match(builder, /if \(premium && subscription\.cancelAtPeriodEnd\)/);
  assert.match(builder, /plan-action-row plan-keep-row/);
  assert.match(builder, /id="keep-premium"/);
  assert.match(builder, /function showKeepPremiumConfirmation\(\)/);
  assert.match(builder, /Automatic renewal will resume/);
  assert.match(builder, /keepPremiumSubscription\(\)/);
  assert.match(builder, /Schedule cancellation/);
  assert.match(builder, /keep Premium access and published job links until/);
  assert.match(builder, /Pathway will turn off renewal with Stripe/);
  assert.match(builder, /cancelSubscriptionAtPeriodEnd\(\)/);
  assert.match(builder, /Cancellation scheduled/);
  const start = builder.indexOf('function renderMyPlan()');
  const end = builder.indexOf('function renderApplicantBoard(', start);
  const planScreen = builder.slice(start, end);
  assert.doesNotMatch(planScreen, /plan-state-chip/);
  for (const benefit of ['Publish your job flow', 'Share a public job link', 'Receive applications in Pathway', 'Review candidates and resumes', 'Approve or reject candidates']) {
    assert.ok(planScreen.includes(benefit), `missing Free-plan Premium benefit: ${benefit}`);
  }
  assert.match(planScreen, /id="my-plan-benefits-upgrade"/);
  assert.match(planScreen, /my-plan-benefits-upgrade.*openSubscriptionPage/s);
});

test('cancellation adapter sends the authenticated period-end cancellation action', () => {
  const backend = read('backend.js');
  assert.match(backend, /async function cancelSubscriptionAtPeriodEnd\(\)/);
  assert.match(backend, /JSON\.stringify\(\{ action: 'cancelSubscription' \}\)/);
  assert.match(backend, /Authorization: `Bearer \$\{session\.access_token\}`/);
  assert.match(backend, /if \(!payload\.cancel_at_period_end\)/);
  assert.match(backend, /cancelSubscriptionAtPeriodEnd,/);
});

test('Keep Premium adapter sends an authenticated request to remove scheduled cancellation', () => {
  const backend = read('backend.js');
  assert.match(backend, /async function keepPremiumSubscription\(\)/);
  assert.match(backend, /JSON\.stringify\(\{ action: 'resumeSubscription' \}\)/);
  assert.match(backend, /payload\.cancel_at_period_end !== false/);
  assert.match(backend, /keepPremiumSubscription,/);
});

test('payment-method adapter accepts only HTTPS Stripe Billing Portal session URLs', () => {
  const backend = read('backend.js');
  assert.match(backend, /async function createPaymentMethodUpdateSession\(\)/);
  assert.match(backend, /JSON\.stringify\(\{ action: 'createPaymentMethodUpdateSession' \}\)/);
  assert.match(backend, /Authorization: `Bearer \$\{session\.access_token\}`/);
  assert.match(backend, /portalUrl\.protocol !== 'https:'/);
  assert.match(backend, /portalUrl\.hostname !== 'billing\.stripe\.com'/);
  assert.match(backend, /createPaymentMethodUpdateSession,/);
});

test('payment-method summary is authenticated, uses Stripe default-method precedence, and exposes only masked card fields', () => {
  const edge = read('supabase/functions/billing/index.ts');
  const backend = read('backend.js');
  const builder = read('builder.js');
  assert.match(edge, /action === "getPaymentMethodSummary"/);
  assert.match(edge, /action === "syncPaymentMethodFromCustomer"/);
  assert.match(edge, /stripe\.subscriptions\.update\(existing\.stripe_subscription_id, \{ default_payment_method: customerMethodId \}\)/);
  assert.match(edge, /stripe\.subscriptions\.update\(existing\.stripe_subscription_id, \{ default_source: customerSourceId \}\)/);
  assert.match(edge, /stripe\.subscriptions\.retrieve\(existing\.stripe_subscription_id, \{ expand: \["default_payment_method"\] \}\)/);
  assert.match(edge, /customer\.invoice_settings\?\.default_payment_method/);
  assert.match(edge, /stripe\.customers\.retrieveSource\(existing\.stripe_customer_id, sourceId\)/);
  assert.match(edge, /stripeObjectId\(method\.customer\) !== customerId/);
  assert.match(edge, /return \{ brand, last4, exp_month: month, exp_year: year \}/);
  assert.match(edge, /payment_method: summary/);
  assert.match(backend, /async function getCurrentPaymentMethodSummary\(\)/);
  assert.match(backend, /JSON\.stringify\(\{ action: 'getPaymentMethodSummary' \}\)/);
  assert.match(backend, /!\/\^\\d\{4\}\$\/\.test\(card\.last4\)/);
  assert.match(backend, /getCurrentPaymentMethodSummary,/);
  assert.match(builder, /id="current-payment-method"/);
  assert.match(builder, /getCurrentPaymentMethodSummary\(\)/);
  assert.match(builder, /ending in \$\{card\.last4\}/);
  assert.match(builder, /requestId !== currentCardSummaryRequest/);
  assert.match(builder, /syncPaymentMethodFromCustomer\(\)/);
  assert.doesNotMatch(builder, /card\.number|card\.cvc/);
});

test('payment history is authenticated, paginated, and restricted to verified Pathway subscriptions', () => {
  const edge = read('supabase/functions/billing/index.ts');
  const backend = read('backend.js');
  const builder = read('builder.js');
  assert.match(edge, /action === "listPaymentHistory"/);
  assert.match(edge, /stripe\.invoices\.list\(\{\s*customer: existing\.stripe_customer_id,\s*limit: 10/);
  assert.match(edge, /invoiceSubscriptionId\(item\)/);
  assert.match(edge, /invoice\.parent[\s\S]*details\.subscription/);
  assert.match(edge, /subscription\.metadata\?\.workspace_id === workspace\.id/);
  assert.match(edge, /verifiedSubscriptionIds\.has\(subscriptionId\)/);
  assert.match(edge, /if \(rawStatus === "draft"\) return \[\]/);
  assert.match(edge, /safeStripeInvoiceUrl\(invoice\.hosted_invoice_url\)/);
  assert.match(edge, /safeStripeInvoiceUrl\(invoice\.invoice_pdf\)/);
  assert.match(edge, /has_more: Boolean\(page\.has_more\)/);
  assert.match(edge, /limit: 10/);
  assert.match(backend, /async function listPaymentHistory\(startingAfter = null\)/);
  assert.match(backend, /JSON\.stringify\(\{ action: 'listPaymentHistory'/);
  assert.match(backend, /invoices\.length > 10/);
  assert.match(backend, /url\.protocol === 'https:'/);
  assert.match(backend, /listPaymentHistory,/);
  assert.match(backend, /hasBillingHistory: Boolean\(data\?\.stripe_customer_id && data\?\.stripe_subscription_id\)/);
  assert.match(builder, /historyButton\.id = 'payment-history-toggle'/);
  assert.match(builder, /loadPaymentHistory\(true\)/);
  assert.match(builder, /View invoice/);
  assert.match(builder, /invoice\.invoicePdf/);
  assert.match(builder, /formatInvoiceAmount\(invoice\)/);
  assert.match(builder, /subscription\?\.hasBillingHistory/);
});

test('header loads Stripe.js directly and checkout form uses the configured beta', () => {
  const html = read('index.html');
  const builder = read('builder.js');
  assert.match(html, /backend\.js\?v=my-companies-20261005/);
  assert.match(html, /builder\.js\?v=my-companies-20261005/);
  assert.match(html, /styles\.css\?v=my-companies-20261005/);
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

test('billing endpoint schedules cancellation only at period end after verifying the owner and Stripe subscription', () => {
  const edge = read('supabase/functions/billing/index.ts');
  assert.match(edge, /action !== "checkout" && action !== "cancelSubscription" && action !== "resumeSubscription" && action !== "createPaymentMethodUpdateSession" && action !== "getPaymentMethodSummary" && action !== "syncPaymentMethodFromCustomer" && action !== "listPaymentHistory"/);
  assert.match(edge, /auth\.getUser\(bearer\)/);
  assert.match(edge, /owner_id", auth\.user\.id/);
  assert.match(edge, /stripe_subscription_id/);
  assert.match(edge, /current\.metadata\?\.workspace_id !== workspace\.id/);
  assert.match(edge, /stripe\.subscriptions\.update\(existing\.stripe_subscription_id, \{ cancel_at_period_end: true \}\)/);
  assert.match(edge, /if \(action === "resumeSubscription"\)/);
  assert.match(edge, /current\.cancel_at_period_end/);
  assert.match(edge, /stripe\.subscriptions\.update\(existing\.stripe_subscription_id, \{ cancel_at_period_end: false \}\)/);
  assert.match(edge, /if \(action === "createPaymentMethodUpdateSession"\)/);
  assert.match(edge, /stripe\.billingPortal\.sessions\.create\(/);
  assert.match(edge, /customer: existing\.stripe_customer_id/);
  assert.match(edge, /type: "payment_method_update"/);
  assert.match(edge, /redirect: \{ return_url: completedReturnUrl\.href \}/);
  assert.match(edge, /if \(action === "createPaymentMethodUpdateSession"\)/);
  assert.match(edge, /stripe\.billingPortal\.sessions\.create\(/);
  assert.match(edge, /customer: existing\.stripe_customer_id/);
  assert.match(edge, /type: "payment_method_update"/);
  assert.match(edge, /billing", "payment-method-updated"/);
  assert.match(edge, /cancel_at_period_end: Boolean\(updated\.cancel_at_period_end\)/);
  const deleteWorkspaceIndex = edge.indexOf('if (action === "deleteWorkspace")');
  assert.ok(deleteWorkspaceIndex >= 0, 'workspace deletion must be a separate owner action');
  assert.doesNotMatch(edge.slice(0, deleteWorkspaceIndex), /subscriptions\.cancel\(/, 'ordinary plan cancellation must remain at period end');
  assert.doesNotMatch(edge, /refunds\.create\(/);
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
