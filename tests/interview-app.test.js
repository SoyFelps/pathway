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
  assert.ok(panel.indexOf("'</p>' + requested + '<div class=\"applicant-info-grid\">'") > -1, 'the suggested times come first, right under the status sentence');
  assert.ok(builder.includes('function interviewNoticeSub(') && builder.includes("t('Suggested: {times}'"), 'the bell and the notifications page name the suggested times');
  assert.ok(builder.includes('await loadInterviewProposals();'), 'the times are read (through the database policy) when a notice needs them');
  assert.equal(/Suggested: \{times\}/.test(fs.readFileSync(path.join(__dirname, '..', 'locales', 'pt-BR.js'), 'utf8')), true);
});
