const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

const context = { console, TextEncoder, TextDecoder, CompressionStream, DecompressionStream, Blob, Response, Uint8Array, Set, Map, Date, Math, JSON, atob, btoa, localStorage: { getItem: () => null, setItem: () => {} } };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../pathway.js'), 'utf8'), context);
const Core = context.PathwayCore;

const application = (id, email, submittedAt, status = 'new', flow = 'flow-a', name = 'Joey Test') =>
  ({ id, flow_id: flow, candidate_email: email, candidate_name: name, submitted_at: submittedAt, status });

test('repeat applications from the same address to the same job form one candidate', () => {
  const groups = Core.groupApplicants([
    application('a1', 'joey@mail.com', '2026-10-06T10:00:00Z'),
    application('a2', 'JOEY@mail.com ', '2026-10-17T10:00:00Z'),
    application('a3', 'anne@mail.com', '2026-10-10T10:00:00Z'),
  ]);
  assert.equal(groups.length, 2);
  const joey = groups.find(group => group.latest.candidate_email.trim().toLowerCase() === 'joey@mail.com');
  assert.equal(joey.count, 2);
  assert.deepEqual(Array.from(joey.items, item => item.id), ['a2', 'a1'], 'newest application first');
  assert.equal(joey.latest.id, 'a2');
});

test('the same address applying to two different jobs stays two candidates', () => {
  const groups = Core.groupApplicants([
    application('a1', 'joey@mail.com', '2026-10-06T10:00:00Z', 'new', 'flow-a'),
    application('a2', 'joey@mail.com', '2026-10-07T10:00:00Z', 'new', 'flow-b'),
  ]);
  assert.equal(groups.length, 2);
  assert.ok(groups.every(group => group.count === 1));
});

test('a candidate takes the stage of the most recent application and groups are ordered newest first', () => {
  const groups = Core.groupApplicants([
    application('a1', 'joey@mail.com', '2026-10-06T10:00:00Z', 'promising'),
    application('a2', 'joey@mail.com', '2026-10-17T10:00:00Z', 'failed'),
    application('a3', 'anne@mail.com', '2026-10-12T10:00:00Z', 'approved'),
  ]);
  assert.deepEqual(Array.from(groups, group => group.latest.id), ['a2', 'a3']);
  assert.equal(groups[0].status, 'failed');
  assert.equal(groups[1].status, 'approved');
});

test('grouping copes with empty input, missing e-mail and unparseable dates', () => {
  assert.equal(Core.groupApplicants([]).length, 0);
  assert.equal(Core.groupApplicants(undefined).length, 0);
  const groups = Core.groupApplicants([
    application('a1', undefined, 'not a date'),
    application('a2', null, '2026-10-17T10:00:00Z'),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].latest.id, 'a2');
  assert.equal(Core.candidateKey({ flow_id: 'f', candidate_email: '  A@B.co ' }), 'f|a@b.co');
});

test('the board shows one card per candidate with an application count, and search covers every application', () => {
  const builder = read('builder.js');
  assert.ok(builder.includes('const allGroups = C.groupApplicants(applicants);'));
  assert.ok(builder.includes('group.items.some(applicant => {'), 'search looks at every application of a candidate');
  assert.ok(builder.includes("const cards = visible.filter(group => group.status === stage.key);"));
  assert.ok(builder.includes('class="repeat-chip"') && builder.includes('applications</span>'));
  assert.ok(builder.includes('const applicant = group.latest;'), 'the card shows the latest application');
  assert.equal(builder.split('class="applicant-card"').length - 1, 1, 'both the Failed column and the other columns use the same card markup');
  assert.ok(builder.includes('applicationTotal > visible.length'), 'the summary also reports the number of applications');
});

test('moving a card moves every application of that candidate in one request', () => {
  const builder = read('builder.js');
  const backend = read('backend.js');
  const move = builder.slice(builder.indexOf('async function moveApplicant('), builder.indexOf('function showApplicantDetails('));
  assert.ok(move.includes('members.map(member => member.id)'));
  assert.ok(move.includes('window.PathwayBackend.updateApplicantStatuses('));
  assert.ok(move.includes('if (updated.length !== members.length)'), 'a partial update is treated as a failure');
  assert.ok(move.includes('members.forEach((member, index) => { member.status = previous[index]; });'), 'a failure restores every application');
  assert.match(backend, /async function updateApplicantStatuses\(applicantIds, status\)[\s\S]*\.in\('id', applicantIds\)[\s\S]*\.select\('id,status,updated_at'\)/);
  assert.match(backend, /updateApplicantStatuses,\n/);
});

test('the detail panel shows one tab per application and one stage for the candidate', () => {
  const builder = read('builder.js');
  const details = builder.slice(builder.indexOf('function showApplicantDetails('), builder.indexOf('function showWorkspaceDetails('));
  assert.ok(details.includes('const group = C.groupApplicants(applicants)'));
  assert.ok(details.includes('role="tablist"') && details.includes('role="tab"') && details.includes('aria-selected='));
  assert.ok(details.includes("index === 0 ? 'Latest · ' : ''"), 'the newest application is labelled and first');
  assert.ok(details.includes('Applied ${group.count} times'));
  assert.ok(details.includes('Applies to all ${group.count} applications'));
  assert.ok(details.includes('group.status === stage.key'), 'the stage select shows the candidate\'s stage');
  assert.ok(details.includes('data-detail-tab="${tab}"'), 'the open tab survives a refresh of the panel');
  assert.ok(details.includes('getApplicantResumeUrl(applicant.resume_path'), 'resume actions use the selected application');
});

test('Clear all failed counts candidates and says how many applications go with them', () => {
  const builder = read('builder.js');
  const clear = builder.slice(builder.indexOf('function confirmClearFailedApplicants('), builder.indexOf('function formatApplicantDate('));
  assert.ok(clear.includes("C.groupApplicants(applicants).filter(group => group.status === 'failed')"));
  assert.ok(clear.includes('all ${applicationCount} applications and their uploaded resumes'));
});

test('a repeat application inherits the candidate\'s current stage, including Failed', () => {
  const source = read('supabase/functions/applications/index.ts');
  assert.match(source, /\.select\("status"\)\.eq\("flow_id", active\.flow\.id\)\.eq\("candidate_email", normalized\.email\)\s*\.order\("submitted_at", \{ ascending: false \}\)\.limit\(1\)/);
  assert.ok(source.includes('const inheritedStatus = previousApplications?.[0]?.status;'));
  assert.ok(source.includes('const initialStatus = typeof inheritedStatus === "string" && inheritedStatus ? inheritedStatus : normalized.outcomeStatus;'));
  assert.ok(source.includes('status: initialStatus,'), 'the new row is saved with the inherited stage');
  assert.equal(/inheritedStatus === ["']failed["']/.test(source), false, 'a Failed candidate is not moved back to New');
});
