const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const builder = read('builder.js');
const backend = read('backend.js');
const slice = (source, from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from) + 1));

test('a single move into the Interview column offers the schedule window; bulk moves never do', () => {
  const move = slice(builder, 'async function moveApplicant(', '// Phones (for example Chrome on Android)');
  assert.ok(move.includes("status === 'interview'") && move.includes('offerInterviewScheduling('), 'moveApplicant offers it');
  const bulk = slice(builder, 'function confirmBulkMove(', 'function offerUndoMove');
  const bulkFlow = builder.slice(builder.indexOf('async function runBulkMove('), builder.indexOf('async function runBulkMove(') + 6000);
  assert.equal(bulk.includes('offerInterviewScheduling') || bulkFlow.includes('offerInterviewScheduling'), false, 'Select mode moves without any window');
  assert.equal(move.includes('cancelInterview'), false, 'leaving the column never cancels an interview');
});

test('the window only opens when the waiting row exists and nothing is scheduled yet', () => {
  const offer = slice(builder, 'async function offerInterviewScheduling(', 'const INTERVIEW_STATE_LABEL');
  assert.ok(offer.includes("row.state !== 'awaiting_schedule'"), 'a candidate with a scheduled interview is left alone');
  assert.ok(offer.includes('refreshInterviewTags(true)'), 'the row made by the trigger is read first');
});

test('the schedule window asks for the format, link or address, day, time, zone, duration with 30 min and 1 hour, and notes', () => {
  const modal = slice(builder, 'function openScheduleInterviewModal(', 'async function offerInterviewScheduling(');
  for (const id of ['iv-kind', 'iv-link', 'iv-address', 'iv-day', 'iv-time', 'iv-zone', 'iv-minutes', 'iv-notes']) assert.ok(modal.includes('id="' + id + '"'), id);
  assert.ok(modal.includes('data-iv-minutes="30"') && modal.includes('data-iv-minutes="60"'), 'quick buttons for 30 min and 1 hour');
  assert.ok(modal.includes('value="${minutes}"') && modal.includes('const minutes = row.durationMinutes || 30'), '30 minutes by default');
  assert.equal(/phone|telephone/i.test(modal), false, 'only online or in person');
  assert.ok(modal.includes('max="${isoDay(lastDay)}"') && modal.includes('today.getMonth() + 6'), 'the calendar stops at 6 months');
  assert.ok(modal.includes('Schedule later'), 'closing the window leaves the candidate waiting');
  assert.ok(modal.includes('data-iv-suggested'), 'the times the candidate suggested can be picked');
  assert.ok(modal.includes('B.scheduleInterview(row.id'), 'the invitation goes through the checked function');
});

test('the card shows the interview tag, the panel has an Interview tab with edit, re-send, cancel and history', () => {
  assert.ok(builder.includes('${interviewCardHtml(interviewFor(applicant.flow_id, applicant.candidate_email))}</article>'));
  for (const label of ['Waiting to be scheduled', 'Interview invite sent', 'Interview confirmed', 'Cannot attend the interview', 'Asked for another time']) assert.ok(builder.includes("'" + label + "'"), label);
  assert.ok(builder.includes('data-right-tab="interview"') && builder.includes('data-right-pane="interview"') && builder.includes("id=\"mobile-open-interview\""));
  const panel = slice(builder, 'function mountInterviewPanel(', 'const notifInterviewText');
  for (const action of ["'schedule'", "'cancel'", "'cancel-yes'", "'resend'", "'new'"]) assert.ok(panel.includes(action), action);
  assert.ok(panel.includes('Cancel this interview?'), 'cancelling asks first');
  assert.ok(panel.includes('listCandidateInterviewEvents'), 'history');
  assert.ok(panel.includes("moving or rejecting the candidate is your decision") || builder.includes('moving or rejecting the candidate is your decision'), 'a decline does not move the card');
});

test('the bell shows the answers of candidates and marks them seen', () => {
  assert.ok(builder.includes('listCandidateInterviewNotices(workspace.id)'));
  assert.ok(builder.includes('markCandidateInterviewNoticeSeen'));
  assert.ok(builder.includes('data-notif-iv='));
  assert.ok(builder.includes('notifications.length + mentionNotifs.length + aiNotifs.length + interviewNotifs.length'));
});

test('the browser reads interviews with the database policy and changes them only through the function', () => {
  for (const name of ['listCandidateInterviews', 'listCandidateInterviewEvents', 'scheduleInterview', 'cancelInterview', 'resendInterview', 'startInterviewRound', 'listCandidateInterviewNotices', 'markCandidateInterviewNoticeSeen']) assert.ok(backend.includes('    ' + name + ',') || backend.includes('    ' + name + '\n'), name + ' is exported');
  assert.ok(backend.includes("client.from('candidate_interviews').select("));
  assert.equal(/from\('candidate_interviews'\)\s*\.(insert|update|delete|upsert)/.test(backend), false, 'the browser never writes the table');
  assert.ok(backend.includes("callInterviews({ action: 'schedule'") && backend.includes("action: 'newRound'"));
  assert.equal(/reminder_24h_sent_at|reminder_2h_sent_at|token_hash/.test(backend), false, 'internal columns are never read');
});

test('the Interview tab and the notices show WHAT the candidate suggested, written for the screen, and the tab has the same side spacing as the AI tab', () => {
  const panel = slice(builder, 'function mountInterviewPanel(', 'const notifInterviewText');
  assert.ok(panel.includes("'<div class=\"applicant-ai-body\">'"), 'the tab content sits in the same padded body as the AI interview tab');
  assert.ok(panel.includes("interviewSlotText(item.local, 'full')"), 'suggested times are written as dates, not as 2026-12-03T14:00');
  assert.ok(panel.indexOf("'</p>' + requested + detailsGrid(row)") > -1, 'the suggested times come first, right under the status sentence');
  assert.ok(builder.includes('function interviewNoticeSub(') && builder.includes("t('Suggested: {times}'"), 'the bell and the notifications page name the suggested times');
  assert.ok(builder.includes('await loadInterviewProposals();'), 'the times are read (through the database policy) when a notice needs them');
  assert.equal(/Suggested: \{times\}/.test(fs.readFileSync(path.join(__dirname, '..', 'locales', 'pt-BR.js'), 'utf8')), true);
});

test('the interview tag on a card is separated from the AI interview tag by the same thin line', () => {
  const css = read('styles.css');
  assert.equal(css.includes('.applicant-card-ai + .applicant-card-interview{'), false, 'no rule removes the line between the two subjects');
  assert.ok(css.includes('.applicant-card-ai{display:flex;flex-wrap:nowrap;align-items:center;gap:7px;margin-top:9px;padding-top:9px;border-top:1px solid var(--border-subtle)'), 'every subject of the card has the line above it');
});

test('the Interview tab after the time has passed: waiting for results, no re-send or cancel, finalize, and a result view with the details in a fold', () => {
  const panel = slice(builder, 'function mountInterviewPanel(', 'const notifInterviewText');
  assert.ok(builder.includes("const interviewAwaitingResult = row =>") && builder.includes("if (interviewAwaitingResult(row)) return ['Waiting for results', 'warn'];"), 'a card tag as well');
  assert.ok(panel.includes("button('finalize', t('Finalize interview'), 'btn-primary')"), 'finalize is offered');
  assert.ok(panel.includes("const actions = awaiting\n"), 'a different list of buttons once the time has passed');
  assert.ok(/awaiting\s*\n\s*\? button\('finalize'[^\n]*\n\s*: button\('schedule'[^\n]*button\('resend'[^\n]*cancelControl/.test(panel), 're-send and cancel only before the time');
  assert.ok(panel.includes("'<details class=\"iv-fold\"><summary>' + t('Scheduling details')"), 'the scheduling details are in a fold');
  assert.ok(panel.includes("button('correct', t('Correct result'))"), 'a correction is possible');
  const modal = slice(builder, 'function openFinalizeInterviewModal(', 'function offerInterviewScheduling');
  assert.ok(modal.includes("state.reason !== 'held' && state.reason !== 'other'"), 'no impression and recommendation for a no-show');
  assert.ok(modal.includes("B.addApplicantComment(row.flowId, row.email, text)") && modal.includes("notes !== (row.resultNotes || '')"), 'the notes become a team comment; a correction adds a new one when the notes changed');
  const schedule = slice(builder, 'function openScheduleInterviewModal(', 'function openFinalizeInterviewModal');
  assert.ok(schedule.includes("const day = row.localStart && !pastRow"), 'a past interview asks for a new day');
});

test('a new round: no "Schedule later", cancelling throws the empty row away, and the earlier interviews stay visible in the tab', () => {
  const schedule = slice(builder, 'function openScheduleInterviewModal(', 'function openFinalizeInterviewModal');
  assert.ok(schedule.includes("const newRound = row.state === 'awaiting_schedule' && (interviewEarlier.get("), 'a candidate who already had an interview');
  assert.ok(schedule.includes("row.state === 'awaiting_schedule' && !newRound ? t('Schedule later') : t('Cancel')"), 'Schedule later only for the first interview');
  assert.ok(schedule.includes('if (newRound && !invitationSent) B.discardInterviewRound(row.id)'), 'closing without sending removes the empty row');
  const panel = slice(builder, 'function mountInterviewPanel(', 'const notifInterviewText');
  assert.ok(panel.includes("t('Previous interviews')") && panel.includes("item.state === 'finished' || item.state === 'cancelled'"), 'earlier rounds are listed, each in a fold');
});

test('the interview windows open ON TOP of the candidate panel (a second layer), so the panel never closes behind them', () => {
  assert.ok(builder.includes('function setLayer(html)') && builder.includes('function closeLayer()'), 'a layer that leaves the window underneath alone');
  const windows = slice(builder, 'function openScheduleInterviewModal(', '// After a SINGLE move into the Interview column');
  assert.ok(!/\bsetModal\(/.test(windows) && !/\bcloseModal\(\)/.test(windows) && !/\bmodalCloseHook\b/.test(windows), 'the schedule, finalize and correct windows use the layer only');
  assert.ok((windows.match(/\bsetLayer\(/g) || []).length === 2 && (windows.match(/\bcloseLayer\(\)/g) || []).length === 2);
});
