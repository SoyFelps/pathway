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
