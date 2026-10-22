const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const permission = read('supabase/migrations/20261022160000_diversity_permission.sql');
const report = read('supabase/migrations/20261022161000_diversity_report.sql');

test('"Diversity" is a team permission that is OFF by default (the others are on)', () => {
  assert.match(permission, /alter table public\.workspace_members add column if not exists can_diversity boolean not null default false/);
  assert.match(permission, /alter table public\.workspace_invitations add column if not exists can_diversity boolean not null default false/);
  assert.match(permission, /when 'diversity' then m\.can_diversity/);
  assert.match(permission, /p_can_diversity boolean default false/, 'invitations: off unless ticked');
  assert.match(permission, /coalesce\(p_can_diversity, false\)/);
  assert.match(permission, /p_can_diversity boolean default null/, 'permission updates from an older client leave it untouched');
  assert.match(permission, /can_diversity = coalesce\(p_can_diversity, can_diversity\)/);
  assert.match(permission, /invitation\.can_diversity, invitation\.invited_by/, 'accepting an invitation carries it over');
  assert.match(permission, /'canDiversity', m\.can_diversity/, 'the data export lists it');
  assert.match(permission, /grant execute on function public\.create_team_invitation\(uuid, text, text, text, boolean, boolean, boolean, boolean, boolean, boolean\) to authenticated, service_role/);
  assert.match(permission, /grant execute on function public\.update_team_member_permissions\(uuid, uuid, boolean, boolean, boolean, boolean, boolean, boolean\) to authenticated, service_role/);
  assert.match(permission, /drop function if exists public\.create_team_invitation\(uuid, text, text, text, boolean, boolean, boolean, boolean, boolean\)/);
  assert.match(permission, /drop function if exists public\.update_team_member_permissions\(uuid, uuid, boolean, boolean, boolean, boolean, boolean\)/);
  // the owner always has it, in the read-only team view too
  assert.match(permission, /coalesce\(p\.last_name, 'name'\), true, true, true\n/);
});

test('the team function: Diversity is off unless explicitly ticked and is carried everywhere', () => {
  const edge = read('supabase/functions/team/index.ts');
  assert.match(edge, /can_diversity: typeof permissions\.diversity === "boolean" \? permissions\.diversity : null/);
  assert.match(edge, /p_can_diversity: permissions\.can_diversity/);
  assert.match(edge, /p_can_diversity: p\.can_diversity/);
  assert.match(edge, /\.\.\.\(p\.can_diversity === null \? \{\} : \{ can_diversity: p\.can_diversity \}\)/);
  assert.equal((edge.match(/can_view_reports,can_diversity/g) || []).length >= 3, true, 'members and invitations are read with the new column');
  assert.match(edge, /can_diversity: member\.can_diversity/);
  assert.match(read('backend.js'), /can_diversity: row\.can_diversity/);
});

test('the team screen: Diversity is unticked by default, in the invitation and for members', () => {
  const builder = read('builder.js');
  assert.match(builder, /data-permission="diversity" \$\{permissions\.can_diversity === true \? 'checked' : ''\}/);
  assert.match(builder, /<input type="checkbox" data-invite-permission="diversity"><span>Diversity<\/span>/, 'no "checked" on the invitation checkbox');
  assert.match(builder, /p\.can_diversity && 'Diversity'/);
  assert.match(builder, /'canDiversity'/);
  assert.match(builder, /All are enabled by default, except Diversity\./);
  assert.match(builder, /does not move candidates between stages/);
});

test('the Diversity page: in the sidebar only for people with the permission, no head counts on screen', () => {
  const builder = read('builder.js');
  assert.match(builder, /\$\{hasPermission\('diversity'\) \? `<button class="sidebar-link/);
  assert.match(builder, /if \(!hasPermission\('diversity'\)\) return renderAccessMessage\('diversity'\);/);
  assert.match(builder, /requestedPage === 'diversity'\) void renderDiversity\(\)/);
  const start = builder.indexOf('function diversityQuestionHtml');
  const end = builder.indexOf('function formatPlanDate');
  assert.ok(start > 0 && end > start);
  const page = builder.slice(start, end);
  assert.match(page, /\$\{pct\}%/, 'only percentages are drawn');
  assert.doesNotMatch(page, /\.n\b|respondents|headcount|count\(/i, 'the page never handles a number of people');
  assert.doesNotMatch(page, /email|candidate_name|toFixed/, 'no e-mail, no name, no decimals');
  assert.match(page, /Math\.round\(Number\(item\.pct\)/, 'whole numbers');
  assert.match(page, /Other groups \(small groups combined\)/);
  // no shortcut to switch the questions on: the page is only a report
  assert.doesNotMatch(page, /Turn on|enable the diversity|data-route="my-companies"/);
  const backend = read('backend.js');
  assert.match(backend, /rpc\('get_diversity_jobs', \{ p_workspace_id: workspaceId \}\)/);
  assert.match(backend, /rpc\('get_diversity_report', \{ p_workspace_id: workspaceId, p_flow_id: flowId \}\)/);
  assert.doesNotMatch(backend, /from\('applicant_diversity'\)|from\('diversity_report_cache'\)/);
});

test('the report functions check the permission themselves and are not open to anonymous visitors', () => {
  for (const name of ['get_diversity_jobs', 'get_diversity_report']) {
    const start = report.indexOf('create or replace function public.' + name);
    assert.ok(start > 0, name);
    const fn = report.slice(start, report.indexOf('$function$;', report.indexOf('$function$', start + 40) + 11));
    assert.match(fn, /security definer/);
    assert.match(fn, /set search_path to ''/);
    assert.match(fn, /auth\.uid\(\) is null or not public\.workspace_user_has_permission\(p_workspace_id, 'diversity'\)/);
    assert.match(fn, /errcode = '42501'/);
  }
  assert.match(report, /revoke all on function public\.get_diversity_jobs\(uuid\) from public, anon, authenticated;/);
  assert.match(report, /grant execute on function public\.get_diversity_jobs\(uuid\) to authenticated, service_role;/);
  assert.match(report, /revoke all on function public\.get_diversity_report\(uuid, uuid\) from public, anon, authenticated;/);
  assert.match(report, /grant execute on function public\.get_diversity_report\(uuid, uuid\) to authenticated, service_role;/);
  assert.match(report, /f\.id = p_flow_id and f\.workspace_id = p_workspace_id/, 'the job must belong to the workspace');
});

test('the privacy rules are applied on the server: 10 respondents, 7 days, groups under 5 merged, whole percentages, daily cache', () => {
  assert.match(report, /c_min_respondents constant integer := 10;/);
  assert.match(report, /c_min_group constant integer := 5;/);
  assert.match(report, /c_delay constant interval := interval '7 days';/);
  assert.match(report, /c_refresh constant interval := interval '1 day';/);
  assert.match(report, /having min\(submitted_at\) <= now\(\) - c_delay/, 'a candidate counts once the first application is 7 days old');
  assert.match(report, /where ap\.submitted_at <= now\(\) - c_delay/, 'and so do the answers');
  assert.match(report, /distinct on \(ap\.email\)/, 'one set of answers per candidate');
  assert.match(report, /if v_respondents < c_min_respondents then/);
  assert.match(report, /v_item\.n < c_min_group or \(v_merged and v_pool < c_min_group\)/, 'small groups merge, and the merged group itself is never under 5');
  assert.match(report, /round\(100\.0 \* v_item\.n \/ v_total\)::integer/);
  assert.match(report, /round\(100\.0 \* v_pool \/ v_total\)::integer/);
  assert.match(report, /v_cached\.computed_at > now\(\) - c_refresh/);
  // the result built for the browser has no head count, no e-mail and no name
  const fn = report.slice(report.indexOf('create or replace function public.get_diversity_report'));
  const built = fn.slice(fn.indexOf('v_result := jsonb_build_object'));
  assert.doesNotMatch(built, /'(count|respondents|candidates|email|name)'|candidate_name/);
  assert.match(built, /jsonb_build_object\('answer', v_item\.answer, 'pct', round\(/, 'a shown group carries its answer and a rounded percentage, nothing else');
  assert.match(built, /jsonb_build_object\('pct', round\(/, 'the merged group carries only a percentage');
  assert.match(built, /'size', case when v_respondents >= 1000 then '1000\+' when v_respondents >= 400 then '400-999' when v_respondents >= 200 then '200-399' when v_respondents >= 100 then '100-199' when v_respondents >= 30 then '30-99' else '10-29' end/, 'only a band for the number of respondents');
  assert.doesNotMatch(built, /'size', v_respondents|'respondents'/, 'never the exact number');
  const page = read('builder.js');
  assert.match(page, /const SIZES = \{ '10-29': '10 to 29', '30-99': '30 to 99', '100-199': '100 to 199', '200-399': '200 to 399', '400-999': '400 to 999', '1000\+': '1,000 or more' \};/);
});

test('the cache table is closed to the browser (RLS, no grants besides service_role) and the answer column exists', () => {
  assert.match(report, /alter table public\.applicant_diversity add column if not exists transgender text;/);
  assert.match(report, /alter table public\.diversity_report_cache enable row level security;/);
  assert.match(report, /revoke all on table public\.diversity_report_cache from public, anon, authenticated;/);
  assert.match(report, /grant all on table public\.diversity_report_cache to service_role;/);
  assert.doesNotMatch(report, /grant (select|insert|update|delete)[^;]* to authenticated/i);
  assert.match(report, /references public\.application_flows \(id\) on delete cascade/, 'deleting a job removes its cached numbers');
});

test('the transgender question: a separate, voluntary question with "Prefer not to say" (the gender list is unchanged)', () => {
  const sandbox = { window: {}, document: {}, fetch() {}, Intl, Event: class {} };
  vm.runInNewContext(read('geo.js'), sandbox);
  const G = sandbox.window.PathwayGeo;
  assert.equal(G.DIVERSITY.transgender.label, 'Do you identify as transgender?');
  assert.deepEqual(JSON.parse(JSON.stringify(G.DIVERSITY.transgender.options)), ['Yes', 'No', 'Prefer not to say']);
  assert.deepEqual(JSON.parse(JSON.stringify(G.DIVERSITY.genderIdentity.options)), ['Woman', 'Man', 'Non-binary', 'Another gender identity', 'Prefer not to say']);
  assert.doesNotMatch(read('geo.js'), /[Cc]isgender|Trans man|Trans woman/);
  const fn = read('supabase/functions/applications/index.ts');
  assert.match(fn, /transgender: answers\.transgender/);
  assert.match(read('supabase/functions/applications/geo.ts'), /"transgender": \[/);
  assert.match(read('legal.html'), /whether the candidate identifies as transgender/);
});
