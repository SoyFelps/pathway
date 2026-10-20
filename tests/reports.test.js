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
  assert.match(read('index.html'), /builder\.js\?v=reports2-20261020/);
  assert.match(read('index.html'), /backend\.js\?v=reports2-20261020/);
  assert.match(read('index.html'), /styles\.css\?v=reports2-20261020/);
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

test('the intake function and the candidate page count each step once per visit, best effort', () => {
  const edge = read('supabase/functions/applications/index.ts');
  assert.match(edge, /event === "step"/);
  assert.match(edge, /cleanName\(body\.nodeId, 80\)/);
  assert.match(edge, /admin\.rpc\("record_job_step", \{ p_published_flow_id: publishedId, p_node_id: nodeId \}\)/);
  const candidate = read('candidate.js');
  assert.match(candidate, /const reachedSteps = new Set\(\)/);
  assert.match(candidate, /if \(reachedSteps\.has\(nodeId\)\) return;/);
  assert.match(candidate, /trackJobEvent\(options\.publishedFlowId, 'step', nodeId\)/);
  assert.match(candidate, /trackStep\('details'\)/);
  assert.match(candidate, /trackStep\(node\.id\)/);
  assert.match(candidate, /let trackStep = \(\) => \{\};/, 'previews and failures never count or break the page');
  const backend = read('backend.js');
  assert.match(backend, /function trackJobEvent\(publishedFlowId, event, nodeId\)/);
  assert.match(backend, /\.\.\.\(nodeId \? \{ nodeId: String\(nodeId\) \} : \{\}\)/);
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
