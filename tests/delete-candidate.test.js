const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const fn = read('supabase/functions/applications/index.ts');
const builder = read('builder.js');
const part = fn.slice(fn.indexOf('async function deleteCandidate('), fn.indexOf('Deno.serve('));

test('the server deletes one candidate: files first, then records, then comments', () => {
  assert.ok(fn.includes('if (body.action === "deleteCandidate") return await deleteCandidate(req, body);'));
  assert.ok(part.includes('admin.auth.getUser(bearer)') && part.includes('Sign in to manage candidates.'));
  assert.ok(part.includes('workspace.owner_id !== auth.user.id') && part.includes('membership?.can_applicants') && part.includes('plan?.status === "active"'), 'owner, or a member with Applicants while the plan is active');
  assert.ok(part.includes('.eq("workspace_id", workspaceId).eq("flow_id", flowId).eq("candidate_email", email)'), 'only that job and that e-mail');
  const files = part.indexOf('admin.storage.from(BUCKET).remove('), rows = part.indexOf('admin.from("applicants").delete()'), comments = part.indexOf('admin.from("applicant_comments").delete()');
  assert.ok(files > 0 && files < rows && rows < comments, 'resume files, then applicant rows, then comments');
  assert.ok(part.includes('nothing was deleted. Try again.'), 'a file that cannot be removed stops everything');
  assert.ok(part.includes('startsWith(`${workspaceId}/`)'), 'only files inside the workspace folder');
});

test('the candidate panel has a Delete candidate button at the bottom that asks for a second click', () => {
  const backend = read('backend.js');
  assert.ok(backend.includes("callApplications({ action: 'deleteCandidate', flowId, email: String(email || '').trim().toLowerCase() }, session.access_token)"));
  assert.ok(backend.includes('deleteCandidate,'));
  assert.ok(builder.indexOf('id="applicant-comments-heading"') < builder.indexOf('id="applicant-delete-row"') && builder.indexOf('id="applicant-delete-row"') < builder.indexOf('class="applicant-mobile-bar"'), 'below the comments, at the end of the panel');
  assert.ok(builder.includes('mountCandidateDeletion(modalRoot, applicant.flow_id, person, group.count);'));
  const ui = builder.slice(builder.indexOf('function mountCandidateDeletion('), builder.indexOf('function showApplicantDetails('));
  assert.ok(ui.includes("Delete ' + esc(person.candidate_name) + ' permanently?") && ui.includes('This cannot be undone.') && ui.includes('Yes, delete'));
  assert.ok(ui.includes('window.PathwayBackend.deleteCandidate(flowId, email)'));
  assert.ok(ui.includes('applicants = applicants.filter(') && ui.includes('closeModal(); renderApplicantBoard(); showToast(\'Candidate deleted.\');'), 'the board updates at once');
});
