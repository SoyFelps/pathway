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
    jobsCreated: [{ title: 'Designer' }, { title: 'Cook' }],
    commentsWritten: [{ text: 'Said "hi"\nsecond line' }, { text: '=HYPERLINK("http://x")' }]
  });
  const lines = csv.replace('﻿', '').split('\r\n');
  assert.equal(lines[0], 'section,record,field,value');
  assert.ok(csv.startsWith('﻿'), 'a byte-order mark so Excel reads accents correctly');
  assert.ok(lines.includes('account,,email,a@b.com'));
  assert.ok(lines.includes('profile,,lastName,Souza'));
  assert.ok(lines.includes('ownedWorkspace,,name,"Acme, Inc."'), 'commas are quoted');
  assert.ok(lines.includes('jobsCreated,2,title,Cook'), 'numbered records');
  assert.ok(csv.includes('commentsWritten,1,text,"Said ""hi""\nsecond line"'), 'quotes and line breaks are escaped');
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
