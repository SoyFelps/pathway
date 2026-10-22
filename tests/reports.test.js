const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const sql = read('supabase/migrations/20261020210000_reports.sql');

test('"Reports" is a team permission: on by default, in invitations, members, the team function and exports', () => {
  assert.match(sql, /alter table public\.workspace_members add column if not exists can_view_reports boolean not null default true/);
  assert.match(sql, /alter table public\.workspace_invitations add column if not exists can_view_reports boolean not null default true/);
  assert.match(sql, /when 'reports' then m\.can_view_reports/);
  assert.match(sql, /p_can_view_reports boolean default true/);
  assert.match(sql, /p_can_view_reports boolean default null/);
  assert.match(sql, /can_view_reports = coalesce\(p_can_view_reports, can_view_reports\)/);
  assert.match(sql, /can_customize_stages, can_view_reports, invited_by/);
  assert.match(sql, /invitation\.can_customize_stages, invitation\.can_view_reports, invitation\.invited_by/);
  assert.match(sql, /'canViewReports', m\.can_view_reports/);
  assert.match(sql, /grant execute on function public\.create_team_invitation\(uuid, text, text, text, boolean, boolean, boolean, boolean, boolean\) to authenticated, service_role/);
  assert.match(sql, /grant execute on function public\.update_team_member_permissions\(uuid, uuid, boolean, boolean, boolean, boolean, boolean\) to authenticated, service_role/);
  assert.match(sql, /drop function if exists public\.create_team_invitation\(uuid, text, text, text, boolean, boolean, boolean, boolean\)/);
  assert.match(sql, /drop function if exists public\.update_team_member_permissions\(uuid, uuid, boolean, boolean, boolean, boolean\)/);
  const edge = read('supabase/functions/team/index.ts');
  assert.match(edge, /can_view_reports: permissions\.reports !== false/);
  assert.match(edge, /p_can_view_reports: permissions\.can_view_reports/);
  assert.match(edge, /p_can_view_reports: p\.can_view_reports/);
  assert.match(edge, /can_view_reports: p\.can_view_reports,\s*\}\)\.eq\("id", invitationId\)/);
  assert.equal((edge.match(/can_customize_stages,can_view_reports/g) || []).length >= 3, true, 'members and invitations are read with the new column');
  assert.match(read('backend.js'), /can_view_reports: row\.can_view_reports/);
});

test('the report function checks the Reports permission itself and returns aggregated numbers only', () => {
  const start = sql.indexOf('create or replace function public.get_workspace_report');
  assert.ok(start > 0);
  const fn = sql.slice(start);
  assert.match(fn, /security definer/);
  assert.match(fn, /set search_path to ''/);
  assert.match(fn, /auth\.uid\(\) is null or not public\.workspace_user_has_permission\(p_workspace_id, 'reports'\)/);
  assert.match(fn, /raise exception 'You do not have permission to view the reports\.'/);
  assert.match(fn, /a\.workspace_id = p_workspace_id/);
  assert.match(fn, /f\.id = p_flow_id and f\.workspace_id = p_workspace_id/, 'a job filter must belong to the workspace');
  assert.doesNotMatch(fn, /candidate_name|candidate_info|resume_|responses/, 'no personal data is read for the report');
  assert.doesNotMatch(fn, /'(email|name|candidate_email)'/, 'no name or e-mail is returned');
  assert.match(fn, /revoke all on function public\.get_workspace_report\(uuid, date, date, uuid\) from public, anon, authenticated/);
  assert.match(fn, /grant execute on function public\.get_workspace_report\(uuid, date, date, uuid\) to authenticated, service_role/);
});

test('candidates are counted once per job and e-mail address, and the date range is capped', () => {
  assert.match(sql, /group by ap\.flow_id, ap\.email/);
  assert.match(sql, /lower\(btrim\(a\.candidate_email\)\)/);
  assert.match(sql, /'applications', \(select count\(\*\) from apps_in\)/);
  assert.match(sql, /if v_to - v_from > 730 then v_from := v_to - 730; end if;/);
  assert.match(sql, /v_to := least\(coalesce\(p_to, v_today\), v_today\)/);
  assert.match(sql, /'funnelApplications'/, 'the completion rate only compares days that the page counters covered');
  assert.match(sql, /h\.kind <> 'backfill'/, 'approximate backfill history is not reported as real history');
});

test('the migration adds no table, so no new grants are needed', () => {
  assert.doesNotMatch(sql, /create table/i);
});

test('the Reports page is in the sidebar for people with the permission and opens from the URL', () => {
  const builder = read('builder.js');
  assert.match(builder, /hasPermission\('view_reports'\) \? `<button class="sidebar-link \$\{active === 'reports' \? 'active' : ''\}" data-route="reports">/);
  assert.match(builder, /root\.querySelector\('\[data-route="reports"\]'\)\?\.addEventListener\('click', \(\) => \{ void renderReports\(\); \}\)/);
  assert.match(builder, /requestedPage === 'reports'\) void renderReports\(\)/);
  assert.match(builder, /if \(!hasPermission\('view_reports'\)\) return renderAccessMessage\('view_reports'\)/);
  assert.match(builder, /section === 'view_reports' \? 'Reports'/);
  const backend = read('backend.js');
  assert.match(backend, /client\.rpc\('get_workspace_report'/);
  assert.match(backend, /getWorkspaceReport,/);
});

test('My Team lets managers choose the Reports permission for members and invitations', () => {
  const builder = read('builder.js');
  assert.match(builder, /data-permission="reports"/);
  assert.match(builder, /data-invite-permission="reports" checked/);
  assert.match(builder, /p\.can_view_reports && 'Reports'/);
});

test('the page offers period and job filters, the four summary numbers, the chart, the funnel and a CSV export', () => {
  const builder = read('builder.js');
  ['7 days', '30 days', '90 days', 'All time'].forEach(label => assert.ok(builder.includes(label), label));
  ['Page visits', 'Started applying', 'New candidates', 'Completion rate', 'Applications over time', 'Application funnel', 'Where candidates are now', 'Automatic screening'].forEach(label => assert.ok(builder.includes(label), label));
  assert.match(builder, /id="report-export"/);
  assert.match(builder, /downloadTextFile\('pathway-report-'/);
  assert.match(builder, /can be inflated by anyone who knows the job link/);
  assert.match(builder, /if \(!hasPermission\('view_reports'\)\)/);
});

test('report CSV cells are protected against spreadsheet formulas (same helper as the other exports)', () => {
  const builder = read('builder.js');
  assert.match(builder, /function reportToCsv\(data, scopeLabel, jobRows\)/);
  assert.match(builder, /return rowsToCsv\(rows\);\s*\}\s*function paintReport/);
  assert.match(builder, /\/\^\[=\+\\-@\\t\\r\]\/\.test\(text\)/);
});

test('report text coming from the database is escaped before it reaches the page', () => {
  const builder = read('builder.js');
  const start = builder.indexOf('// ---- Reports');
  const end = builder.indexOf('function formatPlanDate');
  const code = builder.slice(start, end);
  assert.match(code, /esc\(item\.reason\)/, 'auto-fail reasons contain text typed by employers');
  assert.match(code, /esc\(job\.title \|\| 'Untitled role'\)/);
  assert.match(code, /esc\(job\.company \|\| ''\)/);
  assert.match(code, /esc\(reportStageLabel\(item\.status\)\)/, 'custom column names are escaped');
});

test('the Reports styles exist and the changed files carry a new cache version', () => {
  const css = read('styles.css');
  ['.reports-page', '.rpt-stats', '.rpt-chart', '.rpt-table'].forEach(selector => assert.ok(css.includes(selector), selector));
  assert.match(read('index.html'), /builder\.js\?v=canvas6-20261022/);
  assert.match(read('index.html'), /backend\.js\?v=canvas6-20261022/);
  assert.match(read('index.html'), /styles\.css\?v=canvas6-20261022/);
});

const scaling = read('supabase/migrations/20261020230000_report_scaling_and_step_counts.sql');

test('the step counters are anonymous, closed to the app roles and only accept steps of the published form', () => {
  assert.match(scaling, /create table public\.job_step_counts/);
  assert.match(scaling, /alter table public\.job_step_counts enable row level security/);
  assert.match(scaling, /revoke all on public\.job_step_counts from public, anon, authenticated/);
  assert.match(scaling, /grant all on public\.job_step_counts to service_role/);
  assert.doesNotMatch(scaling, /grant select on public\.job_step_counts/, 'only the report functions read the counters');
  const table = scaling.slice(scaling.indexOf("create table public.job_step_counts"), scaling.indexOf(");", scaling.indexOf("create table public.job_step_counts")));
  assert.doesNotMatch(table, /email|name|ip_|address|agent|cookie|user_id/i, "a step counter row holds no person, only job, day, step and a number");
  const fn = scaling.slice(scaling.indexOf('create or replace function public.record_job_step'), scaling.indexOf('drop function if exists public.get_workspace_report'));
  assert.match(fn, /security definer/);
  assert.match(fn, /set search_path to ''/);
  assert.match(fn, /char_length\(p_node_id\) not between 1 and 80/);
  assert.match(fn, /f\.publication_status = 'published'/);
  assert.match(fn, /f\.active_published_flow_id = pf\.id/);
  assert.match(fn, /n ->> 'type' in \('shortText', 'singleChoice', 'multiChoice'\)/, 'only the first page and questions can be counted');
  assert.match(fn, /p_node_id = 'details'/);
  assert.match(fn, /revoke all on function public\.record_job_step\(uuid, text\) from public, anon, authenticated/);
  assert.match(fn, /grant execute on function public\.record_job_step\(uuid, text\) to service_role/);
});

test('the overview report no longer lists jobs (they were capped at 100) and has a company filter', () => {
  const overview = scaling.slice(scaling.indexOf('create or replace function public.get_workspace_report'), scaling.indexOf('create or replace function public.get_report_jobs'));
  assert.doesNotMatch(overview, /'jobs',/, 'the list of jobs now comes from get_report_jobs');
  assert.doesNotMatch(overview, /limit 100/);
  assert.match(overview, /p_company text default null/);
  assert.match(overview, /if p_company = 'none' then v_no_company := true;/);
  assert.match(overview, /raise exception 'This company could not be found\.'/);
  assert.match(overview, /f\.workspace_id = p_workspace_id/);
  assert.match(overview, /'jobCount'/);
  assert.match(overview, /'selectedJob'/);
  assert.match(overview, /'companies'/);
  assert.match(overview, /'autoFailGroups', case when p_flow_id is null then '\[\]'::jsonb/, 'the reasons are listed only for one job');
  assert.match(scaling, /drop function if exists public\.get_workspace_report\(uuid, date, date, uuid\);/);
  assert.match(overview, /grant execute on function public\.get_workspace_report\(uuid, date, date, uuid, text\) to authenticated, service_role/);
});

test('the jobs list is paged, searchable and sortable in the database, with no cap', () => {
  const jobs = scaling.slice(scaling.indexOf('create or replace function public.get_report_jobs'));
  assert.match(jobs, /auth\.uid\(\) is null or not public\.workspace_user_has_permission\(p_workspace_id, 'reports'\)/);
  assert.match(jobs, /v_limit := greatest\(1, least\(coalesce\(p_limit, 10\), 50\)\)/);
  assert.match(jobs, /v_offset := greatest\(0, coalesce\(p_offset, 0\)\)/);
  assert.match(jobs, /p_sort in \('candidates', 'visits', 'completion', 'autofail'\)/);
  assert.match(jobs, /position\(v_search in lower\(f\.job_title\)\) > 0/, 'search is a plain text match, not a pattern');
  assert.match(jobs, /'total', \(select count\(\*\) from jobs\)/);
  assert.match(jobs, /r\.rn > v_offset and r\.rn <= v_offset \+ v_limit/);
  assert.doesNotMatch(jobs, /candidate_name|candidate_info|resume_|responses/);
  assert.match(jobs, /grant execute on function public\.get_report_jobs\(uuid, date, date, text, text, text, integer, integer\) to authenticated, service_role/);
  assert.match(jobs, /revoke all on function public\.get_report_jobs\(uuid, date, date, text, text, text, integer, integer\) from public, anon, authenticated/);
  assert.match(read('backend.js'), /client\.rpc\('get_report_jobs'/);
});

test('the Reports page lists jobs ten at a time with search and sorting, and keeps the job chooser short', () => {
  const builder = read('builder.js');
  assert.match(builder, /const REPORT_JOBS_PAGE = 10;/);
  assert.match(builder, /id="rpt-jobs-more"/);
  assert.match(builder, /'Show ' \+ Math\.min\(REPORT_JOBS_PAGE, remaining\) \+ ' more'/);
  ['Most candidates', 'Most visits', 'Best completion rate', 'Highest auto-fail rate'].forEach(label => assert.ok(builder.includes(label), label));
  assert.match(builder, /id="rpt-jobs-search"/);
  assert.match(builder, /<th scope="col">Auto-fail<\/th>/);
  assert.match(builder, /function mountReportPicker\(\)/);
  assert.match(builder, /limit: 8, offset: 0/, 'the chooser asks for a short list and a search, never every job');
  assert.match(builder, /id="report-company"/);
  assert.match(builder, /for \(let offset = 0; offset < 2000; offset \+= 50\)/, 'the CSV contains every job, not only the page on screen');
});

test('the auto-fail reasons are listed only for one job, grouped by question', () => {
  const builder = read('builder.js');
  assert.match(builder, /if \(!data\.selectedJob\) return lead \+ '<p class="rpt-note">Every job has its own form/);
  assert.match(builder, /rpt-af-group/);
  assert.match(builder, /esc\(group\.question\)/, 'question labels are typed by employers and must be escaped');
  assert.match(builder, /esc\(item\.reason\)/);
});

const stepsSql = read('supabase/migrations/20261021100000_report_steps.sql');
test('the steps function is checked, aggregated and tied to one job of the workspace', () => {
  assert.match(stepsSql, /auth\.uid\(\) is null or not public\.workspace_user_has_permission\(p_workspace_id, 'reports'\)/);
  assert.match(stepsSql, /security definer/);
  assert.match(stepsSql, /set search_path to ''/);
  assert.match(stepsSql, /f\.id = p_flow_id and f\.workspace_id = p_workspace_id/);
  assert.doesNotMatch(stepsSql.replace(/--[^\n]*/g, ''), /candidate_name|candidate_email|candidate_info|resume_|'answer'/, 'no person and no answer text is read');
  assert.match(stepsSql, /a\.responses -> \(jsonb_array_length\(a\.responses\) - 1\) ->> 'nodeId'/, 'completions come from the last question answered');
  assert.match(stepsSql, /greatest\(coalesce\(p_from, v_since\), v_since\)/, 'the window never starts before the step counters');
  assert.match(stepsSql, /order by \(pf\.id = v_active\) desc, pf\.created_at desc/, 'the form candidates see now, or the last published one');
  assert.match(stepsSql, /revoke all on function public\.get_report_steps\(uuid, uuid, date, date\) from public, anon, authenticated/);
  assert.match(stepsSql, /grant execute on function public\.get_report_steps\(uuid, uuid, date, date\) to authenticated, service_role/);
  assert.doesNotMatch(stepsSql, /create table/i);
  assert.match(read('backend.js'), /client\.rpc\('get_report_steps'/);
});


test('the intake function and the candidate page count each step once per visit and connection, best effort', () => {
  const edge = read('supabase/functions/applications/index.ts');
  assert.match(edge, /event === "step"/);
  assert.match(edge, /cleanName\(body\.nodeId, 80\)/);
  assert.match(edge, /cleanName\(body\.fromNodeId, 80\)/);
  assert.match(edge, /admin\.rpc\("record_job_step", \{ p_published_flow_id: publishedId, p_node_id: nodeId, p_from_node_id: fromNodeId \|\| null \}\)/);
  const candidate = read('candidate.js');
  assert.match(candidate, /const reachedSteps = new Set\(\)/);
  assert.match(candidate, /const key = fromNodeId \+ '>' \+ nodeId;\s*if \(reachedSteps\.has\(key\)\) return;/, 'going back and forth never counts twice');
  assert.match(candidate, /trackJobEvent\(options\.publishedFlowId, 'step', nodeId, fromNodeId\)/);
  assert.match(candidate, /trackStep\('details', 'start'\)/);
  assert.match(candidate, /trackStep\(node\.id, state\.history\.length \? state\.history\[state\.history\.length - 1\]\.node\.id : 'details'\)/, 'a question says which step the visit came from');
  assert.match(candidate, /let trackStep = \(\) => \{\};/, 'previews and failures never count or break the page');
  const backend = read('backend.js');
  assert.match(backend, /function trackJobEvent\(publishedFlowId, event, nodeId, fromNodeId\)/);
  assert.match(backend, /\.\.\.\(fromNodeId \? \{ fromNodeId: String\(fromNodeId\) \} : \{\}\)/);
});

const transitionsSql = read('supabase/migrations/20261021120000_step_transitions.sql');
test('step counters remember where the visit came from and only accept real connections of the published form', () => {
  assert.match(transitionsSql, /add column from_node_id text not null default '' check \(char_length\(from_node_id\) <= 80\)/);
  assert.match(transitionsSql, /add primary key \(flow_id, day, node_id, from_node_id\)/);
  assert.match(transitionsSql, /drop function if exists public\.record_job_step\(uuid, text\)/);
  const fn = transitionsSql.slice(transitionsSql.indexOf('create or replace function public.record_job_step'), transitionsSql.indexOf('create or replace function public.get_report_steps'));
  assert.match(fn, /security definer/);
  assert.match(fn, /set search_path to ''/);
  assert.match(fn, /v_from := coalesce\(p_from_node_id, case when p_node_id = 'details' then 'start' end\)/);
  assert.match(fn, /if v_from is null then return false; end if;/, 'a question without origin is refused');
  assert.match(fn, /if v_from <> 'start' then return false; end if;/);
  assert.match(fn, /i ->> 'type' = 'candidateInfo'/, 'the first questions are those the first page connects to');
  assert.match(fn, /e ->> 'fromNodeId' = v_from and e ->> 'toNodeId' = p_node_id/, 'question to question only along a real edge');
  assert.match(fn, /n ->> 'type' in \('shortText', 'singleChoice', 'multiChoice'\)/);
  assert.match(fn, /revoke all on function public\.record_job_step\(uuid, text, text\) from public, anon, authenticated/);
  assert.match(fn, /grant execute on function public\.record_job_step\(uuid, text, text\) to service_role/);
  assert.doesNotMatch(transitionsSql, /grant select on public\.job_step_counts/);
  const steps = transitionsSql.slice(transitionsSql.indexOf('create or replace function public.get_report_steps'));
  assert.match(steps, /auth\.uid\(\) is null or not public\.workspace_user_has_permission\(p_workspace_id, 'reports'\)/);
  assert.match(steps, /c\.from_node_id <> ''/, 'counters written before origins existed are ignored');
  assert.match(steps, /v_since := greatest\(v_new, coalesce\(v_legacy \+ 1, v_new\)\)/, 'the window starts after the last day that has old-style counters');
  assert.match(steps, /if v_since > v_to then return jsonb_build_object\('hasData', false\)/);
  assert.match(steps, /'transitions'/);
  assert.doesNotMatch(steps.replace(/--[^\n]*/g, ''), /candidate_name|candidate_email|candidate_info|resume_|'answer'/);
  assert.match(steps, /grant execute on function public\.get_report_steps\(uuid, uuid, date, date\) to authenticated, service_role/);
  assert.match(read('backend.js'), /data\.transitions/, 'the page validates the new shape');
});

const vm = require('node:vm');
function loadStepsModel() {
  const builder = read('builder.js');
  const start = builder.indexOf('const REPORT_STEP_MIN_SAMPLE');
  const end = builder.indexOf('function reportStepsHtml');
  assert.ok(start > 0 && end > start, 'the steps model is in builder.js');
  const context = vm.createContext({});
  vm.runInContext(builder.slice(start, end) + '\nthis.reportStepsModel = reportStepsModel;', context);
  return raw => JSON.parse(JSON.stringify(context.reportStepsModel(raw)));
}
const node = (id, type, label = id, subtype) => ({ id, type, label, subtype });
const edge = (from, to, option = null) => ({ from, to, option });

test('the drop-off block appears inside Reports only when a job is chosen, and is part of the CSV', () => {
  const builder = read('builder.js');
  assert.match(builder, /\(data\.selectedJob \? '<section class="rpt-card"><div class="rpt-card-head"><div><h2>Where candidates drop off<\/h2>/);
  assert.match(builder, /if \(data\.selectedJob\) void loadReportSteps\(\);/);
  assert.match(builder, /id="rpt-steps-body"/);
  assert.match(builder, /block\('Where candidates drop off'/);
  assert.match(builder, /reportSteps = null; reportStepsRequestId \+= 1;/, 'steps of another job are never reused');
  assert.match(builder, /esc\(row\.label\)/, 'question labels are typed by employers and must be escaped');
  assert.doesNotMatch(builder, /row\.hint|--lvl/, 'no "If Qn" legend and no indentation: a plain list of questions');
  assert.match(builder, /rpt-step-num/);
});

test('steps of a straight form: who got to each step, who stopped there, and the biggest drop', () => {
  const model = loadStepsModel()({
    hasData: true, views: 400, starts: 200, submitted: 50,
    nodes: [node('info', 'candidateInfo'), node('q1', 'singleChoice', 'Q one'), node('q2', 'shortText', 'Q two'), node('end', 'end')],
    edges: [edge('info', 'q1'), edge('q1', 'q2', 'Yes'), edge('q1', 'q2', 'No'), edge('q2', 'end')],
    transitions: { 'start>details': 100, 'details>q1': 90, 'q1>q2': 70 }, completions: { q2: 50 }
  });
  const byLabel = Object.fromEntries(model.rows.map(row => [row.label, row]));
  assert.equal(byLabel['Opened the job page'].left, 200);
  assert.equal(byLabel['Started the first page'].left, 100);
  assert.equal(byLabel['Completed the first page'].left, 10);
  assert.equal(byLabel['Q one'].left, 20, '90 reached it, 70 saw the next question');
  assert.equal(byLabel['Q two'].left, 20, '70 reached it, 50 submitted');
  assert.equal(byLabel['Submitted an application'].reached, 50);
  assert.equal(model.top.label, 'Started the first page', 'visitors who never start are not the biggest drop; the first page is (50%)');
  assert.deepEqual(model.rows.filter(row => row.kind === 'question').map(row => row.number), [1, 2]);
});

test('paths that branch and meet again: every drop is exact (counting only "reached" would hide the drops)', () => {
  // Q1 (100 arrive): 57 answer Yes -> Q2, 38 answer No -> straight to Q3, 5 stop. Q2: 50 go on to Q3, 7 stop. Q3 receives 38 + 50.
  const model = loadStepsModel()({
    hasData: true, views: 900, starts: 400, submitted: 80,
    nodes: [node('info', 'candidateInfo'), node('q1', 'singleChoice', 'Degree?'), node('q2', 'shortText', 'Which degree?'), node('q3', 'shortText', 'Why us?'), node('end', 'end')],
    edges: [edge('info', 'q1'), edge('q1', 'q2', 'Yes'), edge('q1', 'q3', 'No'), edge('q2', 'q3'), edge('q3', 'end')],
    transitions: { 'start>details': 110, 'details>q1': 100, 'q1>q2': 57, 'q1>q3': 38, 'q2>q3': 50 }, completions: { q3: 80 }
  });
  const row = label => model.rows.find(item => item.label === label);
  assert.equal(row('Degree?').left, 5);
  assert.equal(row('Which degree?').left, 7);
  assert.equal(row('Why us?').reached, 88);
  assert.equal(row('Why us?').left, 8, '88 arrived, 80 submitted');
  assert.deepEqual(model.rows.filter(item => item.kind === 'question').map(item => item.label), ['Degree?', 'Which degree?', 'Why us?'], 'the question where the paths meet comes after the branch');
});

test('every path stays together, and a long chain inside a branch keeps its indentation', () => {
  // Q1: Yes -> A1 -> A2 -> M ; No -> B1 -> M ; M -> end
  const model = loadStepsModel()({
    hasData: true, views: 500, starts: 300, submitted: 60,
    nodes: [node('info', 'candidateInfo'), node('q1', 'singleChoice', 'Q1'), node('a1', 'shortText', 'A1'), node('a2', 'shortText', 'A2'), node('b1', 'shortText', 'B1'), node('m', 'shortText', 'M'), node('end', 'end')],
    edges: [edge('info', 'q1'), edge('q1', 'a1', 'Yes'), edge('q1', 'b1', 'No'), edge('a1', 'a2'), edge('a2', 'm'), edge('b1', 'm'), edge('m', 'end')],
    transitions: { 'start>details': 200, 'details>q1': 190, 'q1>a1': 100, 'q1>b1': 80, 'a1>a2': 90, 'a2>m': 70, 'b1>m': 60 }, completions: { m: 60 }
  });
  const questions = model.rows.filter(item => item.kind === 'question');
  assert.deepEqual(questions.map(item => item.label), ['Q1', 'A1', 'A2', 'B1', 'M']);
  assert.equal(questions.find(item => item.label === 'Q1').left, 10);
  assert.equal(questions.find(item => item.label === 'M').reached, 130);
});

test('a choice that leads to different questions numbers them by reading order, and only choices branch', () => {
  const model = loadStepsModel()({
    hasData: true, views: 100, starts: 60, submitted: 20,
    nodes: [node('info', 'candidateInfo'), node('q1', 'singleChoice', 'Pick one'), node('x', 'shortText', 'Option X'), node('y', 'shortText', 'Option Y'), node('end', 'end')],
    edges: [edge('info', 'q1'), edge('q1', 'x', 'X'), edge('q1', 'y', 'Y'), edge('x', 'end'), edge('y', 'end')],
    transitions: { 'start>details': 50, 'details>q1': 45, 'q1>x': 25, 'q1>y': 15 }, completions: { x: 12, y: 8 }
  });
  const questions = model.rows.filter(item => item.kind === 'question');
  assert.deepEqual(questions.map(item => [item.number, item.label]), [[1, 'Pick one'], [2, 'Option X'], [3, 'Option Y']], 'parallel branches are numbered in the order of the connections');
  assert.equal(questions[0].left, 5);
  assert.equal(questions[1].left, 13);
  assert.equal(questions[2].left, 7);
});

test('a small sample points at nothing, noisy counters never give negative numbers, removed steps are kept', () => {
  const run = loadStepsModel();
  const few = run({ hasData: true, views: 12, starts: 8, submitted: 3, nodes: [node('info', 'candidateInfo'), node('q1', 'shortText'), node('end', 'end')], edges: [edge('info', 'q1'), edge('q1', 'end')], transitions: { 'start>details': 6, 'details>q1': 5 }, completions: { q1: 3 } });
  assert.equal(few.top, null, 'fewer than 20 people at every step: no biggest drop');
  const noisy = run({ hasData: true, views: 100, starts: 200, submitted: 5, nodes: [node('info', 'candidateInfo'), node('q1', 'shortText'), node('end', 'end')], edges: [edge('info', 'q1'), edge('q1', 'end')], transitions: { 'start>details': 90, 'details>q1': 95, 'details>gone-step': 14 }, completions: { q1: 100 } });
  noisy.rows.forEach(row => { if (row.left !== null) assert.ok(row.left >= 0, row.label + ' is not negative'); });
  assert.ok(noisy.rows.some(row => row.kind === 'removed' && row.reached === 14), 'a step removed from the form keeps its count');
  const none = run({ hasData: true, views: 0, starts: 0, submitted: 0, nodes: [], edges: [], transitions: {}, completions: {} });
  assert.equal(none.top, null);
});

test('a form with no questions only has the first page', () => {
  const model = loadStepsModel()({ hasData: true, views: 100, starts: 60, submitted: 40, nodes: [node('info', 'candidateInfo'), node('end', 'end')], edges: [edge('info', 'end')], transitions: { 'start>details': 45 }, completions: { details: 40 } });
  assert.equal(model.rows.filter(row => row.kind === 'question').length, 0);
  assert.equal(model.rows.find(row => row.kind === 'details').left, 5, '45 completed the page, 40 submitted straight away');
});

test('form versions: only the drop-off block is versioned, with a picker shown only for 2+ versions', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261021140000_form_versions.sql'), 'utf8');
  const builder = fs.readFileSync(path.join(__dirname, '..', 'builder.js'), 'utf8');
  const backend = fs.readFileSync(path.join(__dirname, '..', 'backend.js'), 'utf8');
  assert.match(sql, /create table public\.job_form_versions/);
  assert.match(sql, /revoke all on public\.job_form_versions from public, anon, authenticated/);
  assert.match(sql, /grant all on public\.job_form_versions to service_role/);
  assert.match(sql, /create trigger published_flows_form_version/);
  assert.match(sql, /p_version_id uuid default null/);
  assert.match(backend, /p_version_id: version/);
  assert.match(builder, /versions\.length < 2\) return ''/);
  assert.match(builder, /id="rpt-steps-version-slot"/);
});
