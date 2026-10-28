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
  for (const label of ['Creating interview…', 'Interview sent', 'Interview completed', 'Interview left', 'Interview expired', 'Interview cancelled', 'Interview not sent', 'Add interview questions', 'Premium needed']) {
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
  assert.ok(block.includes('.ai-chip{'));
  assert.equal(/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(block), false);
  assert.ok(css.includes('--positive-bg:') && css.includes('--positive-text:'));
});
