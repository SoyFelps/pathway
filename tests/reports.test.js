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
  assert.match(builder, /function reportToCsv\(data, jobLabel\)/);
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
  assert.match(read('index.html'), /builder\.js\?v=reports-20261020/);
  assert.match(read('index.html'), /backend\.js\?v=reports-20261020/);
  assert.match(read('index.html'), /styles\.css\?v=reports-20261020/);
});
