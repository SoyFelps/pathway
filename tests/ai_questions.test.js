const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const load = file => import(require('node:url').pathToFileURL(path.join(root, file)).href);
const logic = () => load('supabase/functions/ai-questions/logic.ts');
const gemini = () => load('supabase/functions/ai-questions/gemini.ts');

const GOOD = 'We are looking for a Legal Assistant to support our legal team with contracts, deadlines and files. You will prepare and review contracts, keep case files organised, track filings and renewals, do basic legal research and coordinate with clients and outside counsel. Strong attention to detail and respect for confidential information are essential.';
const modelReply = obj => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });
const okFetch = replies => { let n = 0; const calls = []; const fn = async (url, init) => { calls.push({ url, init }); const reply = replies[Math.min(n++, replies.length - 1)]; return { ok: true, status: 200, json: async () => reply }; }; fn.calls = calls; return fn; };

test('a description that is empty, tiny or only a few words is never sent to the model', async () => {
  const { createQuestion } = await gemini();
  const spy = okFetch([modelReply({ can_generate: true, question: 'Tell me about a contract you reviewed.' })]);
  for (const description of ['', '   ', 'Legal assistant needed', 'We need a good person for this role, apply now please thanks.', null, undefined, 42]) {
    const result = await createQuestion({ jobTitle: 'Legal Assistant', description, existing: [] }, { apiKey: 'k', fetchFn: spy });
    assert.deepEqual(result, { generated: false, reason: 'insufficient' }, String(description));
  }
  assert.equal(spy.calls.length, 0, 'no call to Google, no cost, nothing invented');
});

test('with a real description the model is asked for one question and the key travels only in the Google header', async () => {
  const { createQuestion } = await gemini();
  const spy = okFetch([modelReply({ can_generate: true, question: 'Describe how you keep track of contract renewals and deadlines.' })]);
  const result = await createQuestion({ jobTitle: 'Legal Assistant', description: GOOD, existing: [] }, { apiKey: 'secret-key', fetchFn: spy });
  assert.deepEqual(result, { generated: true, question: 'Describe how you keep track of contract renewals and deadlines.' });
  assert.equal(spy.calls.length, 1);
  assert.match(spy.calls[0].url, /gemini-3\.5-flash:generateContent$/);
  assert.equal(spy.calls[0].init.headers['x-goog-api-key'], 'secret-key');
  assert.equal(spy.calls[0].url.includes('secret-key'), false, 'never in the address');
  const sent = JSON.parse(spy.calls[0].init.body);
  assert.match(sent.contents[0].parts[0].text, /<job_description>[\s\S]*Legal Assistant[\s\S]*<\/job_description>/);
  assert.match(sent.contents[0].parts[0].text, /\(none yet\)/);
  assert.equal(sent.generationConfig.responseMimeType, 'application/json');
});

test('the questions in the field are sent to the model so it picks another topic', async () => {
  const { buildQuestionRequest, cleanExisting } = await logic();
  const existing = cleanExisting(['Tell me about your career', '  ', 'ab', 'How do you handle confidential information?']);
  assert.deepEqual(Array.from(existing), ['Tell me about your career', 'How do you handle confidential information?'], 'blank and tiny lines are dropped');
  const text = buildQuestionRequest({ jobTitle: 'Legal Assistant', description: GOOD, existing }).contents[0].parts[0].text;
  assert.match(text, /<existing_questions>\n1\. Tell me about your career\n2\. How do you handle confidential information\?\n<\/existing_questions>/);
  assert.equal(cleanExisting(Array.from({ length: 9 }, (_, i) => `Question number ${i + 1} here`)).length, 5, 'at most five');
});

test('when the model says it cannot (vague description), the answer is "insufficient" and no question is made up', async () => {
  const { createQuestion } = await gemini();
  for (const reply of [{ can_generate: false, question: 'Tell me about yourself.' }, { can_generate: true, question: '' }, { can_generate: true, question: null }, { question: 'Tell me about yourself.' }]) {
    const result = await createQuestion({ jobTitle: 'x', description: GOOD, existing: [] }, { apiKey: 'k', fetchFn: okFetch([modelReply(reply)]) });
    assert.deepEqual(result, { generated: false, reason: 'insufficient' }, JSON.stringify(reply));
  }
});

test('a question too close to an existing one gets one more try, then "similar" (never a repeat)', async () => {
  const { createQuestion } = await gemini();
  const existing = ['Describe how you keep track of contract deadlines and renewals.'];
  const repeat = modelReply({ can_generate: true, question: 'How do you keep track of contract deadlines and renewals?' });
  const fresh = modelReply({ can_generate: true, question: 'Tell us about a time you had to protect confidential client information.' });
  const retry = okFetch([repeat, fresh]);
  assert.deepEqual(await createQuestion({ jobTitle: 'x', description: GOOD, existing }, { apiKey: 'k', fetchFn: retry }), { generated: true, question: 'Tell us about a time you had to protect confidential client information.' });
  assert.equal(retry.calls.length, 2);
  assert.match(JSON.parse(retry.calls[1].init.body).contents[0].parts[0].text, /Your previous attempt was too close to an existing question/);
  const stuck = okFetch([repeat]);
  assert.deepEqual(await createQuestion({ jobTitle: 'x', description: GOOD, existing }, { apiKey: 'k', fetchFn: stuck }), { generated: false, reason: 'similar' });
  assert.equal(stuck.calls.length, 2, 'only one extra try');
});

test('similar questions are caught by wording, not only by exact text', async () => {
  const { isTooSimilar, similarity } = await logic();
  assert.equal(isTooSimilar('Tell me about your career', ['tell me about your career!']), true, 'same text');
  assert.equal(isTooSimilar('Describe your experience managing contract deadlines', ['How do you manage contract deadlines and renewals?']), true);
  assert.equal(isTooSimilar('How do you protect confidential client information?', ['How do you manage contract deadlines and renewals?']), false);
  assert.equal(isTooSimilar('Anything at all', []), false);
  assert.ok(similarity('contract deadlines renewals', 'unrelated gardening topic') < 0.2);
});

test('the model reply is read defensively: fences, quotes and numbering go, junk is refused', async () => {
  const { parseModelAnswer } = await logic();
  const wrap = text => ({ candidates: [{ content: { parts: [{ text }] } }] });
  assert.deepEqual(parseModelAnswer(wrap('```json\n{"can_generate":true,"question":"\\"1. How do you organise a busy week of deadlines?\\""}\n```')), { kind: 'question', question: 'How do you organise a busy week of deadlines?' });
  assert.throws(() => parseModelAnswer(wrap('not json')), /gemini_unparsable/);
  assert.throws(() => parseModelAnswer({ candidates: [] }), /gemini_(empty|unparsable)/);
  assert.throws(() => parseModelAnswer(wrap('{"can_generate":true,"question":"Hi?"}')), /gemini_unparsable/, 'too short to be a real question');
});

test('Google trouble: the next model answers, a rejected request stops, and the error never carries the key or the job text', async () => {
  const { createQuestion } = await gemini();
  const calls = [];
  const flaky = async (url) => { calls.push(url); if (calls.length < 3) return { ok: false, status: 503, json: async () => ({}) }; return { ok: true, status: 200, json: async () => modelReply({ can_generate: true, question: 'Walk us through how you prepare a contract for review.' }) }; };
  assert.equal((await createQuestion({ jobTitle: 'x', description: GOOD, existing: [] }, { apiKey: 'k', fetchFn: flaky })).generated, true);
  assert.equal(calls.length, 3, 'tried the three models in order');
  const rejected = async () => ({ ok: false, status: 400, json: async () => ({ error: 'secret-key GOOD text' }) });
  await assert.rejects(() => createQuestion({ jobTitle: 'x', description: GOOD, existing: [] }, { apiKey: 'secret-key', fetchFn: rejected }), error => error.message === 'gemini_http_400');
});

test('the function checks who is asking: signed in, may edit jobs, Premium; the key is a project secret and nothing is logged from the job', () => {
  const index = read('supabase/functions/ai-questions/index.ts');
  assert.ok(index.includes('Deno.env.get("GEMINI_API_KEY_FOR_QUESTIONS")'));
  assert.match(index, /admin\.auth\.getUser\(token\)/);
  assert.match(index, /await mayEditJobs\(authData\.user\.id, workspaceId\)/);
  assert.match(index, /await premiumActive\(workspaceId\)[\s\S]*premium_required/);
  assert.match(index, /console\.error\("ai-questions failed:", error instanceof Error \? error\.message : "unknown error"\)/);
  assert.equal(/console\.(log|info|debug)\(/.test(index), false);
  assert.equal(/GEMINI_API_KEY_FOR_QUESTIONS[^\n]*(response|headers\.set)/.test(index), false, 'the key is never sent back');
  assert.match(index, /APP_ORIGINS = new Set\(\[\s*"https:\/\/soyfelps\.github\.io",/);
});

test('the instruction asks for direct, polite questions and forbids yes/no openers', async () => {
  const { SYSTEM_PROMPT } = await logic();
  assert.match(SYSTEM_PROMPT, /Be direct and polite: start with a verb or a question word/);
  for (const opener of ['"Can you"', '"Could you"', '"Would you"', '"Do you"', '"Have you"', '"Are you"']) assert.ok(SYSTEM_PROMPT.includes(opener), opener);
  assert.match(SYSTEM_PROMPT, /in the language of the description/, 'the openers follow the language of the job description');
});
