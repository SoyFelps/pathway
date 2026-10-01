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
  for (const text of ['Dashboard', 'Applicants', 'applicant-flow-filter', 'applicant-search', 'new', 'failed', 'promising', 'approved', 'dragstart', "dataTransfer.getData('text/plain')", 'showApplicantDetails', 'applicant-status-select', 'Preview resume', 'Download resume', 'applicant-review-layout', 'applicant-review-left', 'applicant-review-right', 'applicant-resume-preview', 'applicant-resume-frame']) {
    assert.ok(builder.includes(text), `missing expected applicants UI fragment: ${text}`);
  }
});

test('Applicants uses a people icon in navigation and its empty state', () => {
  const builder = read('builder.js');
  assert.match(builder, /applicants: '<svg[\s\S]*?<circle cx="9" cy="8"/);
  assert.match(builder, /data-route="applicants"[\s\S]*?\$\{ICONS\.applicants\}/);
  assert.match(builder, /class="applicant-empty-icon"[\s\S]*?\$\{ICONS\.applicants\}/);
  assert.doesNotMatch(builder, /♧/);
});

test('public application endpoint validates the active snapshot, branch answers, privacy notice, file type, size, and rate limit', () => {
  const edge = read('supabase/functions/applications/index.ts');
  for (const text of ['loadActiveFlow', 'active_published_flow_id', 'validateApplicantSubmission', 'privacyAcknowledged', 'MAX_RESUME_BYTES', 'consume_applicant_submission_limit', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']) {
    assert.ok(edge.includes(text), `missing intake protection: ${text}`);
  }
  assert.match(edge, /const NOTICE_VERSION = "2026-10-01-v1"/);
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

test('Applicants-only members receive job labels without opening full Flows data', () => {
  const edge = read('supabase/functions/applications/index.ts');
  const handlerStart = edge.indexOf('if (body.action === "listApplicantFlowLabels")');
  const handlerEnd = edge.indexOf('if (body.action === "deleteFlow")', handlerStart);
  const handler = edge.slice(handlerStart, handlerEnd);
  const backend = read('backend.js');
  const builder = read('builder.js');
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.match(handler, /admin\.auth\.getUser\(bearer\)/);
  assert.match(handler, /membership\?\.can_applicants/);
  assert.match(handler, /workspace_subscriptions/);
  assert.match(handler, /select\("id,job_title,company_name"\)/);
  assert.doesNotMatch(handler, /flow_data|snapshot|responses|resume_path/);
  assert.match(backend, /listApplicantFlowLabels/);
  assert.match(builder, /applicantFlowLabels = await window\.PathwayBackend\.listApplicantFlowLabels\(\)/);
  assert.match(builder, /applicantFlowLabels\.find\(item => item\.cloudId === applicant\.flow_id\)/);
});

test('live published form submits while builder preview remains non-persistent', () => {
  const candidate = read('candidate.js');
  assert.match(candidate, /const live = Boolean\(!options\.preview && options\.publishedFlowId/);
  assert.match(candidate, /if \(!live\) \{ renderComplete\(\); return; \}/);
  assert.match(candidate, /window\.PathwayBackend\.submitApplication/);
  const notice = 'By submitting, you allow the company to use your information and answers to review your application';
  assert.ok(candidate.indexOf('Apply for this role') >= 0 && candidate.indexOf(notice) > candidate.indexOf('Apply for this role'));
  assert.doesNotMatch(candidate, /candidate-privacy-copy|privacy-consent|How your information is used|I have read and agree|name="privacyAcknowledged"/);
  assert.match(candidate, /if \(live\) state\.info\.privacyAcknowledged = true/);
  assert.match(candidate, /Preview mode · Your details are not uploaded or stored/);
  assert.match(read('apply.html'), /candidate\.js\?v=completion-return-20261001/);
  assert.match(read('index.html'), /candidate\.js\?v=completion-return-20261001/);
  assert.match(read('apply.html'), /styles\.css\?v=flow-publish-20261001/);
  assert.match(read('index.html'), /styles\.css\?v=flow-publish-20261001/);
  assert.match(read('apply.html'), /backend\.js\?v=flow-publish-20261001/);
  assert.match(read('apply.html'), /mountCandidate\(root, flow, \{ publishedFlowId \}\)/);
});

test('all live outcomes share a neutral submission screen with a working job-details return and clipboard share', () => {
  const candidate = read('candidate.js');
  const start = candidate.indexOf('function renderComplete()');
  const end = candidate.indexOf('\n    function complete(', start);
  const completion = candidate.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(completion, /const title = isPreview \? 'Preview complete' : 'Application submitted\.'/);
  assert.doesNotMatch(completion, /disqualif|accepted|subtype/i);
  assert.match(completion, /Your application has been received by/);
  assert.match(completion, /const vacancyUrl = window\.location\.href/);
  assert.match(completion, /<button class="btn btn-primary" id="finish-link" type="button">Done<\/button>/);
  assert.doesNotMatch(completion, /href="\$\{C\.esc\(vacancyUrl\)\}"/);
  assert.match(completion, /else returnToStart\(\)/);
  const resetStart = candidate.slice(candidate.indexOf('function returnToStart()'), candidate.indexOf('\n    async function copyJobLink'));
  assert.match(resetStart, /state\.screen = 'landing'/);
  assert.match(resetStart, /state\.current = start/);
  assert.match(resetStart, /state\.answers = \{\}/);
  assert.match(resetStart, /state\.submissionKey = crypto\.randomUUID\(\)/);
  assert.match(resetStart, /render\(\)/);
  assert.match(completion, /id="share-job"[\s\S]*?Share this job/);
  assert.doesNotMatch(completion, /Your application and resume are stored in this job/);
  assert.match(candidate, /navigator\.clipboard[\s\S]*?writeText\(url\)/);
  assert.match(candidate, /document\.execCommand\('copy'\)/);
  assert.match(completion, /Preview only · Your details and answers were not stored or sent to the company/);
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
  assert.match(builder, /const isPdf = applicant\.resume_content_type === 'application\/pdf'/);
  assert.match(builder, /previewFrame\.src = url/);
  assert.match(builder, /previewFrame\.removeAttribute\('src'\)/);
  assert.match(builder, /getApplicantResumeUrl\(applicant\.resume_path, true, filename\)/);
  assert.match(builder, /Preview resume/);
  assert.match(builder, /if \(previewButton\) void loadPreview\(\)/);
  assert.match(builder, /'▧ &nbsp;Hide preview'/);
  assert.match(read('styles.css'), /\.applicant-review-layout\{display:grid;grid-template-columns:minmax\(390px/);
  assert.match(read('styles.css'), /\.applicant-review-right \.applicant-resume-preview iframe\{flex:1/);
  assert.match(read('styles.css'), /@media\(max-width:760px\)\{\s*\.applicant-review-layout\{grid-template-columns:minmax\(0,1fr\)/);
});

test('resume Storage policies qualify the object-path column to avoid workspace.name shadowing', () => {
  const migration = read('supabase/migrations/20260926191710_fix_applicant_resume_storage_policy_path.sql');
  assert.equal((migration.match(/storage\.foldername\(storage\.objects\.name\)/g) || []).length, 2);
  assert.doesNotMatch(migration, /storage\.foldername\(name\)/);
});

test('dashboard shows new applicant and published-flow counts without loading applicant details', () => {
  const backend = read('backend.js');
  const builder = read('builder.js');
  const css = read('styles.css');
  assert.match(backend, /async function countNewApplicants\(workspaceId\)[\s\S]*select\('id', \{ count: 'exact', head: true \}\)[\s\S]*eq\('workspace_id', workspaceId\)[\s\S]*eq\('status', 'new'\)/);
  assert.match(backend, /countNewApplicants,/);
  const dashboardStart = builder.indexOf('function renderDashboard()');
  const dashboardEnd = builder.indexOf('async function renderApplicants()', dashboardStart);
  const dashboard = builder.slice(dashboardStart, dashboardEnd);
  assert.ok(dashboardStart >= 0 && dashboardEnd > dashboardStart);
  assert.match(dashboard, /id="dashboard-new-applicant-count"/);
  assert.match(dashboard, /<span>New applicants<\/span>/);
  assert.match(dashboard, /<span>Published flows<\/span>/);
  assert.match(dashboard, /if \(hasPermission\('applicants'\)\) void loadDashboardNewApplicantCount/);
  assert.doesNotMatch(dashboard, /Steps in your journeys|Saved to Supabase/);
  assert.match(css, /\.draft-tag\{color:#647789\}\.draft-tag \.status-dot\{background:#8395a5/);
  assert.match(css, /\.published-tag \.status-dot\{background:#4f865d/);
});
