const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('applicant rows are never directly writable by anon or authenticated clients', () => {
  const migration = read('supabase/migrations/20260926183321_applicants_private_resumes_and_statuses.sql');
  assert.match(migration, /alter table public\.applicants enable row level security/i);
  assert.match(migration, /revoke all on public\.applicants from anon, authenticated/i);
  assert.match(migration, /grant select on public\.applicants to authenticated/i);
  assert.match(migration, /grant update \(status\) on public\.applicants to authenticated/i);
  assert.match(migration, /workspace owners can read applicants/i);
  assert.match(migration, /workspace owners can update applicant status/i);
  assert.doesNotMatch(migration, /grant\s+insert\s+on\s+public\.applicants\s+to\s+anon/i);
});

test('resume bucket is private, file-limited, and supports only PDF, DOC, DOCX', () => {
  const migration = read('supabase/migrations/20260926183321_applicants_private_resumes_and_statuses.sql');
  assert.match(migration, /'applicant-resumes',[\s\S]*?false,[\s\S]*?10485760/);
  assert.match(migration, /application\/pdf/);
  assert.match(migration, /application\/msword/);
  assert.match(migration, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
  assert.match(migration, /workspace owners can view applicant resumes/i);
  assert.match(read('supabase/migrations/20260926183731_allow_workspace_resume_cleanup.sql'), /workspace owners can delete applicant resumes/i);
});

test('applicant board filters by workspace and optional flow and validates stage updates', () => {
  const backend = read('backend.js');
  assert.match(backend, /from\('applicants'\)[\s\S]*?eq\('workspace_id', workspaceId\)/);
  assert.match(backend, /if \(flowId\) query = query\.eq\('flow_id', flowId\)/);
  assert.match(backend, /new Set\(\['new', 'failed', 'promising', 'approved'\]\)/);
  assert.match(backend, /update\(\{ status \}\)/);
});

test('workspace UI includes search, flow filter, four Kanban stages, card drag/drop, and detail review', () => {
  const builder = read('builder.js');
  for (const text of ['Dashboard', 'Applicants', 'applicant-flow-filter', 'applicant-search', 'new', 'failed', 'promising', 'approved', 'dragstart', "dataTransfer.getData('text/plain')", 'showApplicantDetails', 'applicant-status-select', 'Preview PDF', 'Download resume', 'applicant-resume-preview', 'applicant-resume-frame']) {
    assert.ok(builder.includes(text), `missing expected applicants UI fragment: ${text}`);
  }
});

test('public application endpoint validates the active snapshot, branch answers, privacy notice, file type, size, and rate limit', () => {
  const edge = read('supabase/functions/applications/index.ts');
  for (const text of ['loadActiveFlow', 'active_published_flow_id', 'validateApplicantSubmission', 'privacyAcknowledged', 'MAX_RESUME_BYTES', 'consume_applicant_submission_limit', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']) {
    assert.ok(edge.includes(text), `missing intake protection: ${text}`);
  }
  assert.match(edge, /outcomeStatus:\s*current\.subtype === "disqualified" \? "failed" : "new"/);
  assert.match(edge, /published_flow_id:\s*active\.publication\.id/);
  assert.match(read('supabase/migrations/20260926185250_enforce_active_publication_on_applicant_insert.sql'), /applicants_require_active_publication/);
});

test('public endpoint does not expose a pending-upload or applicant insert path to the browser', () => {
  const edge = read('supabase/functions/applications/index.ts');
  const backend = read('backend.js');
  assert.match(edge, /admin\.storage\.from\(BUCKET\)\.upload\(resumePath, file/);
  assert.match(edge, /admin\.from\("applicants"\)\.insert\(/);
  assert.doesNotMatch(edge, /createSignedUploadUrl|pending_applicant_submissions/);
  assert.doesNotMatch(backend, /from\('applicants'\)\.insert\(/);
  assert.match(backend, /form\.set\('privacyAcknowledged'/);
  assert.match(backend, /form\.set\('resume', resume, resume\.name\)/);
});

test('flow deletion is authenticated, pauses intake, removes private files, then cascades application records', () => {
  const edge = read('supabase/functions/applications/index.ts');
  const deleteStart = edge.indexOf('async function deleteFlowForOwner');
  const deleteEnd = edge.indexOf('\nDeno.serve', deleteStart);
  const deletion = edge.slice(deleteStart, deleteEnd);
  assert.match(deletion, /admin\.auth\.getUser\(bearer\)/);
  assert.match(deletion, /publication_status: "draft", active_published_flow_id: null/);
  assert.ok(deletion.indexOf('.remove(paths.slice') < deletion.indexOf('.delete().eq("id", flowId)'));
  assert.match(read('builder.js'), /Permanent deletion\.<\/strong> Removing this job also deletes every application and private resume/);
});

test('live published form submits while builder preview remains non-persistent', () => {
  const candidate = read('candidate.js');
  assert.match(candidate, /const live = Boolean\(!options\.preview && options\.publishedFlowId/);
  assert.match(candidate, /if \(!live\) \{ renderComplete\(subtype, false\); return; \}/);
  assert.match(candidate, /window\.PathwayBackend\.submitApplication/);
  assert.match(candidate, /I have read and agree to this use of my application data/);
  assert.match(read('apply.html'), /mountCandidate\(root, flow, \{ publishedFlowId \}\)/);
});

test('Edge Function preflight uses a bodyless 204 response and allowlists the published Pages origin', () => {
  const edge = read('supabase/functions/applications/index.ts');
  assert.match(edge, /status === 204\s*\? new Response\(null, \{ status, headers \}\)/);
  assert.match(edge, /if \(req\.method === "OPTIONS"\) return response\(req, 204, \{\}\)/);
  assert.match(edge, /"https:\/\/soyfelps\.github\.io"/);
});

test('resume download reserves a browser tab during the click gesture and falls back to a short-lived secure link', () => {
  const builder = read('builder.js');
  const handlerStart = builder.indexOf("modalRoot.querySelector('#download-applicant-resume').addEventListener('click'");
  const handler = builder.slice(handlerStart, handlerStart + 1200);
  assert.ok(handler.indexOf("window.open('about:blank'") < handler.indexOf('await window.PathwayBackend.getApplicantResumeUrl'));
  assert.match(handler, /tab\.location\.replace\(url\)/);
  assert.match(handler, /navigator\.clipboard\.writeText\(url\)/);
});

test('PDF preview uses an inline signed URL while download remains a separate forced-download link', () => {
  const backend = read('backend.js');
  const helperStart = backend.indexOf('async function getApplicantResumeUrl');
  const helper = backend.slice(helperStart, helperStart + 700);
  assert.match(helper, /download\s*\?\s*await bucket\.createSignedUrl\(path, 120, \{ download: filename \|\| true \}\)/);
  assert.match(helper, /:\s*await bucket\.createSignedUrl\(path, 120\)/);
  const builder = read('builder.js');
  assert.match(builder, /applicant\.resume_content_type === 'application\/pdf'/);
  assert.match(builder, /previewFrame\.src = url/);
  assert.match(builder, /previewFrame\.removeAttribute\('src'\)/);
  assert.match(builder, /getApplicantResumeUrl\(applicant\.resume_path, true, applicant\.resume_filename/);
  assert.match(read('styles.css'), /\.applicant-resume-preview iframe\{[^}]*height:min\(70vh,760px\)/);
});

test('resume Storage policies qualify the object-path column to avoid workspace.name shadowing', () => {
  const migration = read('supabase/migrations/20260926191710_fix_applicant_resume_storage_policy_path.sql');
  assert.equal((migration.match(/storage\.foldername\(storage\.objects\.name\)/g) || []).length, 2);
  assert.doesNotMatch(migration, /storage\.foldername\(name\)/);
});
