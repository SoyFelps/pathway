const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const loadCaptcha = () => import('../supabase/functions/applications/captcha.ts');

function fakeFetch(reply) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (reply instanceof Error) throw reply;
    return { ok: reply.ok ?? true, status: reply.status ?? 200, json: async () => reply.body };
  };
  return { impl, calls };
}

test('captcha: a missing or oversized token is refused without calling Cloudflare', async () => {
  const { verifyTurnstileToken, MAX_TOKEN_LENGTH } = await loadCaptcha();
  const { impl, calls } = fakeFetch({ body: { success: true } });
  for (const token of [undefined, null, '', '   ', 42]) {
    assert.deepEqual(await verifyTurnstileToken('secret', token, '203.0.113.9', impl), { ok: false, reason: 'missing', codes: [] });
  }
  const long = await verifyTurnstileToken('secret', 'x'.repeat(MAX_TOKEN_LENGTH + 1), '203.0.113.9', impl);
  assert.equal(long.ok, false);
  assert.equal(long.reason, 'rejected');
  assert.equal(calls.length, 0);
});

test('captcha: a valid token is accepted and the request carries the secret, token and visitor address', async () => {
  const { verifyTurnstileToken, TURNSTILE_VERIFY_URL } = await loadCaptcha();
  const { impl, calls } = fakeFetch({ body: { success: true } });
  assert.deepEqual(await verifyTurnstileToken('the-secret', ' the-token ', '203.0.113.9', impl), { ok: true });
  assert.equal(calls[0].url, TURNSTILE_VERIFY_URL);
  assert.equal(calls[0].init.method, 'POST');
  const body = calls[0].init.body;
  assert.equal(body.get('secret'), 'the-secret');
  assert.equal(body.get('response'), 'the-token');
  assert.equal(body.get('remoteip'), '203.0.113.9');

  const unknown = fakeFetch({ body: { success: true } });
  await verifyTurnstileToken('the-secret', 'the-token', 'unknown', unknown.impl);
  assert.equal(unknown.calls[0].init.body.has('remoteip'), false, 'an unknown address is not sent');
});

test('captcha: wrong, expired or reused tokens are rejected', async () => {
  const { verifyTurnstileToken } = await loadCaptcha();
  for (const code of ['invalid-input-response', 'timeout-or-duplicate']) {
    const { impl } = fakeFetch({ body: { success: false, 'error-codes': [code] } });
    const result = await verifyTurnstileToken('secret', 'token', '203.0.113.9', impl);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'rejected');
    assert.deepEqual(result.codes, [code]);
  }
});

test('captcha: our own configuration problems and outages are "unavailable", not the visitor\'s fault', async () => {
  const { verifyTurnstileToken } = await loadCaptcha();
  for (const code of ['invalid-input-secret', 'missing-input-secret', 'bad-request', 'internal-error']) {
    const { impl } = fakeFetch({ body: { success: false, 'error-codes': [code] } });
    assert.equal((await verifyTurnstileToken('secret', 'token', '203.0.113.9', impl)).reason, 'unavailable', code);
  }
  assert.equal((await verifyTurnstileToken('secret', 'token', '203.0.113.9', fakeFetch({ ok: false, status: 502 }).impl)).reason, 'unavailable');
  assert.equal((await verifyTurnstileToken('secret', 'token', '203.0.113.9', fakeFetch(new Error('network down')).impl)).reason, 'unavailable');
});

test('application endpoint runs its checks in a safe order', () => {
  const source = read('supabase/functions/applications/index.ts');
  const submit = source.slice(source.indexOf('async function submitApplicant('), source.indexOf('async function deleteFlowForOwner('));
  const at = needle => { const i = submit.indexOf(needle); assert.ok(i >= 0, `missing: ${needle}`); return i; };
  const order = [
    at('cleanName(form.get("website"), 300)'),            // honeypot
    at('verifyTurnstileToken('),                           // CAPTCHA before any database or storage work
    at('loadActiveFlow(publishedId)'),
    at('consume_applicant_submission_limit'),              // per-visitor limit
    at('if (existing) return response'),                   // a retry of a saved application still succeeds
    at('FLOW_MAX_PER_HOUR'),                               // per-job ceiling
    at('const firstForAddress'),
    at('admin.storage.from(BUCKET).upload('),
    at('admin.from("applicants").insert('),
    at('if (firstForAddress)'),
  ];
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'checks happen in the intended order');
  assert.equal(submit.split('const ip = ').length - 1, 1, 'the visitor address is computed once, before the CAPTCHA');
});

test('captcha is enforced whenever the secret exists and fails closed when the check cannot run', () => {
  const source = read('supabase/functions/applications/index.ts');
  assert.ok(source.includes('Deno.env.get("TURNSTILE_SECRET_KEY")'));
  assert.ok(source.includes('if (TURNSTILE_SECRET_KEY) {'));
  assert.ok(source.includes('console.warn("TURNSTILE_SECRET_KEY is not set'), 'running without a CAPTCHA is logged');
  assert.match(source, /reason === "unavailable"[\s\S]{0,200}fail\(req, 503/);
  assert.match(source, /"Complete the security check to submit your application\."/);
  assert.equal(/0x4AAAA[A-Za-z0-9_-]{10,}/.test(source), false, 'no Turnstile key is written in the function');
});

test('per-job ceilings are high by default, configurable, and answer 429', () => {
  const source = read('supabase/functions/applications/index.ts');
  assert.ok(source.includes('positiveInt("FLOW_MAX_APPLICATIONS_PER_HOUR", 300)'));
  assert.ok(source.includes('positiveInt("FLOW_MAX_APPLICATIONS_PER_DAY", 2000)'));
  assert.match(source, />= FLOW_MAX_PER_HOUR \|\| \(lastDay\.count \?\? 0\) >= FLOW_MAX_PER_DAY[\s\S]{0,400}fail\(req, 429, "This job is receiving a very high volume/);
  assert.ok(source.includes('.gte("submitted_at", hourAgo)') && source.includes('.gte("submitted_at", dayAgo)'));
});

test('the confirmation e-mail is sent only for the first application from an address to a job', () => {
  const source = read('supabase/functions/applications/index.ts');
  assert.match(source, /\.eq\("flow_id", active\.flow\.id\)\.eq\("candidate_email", normalized\.email\)/);
  assert.ok(source.includes('const firstForAddress = !previousError && (previousApplications?.length ?? 0) === 0;'), 'a failed lookup never sends');
  assert.match(source, /if \(firstForAddress\) \{[\s\S]{0,400}sendApplicationConfirmation\(/);
  assert.ok(source.includes('Confirmation e-mail skipped: this address has already applied to this job.'));
  const submitBody = source.slice(source.indexOf('async function submitApplicant('), source.indexOf('async function deleteFlowForOwner('));
  const visitorMessages = submitBody.match(/fail\(req, \d+,\s*"[^"]*"/g) || [];
  assert.ok(visitorMessages.length >= 8, 'the error messages shown to visitors were found');
  assert.equal(visitorMessages.some(message => /already|duplicate|exists|used before/i.test(message)), false,
    'no message tells the visitor that an address applied before');
  const successResponses = submitBody.match(/return response\(req, 200, \{[^}]*\}\)/g) || [];
  assert.ok(successResponses.every(item => item === 'return response(req, 200, { submitted: true, accepted: true })'), 'every success looks the same');
});

test('the candidate page asks for a CAPTCHA token only at submission time and sends it to the server', () => {
  const candidate = read('candidate.js');
  const submit = candidate.slice(candidate.indexOf('async function submitApplication('), candidate.indexOf('function renderSubmissionError('));
  assert.ok(candidate.includes("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"));
  assert.ok(candidate.includes("execution: 'execute'") && candidate.includes("appearance: 'interaction-only'"));
  assert.ok(candidate.includes('if (!siteKey || !container) return \'\';'), 'no site key means no CAPTCHA');
  assert.ok(candidate.includes('id="captcha-box"'), 'a container exists on the submitting screen');
  assert.ok(submit.indexOf('requestCaptchaToken(') >= 0 && submit.indexOf('requestCaptchaToken(') < submit.indexOf('PathwayBackend.submitApplication('));
  assert.ok(submit.includes('turnstileToken,'));
  assert.ok(read('backend.js').includes("form.set('turnstileToken', application.turnstileToken || '');"));
  // the token is never requested when the visitor opens the form: it would expire while they answer questions
  assert.equal(candidate.split('requestCaptchaToken(').length - 1, 2, 'one definition and one call');
});

test('apply.html loads the CAPTCHA settings, and the settings file holds only a public site key', () => {
  const html = read('apply.html');
  assert.ok(html.indexOf('turnstile-config.js') > 0 && html.indexOf('turnstile-config.js') < html.indexOf('candidate.js'));
  const config = read('turnstile-config.js');
  assert.match(config, /window\.PATHWAY_TURNSTILE = \{\s*siteKey: '[^']*'\s*\};/);
  assert.equal(/secret\s*[:=]/i.test(config.replace(/^\/\*[\s\S]*?\*\//, '')), false, 'no secret value in the browser config');
});
