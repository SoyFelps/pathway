const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const load = file => import(require('node:url').pathToFileURL(path.join(root, file)).href);
const logic = () => load('supabase/functions/ai-interview/logic.ts');
const client = () => load('supabase/functions/ai-interview/witcher.ts');

test('logic.ts and witcher.ts are identical in both AI-interview functions', () => {
  for (const file of ['logic.ts', 'witcher.ts']) {
    assert.equal(read(`supabase/functions/ai-interview/${file}`), read(`supabase/functions/ai-interview-webhook/${file}`), file);
  }
});

test('a Witcher signature is checked the same way Witcher makes it, and stale or forged calls fail', async () => {
  const { verifyWebhook, SIGNATURE_TOLERANCE_SECONDS } = await logic();
  const body = JSON.stringify({ event: 'completed', interview: { externalId: 'x' } });
  const now = 1790000000;
  const sign = (secret, ts, text) => 'v1=' + crypto.createHmac('sha256', secret).update(`${ts}.${text}`).digest('hex');
  assert.equal(await verifyWebhook('s3cret', String(now), sign('s3cret', now, body), body, now + 5), true);
  assert.equal(await verifyWebhook('s3cret', String(now), sign('other', now, body), body, now), false, 'wrong secret');
  assert.equal(await verifyWebhook('s3cret', String(now), sign('s3cret', now, body), body + ' ', now), false, 'changed body');
  assert.equal(await verifyWebhook('s3cret', String(now), sign('s3cret', now, body), body, now + SIGNATURE_TOLERANCE_SECONDS + 1), false, 'too old');
  assert.equal(await verifyWebhook('s3cret', String(now), sign('s3cret', now, body), body, now - SIGNATURE_TOLERANCE_SECONDS - 1), false, 'from the future');
  assert.equal(await verifyWebhook('', String(now), sign('', now, body), body, now), false, 'no secret configured never passes');
  assert.equal(await verifyWebhook('s3cret', null, sign('s3cret', now, body), body, now), false);
  assert.equal(await verifyWebhook('s3cret', String(now), null, body, now), false);
  assert.equal(await verifyWebhook('s3cret', 'abc', sign('s3cret', now, body), body, now), false);
});

test('only a candidate still in the column, with questions, a Premium plan and a language for the job, is sent', async () => {
  const { checkSendable } = await logic();
  const ok = { questions: ['Tell us about yourself.'], premium: true, stillInColumn: true, companyName: 'CoreFront', language: 'en' };
  assert.deepEqual(checkSendable(ok), { ok: true });
  assert.deepEqual(checkSendable({ ...ok, stillInColumn: false }), { ok: false, action: 'drop' });
  assert.deepEqual(checkSendable({ ...ok, questions: [] }), { ok: false, action: 'block', reason: 'no_questions' });
  assert.deepEqual(checkSendable({ ...ok, questions: ['hi', 12, null] }), { ok: false, action: 'block', reason: 'no_questions' }, 'too short or not text');
  assert.deepEqual(checkSendable({ ...ok, premium: false }), { ok: false, action: 'block', reason: 'no_plan' });
  assert.deepEqual(checkSendable({ ...ok, companyName: '  ' }), { ok: false, action: 'block', reason: 'no_company_name' });
  assert.deepEqual(checkSendable({ ...ok, language: null }), { ok: false, action: 'block', reason: 'no_language' }, 'nothing is sent in a language nobody decided');
  assert.deepEqual(checkSendable({ ...ok, language: undefined }), { ok: false, action: 'block', reason: 'no_language' });
  assert.deepEqual(checkSendable({ ...ok, language: 'fr' }), { ok: false, action: 'block', reason: 'no_language' }, 'only the three languages of the interview');
  assert.deepEqual(checkSendable({ ...ok, language: 'pt' }), { ok: true });
  assert.deepEqual(checkSendable({ ...ok, language: 'es' }), { ok: true });
  assert.deepEqual(checkSendable({ ...ok, stillInColumn: false, premium: false }), { ok: false, action: 'drop' }, 'a card that left is dropped before anything else');
});

test('the create call carries the row id as externalId and only the data Witcher needs', async () => {
  const { buildCreateBody, companyLogoUrl } = await logic();
  const body = buildCreateBody({
    id: '11111111-1111-4111-8111-111111111111', candidateName: 'Marina Souza', candidateEmail: 'marina@example.com', jobTitle: 'Designer',
    companyName: 'CoreFront', logoUrl: 'https://x.supabase.co/storage/v1/object/public/company-logos/a.png', questions: ['  Tell   us about you. ', 'ab', 'Why this role?'],
  });
  assert.equal(body.externalId, '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(body.questions, ['Tell us about you.', 'Why this role?']);
  assert.deepEqual(body.company, { name: 'CoreFront', logoUrl: 'https://x.supabase.co/storage/v1/object/public/company-logos/a.png' });
  assert.ok(!('logoUrl' in buildCreateBody({ id: 'a', candidateName: 'a', candidateEmail: 'a@b.co', jobTitle: 'j', companyName: 'c', logoUrl: null, questions: ['abc'] }).company));
  const withColor = buildCreateBody({ id: 'a', candidateName: 'a', candidateEmail: 'a@b.co', jobTitle: 'j', companyName: 'c', logoUrl: null, color: '#AA3355', questions: ['abc'] });
  assert.deepEqual(withColor.company, { name: 'c', color: '#aa3355' }, 'the primary colour travels in lower case');
  for (const bad of [null, '', 'red', '#fff', 'javascript:alert(1)']) assert.ok(!('color' in buildCreateBody({ id: 'a', candidateName: 'a', candidateEmail: 'a@b.co', jobTitle: 'j', companyName: 'c', logoUrl: null, color: bad, questions: ['abc'] }).company), 'no colour is sent for ' + bad);
  assert.equal(companyLogoUrl('https://x.supabase.co/', 'ws id/logo 1.png'), 'https://x.supabase.co/storage/v1/object/public/company-logos/ws%20id/logo%201.png');
  assert.equal(companyLogoUrl('https://x.supabase.co', null), null);
});

test('retry delays: sends give up after six tries, erasures never give up', async () => {
  const { sendRetryDelaySeconds, deletionRetryDelaySeconds, MAX_SEND_ATTEMPTS } = await logic();
  assert.equal(sendRetryDelaySeconds(1), 30);
  assert.equal(sendRetryDelaySeconds(5), 600);
  assert.equal(sendRetryDelaySeconds(MAX_SEND_ATTEMPTS), null);
  assert.equal(deletionRetryDelaySeconds(1), 60);
  assert.equal(deletionRetryDelaySeconds(3), 240);
  for (const n of [7, 20, 500]) assert.equal(deletionRetryDelaySeconds(n), 3600);
});

test('a notice from Witcher moves a row forward only, and keeps the impression and the readiness of the evaluation', async () => {
  const { updateFromWitcher, canAdvance } = await logic();
  const done = updateFromWitcher({ state: 'invited' }, { status: 'completed', impression: 'positive', evaluationReady: true, completedAt: '2026-10-28T12:00:00Z' });
  assert.deepEqual([done.state, done.impression, done.evaluation_ready, done.completed_at], ['completed', 'positive', true, '2026-10-28T12:00:00Z']);
  const failedAi = updateFromWitcher({ state: 'invited' }, { status: 'completed', impression: null, evaluationReady: false, completedAt: '2026-10-28T12:00:00Z' });
  assert.deepEqual([failedAi.impression, failedAi.evaluation_ready], [null, false], 'no made-up badge when the AI failed');
  assert.equal(updateFromWitcher({ state: 'completed' }, { status: 'invited' }), null, 'never backwards');
  assert.equal(updateFromWitcher({ state: 'completed' }, { status: 'abandoned' }), null);
  assert.equal(updateFromWitcher({ state: 'cancelled' }, { status: 'completed' }), null, 'a cancelled interview stays cancelled');
  assert.equal(updateFromWitcher({ state: 'invited' }, { status: 'weird' }), null);
  assert.equal(updateFromWitcher({ state: 'invited' }, { status: 'created' }), null, 'created means the e-mail has not left yet');
  assert.ok(updateFromWitcher({ state: 'completed' }, { status: 'completed', impression: 'negative', evaluationReady: true }), 'a re-evaluation refreshes a completed row');
  const mixed = updateFromWitcher({ state: 'invited' }, { status: 'completed', impression: 'mixed', evaluationReady: true });
  assert.equal(mixed.impression, 'mixed', 'the third level is stored');
  assert.equal(updateFromWitcher({ state: 'invited' }, { status: 'completed', impression: 'maybe', evaluationReady: true }).impression, null, 'an unknown value is never stored');
  assert.equal(updateFromWitcher({ state: 'invited' }, { status: 'abandoned' }).state, 'abandoned');
  assert.equal(canAdvance('in_progress', 'expired'), false);
});

test('the Witcher client reports network problems as status 0 and never leaks the key into its result', async () => {
  const { callWitcher } = await client();
  const config = { url: 'https://w.example/functions/v1/interviews-api', apiKey: 'KEY-123' };
  let seen;
  const good = await callWitcher(config, 'get', { externalId: 'a' }, { fetchFn: async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ status: 'invited' }) }; } });
  assert.deepEqual([good.ok, good.status, good.json.status], [true, 200, 'invited']);
  assert.equal(seen.init.headers['x-witcher-api-key'], 'KEY-123');
  assert.deepEqual(JSON.parse(seen.init.body), { action: 'get', externalId: 'a' });
  const down = await callWitcher(config, 'get', {}, { fetchFn: async () => { throw new Error('socket hang up KEY-123'); } });
  assert.deepEqual([down.ok, down.status], [false, 0]);
  assert.ok(!JSON.stringify(down).includes('KEY-123'));
  const broken = await callWitcher(config, 'get', {}, { fetchFn: async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } }) });
  assert.deepEqual([broken.ok, broken.status, broken.json], [false, 502, {}]);
});

test('function settings: user actions need a JWT, the webhook and worker cannot have one', () => {
  const config = read('supabase/config.toml');
  assert.match(config, /\[functions\.ai-interview\][^[]*verify_jwt = true/);
  assert.match(config, /\[functions\.ai-interview-webhook\][^[]*verify_jwt = false/);
});

test('the functions check permissions, keep secrets out of logs and never hand the key to the browser', () => {
  const user = read('supabase/functions/ai-interview/index.ts');
  const hook = read('supabase/functions/ai-interview-webhook/index.ts');
  assert.ok(user.includes('userClient.from("ai_interviews")'), 'rows are read with the person\'s own session, so the database policy decides');
  assert.ok(user.includes('premiumActive'), 'Premium is checked on the server');
  assert.ok(!/console\.(log|error|warn)\([^)]*(body|apiKey|WITCHER_API_KEY|WITCHER_WEBHOOK_SECRET|evaluation|messages)/i.test(user + hook));
  assert.ok(!/apiKey/.test(user.replace(/witcher\.apiKey/g, '').replace(/apiKey: Deno/g, '')), 'the key is only read from the environment');
  assert.ok(hook.includes('verifyWebhook('), 'notices are only accepted with a valid signature');
  assert.ok(hook.includes('eraseOrphan'), 'an interview created while the card moved out is erased again');
  assert.ok(hook.includes('ai_interview_deletions'), 'the erasure queue is emptied');
});
