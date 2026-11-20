const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261119120000_candidate_interviews.sql'), 'utf8');

test('interview tables follow the explicit-grants rule (RLS on, revoke all, exact grants)', () => {
  for (const table of ['candidate_interviews', 'candidate_interview_tokens', 'candidate_interview_events', 'candidate_interview_notice_seen', 'candidate_interview_settings']) {
    assert.ok(sql.includes(`alter table public.${table} enable row level security`), `${table} has RLS`);
    assert.ok(sql.includes(`revoke all on public.${table} from public, anon, authenticated`), `${table} is closed to browser roles`);
    assert.ok(sql.includes(`grant all on public.${table} to service_role`), `${table} is open to the edge functions`);
  }
});

test('the browser can only read interviews and history, never write, and never touch tokens or settings', () => {
  assert.ok(/grant select \([^)]*\)\s+on public\.candidate_interviews to authenticated/.test(sql));
  assert.ok(sql.includes('grant select on public.candidate_interview_events to authenticated'));
  for (const table of ['candidate_interview_tokens', 'candidate_interview_settings', 'candidate_interview_notice_seen']) {
    assert.equal(new RegExp(`grant [^;]*on public\\.${table} to authenticated`).test(sql), false, `${table} has no grant to authenticated`);
  }
  assert.equal(/grant (insert|update|delete)[^;]*to authenticated/.test(sql), false);
  assert.ok(!/grant select \([^)]*(reminder_24h_sent_at|reminder_2h_sent_at)[^)]*\)\s+on public\.candidate_interviews/.test(sql), 'reminder bookkeeping stays hidden');
  assert.ok(sql.includes("workspace_user_has_permission(workspace_id, 'applicants')"), 'reading needs the Candidates permission');
});

test('the token is stored only as a hash and expires', () => {
  const t = sql.slice(sql.indexOf('create table public.candidate_interview_tokens'), sql.indexOf('alter table public.candidate_interview_tokens'));
  assert.ok(t.includes('token_hash text not null unique check (char_length(token_hash) = 64)'));
  assert.ok(t.includes('expires_at timestamptz not null'));
  assert.equal(/\btoken text\b/.test(t), false, 'no column keeps the secret itself');
});

test('only online or in-person; scheduled rows need the details of the meeting', () => {
  assert.ok(sql.includes("kind in ('online', 'in_person')"));
  assert.equal(/phone/.test(sql.replace(/--.*$/gm, '')), false, 'no phone type (owner decision)');
  assert.ok(sql.includes("(kind = 'online' and meeting_link is not null) or (kind = 'in_person' and address is not null)"));
  assert.ok(sql.includes("state = 'awaiting_schedule'\n    or"), 'a waiting row needs no details');
});

test('one open interview per candidate and job; cancelled and finished ones do not block a new round', () => {
  assert.ok(sql.includes("create unique index candidate_interviews_one_open_idx on public.candidate_interviews (flow_id, candidate_email)\n  where state in ('awaiting_schedule', 'invited', 'confirmed', 'declined', 'reschedule_requested')"));
});

test('the time windows are enforced in the database: future, at most 6 months, suggestions up to 30 days after the interview', () => {
  assert.ok(sql.includes("new.starts_at > now() + interval '6 months'"));
  assert.ok(sql.includes('new.starts_at <= now()'));
  assert.ok(sql.includes("v_limit := new.starts_at + interval '30 days'"));
  assert.ok(sql.includes("jsonb_array_length(proposed_times) <= 3"));
  assert.ok(sql.includes('new.local_start at time zone new.time_zone'), 'starts_at is computed from the wall-clock time and the zone');
  assert.ok(sql.includes('pg_timezone_names'), 'the zone must be a real IANA name');
  assert.ok(sql.includes('new.starts_at is distinct from old.starts_at'), 'an unrelated update never re-checks the window');
});

test('moving into the Interview column creates the waiting row; moving out removes only a waiting one; scheduled ones stay', () => {
  assert.ok(sql.includes("if new.status = 'interview' then"));
  assert.ok(sql.includes("values (new.workspace_id, new.flow_id, v_email, new.id, 'awaiting_schedule')"));
  assert.ok(sql.includes('do nothing'), 'a scheduled interview is left alone');
  assert.ok(sql.includes("candidate_email = v_email and state = 'awaiting_schedule'"), 'only a waiting row is removed');
  assert.ok(sql.includes('after update of status on public.applicants'));
  assert.ok(sql.includes('after delete on public.applicants'), 'deleting the last application deletes the interview');
});

test('triggers and workers are closed to browser roles; notices need the permission', () => {
  for (const fn of ['candidate_interview_check_times()', 'candidate_interview_on_stage_change()', 'candidate_interview_on_applicant_deleted()', 'candidate_interview_tick()', 'candidate_interview_reminders_due()']) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon, authenticated`), `${fn} is closed`);
  }
  assert.ok(sql.includes('grant execute on function public.get_candidate_interview_notices(uuid) to authenticated, service_role'));
  assert.ok(sql.includes('grant execute on function public.mark_candidate_interview_notice_seen(uuid) to authenticated, service_role'));
  assert.ok(sql.includes("not public.workspace_user_has_permission(p_workspace_id, 'applicants')"));
  assert.ok(sql.includes('cardinality(f.responsible_user_ids) = 0 or auth.uid() = any (f.responsible_user_ids)'), 'responsible filter like the AI notices');
  assert.ok(sql.includes('s.notice_at = i.notice_at'), 'a new answer shows again after the old one was seen');
});

test('reminders: confirmed only, workspace with an active plan, none for an interview booked too late, every 5 minutes', () => {
  assert.ok(sql.includes("i.state = 'confirmed' and i.reminder_24h_sent_at is null"));
  assert.ok(sql.includes("i.state = 'confirmed' and i.reminder_2h_sent_at is null"));
  assert.ok(sql.includes("i.invited_at <= i.starts_at - interval '24 hours'"));
  assert.ok(sql.includes("i.invited_at <= i.starts_at - interval '2 hours'"));
  assert.ok(sql.includes('public.workspace_has_active_subscription(i.workspace_id)'));
  assert.ok(sql.includes("cron.schedule('candidate-interview-tick', '*/5 * * * *'"));
  assert.ok(sql.includes('make_interval(mins => i.duration_minutes)'), 'past interviews become history');
});

test('the migration stores no secret and no function address', () => {
  assert.ok(!/sk_|whsec_|functions\/v1|RESEND/.test(sql));
});

test('10-minute reminder: own column hidden from the browser, own window, 2 h reminder stops 10 minutes before', () => {
  const next = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261120140000_interview_reminder_10m.sql'), 'utf8');
  assert.ok(next.includes('add column reminder_10m_sent_at timestamptz'));
  assert.ok(!/grant/.test(next.replace(/grant execute on function public\.candidate_interview_reminders_due\(\) to service_role;/, '')), 'no new table grant: the column stays hidden');
  assert.ok(next.includes("i.state = 'confirmed' and i.reminder_10m_sent_at is null"));
  assert.ok(next.includes("i.starts_at - interval '10 minutes' <= now() and i.starts_at > now()"));
  assert.ok(next.includes("i.invited_at <= i.starts_at - interval '10 minutes'"));
  assert.ok(next.includes("i.starts_at - interval '2 hours' <= now() and i.starts_at - interval '10 minutes' > now()"));
  assert.ok(next.includes("'reminder_10m'"), 'history line kind allowed');
});

test('interview result: manual finish (no job closes interviews any more), result columns readable by the browser, new history kinds', () => {
  const next = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261120150000_interview_result.sql'), 'utf8');
  for (const column of ['result_reason', 'result_impression', 'result_recommended', 'result_notes', 'result_at', 'result_by']) assert.ok(next.includes('add column ' + column), column);
  assert.ok(next.includes("grant select (result_reason, result_impression, result_recommended, result_notes, result_at, result_by) on public.candidate_interviews to authenticated"));
  assert.ok(next.includes("'finalized', 'result_corrected'"), 'history kinds');
  assert.ok(next.includes("state = 'finished' and result_reason is not null"), 'a result only exists on a finished interview');
  const tick = next.slice(next.indexOf('create or replace function public.candidate_interview_tick()'));
  assert.ok(!tick.includes("set state = 'finished'") && !tick.includes("update public.candidate_interviews"), 'the job no longer closes interviews');
  assert.ok(tick.includes('candidate_interview_reminders_due()'), 'it still wakes the reminders');
});
