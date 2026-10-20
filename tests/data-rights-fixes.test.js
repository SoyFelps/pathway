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

test('a person who leaves keeps their name on their comments and in the mentions of them', () => {
  const keep = read('supabase/migrations/20261019240000_keep_comment_author_names.sql');
  assert.ok(keep.includes('drop trigger if exists applicant_comments_anonymize_author on public.applicant_comments;') && keep.includes('drop function if exists public.anonymize_comment_author();'));
  assert.ok(keep.includes('drop trigger if exists profiles_scrub_mentions on public.profiles;') && keep.includes('drop function if exists public.scrub_deleted_user_mentions();'));
  assert.equal(/create (or replace )?(trigger|function)/i.test(keep.replace(/^--.*$/gm, '')), false, 'nothing new is created: names are simply left alone');
  const html = read('legal.html');
  assert.ok(html.includes('the internal comments they wrote stay in the workspace under their name, and so do @mentions of them in other comments'));
  assert.ok(html.includes('A former team member can ask the employer to anonymize those comments.'));
  assert.equal(html.includes('Former team member'), false, 'no more "Former team member" wording');
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
});
