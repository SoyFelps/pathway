const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

test('the sign-in screens no longer say "Early access"', () => {
  assert.equal(read('auth.js').includes('Early access'), false);
});

test('under the main button, people agree to the Terms of Use and Privacy Policy, with links to the legal page', () => {
  const auth = read('auth.js');
  assert.ok(auth.includes("'By ' + action + ', you agree to our <a href=\"legal.html#terms\" target=\"_blank\" rel=\"noopener\">Terms of Use</a> and <a href=\"legal.html#privacy\" target=\"_blank\" rel=\"noopener\">Privacy Policy</a>.'"));
  assert.ok(auth.includes("legalConsentHtml(state.mode === 'signup' ? 'creating an account' : 'signing in')"), 'sign-up and sign-in each get their own wording');
  assert.ok(auth.includes("(state.mode === 'signup' ? ' ' + legalConsentHtml('creating an account') : '')"), 'people who sign up from an invitation also see it');
  assert.equal(auth.includes('One account creates one private workspace'), false, 'the old text is gone');
});

test('legal.html holds the Terms of Use, Privacy Policy, Data Processing Terms and the provider list', () => {
  const html = read('legal.html');
  for (const id of ['terms', 'privacy', 'processing', 'subprocessors']) assert.ok(html.includes(`<article id="${id}"`), `section ${id}`);
  assert.ok(html.includes('<title>Terms of Use and Privacy Policy · Pathway</title>'));
  assert.ok(html.includes('Version 2026-10-19-v2'));
});

test('the legal text covers the points that protect the company and the data subjects', () => {
  const html = read('legal.html');
  const required = [
    'Lei nº 13.709/2018', 'LGPD', 'GDPR', 'ANPD', 'controlador', 'operador',
    'LGPD art. 20', 'GDPR art. 22', 'Limitation of liability', 'Indemnification', 'AS IS', 'Governing law',
    'we do not use Customer Content or Candidate Data to train', 'standard contractual clauses', 'LGPD (art. 18)',
    'within 15 days', 'Children', 'Cookies and local storage', 'Supabase', 'Stripe', 'Resend', 'Cloudflare', 'GitHub',
  ];
  assert.deepEqual(required.filter(text => !html.includes(text)), []);
});

test('everything the owner must fill in is highlighted, and no secret or key is on the page', () => {
  const html = read('legal.html');
  const todos = html.match(/<mark class="legal-todo">\[[^\]]+\]<\/mark>/g) || [];
  assert.ok(todos.length >= 10, 'placeholders for company name, registration, address, e-mails and court are highlighted');
  assert.equal(/sk_(live|test)_|whsec_|sb_publishable_|service_role|0x4AAAA/.test(html), false);
});

test('the legal page needs no scripts and uses the shared stylesheet', () => {
  const html = read('legal.html');
  assert.equal(/<script/i.test(html), false);
  assert.ok(/<link rel="stylesheet" href="styles\.css\?v=[^"]+">/.test(html));
});
