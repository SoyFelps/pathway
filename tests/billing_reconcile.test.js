const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compare = () => import(require('node:url').pathToFileURL(path.join(root, 'supabase/functions/billing-reconcile/compare.ts')).href);

const NOW = new Date('2026-11-02T07:00:00Z');
const OLD = '2026-11-01T00:00:00Z'; // long enough ago to be corrected
const db = (over = {}) => ({ workspace_id: 'w1', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', status: 'active', current_period_end: '2026-11-27T11:42:44Z', cancel_at_period_end: false, updated_at: OLD, ...over });
const st = (over = {}) => ({ id: 'sub_1', customerId: 'cus_1', status: 'active', periodEnd: '2026-11-27T11:42:44Z', cancelAtPeriodEnd: false, workspaceId: 'w1', ...over });

test('a subscription that matches Stripe produces nothing', async () => {
  const { compareSubscriptions } = await compare();
  const { findings, summary } = compareSubscriptions([db()], [st()], new Set(), NOW);
  assert.deepEqual(findings, []);
  assert.equal(summary.inSync, 1);
});

test('a cancellation the webhook missed is corrected from Stripe (database active, Stripe canceled)', async () => {
  const { compareSubscriptions } = await compare();
  const { findings, summary } = compareSubscriptions([db()], [st({ status: 'canceled' })], new Set(), NOW);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'fix');
  assert.deepEqual(findings[0].changes, [{ field: 'status', database: 'active', stripe: 'canceled' }]);
  assert.equal(summary.fixes, 1);
});

test('a renewal the webhook missed is corrected too (the customer paid, the stored end date is old)', async () => {
  const { compareSubscriptions } = await compare();
  const { findings } = compareSubscriptions([db({ current_period_end: '2026-10-27T11:42:44Z' })], [st({ periodEnd: '2026-11-27T11:42:44Z' })], new Set(), NOW);
  assert.equal(findings[0].kind, 'fix');
  assert.equal(findings[0].changes[0].field, 'current_period_end');
});

test('the end date is compared by the second, and a cancel-at-period-end flag difference is a fix', async () => {
  const { compareSubscriptions } = await compare();
  assert.deepEqual(compareSubscriptions([db({ current_period_end: '2026-11-27 11:42:44+00' })], [st()], new Set(), NOW).findings, [], 'same moment, different text');
  const flag = compareSubscriptions([db()], [st({ cancelAtPeriodEnd: true })], new Set(), NOW).findings;
  assert.equal(flag[0].kind, 'fix');
  assert.equal(flag[0].changes[0].field, 'cancel_at_period_end');
});

test('a row changed in the last hour is left alone (the webhook may be working on it)', async () => {
  const { compareSubscriptions } = await compare();
  const recent = new Date(NOW.getTime() - 20 * 60 * 1000).toISOString();
  const { findings, summary } = compareSubscriptions([db({ updated_at: recent })], [st({ status: 'canceled' })], new Set(), NOW);
  assert.deepEqual(findings, []);
  assert.equal(summary.skippedRecent, 1);
});

test('ambiguous cases are only reported, never corrected', async () => {
  const { compareSubscriptions } = await compare();
  const reason = (rows, subs, existing = new Set()) => compareSubscriptions(rows, subs, existing, NOW).findings.map(item => item.kind + ':' + item.reason);
  assert.deepEqual(reason([db()], []), ['review:subscription_not_in_stripe']);
  assert.deepEqual(reason([db()], [st({ customerId: 'cus_other', status: 'canceled' })]), ['review:customer_mismatch']);
  assert.deepEqual(reason([db()], [st({ workspaceId: 'w2', status: 'canceled' })]), ['review:workspace_mismatch']);
  assert.deepEqual(reason([], [st({ workspaceId: 'gone' })]), ['review:stripe_subscription_without_workspace']);
  assert.deepEqual(reason([db({ stripe_subscription_id: 'sub_old' })], [st({ id: 'sub_new', workspaceId: 'w1' })], new Set(['w1'])), ['review:subscription_not_in_stripe', 'review:stripe_subscription_unknown_workspace_has_other']);
});

test('a paid subscription the database never recorded is created, but only for a workspace that exists and has no record', async () => {
  const { compareSubscriptions } = await compare();
  const { findings, summary } = compareSubscriptions([], [st()], new Set(['w1']), NOW);
  assert.equal(findings[0].kind, 'create');
  assert.equal(summary.creates, 1);
  assert.deepEqual(compareSubscriptions([], [st({ workspaceId: null })], new Set(), NOW).findings, [], 'not made by Pathway: ignored');
});

test('two subscriptions for one workspace without a record: only the first is created, the second is for a person to look at', async () => {
  const { compareSubscriptions } = await compare();
  const { findings } = compareSubscriptions([], [st({ id: 'sub_a' }), st({ id: 'sub_b' })], new Set(['w1']), NOW);
  assert.deepEqual(findings.map(item => item.kind + ':' + (item.reason || item.subscriptionId)), ['create:sub_a', 'review:stripe_subscription_unknown_workspace_has_other']);
});

test('old finished subscriptions are history: a workspace that cancelled and subscribed again raises no alarm', async () => {
  const { compareSubscriptions } = await compare();
  const old = st({ id: 'sub_old', status: 'canceled' });
  const expired = st({ id: 'sub_expired', status: 'incomplete_expired' });
  // The record points to the new subscription; the old canceled one and an abandoned checkout are still listed by Stripe.
  const { findings } = compareSubscriptions([db({ stripe_subscription_id: 'sub_new' })], [st({ id: 'sub_new' }), old, expired], new Set(['w1']), NOW);
  assert.deepEqual(findings, []);
  // A finished subscription of a workspace that is gone, or of one with no record at all, is ignored too.
  assert.deepEqual(compareSubscriptions([], [old], new Set(), NOW).findings, []);
  assert.deepEqual(compareSubscriptions([], [old], new Set(['w1']), NOW).findings, []);
});

test('two LIVE subscriptions for one workspace are reported (possible double charge); finished ones never count', async () => {
  const { compareSubscriptions } = await compare();
  const { findings } = compareSubscriptions([db({ stripe_subscription_id: 'sub_a' })], [st({ id: 'sub_a' }), st({ id: 'sub_b' })], new Set(['w1']), NOW);
  assert.deepEqual(findings.map(item => item.kind + ':' + item.reason), ['review:stripe_subscription_unknown_workspace_has_other']);
  const order = compareSubscriptions([], [st({ id: 'sub_old', status: 'canceled' }), st({ id: 'sub_live' })], new Set(['w1']), NOW).findings;
  assert.deepEqual(order.map(item => item.kind + ':' + item.subscriptionId), ['create:sub_live']);
});

test('access is the same rule the database uses: active and the end date in the future', async () => {
  const { hasAccess } = await compare();
  assert.equal(hasAccess('active', '2026-11-27T00:00:00Z', NOW), true);
  assert.equal(hasAccess('active', '2026-10-27T00:00:00Z', NOW), false);
  assert.equal(hasAccess('canceled', '2026-11-27T00:00:00Z', NOW), false);
  assert.equal(hasAccess('active', null, NOW), false);
});

test('the report names ids and plan fields only, and says what was done', async () => {
  const { compareSubscriptions, reportText } = await compare();
  const { findings, summary } = compareSubscriptions([db()], [st({ status: 'canceled' })], new Set(), NOW);
  const text = reportText(summary, findings, { 'w1:sub_1': 'done' });
  assert.ok(text.includes('CORRECTED workspace w1 subscription sub_1: status active -> canceled.'));
  assert.ok(text.includes('1 corrected'));
  assert.ok(reportText(summary, findings, {}).includes('NOT CORRECTED'));
});

test('the function: Stripe test key by name, report only when configured, optimistic update, jobs offline when access is lost', () => {
  const code = read('supabase/functions/billing-reconcile/index.ts');
  assert.ok(code.includes('Deno.env.get("STRIPE_SECRET_KEY")'), 'the same secret the billing functions use: switching to live mode changes that one value');
  assert.ok(code.includes('Deno.env.get("RECONCILE_REPORT_TO")') && code.includes('if (!REPORT_TO || !RESEND_API_KEY) return false;'));
  assert.ok(code.includes('.eq("updated_at", finding.databaseUpdatedAt)'), 'never overwrites a row the webhook changed meanwhile');
  assert.ok(code.includes('if (!hasAccess(target.status, target.periodEnd, now)) await takeJobPagesOffline(finding.workspaceId);'));
  assert.ok(code.includes('THROTTLE_MS = 30 * 60 * 1000') && code.includes('stripe!.subscriptions.list({ status: "all", limit: 100 })'));
  assert.ok(code.includes('if (finding.kind === "review") continue;'), 'ambiguous cases are never applied');
  assert.ok(!/sk_(test|live)_|whsec_|console\.(log|error)\([^)]*(stripeSecret|serviceKey)/.test(code), 'no secret in code or logs');
  assert.ok(code.includes('STRIPE_API_VERSION = "2026-03-25.dahlia; custom_checkout_payment_form_preview=v1"') && read('supabase/functions/billing-webhook/index.ts').includes('2026-03-25.dahlia; custom_checkout_payment_form_preview=v1'), 'same Stripe API version as the webhook');
  const webhook = read('supabase/functions/billing-webhook/index.ts');
  assert.ok(webhook.includes('publication_status: "draft", active_published_flow_id: null') && code.includes('publication_status: "draft", active_published_flow_id: null'), 'unpublishing works like the webhook');
});

test('the migration: two private tables, a kick function that only calls the function, one daily job at 07:00 UTC', () => {
  const sql = read('supabase/migrations/20261101160000_billing_reconcile.sql');
  for (const table of ['billing_settings', 'billing_reconcile_runs']) {
    assert.ok(sql.includes(`alter table public.${table} enable row level security;`) && sql.includes(`revoke all on public.${table} from public, anon, authenticated;`) && sql.includes(`grant all on public.${table} to service_role;`), table);
  }
  assert.ok(sql.includes("cron.schedule('billing-reconcile', '0 7 * * *'"));
  assert.ok(sql.includes('revoke all on function public.billing_reconcile_kick()') && sql.includes("select value into v_url from public.billing_settings where key = 'reconcile_url'"));
  assert.ok(!/sk_(test|live)_|whsec_|api[_-]?key/i.test(sql.replace(/--.*$/gm, '')), 'no secret is ever stored in the database');
  assert.ok(read('supabase/config.toml').includes('[functions.billing-reconcile]'));
});

test('plans: the plan of a subscription comes from its price (lookup keys, the old price counts as Agency, an unknown price changes nothing)', async () => {
  const { planOfPrice, compareSubscriptions } = await compare();
  const LEGACY = 'price_legacy';
  assert.equal(planOfPrice({ id: 'price_a', lookup_key: 'pathway_business_monthly' }, LEGACY), 'business');
  assert.equal(planOfPrice({ id: 'price_b', lookup_key: 'pathway_agency_monthly' }, LEGACY), 'agency');
  assert.equal(planOfPrice({ id: LEGACY, lookup_key: null }, LEGACY), 'agency', 'the US$ 24.90 price sold before the plans');
  assert.equal(planOfPrice({ id: 'price_other', lookup_key: null }, LEGACY), null);
  assert.equal(planOfPrice(null, LEGACY), null);
  // an upgrade the webhook missed is corrected; an unknown price (plan null) and a database without a plan are left alone
  const fix = compareSubscriptions([db({ plan: 'business', updated_at: OLD })], [st({ plan: 'agency' })], new Set(), NOW).findings;
  assert.equal(fix.length, 1);
  assert.deepEqual(fix[0].changes, [{ field: 'plan', database: 'business', stripe: 'agency' }]);
  assert.deepEqual(compareSubscriptions([db({ plan: 'agency', updated_at: OLD })], [st({ plan: null })], new Set(), NOW).findings, []);
  assert.deepEqual(compareSubscriptions([db({ updated_at: OLD })], [st({ plan: 'agency' })], new Set(), NOW).findings, []);
});

test('plans: checkout and plan change are decided by the server, the webhook and the reconciliation write the plan from the price', () => {
  const billing = read('supabase/functions/billing/index.ts');
  assert.ok(billing.includes('const PRICE_LOOKUP_KEYS = { business: "pathway_business_monthly", agency: "pathway_agency_monthly" } as const;'));
  assert.ok(billing.includes('if (body && (body.plan === "business" || body.plan === "agency")) requestedPlan = body.plan;'), 'only the two plan names are accepted');
  assert.ok(billing.includes('proration_behavior: "always_invoice"') && billing.includes('payment_behavior: "error_if_incomplete"'), 'a refused card changes nothing');
  assert.ok(billing.includes('if (requestedPlan !== "agency") return fail(req, 409, "Moving to a smaller plan is scheduled from My Plan.");'), 'smaller plans are never changed here');
  const webhook = read('supabase/functions/billing-webhook/index.ts');
  assert.ok(webhook.includes('...(planOfSubscription(subscription) ? { plan: planOfSubscription(subscription) } : {}),'));
  assert.ok(webhook.includes('pathway_business_monthly: "business", pathway_agency_monthly: "agency"'));
  const reconcile = read('supabase/functions/billing-reconcile/index.ts');
  assert.ok(reconcile.includes('...(target.plan ? { plan: target.plan } : {})'));
  const backend = read('backend.js');
  assert.ok(backend.includes("body: billingBody({ action: 'changePlan', plan: plan === 'agency' ? 'agency' : 'business' })"));
});
