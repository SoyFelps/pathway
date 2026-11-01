const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const builder = read('builder.js');
const backend = read('backend.js');
const css = read('styles.css');

test('the browser never holds a Witcher key or talks to Witcher: it only calls the checked ai-interview function', () => {
  for (const [name, source] of [['builder.js', builder], ['backend.js', backend], ['index.html', read('index.html')]]) {
    assert.ok(!/WITCHER_API_KEY|x-witcher-api-key|WITCHER_WEBHOOK_SECRET|interviews-api/.test(source), name + ' knows nothing about the Witcher key or API');
  }
  assert.ok(backend.includes('/functions/v1/ai-interview`'));
  assert.ok(backend.includes('Authorization: `Bearer ${session.access_token}`'), 'the call carries the signed-in session');
});

test('the questions of a job are cleaned the way the database wants them and are edited from the job details and the new-job form', () => {
  assert.ok(backend.includes('.filter(item => item.length >= 3).slice(0, 5)'));
  assert.ok(builder.includes("mountInterviewQuestionsField(panel.querySelector('#role-ai-questions')"));
  assert.ok(builder.includes("mountInterviewQuestionsField(modalRoot.querySelector('#new-ai-questions')"));
  assert.ok(builder.includes('save({ internal: true })'), 'editing the questions does not count as an unpublished change');
  assert.ok(builder.includes('flow.interviewQuestions = window.PathwayBackend.cleanInterviewQuestions(newInterviewQuestions);'));
});

test('the card shows the interview tag and badge, and the candidate panel gets an AI Interview tab next to Resume', () => {
  assert.ok(builder.includes('aiInterviewCardHtml(aiInterviewFor(applicant.flow_id, applicant.candidate_email))'));
  for (const label of ['Setting up AI Interview', 'Invite sent for AI Interview', 'AI Interview completed', 'AI Interview left', 'AI Interview expired', 'AI Interview cancelled', 'AI Interview not sent', 'AI Interview in progress', 'Add interview questions', 'Premium needed']) {
    assert.ok(builder.includes(label), label);
  }
  assert.ok(builder.includes('data-right-tab="resume"') && builder.includes('data-right-tab="ai"'));
  assert.ok(builder.includes('id="mobile-open-ai"'), 'phones get a button to open the tab');
  assert.ok(builder.includes('aiPane') && builder.includes('const aiRow = aiInterviewFor('), 'the tab exists only for a candidate who has an interview');
});

test('the panel offers re-send and cancel only before the candidate starts, and a retry of the evaluation only when it is missing', () => {
  const panel = builder.slice(builder.indexOf('function mountAiInterviewPanel'), builder.indexOf('function mountInterviewQuestionsField'));
  assert.ok(panel.includes("row.state === 'invited'") && panel.includes("button('resend', 'Re-send e-mail'"));
  assert.ok(panel.includes("'Cancel invitation'") && panel.includes('cancel-yes'), 'cancelling asks for a second click');
  assert.ok(panel.includes('const ready = row.evaluationReady && live.evaluation'), 'a ready evaluation is shown as text');
  assert.ok(panel.includes("button('reevaluate', 'Write the evaluation again')"), 'the retry button is only in the not-ready branch');
  assert.ok(panel.includes('The AI does not decide who moves forward'), 'the reminder that people decide is on screen');
  assert.ok(!panel.includes('localStorage') && !panel.includes('sessionStorage'), 'the evaluation and the conversation are never stored in the browser');
  assert.ok(!/innerHTML = [^;]*live\.evaluation\b(?![^;]*esc\()/.test(panel), 'the evaluation is escaped before it is shown');
});

test('finished interviews ring the bell, and opening one lands on the AI Interview tab', () => {
  assert.ok(builder.includes('data-notif-ai='));
  assert.ok(builder.includes('finished the AI interview'));
  assert.ok(builder.includes('pendingOpenAiTab = true'));
  assert.ok(builder.includes("aiNotifs = await window.PathwayBackend.listAiInterviewNotices(workspace.id)"));
  assert.ok(builder.includes('markAiInterviewNoticeSeen(noticeId)'));
});

test('the new styles use colour tokens only', () => {
  const block = css.slice(css.indexOf('/* AI Interview (Witcher)'));
  assert.ok(block.includes('.applicant-card-ai{'));
  assert.equal(/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(block), false);
  assert.ok(css.includes('--positive-bg:') && css.includes('--positive-text:'));
});

test('a new invitation after a cancelled, left or expired interview is only sent by the "Invite again" button, in any column', () => {
  const panel = builder.slice(builder.indexOf('function mountAiInterviewPanel'), builder.indexOf('function mountInterviewQuestionsField'));
  assert.ok(panel.includes("button('reinvite', 'Invite again')"));
  for (const state of ['cancelled', 'abandoned', 'expired']) {
    const start = panel.indexOf("row.state === '" + state + "'");
    assert.ok(start > 0, state + ' has its own branch');
    assert.ok(panel.slice(start, panel.indexOf(';', start + 40)).includes('reinviteBlock(row)'), state + ' offers Invite again');
  }
  assert.ok(!panel.includes('move the card out of AI Interview'), 'the old "move the card" advice is gone');
  assert.ok(panel.includes('Moving the card between columns does not send another invitation.'));
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261029110000_ai_interview_reinvite.sql'), 'utf8');
  assert.ok(migration.includes('where not exists (select 1 from public.ai_interviews i where i.flow_id = new.flow_id and i.candidate_email = v_email)'), 'moving a card creates an interview only when the candidate has none at all');
  assert.ok(migration.includes('and not manual'), 'a manual interview is never removed by moving the card');
  const user = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'ai-interview', 'index.ts'), 'utf8');
  assert.ok(user.includes('case "reinvite"') && user.includes('manual: true') && user.includes('["cancelled", "abandoned", "expired"]'));
  const worker = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'ai-interview-webhook', 'index.ts'), 'utf8');
  assert.ok(worker.includes('row.manual === true ||'), 'a manual interview is sent whatever column the card is in');
});

test('the card tag follows a move into or out of the AI Interview column without pressing Refresh, and sits at the foot of the card', () => {
  assert.ok(builder.includes("if (status === 'ai_interview' || previous.includes('ai_interview')) watchAiInterviewTags();"));
  assert.ok(builder.includes('function watchAiInterviewTags()'));
  const card = builder.slice(builder.indexOf('const cardHtml = group =>'), builder.indexOf("if (stage.key === 'failed')"));
  assert.ok(card.indexOf('applicant-card-meta') < card.indexOf('aiInterviewCardHtml('), 'the tag row comes after the date row, as in the first plan');
});

test('the impression is a thumb, green up for positive and red down for negative, never a word', () => {
  const badge = builder.slice(builder.indexOf('function aiImpressionBadge'), builder.indexOf('function aiInterviewCardHtml'));
  assert.ok(badge.includes('THUMB_PATHS[impression]') && badge.includes('<svg'));
  assert.ok(badge.includes("'Positive impression'") && badge.includes("'Negative impression'"), 'the meaning stays available to screen readers and as a tooltip');
  assert.ok(!badge.includes(">Positive<") && !badge.includes(">Negative<"), 'no visible word');
  assert.ok(css.includes('.ai-impression.is-positive{background:var(--positive-bg);color:var(--positive-text)}'), 'positive is green');
  assert.ok(css.includes('.ai-impression.is-negative{background:var(--red-bg);color:var(--red-text)}'), 'negative is red');
});

test('the board columns are wide enough for the interview tag and its thumb to stay on one line', () => {
  assert.ok(css.includes('grid-template-columns:repeat(4,minmax(240px,1fr))'), 'desktop columns are at least 240px');
  assert.ok(css.includes('minmax(225px,1fr)'), 'medium screens keep a slightly narrower minimum');
  assert.ok(!css.includes('minmax(215px,1fr)'), 'the old narrow minimum is gone everywhere, Failed column included');
});

test('a finished interview always reads "AI Interview completed" on the card, with a grey dash instead of a thumb until there is an impression', () => {
  assert.ok(builder.includes("case 'completed': return ['AI Interview completed', 'ok'];"));
  assert.ok(!builder.includes('evaluation pending'), 'the card says nothing about the evaluation');
  const card = builder.slice(builder.indexOf('function aiInterviewCardHtml'), builder.indexOf('let aiWatchTimer'));
  assert.ok(card.includes('ai-impression is-none') && card.includes('M7 12h10'), 'grey circle with a dash');
  assert.ok(css.includes('.ai-impression.is-none{background:var(--border-subtle);color:var(--text-subtle)'));
});

test('the thumb and the dash sit exactly in the middle of their circle (block icon, flex centring, no baseline gap)', () => {
  assert.ok(css.includes('.ai-impression{display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;'));
  assert.ok(css.includes('.ai-impression svg{display:block}'));
  assert.ok(css.includes('line-height:0'));
});

test('inside the candidate details the badge keeps its own layout (the label rule for spans does not apply to it)', () => {
  assert.ok(css.includes('.applicant-info-item span{display:block;'), 'the label rule that used to push the badge around still exists');
  assert.ok(css.includes('.applicant-info-item .ai-impression{display:inline-flex;margin-bottom:0}'), 'and is overridden for the badge, with a more specific selector');
});

test('the Impression field of the AI Interview tab writes the words before the thumb, bold, red for negative and green for positive', () => {
  const panel = builder.slice(builder.indexOf('function mountAiInterviewPanel'), builder.indexOf('function mountInterviewQuestionsField'));
  assert.ok(panel.includes('aiImpressionLabelled(row.impression)'));
  const label = builder.slice(builder.indexOf('function aiImpressionLabelled'), builder.indexOf('function aiInterviewCardHtml'));
  assert.ok(label.includes("'Positive impression'") && label.includes("'Negative impression'"));
  assert.ok(label.indexOf('ai-impression-text') < label.indexOf('+ badge +'), 'the words come before the thumb');
  assert.ok(css.includes('.ai-impression-line.is-negative .ai-impression-text{color:var(--red)}'));
  assert.ok(css.includes('font-weight:700}\n.ai-impression-line.is-negative') || css.includes('.applicant-info-item .ai-impression-text{display:inline;margin-bottom:0;font-size:12px;font-weight:700}'));
  const card = builder.slice(builder.indexOf('function aiInterviewCardHtml'), builder.indexOf('let aiWatchTimer'));
  assert.ok(!card.includes('aiImpressionLabelled'), 'the card keeps only the thumb');
});

test('the title of the AI Interview tab carries no thumb: the impression is shown once, in its own field', () => {
  const panel = builder.slice(builder.indexOf('function mountAiInterviewPanel'), builder.indexOf('function mountInterviewQuestionsField'));
  const head = panel.slice(panel.indexOf("const head = '<header"), panel.indexOf("let body = ''"));
  assert.ok(!head.includes('aiImpressionBadge') && !head.includes('aiImpressionLabelled'), 'no thumb next to "Completed"');
  assert.equal(panel.split('aiImpressionLabelled(row.impression)').length - 1, 1, 'the impression appears once, in the Impression field');
});

test('"Write the evaluation again": the button is replaced by a notice at the click, and returns only if the AI really failed', () => {
  const panel = builder.slice(builder.indexOf('function mountAiInterviewPanel'), builder.indexOf('function mountInterviewQuestionsField'));
  const click = panel.slice(panel.indexOf("if (action === 'reevaluate') {"), panel.indexOf('let current;'));
  assert.ok(click.indexOf("reevaluating = 'sending'; evalPolls = 0; render(lastData);") < click.indexOf('await B.aiInterviewAction'), 'the notice is drawn before the request goes out, so the button cannot be pressed twice');
  assert.ok(!click.includes('getAiInterviewStatus'), 'no extra round trip between the click and the notice');
  assert.ok(panel.includes('Writing the evaluation…') && panel.includes('This can take up to a minute.'));
  assert.ok(panel.includes("reevaluating === 'sending' || live.evaluating === true"), 'shown while sending and while Witcher says it is writing');
  assert.ok(panel.includes("if (reevaluating === 'running' && live.evaluating !== true) reevaluating = '';"), 'when Witcher stops, the button may come back');
  assert.ok(panel.includes('could not write it this time either'), 'and it says that the retry failed');
  assert.ok(!panel.includes("showToast('Writing the evaluation."), 'the notice is on the page, not a toast that is easy to miss');
  const user = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'ai-interview', 'index.ts'), 'utf8');
  assert.ok(user.includes('evaluating: result.json.evaluating === true'), 'the server function passes the flag on');
});
