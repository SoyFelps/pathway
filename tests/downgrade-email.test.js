const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const load = () => import('../supabase/functions/billing/downgrade-email.ts');
const base = { kind: 'confirmation', workspaceName: 'Acme Talent', effectiveAt: '2026-12-09T12:27:29Z', keepCompanyName: 'Keep Co', removedCompanyNames: ['Old A', 'Old B'], planUrl: 'https://example.test/index.html#my-plan' };

test('plans, phase 4b: the downgrade e-mail names the date, the company that stays and the ones that go, in the person\'s language', async () => {
  const { buildDowngradeEmail } = await load();
  const en = buildDowngradeEmail(base);
  assert.equal(en.subject, 'Your plan will change to Business on December 9, 2026');
  for (const body of [en.text, en.html]) for (const piece of ['Acme Talent', 'Keep Co', 'Old A', 'Old B', 'my-plan']) assert.ok(body.includes(piece), piece);
  assert.match(en.text, /permanently deleted/);
  const pt = buildDowngradeEmail({ ...base, language: 'pt-BR', kind: 'week' });
  assert.match(pt.subject, /^Lembrete: seu plano muda para o Business em 9 de dezembro de 2026$/);
  assert.match(pt.text, /excluídas para sempre/);
  const es = buildDowngradeEmail({ ...base, language: 'es', kind: 'day' });
  assert.match(es.subject, /último recordatorio/);
  assert.equal(buildDowngradeEmail({ ...base, language: 'fr' }).subject, en.subject, 'an unknown language falls back to English');
});

test('plans, phase 4b: no company chosen means no deletion list; one company means nothing is deleted; names are escaped', async () => {
  const { buildDowngradeEmail } = await load();
  const none = buildDowngradeEmail({ ...base, keepCompanyName: null, removedCompanyNames: ['Old A'] });
  assert.match(none.text, /No company is chosen/);
  assert.equal(none.text.includes('Old A'), false, 'nothing is listed for deletion without a company to keep');
  const single = buildDowngradeEmail({ ...base, removedCompanyNames: [] });
  assert.match(single.text, /Nothing will be deleted/);
  const hostile = buildDowngradeEmail({ ...base, workspaceName: '<script>x</script>', removedCompanyNames: ['<img src=x onerror=1>'] });
  assert.equal(hostile.html.includes('<script>'), false);
  assert.equal(hostile.html.includes('<img'), false);
  const many = buildDowngradeEmail({ ...base, removedCompanyNames: Array.from({ length: 14 }, (_, index) => 'Company ' + index) });
  assert.match(many.text, /and 4 more/);
});

test('plans, phase 4b: the notices are wired so that an e-mail failure never blocks the downgrade', () => {
  assert.equal(read('supabase/functions/billing/downgrade-email.ts'), read('supabase/functions/billing-reconcile/downgrade-email.ts'), 'the two downgrade-email.ts copies must stay identical');
  const email = read('supabase/functions/billing/downgrade-email.ts');
  assert.match(email, /catch \(error\) \{[\s\S]*return false;/, 'the sender swallows every error');
  assert.match(email, /plan-downgrade\/\$\{change\.id\}\/\$\{kind\}/, 'Resend gets an idempotency key per change and notice');
  const billing = read('supabase/functions/billing/index.ts');
  const afterSchedule = billing.slice(billing.indexOf('const { data: created, error: insertError }'));
  assert.ok(afterSchedule.indexOf('sendDowngradeNotice') > afterSchedule.indexOf('if (insertError)'), 'the e-mail is sent only after the change is recorded');
  assert.match(billing, /confirmation_sent_at/);
  const reconcile = read('supabase/functions/billing-reconcile/index.ts');
  assert.match(reconcile, /try \{ await runDowngradeReminders\(\); \} catch/, 'a reminder error does not stop the run');
  assert.ok(reconcile.indexOf('runDowngradeReminders();') < reconcile.indexOf('await runDueDowngrades();'));
  assert.match(reconcile, /notice_week_sent_at/);
  assert.match(reconcile, /notice_day_sent_at/);
});
