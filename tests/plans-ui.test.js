const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

test('plans, phase 2: no screen or server message says Premium any more; the plan name comes from the plan', () => {
  for (const file of ['builder.js', 'auth.js', 'backend.js', 'pathway.js']) {
    const source = read(file);
    assert.equal(/\bt\(\s*'[^']*Premium/.test(source), false, file + ' still has a Premium text');
  }
  for (const fn of ['applications', 'team', 'ai-interview', 'ai-questions']) {
    const source = read('supabase/functions/' + fn + '/index.ts');
    assert.equal(/(?:fail\([^;\n]*|error:\s*)"[^"]*Premium/.test(source), false, fn + ' still sends a Premium message');
  }
  const builder = read('builder.js');
  assert.ok(builder.includes("const planName = plan => (plan === 'free' ? t('Free') : (C.PLANS[plan] || C.PLANS.business).name);"));
  assert.ok(builder.includes('<span class="status-dot"></span>${esc(planName(workspacePlan()))}</span>'), 'the header pill names the plan');
  assert.ok(builder.includes("${esc(planName(item.plan))}"), 'the workspace badges name the plan');
  assert.ok(builder.includes('<h2>${premium ? esc(planName(currentPlan())) : t(\'Free\')}</h2>'), 'My Plan names the plan');
});

test('plans, phase 2: My Plan shows the three plans and the subscription page sells the chosen one', () => {
  const builder = read('builder.js');
  assert.ok(builder.includes('function planCompareHtml()') && builder.includes("root.querySelector('.my-plan-page')?.insertAdjacentHTML('beforeend', planCompareHtml());"));
  assert.ok(builder.includes("C.planCardsHtml({ t, tn, esc }, { business: action('business'), agency: action('agency') }, current)"));
  assert.ok(builder.includes("function openSubscriptionPage(plan) {\n    chosenPlan = plan === 'agency' ? 'agency' : 'business';"));
  assert.ok(builder.includes("t('Nellio {plan} subscription', { plan: planName(chosenPlan) })"));
  assert.ok(builder.includes("${esc(planPrice(chosenPlan))}"));
  const backend = read('backend.js');
  assert.ok(backend.includes(".select('status,current_period_end,cancel_at_period_end,stripe_customer_id,stripe_subscription_id,plan')"), 'the subscription state carries the plan');
});

test('plans, phase 4a: the scheduled downgrade has one shared cleanup, a runner, a table and the screens', () => {
  assert.equal(read('supabase/functions/billing/plan-cleanup.ts'), read('supabase/functions/billing-reconcile/plan-cleanup.ts'), 'the two plan-cleanup.ts copies must stay identical');
  const migration = read('supabase/migrations/20261109130000_plan_downgrade.sql');
  assert.match(migration, /create unique index workspace_plan_changes_one_pending_idx[\s\S]*where status in \('scheduled', 'running'\)/);
  assert.match(migration, /revoke all on public\.workspace_plan_changes from public, anon, authenticated/);
  assert.match(migration, /grant all on public\.workspace_plan_changes to service_role/);
  const reconcile = read('supabase/functions/billing-reconcile/index.ts');
  assert.match(reconcile, /runDueDowngrades\(\)[\s\S]*return await run\(\)/, 'the runner goes first and never stops the daily comparison');
  assert.match(reconcile, /subscription\.plan === "business"/, 'nothing is deleted before Stripe moved the subscription to Business');
  const builder = read('builder.js');
  assert.match(builder, /function showDowngradeModal/);
  assert.match(builder, /DELETE/, 'deleting companies needs a typed confirmation');
  assert.match(builder, /plan-change-banner/);
  assert.match(builder, /overCompanyLimit\(\)\) \{ showChooseCompanyModal/, 'publishing is blocked while a Business workspace holds several companies');
  assert.match(builder, /new MutationObserver\(\(\) => \{ if \(!root\.querySelector\('\.plan-change-banner'\)\)/, 'the banner is painted again after every screen');
  const backend = read('backend.js');
  for (const name of ['scheduleDowngrade', 'cancelDowngrade', 'resolveCompanyLimit', 'getPlanChange']) assert.match(backend, new RegExp(name + ','));
});

test('plans: after a checkout the list of workspaces is read again, so the header plan, the company limit and the free-plan locks follow the new plan', () => {
  const builder = read('builder.js');
  const body = builder.slice(builder.indexOf('async function refreshSubscriptionAfterCheckout'), builder.indexOf('function renderSubscriptionPage'));
  assert.match(body, /myWorkspaces = await window\.PathwayBackend\.listMyWorkspaces\(\)/);
  assert.ok(body.indexOf('listMyWorkspaces') < body.indexOf('renderMyPlan()'), 'the list is read before the screen is drawn');
});
