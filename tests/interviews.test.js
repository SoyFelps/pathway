const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const loadLogic = () => import('../supabase/functions/interviews/logic.ts');
const loadEmail = () => import('../supabase/functions/interviews/email.ts');
const index = read('supabase/functions/interviews/index.ts');

const online = { kind: 'online', localStart: '2026-12-01T14:00', timeZone: 'America/Sao_Paulo', durationMinutes: 30, meetingLink: 'https://meet.example.test/abc', notes: '  Join 5 minutes early  ' };

test('the schedule form is checked: kind, day and time, zone, duration, link or address', async () => {
  const { parseScheduleInput } = await loadLogic();
  const ok = parseScheduleInput(online);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { kind: 'online', localStart: '2026-12-01T14:00', timeZone: 'America/Sao_Paulo', durationMinutes: 30, meetingLink: 'https://meet.example.test/abc', address: null, notes: 'Join 5 minutes early' });
  const person = parseScheduleInput({ ...online, kind: 'in_person', address: 'Av. Paulista, 1000' });
  assert.equal(person.value.address, 'Av. Paulista, 1000');
  assert.equal(person.value.meetingLink, null, 'the other kind of detail is dropped');
  assert.equal(parseScheduleInput({ ...online, kind: 'phone' }).error, 'Choose online or in person.');
  assert.equal(parseScheduleInput({ ...online, localStart: '2026-12-01 14:00' }).error, 'Choose a valid day and time.');
  assert.equal(parseScheduleInput({ ...online, localStart: '2026-13-45T99:99' }).error, 'Choose a valid day and time.');
  assert.equal(parseScheduleInput({ ...online, timeZone: '' }).error, 'Choose the time zone.');
  assert.equal(parseScheduleInput({ ...online, durationMinutes: 3 }).error, 'The duration must be between 5 minutes and 8 hours.');
  assert.equal(parseScheduleInput({ ...online, durationMinutes: 481 }).error, 'The duration must be between 5 minutes and 8 hours.');
  assert.equal(parseScheduleInput({ ...online, meetingLink: 'javascript:alert(1)' }).error, 'Enter a meeting link that starts with http:// or https://.');
  assert.equal(parseScheduleInput({ ...online, meetingLink: '' }).error, 'Enter a meeting link that starts with http:// or https://.');
  assert.equal(parseScheduleInput({ ...online, kind: 'in_person', address: ' ' }).error, 'Enter the address of the interview.');
});

test('the candidate answer is checked: confirm, decline, or a request with up to 3 times', async () => {
  const { parseAnswer, stateAfter, isRepeat } = await loadLogic();
  assert.deepEqual(parseAnswer({ response: 'confirm' }).value, { response: 'confirm' });
  assert.deepEqual(parseAnswer({ response: 'decline', note: ' Sorry ' }).value, { response: 'decline', note: 'Sorry' });
  const ask = parseAnswer({ response: 'reschedule', note: 'Any afternoon', proposedTimes: [{ local: '2026-12-03T14:00' }, '2026-12-04T10:30', '2026-12-03T14:00'] });
  assert.deepEqual(ask.value, { response: 'reschedule', note: 'Any afternoon', times: ['2026-12-03T14:00', '2026-12-04T10:30'] }, 'duplicates are dropped');
  assert.equal(parseAnswer({ response: 'reschedule', proposedTimes: ['2026-12-03T14:00', '2026-12-03T15:00', '2026-12-03T16:00', '2026-12-03T17:00'] }).error, 'You can suggest up to 3 times.');
  assert.equal(parseAnswer({ response: 'reschedule', proposedTimes: ['tomorrow'] }).error, 'Each suggested time must look like 2026-12-03T14:00.');
  assert.equal(parseAnswer({ response: 'reschedule', proposedTimes: [] }).error, 'Suggest at least one time or write a message.');
  assert.equal(parseAnswer({ response: 'reschedule', note: 'Can we talk on Friday?' }).ok, true, 'a message alone is enough');
  assert.equal(parseAnswer({ response: 'maybe' }).error, 'Choose one of the answers.');
  assert.equal(stateAfter({ response: 'confirm' }), 'confirmed');
  assert.equal(stateAfter({ response: 'decline', note: null }), 'declined');
  assert.equal(stateAfter({ response: 'reschedule', note: null, times: [] }), 'reschedule_requested');
  assert.equal(isRepeat('confirmed', { response: 'confirm' }), true);
  assert.equal(isRepeat('declined', { response: 'confirm' }), false);
});

test('the secret of the link: 43 random characters, only the SHA-256 hash is stored', async () => {
  const { newToken, hashToken, looksLikeToken } = await loadLogic();
  const a = newToken(), b = newToken();
  assert.notEqual(a, b);
  assert.equal(looksLikeToken(a), true);
  assert.equal(a.length, 43);
  assert.equal(looksLikeToken('short'), false);
  assert.equal(looksLikeToken('x'.repeat(43) + '!'), false);
  assert.equal(looksLikeToken(null), false);
  const hash = await hashToken(a);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, await hashToken(a), 'the same secret always gives the same hash');
  assert.equal(await hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'plain SHA-256');
});

test('the invitation is written in the job language, with the time of the interview zone, no attachment and one button', async () => {
  const { buildCandidateEmail, formatWhen } = await loadEmail();
  const startsAt = new Date('2026-12-01T17:00:00Z');
  const interview = { kind: 'online', startsAt, durationMinutes: 30, timeZone: 'America/Sao_Paulo', meetingLink: 'https://meet.example.test/abc', notes: 'Join early' };
  assert.equal(formatWhen(startsAt, 30, 'America/Sao_Paulo', 'en'), 'Tuesday, December 1, 2026, 14:00–14:30 (GMT-3, America/Sao_Paulo)');
  assert.match(formatWhen(startsAt, 30, 'America/Sao_Paulo', 'pt'), /terça-feira, 1 de dezembro de 2026, 14:00–14:30/);
  assert.match(formatWhen(startsAt, 30, 'Europe/Lisbon', 'es'), /martes, 1 de diciembre de 2026, 17:00–17:30/);
  const base = { candidateName: 'Alex Morgan', jobTitle: 'Product Designer', companyName: 'CoreFront', interview, pageUrl: 'https://nellio.app/interview.html#TOKEN' };
  const en = buildCandidateEmail({ ...base, kind: 'invite' });
  assert.equal(en.subject, 'Interview invitation: Product Designer – CoreFront');
  assert.equal(en.fromName, 'CoreFront via Nellio');
  const pt = buildCandidateEmail({ ...base, kind: 'invite', language: 'pt' });
  assert.equal(pt.subject, 'Convite para entrevista: Product Designer – CoreFront');
  assert.match(pt.text, /Olá, Alex Morgan,/);
  assert.match(pt.html, /Ver e responder/);
  const es = buildCandidateEmail({ ...base, kind: 'invite', language: 'es' });
  assert.equal(es.subject, 'Invitación a entrevista: Product Designer – CoreFront');
  for (const mail of [en, pt, es]) {
    for (const body of [mail.text, mail.html]) {
      assert.match(body, /https:\/\/meet\.example\.test\/abc/);
      assert.match(body, /https:\/\/nellio\.app\/interview\.html#TOKEN/);
      assert.match(body, /Join early/);
      assert.match(body, /14:00–14:30/);
    }
    assert.match(mail.html, /nellio-email-header\.png/, 'the green Nellio header');
    assert.equal('attachments' in mail, false, 'no attachment');
  }
  assert.equal(buildCandidateEmail({ ...base, kind: 'update' }).subject, 'Interview updated: Product Designer – CoreFront');
  assert.equal(buildCandidateEmail({ ...base, kind: 'reminder24' }).subject, 'Reminder: your interview for Product Designer is in 24 hours');
  assert.equal(buildCandidateEmail({ ...base, kind: 'reminder2', language: 'pt' }).subject, 'Lembrete: sua entrevista para Product Designer é em 2 horas');
  assert.equal(buildCandidateEmail({ ...base, kind: 'reminder10' }).subject, 'Reminder: your interview for Product Designer starts in 10 minutes');
  assert.equal(buildCandidateEmail({ ...base, kind: 'reminder10', language: 'es' }).subject, 'Recordatorio: su entrevista para Product Designer empieza en 10 minutos');
  const cancel = buildCandidateEmail({ ...base, kind: 'cancel' });
  assert.equal(cancel.subject, 'Interview cancelled: Product Designer – CoreFront');
  assert.equal(cancel.html.includes('interview.html#TOKEN'), false, 'a cancellation has no button');
  assert.ok(cancel.html.includes('When:') && !/Meeting link|Format|Address|Notes/.test(cancel.html), 'a cancellation shows only the date, no link, address or notes');
  assert.equal(cancel.html.includes(online.meetingLink) || cancel.text.includes(online.meetingLink), false, 'the meeting link is not in a cancellation');
});

test('an in-person invitation shows the address; no language or an unknown one means English', async () => {
  const { buildCandidateEmail } = await loadEmail();
  const interview = { kind: 'in_person', startsAt: new Date('2026-12-01T17:00:00Z'), durationMinutes: 60, timeZone: 'America/Sao_Paulo', address: 'Av. Paulista, 1000' };
  const mail = buildCandidateEmail({ kind: 'invite', language: 'fr', candidateName: 'Alex', jobTitle: 'Designer', companyName: 'CoreFront', interview, pageUrl: 'https://nellio.app/interview.html#T' });
  assert.match(mail.text, /In person/);
  assert.match(mail.text, /Av\. Paulista, 1000/);
  assert.match(mail.text, /Hi Alex,/);
});

test('text from the recruiter or the candidate cannot inject HTML or e-mail headers', async () => {
  const { buildCandidateEmail, buildRecruiterEmail } = await loadEmail();
  const interview = { kind: 'online', startsAt: new Date('2026-12-01T17:00:00Z'), durationMinutes: 30, timeZone: 'UTC', meetingLink: 'https://x.test/?a=1&b=<script>', notes: '<img src=x onerror=alert(1)>' };
  const mail = buildCandidateEmail({ kind: 'invite', candidateName: '<b>Eve</b>\r\nBcc: x@y.test', jobTitle: '"><script>', companyName: 'A & B <i>', interview, pageUrl: 'https://nellio.app/interview.html#T' });
  assert.equal(/<script|<img src=x|<b>Eve|<i>/.test(mail.html), false);
  assert.equal(/[\r\n]/.test(mail.subject), false);
  assert.equal(/[\r\n]/.test(mail.fromName), false);
  const note = buildRecruiterEmail({ kind: 'reschedule', candidateName: 'Eve', jobTitle: 'J', companyName: 'C', interview, message: '<script>alert(1)</script>', suggestedTimes: ['2026-12-03T14:00'], appUrl: 'https://nellio.app/#applicants' });
  assert.equal(note.html.includes('<script>'), false);
});

test('the recruiter is told when the candidate answers, in the recruiter language, and what a decline does not do', async () => {
  const { buildRecruiterEmail, languageOfProfile } = await loadEmail();
  assert.equal(languageOfProfile('pt-BR'), 'pt');
  assert.equal(languageOfProfile('es'), 'es');
  assert.equal(languageOfProfile(null), 'en');
  const interview = { kind: 'online', startsAt: new Date('2026-12-01T17:00:00Z'), durationMinutes: 30, timeZone: 'America/Sao_Paulo', meetingLink: 'https://meet.example.test/abc' };
  const base = { candidateName: 'Alex', jobTitle: 'Designer', companyName: 'CoreFront', interview, appUrl: 'https://nellio.app/#applicants' };
  assert.equal(buildRecruiterEmail({ ...base, kind: 'confirmed', language: 'pt' }).subject, 'Alex confirmou a entrevista – Designer');
  const declined = buildRecruiterEmail({ ...base, kind: 'declined' });
  assert.equal(declined.subject, 'Alex cannot attend the interview – Designer');
  assert.match(declined.text, /not moved or rejected/);
  const ask = buildRecruiterEmail({ ...base, kind: 'reschedule', language: 'es', message: 'Puedo el viernes', suggestedTimes: ['2026-12-03T14:00', '2026-12-04T10:30'] });
  assert.match(ask.text, /2026-12-03 14:00/);
  assert.match(ask.text, /Puedo el viernes/);
  // The title names the person; the e-mail address is in the body (owner request, 2026-11-19).
  const named = buildRecruiterEmail({ ...base, kind: 'confirmed', candidateName: 'Alex Morgan', candidateEmail: 'alex@example.test' });
  assert.equal(named.subject, 'Alex Morgan confirmed the interview – Designer');
  assert.match(named.html, /<h1[^>]*>Alex Morgan confirmed\.<\/h1>/);
  assert.match(named.html, /<strong>E-mail:<\/strong> alex@example\.test/);
  assert.match(named.text, /E-mail: alex@example\.test/);
  assert.equal(/<h1[^>]*>[^<]*alex@example/.test(named.html), false, 'the address is not in the title');
  const unnamed = buildRecruiterEmail({ ...base, kind: 'confirmed', candidateName: '', candidateEmail: 'alex@example.test' });
  assert.match(unnamed.html, /<h1[^>]*>alex@example\.test confirmed\.<\/h1>/, 'a candidate without a name is shown by the address');
  // The calendar links are only in the notice that the candidate CONFIRMED (owner decision, 2026-11-18); there is no copy when the invitation is sent.
  const links = { google: 'https://calendar.google.com/x', outlook: 'https://outlook.live.com/y' };
  const confirmed = buildRecruiterEmail({ ...base, kind: 'confirmed', calendarLinks: links });
  assert.match(confirmed.text, /Add to my calendar/);
  assert.match(confirmed.text, /calendar\.google\.com/);
  // In the HTML the long addresses hide behind two short words (owner request, 2026-11-19).
  assert.match(confirmed.html, />Google<\/a>/);
  assert.match(confirmed.html, />Outlook<\/a>/);
  assert.equal(/>https:\/\/calendar\.google\.com/.test(confirmed.html), false, 'the address is not shown as the text of the link');
  assert.match(confirmed.html, /href="https:\/\/calendar\.google\.com\/x"/);
  assert.equal(/Add to my calendar/.test(buildRecruiterEmail({ ...base, kind: 'declined', calendarLinks: links }).text), false, 'no calendar links in a decline');
  const emailSource = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/interviews/email.ts'), 'utf8');
  assert.equal(/scheduled: \{/.test(emailSource), false, 'the recruiter gets no e-mail when the invitation is sent');
  assert.equal(index.includes('notifyRecruiters(ctx, "scheduled"'), false);
});

test('the function checks origin and sign-in, and the candidate actions need only the secret of the link', () => {
  assert.ok(index.includes('if (origin && !APP_ORIGINS.has(origin))'), 'only the Nellio sites and local ports');
  assert.ok(index.includes('"https://nellio.app"') && index.includes('"https://soyfelps.github.io"'));
  // the three recruiter actions authenticate; get/respond/calendar/tick do not
  const dispatch = index.slice(index.indexOf('Deno.serve('));
  const authAt = dispatch.indexOf('const auth = await authenticate(req)');
  for (const action of ['get', 'respond', 'calendar', 'tick']) assert.ok(dispatch.indexOf(`action === "${action}"`) < authAt, `${action} is answered before sign-in is demanded`);
  for (const action of ['schedule', 'cancel', 'resend', 'newRound']) assert.ok(dispatch.indexOf(`action === "${action}"`) > -1);
  assert.ok(index.includes('await admin!.auth.getUser(token)'), 'the session is verified');
  assert.ok(index.includes('userClient.from("candidate_interviews")'), 'the recruiter sees an interview only if the database policy allows it');
});

test('every change checks the plan, the state and the time windows; the browser never writes', () => {
  assert.ok(index.includes('"An active plan is needed to schedule interviews."'));
  assert.ok(index.includes('workspace_has_active_subscription'));
  assert.ok(index.includes('.eq("state", seen.state)'), 'a change only applies to the state that was seen');
  assert.ok(index.includes('.eq("state", iv.state)'));
  assert.ok(index.includes('error.code === "22023"'), 'the window messages of the database reach the person');
  assert.ok(index.includes('new Date(iv.starts_at).getTime() <= Date.now()'), 'nobody answers an interview that has passed');
  assert.ok(index.includes('recentEvents(iv.id, ["confirmed", "declined", "reschedule_requested"], 60) >= 10'), 'limit of answers per hour');
  assert.ok(index.includes('recentEvents(seen.id, ["resent"], 60) >= 3'), 'limit of re-sends per hour');
});

test('the e-mail has no attachment, the secret is stored only as a hash and never logged', () => {
  assert.equal(/attachments/i.test(index), false, 'no attachment is sent');
  assert.ok(index.includes('token_hash: await hashToken(token)'));
  assert.ok(index.includes('hashToken(body.token)'));
  assert.equal(/console\.(log|error)\([^)]*token/i.test(index), false, 'the secret never reaches the logs');
  assert.equal(/candidateView[\s\S]{0,1200}candidate_email/.test(index.slice(index.indexOf('function candidateView'), index.indexOf('// Recruiter actions'))), false, 'the page never shows the e-mail address');
  assert.ok(index.includes('"Idempotency-Key"'), 'a retried call never sends twice');
});

test('a decline or a request for another time moves nobody: the card stays where it is', () => {
  const answer = index.slice(index.indexOf('async function actionRespond'), index.indexOf('async function actionCalendar'));
  assert.equal(/from\("applicants"\)\s*\.update|status:/.test(answer), false, 'the candidate answer never touches the applicant');
});

test('reminders are claimed once and given back when the e-mail fails', () => {
  const tick = index.slice(index.indexOf('async function actionTick'), index.indexOf('Deno.serve('));
  assert.ok(tick.includes('.is(column, null)'), 'claimed only while not yet sent');
  assert.ok(tick.includes('.eq("state", "confirmed")'), 'only confirmed interviews');
  assert.ok(tick.includes('[column]: null'), 'a failed e-mail is tried again on the next tick');
  assert.ok(tick.includes('.slice(0, 50)'));
});

test('the function is listed with the other edge functions that check the origin (no JWT, it authenticates itself)', () => {
  assert.ok(index.includes('Plan: D:\\Pathway\\plano-entrevistas.md'));
  assert.ok(!/sk_live|whsec_|re_[A-Za-z0-9]{20}/.test(index), 'no secret in the code');
});

test('while the hiring team looks at a request for another time the candidate has no buttons and no calendar', () => {
  const view = index.slice(index.indexOf('function candidateView('), index.indexOf('// Recruiter actions (signed in)'));
  assert.ok(view.includes('canChange: on && iv.state !== "reschedule_requested" && iv.state !== "declined"'), 'no buttons while the request is open or after "cannot attend"');
  assert.ok(view.includes('calendar: (iv.state === "invited" || iv.state === "confirmed")'), 'a calendar only for an invitation or a confirmation');
  const respond = index.slice(index.indexOf('async function actionRespond('), index.indexOf('async function actionCalendar('));
  assert.ok(respond.includes('iv.state === "reschedule_requested"') && respond.includes('Your request is with the hiring team.') && respond.includes('iv.state === "declined"') && respond.includes('Your answer is with the hiring team.'), 'the answer is refused by the server too');
  const calendar = index.slice(index.indexOf('async function actionCalendar('), index.indexOf('// Reminders:'));
  assert.ok(calendar.includes('state !== "invited" && found.ctx.iv.state !== "confirmed"') && calendar.includes('The calendar is not available for this interview.'), 'the .ics is refused too');
  const page = fs.readFileSync(path.join(__dirname, '..', 'interview.js'), 'utf8');
  assert.ok(page.includes('if (!view.canChange || panel) return'), 'the page draws the buttons only when the candidate may change the answer');
});

test('each interview has its own responsible people: chosen in the schedule window, checked against the workspace, and the ones told about the answers', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261120120000_candidate_interview_responsibles.sql'), 'utf8');
  assert.ok(sql.includes("add column responsible_user_ids uuid[] not null default '{}'::uuid[]") && sql.includes('cardinality(responsible_user_ids) <= 20'), 'a list of at most 20 people, empty by default');
  assert.ok(sql.includes('grant select (responsible_user_ids) on public.candidate_interviews to authenticated;'), 'the browser can read it, never write it');
  assert.equal((sql.match(/case when cardinality\(i\.responsible_user_ids\) > 0 then auth\.uid\(\) = any \(i\.responsible_user_ids\)/g) || []).length, 2, 'the bell and the notifications page use the same rule');
  assert.ok(sql.includes('else (cardinality(f.responsible_user_ids) = 0 or auth.uid() = any (f.responsible_user_ids)) end'), 'an empty list keeps the old rule (the job\'s people)');
  assert.ok(index.includes('async function parseResponsibles(') && index.includes('"Choose people from this workspace."'), 'only people of the workspace');
  assert.ok(index.includes('...(responsibles.ids !== null ? { responsible_user_ids: responsibles.ids } : {})'), 'a request without the list leaves it as it is');
  const recipients = index.slice(index.indexOf('async function recruiterRecipients('), index.indexOf('async function notifyRecruiters('));
  assert.ok(recipients.includes('ctx.iv.responsible_user_ids.length') && recipients.includes('ctx.flow.responsible_user_ids'), 'the interview\'s list first, else who scheduled it plus the job\'s people');
  const builder = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  assert.ok(builder.includes("if (!editing) mountResponsibleField(form.querySelector('#iv-responsible'), 'iv-responsible-label'"), 'the same multi-select as the job responsible field, at the end of the window, only when the interview is created');
  assert.ok(builder.includes('responsibleIds: !editing && people.length ? currentResponsibleIds(responsibleIds) : undefined'), 'sent with the first invitation, never with an edit (which e-mails the candidate)');
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'backend.js'), 'utf8').includes(",responsible_user_ids')"), 'read with the interviews');
});

test('after the invitation the responsible people change in the Interview tab at any time: no e-mail to the candidate and a line in the history with the name', () => {
  const action = index.slice(index.indexOf('async function actionSetResponsibles('), index.indexOf('async function actionCancel('));
  assert.ok(action.length > 100);
  assert.equal(/sendToCandidate|sendMail|notifyRecruiters/.test(action), false, 'nothing is e-mailed to anyone');
  assert.ok(action.includes('addEvent(updated, "responsibles_changed", "recruiter", userId'), 'the history records who did it');
  assert.ok(action.includes('return response(req, 200, { interview: recruiterRow(before) });'), 'an unchanged list writes no history line');
  assert.ok(index.includes('action === "setResponsibles"') && index.includes('actionSetResponsibles(req, auth.userId, auth.userClient, body)'), 'a signed-in action');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261120130000_interview_responsibles_history.sql'), 'utf8');
  assert.ok(sql.includes("'finished', 'responsibles_changed'"), 'the history accepts the new kind');
  const builder = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  assert.ok(builder.includes("mountResponsibleField(respHost, 'iv-tab-resp-label'") && builder.includes('B.setInterviewResponsibles(row.id, currentResponsibleIds(chosen))'), 'the tab saves by itself');
  assert.ok(builder.includes("t('{name} changed the responsible people', { name: esc(interviewActorName(item.actorUserId)) })"), 'the history line has the name');
  const backend = fs.readFileSync(path.join(__dirname, '..', 'backend.js'), 'utf8');
  assert.ok(backend.includes("action: 'setResponsibles'") && backend.includes('actor_user_id'), 'the browser asks the function and reads who acted');
});
