const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

test('notification state is per person and per job, computed rather than stored per application', () => {
  const sql = read('supabase/migrations/20261018123000_flow_notifications.sql');
  assert.match(sql, /create table public\.flow_notification_state \(\s*user_id uuid not null references auth\.users\(id\) on delete cascade,\s*flow_id uuid not null references public\.application_flows\(id\) on delete cascade,\s*seen_at timestamptz not null default now\(\),\s*primary key \(user_id, flow_id\)/);
  assert.match(sql, /alter table public\.flow_notification_state enable row level security;\s*revoke all on public\.flow_notification_state from public, anon, authenticated;/, 'nobody touches the table directly');
  assert.equal(/to anon/.test(sql), false);
});

test('only candidates count: first application newer than seen_at, not Failed, repeats ignored', () => {
  const sql = read('supabase/migrations/20261018123000_flow_notifications.sql');
  assert.ok(sql.includes("lower(btrim(a.candidate_email))"), 'one candidate per job and e-mail address');
  assert.ok(sql.includes('min(a.submitted_at) as first_at'), 'a repeat application never makes a candidate new again');
  assert.ok(sql.includes("(array_agg(a.status order by a.submitted_at desc))[1] as current_status"));
  assert.ok(sql.includes("cand.first_at > mine.since and cand.current_status <> 'failed'"));
});

test('only people with the Candidates permission, and only the responsible people of each job, are notified', () => {
  const sql = read('supabase/migrations/20261018123000_flow_notifications.sql');
  assert.ok(sql.includes("workspace_user_has_permission(p_workspace_id, 'applicants')"));
  assert.ok(sql.includes('cardinality(f.responsible_user_ids) = 0 or auth.uid() = any (f.responsible_user_ids)'));
  assert.ok(sql.includes("timestamptz '2026-10-18 12:30:00+00'"), 'candidates from before the feature existed never notify');
  assert.match(sql, /grant execute on function public\.get_flow_notifications\(uuid\) to authenticated, service_role;/);
  assert.match(sql, /grant execute on function public\.mark_flow_notification_seen\(uuid\) to authenticated, service_role;/);
});

test('the bell shows one entry per job, refreshes every minute and clears when the job board loads', () => {
  const builder = read('builder.js');
  const backend = read('backend.js');
  assert.ok(builder.includes('const NOTIF_REFRESH_MS = 60000;'));
  assert.ok(builder.includes('There are new applications for <strong>'));
  assert.ok(builder.includes("document.visibilityState === 'visible'"), 'no checks while the tab is hidden');
  assert.ok(builder.includes('notifObserver.observe(root, { childList: true })'), 'the bell is added to every page header');
  assert.match(builder, /renderApplicantBoard\(\);\s*markFlowSeen\(applicantFilter\);/, 'opening a job board clears its notification');
  assert.ok(builder.includes("setOpen(false); applicantFilter = item.dataset.notifFlow; applicantSearch = ''; void renderApplicants();"), 'the notification opens that job\'s board');
  assert.ok(backend.includes("client.rpc('get_flow_notifications', { p_workspace_id: workspaceId })"));
  assert.ok(backend.includes("client.rpc('mark_flow_notification_seen', { p_flow_id: flowId })"));
});

test('the notification shows the company profile name, or the workspace name when the job has none', () => {
  const sql = read('supabase/migrations/20261018130000_flow_notifications_company_label.sql');
  assert.ok(sql.includes('coalesce(wc.name, w.name) as company'));
  assert.ok(sql.includes('left join public.workspace_companies wc on wc.id = f.company_id'));
  assert.equal(sql.includes('f.company_name'), false, 'the stored company_name text can be stale and is not used');
});
