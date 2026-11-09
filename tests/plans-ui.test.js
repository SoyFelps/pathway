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
  assert.ok(builder.includes("t('Pathway {plan} subscription', { plan: planName(chosenPlan) })"));
  assert.ok(builder.includes("${esc(planPrice(chosenPlan))}"));
  const backend = read('backend.js');
  assert.ok(backend.includes(".select('status,current_period_end,cancel_at_period_end,stripe_customer_id,stripe_subscription_id,plan')"), 'the subscription state carries the plan');
});
