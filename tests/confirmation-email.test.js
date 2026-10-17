const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const loadEmail = () => import('../supabase/functions/applications/email.ts');

test('confirmation e-mail is written in English and names the role and the company', async () => {
  const { buildConfirmationEmail } = await loadEmail();
  const mail = buildConfirmationEmail({ name: 'Alex Morgan', jobTitle: 'Product Designer', companyName: 'CoreFront' });
  assert.equal(mail.subject, 'We received your application for Product Designer at CoreFront');
  for (const body of [mail.text, mail.html]) {
    assert.match(body, /Alex Morgan/);
    assert.match(body, /Product Designer/);
    assert.match(body, /CoreFront/);
  }
  assert.match(mail.text, /Thank you for applying/);
  assert.match(mail.text, /Please do not reply/);
  assert.equal(mail.fromName, 'CoreFront via Pathway');
});

test('candidate-controlled values cannot inject HTML or e-mail headers', async () => {
  const { buildConfirmationEmail, safeDisplayName } = await loadEmail();
  const mail = buildConfirmationEmail({
    name: '<img src=x onerror=alert(1)>\r\nBcc: evil@example.test',
    jobTitle: 'Role\r\nBcc: evil@example.test',
    companyName: 'Evil <Co>" , <a@b.c>',
  });
  assert.equal(/[\r\n]/.test(mail.subject), false);
  assert.equal(mail.html.includes('<img'), false);
  assert.equal(mail.html.includes('<a@b.c>'), false);
  assert.match(mail.html, /&lt;img/);
  assert.equal(/[<>"@,]/.test(mail.fromName), false);
  assert.equal(safeDisplayName('"><x>'), 'x');
  assert.equal(safeDisplayName('   '), 'Pathway');
});

test('missing or oversized values fall back to safe defaults', async () => {
  const { buildConfirmationEmail } = await loadEmail();
  const empty = buildConfirmationEmail({ name: '', jobTitle: undefined, companyName: null });
  assert.equal(empty.subject, 'We received your application for the open role at the hiring team');
  assert.match(empty.text, /^Hi there,/);
  const long = buildConfirmationEmail({ name: 'N'.repeat(500), jobTitle: 'J'.repeat(500), companyName: 'C'.repeat(500) });
  assert.ok(long.subject.length <= 200);
  assert.ok(long.fromName.length <= 60);
});

test('the applications function sends the confirmation only after a new application is saved, as best effort', () => {
  const source = read('supabase/functions/applications/index.ts').replace(/\r\n/g, '\n');
  const submit = source.slice(source.indexOf('async function submitApplicant('), source.indexOf('async function deleteFlowForOwner('));
  const honeypot = submit.indexOf('cleanName(form.get("website"), 300)');
  const validation = submit.indexOf('validateApplicantSubmission(');
  const duplicate = submit.indexOf('if (existing) return response');
  const insert = submit.indexOf('admin.from("applicants").insert(');
  const send = submit.indexOf('sendApplicationConfirmation(submissionKey');
  assert.ok(honeypot > 0 && validation > honeypot && duplicate > validation && insert > duplicate && send > insert,
    'honeypot, validation and duplicate checks all happen before the e-mail is sent');
  assert.ok(submit.indexOf('return response(req, 200', send) > send, 'the success response comes after the send is started');

  const sender = source.slice(source.indexOf('async function sendApplicationConfirmation('), source.indexOf('async function submitApplicant('));
  assert.match(sender, /if \(!RESEND_API_KEY\)/, 'no key means a logged skip, not a failure');
  assert.match(sender, /try \{[\s\S]*catch \(error\)/, 'sending never throws into the application flow');
  assert.ok(sender.includes('https://api.resend.com/emails'));
  assert.ok(sender.includes('Idempotency-Key'));
  assert.equal(/console\.(log|error)\([^)]*(candidate_email|normalized\.email|\bto\b\s*[,)])/.test(sender), false, 'the candidate address is never logged');
  assert.ok(source.includes('Deno.env.get("RESEND_API_KEY")'));
  assert.ok(source.includes('Deno.env.get("EMAIL_FROM")'));
});
