const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const sql = read('supabase/migrations/20261019210000_export_my_data.sql');
const builder = read('builder.js');

// Runs the real CSV helpers from builder.js.
const start = builder.indexOf('function csvCell(value)'), end = builder.indexOf('function downloadTextFile(');
const { myDataToCsv, csvCell } = new Function(builder.slice(start, end) + '\nreturn { myDataToCsv, csvCell };')();

test('the export function only reads the caller\'s own rows and leaves out other people and secrets', () => {
  assert.match(sql, /create or replace function public\.export_my_data\(\)\s+returns jsonb[\s\S]*security definer\s+set search_path = ''/);
  assert.ok(sql.includes('v_uid uuid := auth.uid();') && sql.includes('if v_uid is null then'));
  for (const rule of ['u.id = v_uid', 'p.user_id = v_uid', 'w.owner_id = v_uid', 'm.user_id = v_uid', 'f.created_by = v_uid', 'c.author_id = v_uid']) assert.ok(sql.includes(rule), rule);
  assert.equal(/encrypted_password|password_hash|raw_user_meta|recovery_token|confirmation_token/.test(sql), false, 'no secrets');
  assert.equal(/candidate_email|candidate_name|member_email|invited_email/.test(sql), false, 'no other people\'s personal data');
  assert.match(sql, /revoke all on function public\.export_my_data\(\) from public, anon, authenticated;\s*grant execute on function public\.export_my_data\(\) to authenticated, service_role;/);
  assert.equal(/to anon/.test(sql), false);
});

test('Settings has a "Download my data" link next to the legal line', () => {
  const settings = builder.slice(builder.indexOf('function renderSettings()'), builder.indexOf('window.PathwayAuth.start('));
  assert.ok(settings.includes('<div class="settings-footer-row"><p class="settings-legal-note">Legal questions?'));
  assert.ok(settings.includes('id="settings-download-data">Download my data</button>'));
  assert.ok(settings.includes('window.PathwayBackend.exportMyData()') && settings.includes("'pathway-my-data-'"));
  assert.ok(read('backend.js').includes("client.rpc('export_my_data')") && read('backend.js').includes('exportMyData,'));
});

test('the CSV is flat, readable and safe to open in a spreadsheet', () => {
  const csv = myDataToCsv({
    exportedAt: '2026-10-19T10:00:00Z',
    account: { email: 'a@b.com', createdAt: '2026-10-01' },
    profile: { firstName: 'Ana', lastName: 'Souza' },
    ownedWorkspace: { name: 'Acme, Inc.', planStatus: 'active' },
    jobsCreated: [{ title: 'Designer' }, { title: 'Said "hi"\nsecond line' }, { title: '=HYPERLINK("http://x")' }],
    commentsWritten: [{ text: 'must never be exported' }]
  });
  const lines = csv.replace('﻿', '').split('\r\n');
  assert.equal(lines[0], 'section,record,field,value');
  assert.ok(csv.startsWith('﻿'), 'a byte-order mark so Excel reads accents correctly');
  assert.ok(lines.includes('account,,email,a@b.com'));
  assert.ok(lines.includes('profile,,lastName,Souza'));
  assert.ok(lines.includes('ownedWorkspace,,name,"Acme, Inc."'), 'commas are quoted');
  assert.ok(lines.includes('jobsCreated,1,title,Designer'), 'numbered records');
  assert.ok(csv.includes('jobsCreated,2,title,"Said ""hi""\nsecond line"'), 'quotes and line breaks are escaped');
  assert.equal(/commentsWritten|must never be exported/.test(csv), false, 'internal comments are never exported');
  assert.equal(csvCell('=1+1'), "'=1+1", 'formulas are neutralised');
  assert.equal(csvCell('+5'), "'+5");
  assert.equal(csvCell(null), '');
  assert.equal(lines.some(line => /^membership,/.test(line)), false, 'sections that do not apply are left out');
});

test('the CSV lists each section\'s fields in a natural order', () => {
  const csv = myDataToCsv({ profile: { lastName: 'Souza', createdAt: 'c', firstName: 'Ana' }, account: { lastSignInAt: 'l', userId: 'u', email: 'e' } });
  const lines = csv.replace('﻿', '').split('\r\n');
  assert.ok(lines.indexOf('profile,,firstName,Ana') < lines.indexOf('profile,,lastName,Souza'));
  assert.ok(lines.indexOf('account,,userId,u') < lines.indexOf('account,,email,e') && lines.indexOf('account,,email,e') < lines.indexOf('account,,lastSignInAt,l'));
});

const { candidateDataToCsv } = new Function(builder.slice(start, builder.indexOf('function downloadTextFile(')) + '\nreturn { candidateDataToCsv };')();

test('"Export data" on a candidate builds one CSV with the application data held about them (no internal comments)', () => {
  const person = { candidate_name: 'Ana Souza', candidate_email: 'ana@x.com' };
  const items = [
    { submitted_at: '2026-10-19T12:00:00Z', status: 'failed', auto_fail_reason: 'Answered "No" to "Right to work?"', resume_filename: 'cv.pdf', privacy_notice_version: 'v1', privacy_acknowledged_at: '2026-10-19T12:00:01Z', candidate_info: { phone: '555' }, responses: [{ order: 1, question: 'Tools?', answer: ['Figma', 'Sketch'] }, { order: 2, question: 'Years', answer: '5' }] },
    { submitted_at: '2026-10-18T09:00:00Z', status: 'new', resume_filename: 'old.pdf', candidate_info: {}, responses: [] }
  ];
  const csv = candidateDataToCsv({ person, items, jobTitle: 'Designer', stage: 'failed', comments: [{ createdAt: '2026-10-19T13:00:00Z', authorName: 'Felipe', body: 'INTERNAL NOTE' }], exportedAt: '2026-10-19T14:00:00Z' });
  const lines = csv.replace('﻿', '').split('\r\n');
  assert.equal(lines[0], 'section,record,field,value');
  assert.ok(lines.includes('candidate,,name,Ana Souza') && lines.includes('candidate,,email,ana@x.com') && lines.includes('candidate,,job,Designer') && lines.includes('candidate,,applications,2'));
  assert.ok(lines.indexOf('application,1,resumeFile,old.pdf') < lines.indexOf('application,2,resumeFile,cv.pdf'), 'oldest application first');
  assert.ok(lines.includes('application,2,whyMovedToFailed,"Answered ""No"" to ""Right to work?"""'), 'the automatic-screening reason is included');
  assert.ok(lines.includes('details,2,phone,555'));
  assert.ok(lines.includes('answer,2.1,answer,Figma; Sketch') && lines.includes('answer,2.2,question,Years'));
  assert.equal(/teamComment|INTERNAL NOTE|Felipe/.test(csv), false, 'the team\'s internal comments are never part of the export');
  assert.equal(lines.some(line => /^application,1,whyMovedToFailed/.test(line)), false, 'empty values are left out');
});

test('the candidate panel offers Export data next to Delete candidate', () => {
  const ui = builder.slice(builder.indexOf('function mountCandidateDeletion('), builder.indexOf('function showApplicantDetails('));
  assert.ok(ui.includes('id="export-candidate">Export data</button>') && ui.includes('id="delete-candidate">Delete candidate</button>'));
  assert.equal(ui.includes('listApplicantComments'), false, 'the export does not even read the comments');
  assert.ok(ui.includes('candidateDataToCsv({ person, items: group.items'));
  assert.ok(ui.includes("'pathway-candidate-data-'"), 'the file name has no personal data');
});

test('the legal page explains the self-service data rights tools', () => {
  const html = read('legal.html');
  assert.ok(html.includes('<strong>download a copy of their data</strong>') && html.includes('never includes passwords'));
  assert.ok(html.includes('<strong>export the application data held about a candidate</strong>') && html.includes('<strong>delete a candidate</strong>'));
  assert.ok(html.includes('The employer can export or permanently delete your application data from within Pathway.'));
  assert.ok(html.includes('Candidates’ requests.') && html.includes('“Export data” button') && html.includes('“Delete candidate” button'));
  assert.ok(html.includes('(“Download my data”)') && html.includes('(“Export data”)'));
  assert.ok(html.includes('Version 2026-10-19-v7'));
});

test('internal comments stay inside Pathway: not in the database export, and the legal page says so', () => {
  const sql = read('supabase/migrations/20261019230000_export_my_data_without_comments.sql');
  assert.ok(sql.includes('create or replace function public.export_my_data()'));
  assert.equal(/commentsWritten|applicant_comments/.test(sql.replace(/^--.*$/gm, '')), false, 'the function no longer reads comments');
  assert.ok(sql.includes("'jobsCreated'") && sql.includes('u.id = v_uid'));
  const html = read('legal.html');
  assert.ok(html.includes('it leaves out the team’s internal comments and other people’s personal data'));
  assert.ok(html.includes('the team’s internal comments are not included, because they are internal notes of your workspace'));
  assert.equal(html.includes('including team comments'), false);
  const builder = read('builder.js');
  assert.equal(/'commentsWritten'|\bteamComment\b/.test(builder), false, 'no comment section in either CSV');
});
