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
  assert.equal(builder.includes('#new-ai-questions'), false, 'the new-job form no longer asks for questions');
  assert.ok(builder.includes('save({ internal: true })'), 'editing the questions does not count as an unpublished change');
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
  assert.ok(panel.includes("row.state === 'invited'") && panel.includes("button('resend', t('Re-send e-mail')"));
  assert.ok(panel.includes("t('Cancel invitation')") && panel.includes('cancel-yes'), 'cancelling asks for a second click');
  assert.ok(panel.includes('const ready = row.evaluationReady && live.evaluation'), 'a ready evaluation is shown as text');
  assert.ok(panel.includes("button('reevaluate', t('Write the evaluation again'))"), 'the retry button is only in the not-ready branch');
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
  assert.ok(panel.includes("button('reinvite', t('Invite again'))"));
  for (const state of ['cancelled', 'abandoned', 'expired']) {
    const start = panel.indexOf("row.state === '" + state + "'");
    assert.ok(start > 0, state + ' has its own branch');
    const next = panel.indexOf("row.state === '", start + 40);
    const end = next > 0 ? next : panel.indexOf('// An interview that is still going on', start);
    assert.ok(panel.slice(start, end).includes('reinviteBlock(row)'), state + ' offers Invite again');
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
  assert.ok(builder.includes("if (!sameColumn && (status === 'ai_interview' || previous.includes('ai_interview'))) watchAiInterviewTags();"), 'only a real change of stage starts watching; a new order inside a column does not');
  assert.ok(builder.includes('function watchAiInterviewTags()'));
  const card = builder.slice(builder.indexOf('const cardHtml = group =>'), builder.indexOf("if (stage.key === 'failed')"));
  assert.ok(card.indexOf('applicant-card-meta') < card.indexOf('aiInterviewCardHtml('), 'the tag row comes after the date row, as in the first plan');
});

test('the impression is a thumb, green up for positive, amber dash for mixed and red down for negative, never a word', () => {
  const badge = builder.slice(builder.indexOf('function aiImpressionBadge'), builder.indexOf('function aiInterviewCardHtml'));
  assert.ok(badge.includes('THUMB_PATHS[impression]') && badge.includes('<svg'));
  const labels = builder.slice(builder.indexOf('const AI_IMPRESSION_LABELS'), builder.indexOf('function aiImpressionBadge'));
  assert.ok(labels.includes("'Positive impression'") && labels.includes("'Mixed impression'") && labels.includes("'Negative impression'"), 'the meaning stays available to screen readers and as a tooltip');
  assert.ok(badge.includes('aria-label'), 'the label is announced');
  assert.ok(!badge.includes(">Positive<") && !badge.includes(">Negative<"), 'no visible word');
  assert.ok(css.includes('.ai-impression.is-positive{background:var(--positive-bg);color:var(--positive-text)}'), 'positive is green');
  assert.ok(css.includes('.ai-impression.is-negative{background:var(--red-bg);color:var(--red-text)}'), 'negative is red');
  assert.ok(css.includes('.ai-impression.is-mixed{background:var(--amber-bg);color:var(--amber-text)}'), 'mixed is amber');
  assert.ok(builder.includes(`mixed: '<path d="M5 12h14"/>'`), 'mixed has its own icon');
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
  assert.ok(label.includes('AI_IMPRESSION_LABELS[impression]'));
  assert.ok(label.indexOf('ai-impression-text') < label.indexOf('+ badge +'), 'the words come before the thumb');
  assert.ok(css.includes('.ai-impression-line.is-negative .ai-impression-text{color:var(--red)}'));
  assert.ok(css.includes('.ai-impression-line.is-mixed .ai-impression-text{color:var(--amber-text)}'));
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

test('an interview still going on while the candidate sits in another column shows a notice with a button that moves the card into AI Interview', () => {
  const panel = builder.slice(builder.indexOf('function mountAiInterviewPanel'), builder.indexOf('function mountInterviewQuestionsField'));
  assert.ok(panel.includes("['pending', 'blocked', 'invited', 'in_progress'].includes(row.state)"), 'only for an interview that is not finished and not cancelled');
  assert.ok(panel.includes("stage.getStage() !== 'ai_interview'") && panel.includes('stage.canMove()'), 'only when the card is elsewhere and the AI Interview column is turned on');
  assert.ok(panel.includes('This candidate is not in the AI Interview column of the Kanban.') && panel.includes("button('move-stage', t('Move to AI Interview column'))"));
  assert.ok(panel.includes('await stage.moveTo()') && panel.includes('pendingOpenAiTab = true'), 'the move keeps the person on the AI Interview tab');
  assert.ok(builder.includes("moveTo: () => moveApplicant(applicant.id, 'ai_interview')"), 'the button uses the normal move, so the stage history and the board stay in order');
});

test('on computer screens the applicants board is as tall as the window and scrolls inside itself, so both scroll bars stay in view', () => {
  assert.ok(builder.includes('<div class="workspace-body is-board">${renderSidebar(\'applicants\')}<main class="applicants-page">'));
  const block = css.slice(css.indexOf('/* Applicants board: on a computer screen'));
  assert.ok(block.includes('@media(min-width:761px)'), 'phones keep the old page scroll');
  assert.ok(block.includes('.workspace-body.is-board{height:calc(100vh - 70px);height:calc(100dvh - 70px);'), 'the area is exactly the window minus the top bar');
  assert.ok(block.includes('.workspace-body.is-board .kanban-board{flex:1 1 auto;min-height:300px;overflow:auto;'), 'the board is the scrolling area, in both directions');
  assert.ok(block.includes('#applicants-content{flex:1 1 auto;min-height:0;'), 'and takes all the room left under the title and the filters');
  assert.ok(block.includes('align-self:stretch;height:100%;'), 'the page fills the area even where the workspace row is set to align its items at the start');
  assert.equal(/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(block), false, 'colour tokens only');
});

test('the candidate data export includes the AI interview (history, impression, evaluation, transcript) and says so when it could not be loaded', () => {
  const csv = builder.slice(builder.indexOf('function candidateDataToCsv'), builder.indexOf('function downloadTextFile'));
  for (const section of ["'aiInterviewNote'", "'aiInterview'", "'aiInterviewResult'", "'aiInterviewTranscript'"]) assert.ok(csv.includes(section), section);
  assert.ok(csv.includes('the audio of the answers is never stored'), 'the audio is never part of it');
  assert.ok(csv.includes("message.kind !== 'closing'"), 'the closing line of the AI is not a candidate record');
  const click = builder.slice(builder.indexOf("row.querySelector('#export-candidate')"), builder.indexOf('const showConfirm'));
  assert.ok(click.includes('window.PathwayBackend.listAiInterviews(workspace.id, flowId)') && click.includes("getAiInterviewStatus(flowId, email, 'export')"));
  assert.ok(click.includes('the AI interview part could not be loaded'), 'an export without the interview is never mistaken for a complete one');
});

test('every way of deleting a candidate, a job, a workspace or an account reaches Witcher through the erasure queue', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261029100000_ai_interviews.sql'), 'utf8');
  assert.ok(migration.includes('after delete on public.applicants'), 'deleting the last application of a candidate (also what a deleted job or workspace does, row by row)');
  assert.ok(migration.includes('after delete on public.ai_interviews'), 'whatever removes an interview row, whether directly or by cascade, queues its erasure');
  assert.ok(migration.includes('references public.application_flows (id) on delete cascade') && migration.includes('references public.workspaces (id) on delete cascade'), 'a deleted job or workspace takes its interviews along');
  const worker = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'ai-interview-webhook', 'index.ts'), 'utf8');
  assert.ok(worker.includes('eraseQueued()') && worker.includes('callWitcher(witcher, "delete"'), 'the worker empties the queue');
});

test('the delete-candidate confirmation tells the person that the AI interview goes too, when there is one', () => {
  const confirm = builder.slice(builder.indexOf('const showConfirm = () => {'), builder.indexOf("row.querySelector('#cancel-delete-candidate')"));
  assert.ok(confirm.includes("aiInterviewFor(flowId, email) ? t(', the resume file, their AI interview (answers, evaluation and impression) and the team comments about them') : t(', the resume file and the team comments about them')"));
  assert.ok(confirm.includes("t('This removes {what}. This cannot be undone.', { what: removes })"), 'the rest of the warning is unchanged');
});

test('every action of the AI Interview tab that goes to the server replaces its button by a notice at the click, with no lookup first', () => {
  const panel = builder.slice(builder.indexOf('function mountAiInterviewPanel'), builder.indexOf('function mountInterviewQuestionsField'));
  for (const text of ['Sending the invitation again…', 'Sending the e-mail again…', 'Cancelling the invitation…', 'Checking again…']) assert.ok(panel.includes(text), text);
  assert.ok(panel.includes("const button = (action, label, extra = '', disabled = false) => working ? '' :"), 'while an action is being done there is no button to press');
  const generic = panel.slice(panel.indexOf("const names = { 'cancel-yes'"), panel.indexOf('void load();\n  }') > 0 ? panel.indexOf('await B.aiInterviewAction(names[action]') : undefined);
  assert.ok(generic.includes('working = WORKING_TEXT[action]; render(lastData);'), 'the notice is drawn right away');
  assert.ok(!generic.includes('getAiInterviewStatus'), 'no round trip between the click and the notice (it used to leave the button on screen for seconds)');
  assert.ok(panel.includes("if (action === 'cancel') { confirming = 'cancel'; if (lastData) render(lastData);"), 'the "are you sure?" of Cancel invitation appears at once too');
  assert.ok(panel.includes('busy = false; working = null;'), 'the notice stays until the fresh state arrives');
});

test('the "left before finishing" panel says when and where the candidate left, and warns about inviting again with the same questions', () => {
  const panel = builder.slice(builder.indexOf('function mountAiInterviewPanel'), builder.indexOf('function mountInterviewQuestionsField'));
  const start = panel.indexOf("row.state === 'abandoned'");
  const branch = panel.slice(start, panel.indexOf("row.state === 'expired'", start));
  assert.ok(branch.includes("info(t('Left on'), when(live.abandonedAt))") && branch.includes("info(t('Where they left'), where)"));
  assert.ok(branch.includes('live.progress') && branch.includes('On the follow-up to question {number} of {total}') && branch.includes('questionText'));
  assert.ok(branch.includes('may give this candidate an advantage') && branch.indexOf('may give this candidate an advantage') < branch.indexOf('reinviteBlock(row)'));
  const user = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'ai-interview', 'index.ts'), 'utf8');
  assert.ok(user.includes('abandonedAt: result.json.abandonedAt') && user.includes('progress: result.json.progress'));
});

test('after 12 months the transcript and evaluation are gone: the panel and the export say so and keep the impression (retention rule of 2026-11-01)', () => {
  assert.ok(builder.includes('const AI_RETENTION_MS = 365 * 24 * 3600 * 1000;'));
  assert.ok(builder.includes("row.state === 'completed' && row.createdAt && Date.now() - Date.parse(row.createdAt) > AI_RETENTION_MS"));
  assert.ok(builder.includes('This interview is more than 12 months old, so its transcript and written evaluation were deleted from the interview service to save space.'));
  assert.ok(builder.includes('Even though they were deleted, the system recorded that the impression was '));
  const panel = builder.slice(builder.indexOf('function mountAiInterviewPanel'), builder.indexOf('function mountInterviewQuestionsField'));
  assert.ok(panel.indexOf('aiInterviewPurged(row)') > 0 && panel.indexOf('aiInterviewPurged(row)') < panel.indexOf("row.state === 'completed') {"), 'the old-interview message comes before the normal completed view (no "write the evaluation again" button)');
  assert.ok(builder.includes('if (aiInterviewPurged(interview.rows[0])) add(\'aiInterviewResult\''), 'the export says it too');
});

test('the panel row carries createdAt, which the 12-month rule needs', () => {
  const backend = fs.readFileSync(path.join(__dirname, '..', 'backend.js'), 'utf8');
  assert.ok(backend.includes('createdAt: payload.interview.createdAt || null'));
});

test('free plan (owner decisions 2026-11-01): stage moves locked with a note, transcript and evaluation hidden, plan cancellation explained', () => {
  assert.ok(builder.includes("const workspaceIsFree = () =>") && builder.includes('!item.premiumActive'));
  assert.ok(builder.includes("'This workspace is on the free plan. Upgrade to Premium to move candidates between stages.'"));
  assert.ok(builder.includes("if (workspaceIsFree()) { showToast(t(FREE_MOVE_NOTE), 6000); return; }"), 'moveApplicant refuses on the free plan');
  assert.ok(builder.includes("const freeNote = isOwner && workspaceIsFree()"), 'the note above the board is for the owner only');
  assert.ok(builder.includes("draggable=\"${workspaceIsFree() || selectMode ? 'false' : 'true'}\"") && builder.includes('id="applicant-status-select"${workspaceIsFree()'));
  assert.ok(builder.includes("data.locked && row.state === 'completed'") && builder.includes('Upgrade to Premium to see the transcript and the written evaluation of this interview.'));
  assert.ok(builder.includes('This interview was cancelled when the workspace was on the free plan, and its link no longer works. Invite this candidate again if you want them to take the AI interview.'));
  assert.ok(builder.includes("getAiInterviewStatus(flowId, email, 'export')"), 'the candidate data export stays complete');
  const backend = fs.readFileSync(path.join(__dirname, '..', 'backend.js'), 'utf8');
  assert.ok(backend.includes("...(purpose ? { purpose } : {})") && backend.includes('locked: Boolean(payload.locked)') && backend.includes("cancelReason: payload.interview.cancelReason || null"));
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.ok(css.includes('.applicants-free-note{'));
});

test('free plan, server side: status is not even requested from Witcher, the worker cancels sent interviews, the database refuses stage moves', () => {
  const user = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'ai-interview', 'index.ts'), 'utf8');
  const lock = user.indexOf('body.purpose !== "export" && !(await premiumActive(row.workspace_id))');
  assert.ok(lock > 0 && lock < user.indexOf('callWitcher(witcher, "get", { externalId: row.id })', lock - 400), 'the lock comes before the Witcher call');
  assert.ok(user.includes('locked: true') && user.includes('cancelReason: row.cancel_reason ?? null'));
  const worker = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'ai-interview-webhook', 'index.ts'), 'utf8');
  assert.ok(worker.includes('async function cancelForPlan()') && worker.includes('cancel_reason: "plan"') && worker.includes('CANCEL_RETRY_SECONDS = 60'));
  assert.ok(worker.includes('if (await premiumActive(row.workspace_id))'), 'a plan that came back stops the cancellation');
  assert.ok(!/state: "cancelled"[^)]*in_progress/.test(worker) && worker.includes('.eq("state", "invited")'), 'only sent, not started interviews are cancelled; one in progress is never cut');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261101140000_free_plan_locks.sql'), 'utf8');
  assert.ok(sql.includes('public.workspace_user_has_active_subscription(workspace_id)') && sql.includes('create policy "workspace applicant reviewers can update applicant status"'));
  assert.ok(sql.includes("delete from public.ai_interviews where workspace_id = p_workspace_id and state in ('pending', 'blocked')"));
  assert.ok(sql.includes("state = 'invited' and cancel_requested_at is null") && sql.includes('cancel_reason text check (cancel_reason in (\'plan\'))'));
  assert.ok(sql.includes('cancel_requested_at <= now()'), 'the worker is woken for a due cancellation');
  assert.ok(sql.includes('revoke all on function public.ai_interview_free_plan_cleanup(uuid)'));
});

test('plan loss is detected from the status only: Stripe\'s end-of-period notice arrives after the stored end date', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261101150000_free_plan_cleanup_fix.sql'), 'utf8');
  assert.ok(sql.includes("v_had boolean := tg_op = 'UPDATE' and old.status = 'active';"));
  assert.ok(!/v_had boolean[^;]*current_period_end/.test(sql), 'the stored date must not decide whether the plan was had');
});
