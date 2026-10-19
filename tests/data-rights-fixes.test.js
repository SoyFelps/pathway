const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const sql = read('supabase/migrations/20261019220000_data_rights_fixes.sql');

test('"Download my data" only includes workspace content the person can still reach (history: comments were included before 2026-10-19 evening)', () => {
  assert.ok(sql.includes("where f.created_by = v_uid and public.workspace_user_has_permission(f.workspace_id, 'flows')"), 'jobs: only where they still manage jobs');
  assert.ok(sql.includes("where c.author_id = v_uid and public.workspace_user_has_permission(c.workspace_id, 'applicants')"), 'comments: only where they can still review candidates');
  assert.ok(sql.includes('v_uid uuid := auth.uid();') && sql.includes('u.id = v_uid'), 'still only the caller\'s own account data');
  assert.equal(/encrypted_password|candidate_email|member_email/.test(sql), false);
  assert.match(sql, /grant execute on function public\.anonymize_comment_author\(\) to service_role;/);
  assert.equal(/to anon|to authenticated/.test(sql.replace(/^--.*$/gm, '')), false, 'the new trigger functions are not callable from the app');
});

test('deleting an account anonymizes the name on their comments and removes them from the mention lists', () => {
  assert.ok(sql.includes("if old.author_id is not null and new.author_id is null then\n    new.author_name := 'Former team member';"));
  assert.ok(sql.includes('before update of author_id on public.applicant_comments'));
  assert.ok(sql.includes("where m ->> 'userId' <> old.user_id::text") && sql.includes('after delete on public.profiles'));
});

test('"Clear all failed" also removes the team comments about the deleted candidates', () => {
  const fn = read('supabase/functions/applications/index.ts');
  const part = fn.slice(fn.indexOf('async function deleteFailedApplicants('), fn.indexOf('async function deleteCandidate('));
  assert.ok(part.includes('.select("id,resume_path,flow_id,candidate_email")'));
  assert.ok(part.includes('admin.from("applicant_comments").delete()'));
  assert.ok(part.includes('stillThere') && part.includes('goneEmails'), 'a candidate that still has another application keeps their comments');
  assert.ok(part.indexOf('admin.storage.from(BUCKET).remove(paths)') < part.indexOf('admin.from("applicants").delete()') && part.indexOf('admin.from("applicants").delete()') < part.indexOf('admin.from("applicant_comments").delete()'), 'files, then records, then comments');
});

test('the CSV files explain the apostrophe added to values that start with + - = @', () => {
  const builder = read('builder.js');
  assert.equal((builder.match(/A leading apostrophe on a value \(for example a phone number starting with \+\)/g) || []).length, 2, 'both exports carry the note');
  assert.ok(read('legal.html').includes('replaced by “Former team member”'));
});
