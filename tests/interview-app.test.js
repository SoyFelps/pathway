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
  assert.ok(modal.includes('B.scheduleInterview(interviewId'), 'the invitation goes through the checked function');
});

test('the card shows the interview tag, the panel has an Interview tab with edit, re-send, cancel and history', () => {
  assert.ok(builder.includes('${interviewCardHtml(interviewFor(applicant.flow_id, applicant.candidate_email))}</article>'));
  for (const label of ['Waiting to be scheduled', 'Interview invite sent', 'Interview confirmed', 'Denied the interview', 'Asked for another time']) assert.ok(builder.includes("'" + label + "'"), label);
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
  assert.ok(panel.includes("? button('finalize', t('Finalize interview'), 'btn-primary') + resend + ") && panel.includes("+ resend + (opened ? '' : cancelControl);") && builder.includes('const interviewResendable = row =>'), 'cancel only before the time; re-send until the interview ends');
  assert.ok(panel.includes("'<h4>' + t('Scheduling details') + '</h4>' + detailsGrid(item)") && panel.includes('<details class=\"iv-fold\"'), 'the scheduling details are inside the fold of each round');
  assert.ok(panel.includes('data-iv-action=\"correct\" data-iv-id=') && panel.includes("t('Correct result')"), 'a correction is possible, for the round it belongs to');
  const modal = slice(builder, 'function openFinalizeInterviewModal(', 'function offerInterviewScheduling');
  assert.ok(modal.includes("state.reason !== 'held' && state.reason !== 'other'"), 'no impression and recommendation for a no-show');
  assert.ok(modal.includes("B.addApplicantComment(row.flowId, row.email, text)") && modal.includes("notes !== (row.resultNotes || '')"), 'the notes become a team comment; a correction adds a new one when the notes changed');
  const schedule = slice(builder, 'function openScheduleInterviewModal(', 'function openFinalizeInterviewModal');
  assert.ok(schedule.includes("const day = row.localStart && !pastRow"), 'a past interview asks for a new day');
});

test('a new round: no "Schedule later", cancelling throws the empty row away, and the earlier interviews stay visible in the tab', () => {
  const schedule = slice(builder, 'function openScheduleInterviewModal(', 'function openFinalizeInterviewModal');
  assert.ok(schedule.includes("const newRound = row.state === 'awaiting_schedule' && (Boolean(options.rowPromise) || (interviewEarlier.get("), 'a candidate who already had an interview');
  assert.ok(schedule.includes("row.state === 'awaiting_schedule' && !newRound ? t('Schedule later') : t('Cancel')"), 'Schedule later only for the first interview');
  assert.ok(schedule.includes('if (newRound && !invitationSent)') && schedule.includes('B.discardInterviewRound(id)'), 'closing without sending removes the empty row');
  const panel = slice(builder, 'function mountInterviewPanel(', 'const notifInterviewText');
  assert.ok(panel.includes("t('Previous interviews')") && panel.includes("item.state === 'finished' || item.state === 'cancelled'"), 'earlier rounds are listed, each in a fold');
});

test('the interview windows open ON TOP of the candidate panel (a second layer), so the panel never closes behind them', () => {
  assert.ok(builder.includes('function setLayer(html)') && builder.includes('function closeLayer()'), 'a layer that leaves the window underneath alone');
  const windows = slice(builder, 'function openScheduleInterviewModal(', '// After a SINGLE move into the Interview column');
  assert.ok(!/\bsetModal\(/.test(windows) && !/\bcloseModal\(\)/.test(windows) && !/\bmodalCloseHook\b/.test(windows), 'the schedule, finalize and correct windows use the layer only');
  assert.ok((windows.match(/\bsetLayer\(/g) || []).length === 2 && (windows.match(/\bcloseLayer\(\)/g) || []).length === 2);
});

test('when the latest round is over, no round gets the spotlight: a count and every round in a fold, each with its own history', () => {
  const panel = slice(builder, 'function mountInterviewPanel(', 'const notifInterviewText');
  assert.ok(panel.includes("const terminal = Boolean(row && (row.state === 'cancelled' || (row.state === 'finished' && row.resultAt)));"), 'a cancelled or finalized latest round');
  assert.ok(panel.includes("tn('{count} interview', '{count} interviews', rounds.length)"), 'the title counts the rounds');
  assert.ok(panel.includes('const folds = (terminal ? rounds : rounds.filter(item => item !== row));'), 'all rounds listed when none is in play');
  assert.ok(panel.includes('historyList(eventsById.get(item.id))'), 'each round shows its own history');
  assert.ok(panel.includes("const history = !terminal && events.length"), 'no global history under the folds');
});

test('"Schedule another interview" opens the window at once: the row of the new round is made in the background and sending waits for it', () => {
  const panel = slice(builder, 'function mountInterviewPanel(', 'const notifInterviewText');
  const start = panel.indexOf("if (action === 'new') {");
  const branch = panel.slice(start, panel.indexOf('return;', start));
  assert.ok(branch.indexOf('openScheduleInterviewModal(') > -1 && branch.indexOf('B.startInterviewRound') < branch.indexOf('openScheduleInterviewModal(') && !/await B\.startInterviewRound/.test(branch), 'the window does not wait for the server');
  const schedule = slice(builder, 'function openScheduleInterviewModal(', 'function openFinalizeInterviewModal');
  assert.ok(schedule.includes('if (pendingRow) interviewId = (await pendingRow).id;'), 'sending waits for the row');
  assert.ok(schedule.includes('pendingRow.then(created => created.id)'), 'closing without sending discards the row once it exists');
});

test('the card shows the result of the latest interview (a cancelled one only when nothing else happened), the history of the round in play sits above the earlier rounds, and a saving button looks disabled', () => {
  assert.ok(builder.includes("(have.state === 'cancelled' && row.state === 'finished')"), 'a cancelled latest round gives way to an earlier round with a result');
  assert.ok(builder.includes("if (row && row.state === 'cancelled') return ['Interview cancelled', 'warn'];") && builder.includes("return [row.resultReason === 'held' ? 'Interview held' : 'Interview finished', tone];"), 'tags for a result and for a cancellation');
  assert.ok(builder.includes('aiImpressionBadge(row.resultImpression)') && builder.includes('class=\"ai-recommend\"') && builder.includes("interviewBadges(row)"), 'the impression thumb and, when recommended, a seal next to it (no word on the card)');
  const panel = slice(builder, 'function mountInterviewPanel(', 'const notifInterviewText');
  assert.ok(panel.includes("+ body + meetingNotes + history + earlierHtml + '</div>';"), 'the transcript and minutes, then the history, then the earlier rounds');
  const modal = slice(builder, 'function openFinalizeInterviewModal(', 'function offerInterviewScheduling');
  assert.ok(modal.includes("if (submitting) return;") && modal.includes("t('Saving…')") && modal.includes("form.querySelectorAll('button, textarea, input').forEach(item => { item.disabled = busy; });"), 'one submit only, with a visible waiting state');
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8').includes('.btn:disabled,.btn[disabled]{opacity:.6;cursor:progress}'), 'a disabled button looks disabled');
});

test('the recommendation seal also shows in the Interview tab and next to the hiring stage, for the latest interview that is not cancelled', () => {
  assert.ok(builder.includes("const interviewRecommended = row => Boolean(row && row.state === 'finished' && row.resultAt && row.resultRecommended === true);"), 'only a finalized interview with the recommendation on');
  const panel = slice(builder, 'function mountInterviewPanel(', 'const notifInterviewText');
  assert.ok(panel.includes("interviewRecommended(mine.find(item => item.state !== 'cancelled') || null)"), 'the tab looks at the latest round that is not cancelled');
  assert.ok(panel.includes("</h3></div>' + seal + '<button"), 'the seal sits at the right of the title');
  assert.ok(builder.includes("${interviewRecommended(interviewRow) ? recommendSeal(true) : ''}"), 'next to the hiring stage in the candidate panel');
});

test('the card tag is centered like the AI one, a candidate who declined "denied the interview" (not "cannot attend"), a single interview opens its fold, and Recommended is an advanced filter', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.ok(css.includes('.applicant-card-interview{flex-wrap:nowrap;align-items:center}'), 'one centered line');
  assert.ok(builder.includes("case 'declined': return ['Denied the interview', 'warn'];") && !/cannot attend/i.test(builder.replace(/I cannot attend/g, '')), 'no screen of the team says cannot attend');
  const panel = slice(builder, 'function mountInterviewPanel(', 'const notifInterviewText');
  assert.ok(panel.includes("(terminal && rounds.length === 1 ? ' open' : '')"), 'the only interview is open');
  assert.ok(builder.includes("interview: t('Interview'), date:") && builder.includes("{ value: 'recommended', label: t('Recommended') }") && builder.includes('const keys = interviewFilterKeys(interviewFor(item.flow_id, item.candidate_email)); return row.values.some(value => keys.has(value));'), 'the filter asks about the interview the card shows (same rule as the seal for Recommended)');
});

test('the Interview filter lists the stages, results, impressions, Recommended and "No interview", and reads them from the interview the card shows', () => {
  const options = slice(builder, "case 'interview': return [", "case 'applications':");
  for (const value of ['awaiting_schedule', 'invited', 'confirmed', 'reschedule_requested', 'declined', 'waiting_results', 'held', 'no_show', 'other', 'cancelled', 'positive', 'mixed', 'negative', 'recommended', 'none']) assert.ok(options.includes("value: '" + value + "'"), value);
  const keys = slice(builder, 'function interviewFilterKeys(row) {', 'function interviewCardHtml(row) {');
  assert.ok(keys.includes('interviewAwaitingResult(row)') && keys.includes('interviewRecommended(row)') && keys.includes("keys.add('none')"), 'waiting for results, recommendation and no interview');
  assert.ok(keys.includes("row.resultReason === 'held' ? 'held' : row.resultReason === 'no_show' ? 'no_show' : 'other'"), 'the result of a finalized interview');
});

test('the Interviews page: its own menu item below Applicants, its own route, a list with search, job / responsible / status filters and Upcoming-Past-All, and the same windows as the candidate tab', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(builder.indexOf("data-route=\"applicants\"") < builder.indexOf("data-route=\"interviews\"") && builder.includes("hasPermission('applicants') ? `<button class=\"sidebar-link ${active === 'interviews' ? 'active' : ''}\" data-route=\"interviews\""), 'a menu item right below Applicants, for people who may see candidates');
  assert.ok(builder.includes("requestedPage === 'interviews') void renderInterviews()") && builder.includes("setRoute('interviews')"), 'its own address');
  const page = slice(builder, 'async function renderInterviews()', '// ---- Reports');
  assert.ok(page.includes("id=\"iv-search\"") && page.includes("'iv-job-filter'") && page.includes("'iv-responsible-filter'") && page.includes("'iv-status-filter'"), 'search, job, responsible and status');
  assert.ok(page.includes("hasPermission('flows') ? ivComboboxHtml('iv-responsible-filter'"), 'the responsible filter needs the job lists, like on Applicants');
  assert.ok(page.includes("openScheduleInterviewModal(row, { afterClose") && page.includes("openFinalizeInterviewModal(row, { afterClose") && page.includes('await ivCancelInterview(row)') && builder.includes('window.PathwayBackend.cancelInterview(row.id)'), 'edit, finalize and cancel are the same flows as the candidate tab');
  assert.ok(!/class="[^"]*applicants-page/.test(page), 'it must not carry the class of the board page (the interview windows would try to redraw a board that is not there)');
  const list = slice(builder, 'const ivScheduled = () =>', 'function ivRowHtml(row)');
  assert.ok(list.includes("row.state !== 'awaiting_schedule' && row.startsAt") && list.includes('interviewFilterKeys(row).has(ivStatus)') && list.includes('applicantFlowHasResponsible(row.flowId, ivResponsible)'), 'only scheduled interviews; the status and responsible rules are the ones of the card and the filter');
  assert.ok(list.includes("ivScope === 'upcoming' ? !ivIsPast(row) : ivIsPast(row)") && list.includes('IV_UPCOMING_GRACE_MS = 5 * 60000') && page.includes('data-ivp-waiting'), 'what waits for a result is in Past, with an alert that shows it');
  assert.ok(builder.includes("interviewNames.get(row.flowId + '|' + row.email)"), 'the windows know the candidate name without the Applicants list');
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'backend.js'), 'utf8').includes('listInterviewCandidateNames'), 'a light read of the candidate names');
});

test('the Interviews calendar: List / Day / Week / Month on the same filtered interviews, the weekend rule of the calendar file, and a details window with the same actions', () => {
  const page = slice(builder, '// ---- the calendar views (Day, Week, Month)', '  async function loadInterviewsPage() {');
  assert.ok(page.includes("[['list', t('List')], ['day', t('Day')], ['week', t('Week')], ['month', t('Month')]]"), 'the four views');
  assert.ok(page.includes('ivScheduled().filter(ivMatches)'), 'the calendar uses the same filters as the list');
  assert.ok(page.includes('Cal.weekDays(') || page.includes('ivCal().weekDays('), 'the week hides Saturday and Sunday without an interview');
  assert.ok(page.includes('Cal.monthGrid(ivAnchor, events)') && page.includes('data-ivp-day'), 'the month, and a click on a day opens it');
  assert.ok(page.includes('const maxLanes = days.length > 1 ? 2 : 6;') && page.includes('iv-ev-more'), 'crowded hours show a "+N" button');
  assert.ok(page.includes('function openInterviewDetails(row)') && page.includes("closeLayer(); openScheduleInterviewModal(row, { afterClose: reload });") && page.includes("closeLayer(); openFinalizeInterviewModal(row, { afterClose: reload });") && page.includes('await ivCancelInterview(row)'), 'edit, finalize and cancel from the details window');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.includes('interviews-calendar.js?v='), 'the calendar file is loaded (with a version)');
});

test('the Interviews page can change the responsible people of an interview that is not finalized, in a small window with the same field and server action as the Interview tab', () => {
  const page = slice(builder, 'function ivRowHtml(row)', 'function renderInterviewsList()');
  assert.ok(page.includes("on ? ['responsibles', t('Change responsible'), '', locked] : null"), 'in the menu of every interview that is on (invited, confirmed, declined, asked for another time, waiting for results), never finalized or cancelled');
  const modal = slice(builder, 'function openInterviewResponsiblesModal(row)', 'function openInterviewDetails(row)');
  assert.ok(modal.includes('mountResponsibleField(') && modal.includes('setInterviewResponsibles(row.id, currentResponsibleIds(chosen))') && modal.includes('loadInterviewsPage()'));
  assert.ok(builder.includes("action === 'responsibles') { openInterviewResponsiblesModal(row); return; }") && builder.includes("action === 'responsibles') { closeLayer(); openInterviewResponsiblesModal(row); }"), 'from the list and from the details window');
});
