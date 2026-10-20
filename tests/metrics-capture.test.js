const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

test('every stage change is recorded with its date, and the history goes away with the candidate', () => {
  const sql = read('supabase/migrations/20261020190000_recruiting_metrics_capture.sql');
  assert.ok(sql.includes('applicant_id uuid not null references public.applicants(id) on delete cascade'));
  assert.ok(sql.includes("kind text not null check (kind in ('submitted', 'moved', 'backfill'))"));
  assert.ok(sql.includes('after insert or update of status on public.applicants'));
  assert.ok(sql.includes("values (new.workspace_id, new.flow_id, new.id, old.status, new.status, 'moved')"));
  assert.ok(sql.includes("select a.workspace_id, a.flow_id, a.id, null, a.status, 'backfill'"));
  assert.equal(/candidate_email|candidate_name/.test(sql.replace(/^--.*$/gm, '')), false, 'the history holds no personal data');
});

test('the new tables follow the privilege rules: RLS on, nothing for anon, read-only for reviewers', () => {
  const sql = read('supabase/migrations/20261020190000_recruiting_metrics_capture.sql');
  for (const table of ['applicant_stage_history', 'job_event_counts']) {
    assert.ok(sql.includes('alter table public.' + table + ' enable row level security;'), table);
    assert.ok(sql.includes('revoke all on public.' + table + ' from public, anon, authenticated;'), table);
    assert.ok(sql.includes('grant select on public.' + table + ' to authenticated;'), table);
    assert.ok(sql.includes('grant all on public.' + table + ' to service_role;'), table);
  }
  assert.equal(/grant (insert|update|delete|all)[^;]*public\.(applicant_stage_history|job_event_counts)[^;]*to authenticated/.test(sql), false);
  assert.match(sql, /grant execute on function public\.record_job_event\(uuid, text\) to service_role;/);
  assert.match(sql, /grant execute on function public\.record_applicant_stage_change\(\) to service_role;/);
});

test('the counters are anonymous: only daily totals per job, no IP, no cookie, no person, no source', () => {
  const sql = read('supabase/migrations/20261020190000_recruiting_metrics_capture.sql');
  const body = sql.slice(sql.indexOf('create table public.job_event_counts'), sql.indexOf('alter table public.job_event_counts enable'));
  assert.ok(body.includes('primary key (flow_id, day, event)'));
  assert.equal(/\b(ip|user_agent|session|email|cookie|visitor|source)\b/i.test(body), false);
  assert.ok(sql.includes("check (event in ('view', 'start'))"));
  assert.ok(sql.includes('and public.flow_data_is_valid(f.flow_data)'), 'only active, intact jobs are counted');
  const edge = read('supabase/functions/applications/index.ts');
  assert.ok(edge.includes('if (body.action === "trackEvent")'));
  assert.ok(edge.includes('return response(req, 200, { ok: true });'), 'always answers ok, never reveals whether a job exists');
  assert.ok(read('legal.html').includes('count visits and form starts anonymously'));
});

test('there is no "source" capture anywhere: no column, no link tag, no form field', () => {
  const files = ['supabase/migrations/20261020190000_recruiting_metrics_capture.sql', 'supabase/functions/applications/index.ts', 'backend.js', 'candidate.js', 'apply.html', 'builder.js'];
  for (const file of files) {
    const text = read(file).replace(/^--.*$/gm, '');
    assert.equal(/normalizeSource|normalizeLinkSource|link-source|[&#?]src=|p_source|source text|form\.set\('source'/.test(text), false, file + ' has no source capture');
  }
  assert.equal(read('legal.html').includes('source tag'), false);
  const candidate = read('candidate.js');
  assert.ok(candidate.includes("track('view');") && candidate.includes("track('start')"));
  assert.ok(candidate.includes("if (live && window.PathwayBackend.trackJobEvent)"), 'previews are never counted');
});
