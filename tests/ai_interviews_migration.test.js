const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261029100000_ai_interviews.sql'), 'utf8');

test('AI interview tables follow the explicit-grants rule (RLS on, revoke all, exact grants)', () => {
  for (const table of ['ai_interviews', 'ai_interview_deletions', 'ai_interview_settings', 'ai_interview_notice_seen']) {
    assert.ok(sql.includes(`alter table public.${table} enable row level security`), `${table} has RLS`);
    assert.ok(sql.includes(`revoke all on public.${table} from public, anon, authenticated`), `${table} is closed to browser roles`);
    assert.ok(sql.includes(`grant all on public.${table} to service_role`), `${table} is open to the edge functions`);
  }
  assert.ok(/grant select \([^)]*\)\s+on public\.ai_interviews to authenticated/.test(sql), 'the browser may only read listed columns');
  assert.ok(!/grant select \([^)]*(last_error|lease_until|attempts)[^)]*\)\s+on public\.ai_interviews/.test(sql), 'internal columns stay hidden');
  assert.ok(sql.includes("workspace_user_has_permission(workspace_id, 'applicants')"), 'reading needs the Candidates permission');
});

test('the questions live in their own column, outside flow_data, and do not mark the job as changed', () => {
  assert.ok(sql.includes('add column if not exists interview_questions jsonb'));
  assert.ok(!sql.includes("flow_data ||") && !sql.includes("'interviewQuestions'"), 'never put the questions into flow_data');
  const trigger = sql.slice(sql.indexOf('create or replace function public.set_flow_updated_at()'));
  assert.ok(trigger.includes("- 'interview_questions'"), 'updated_at ignores the questions like it ignores the responsible people');
});

test('moving a card creates the pending row after 10 seconds and moving out removes only a waiting one', () => {
  assert.ok(sql.includes("now() + interval '10 seconds'"));
  assert.ok(sql.includes("state in ('pending', 'blocked')"));
  assert.ok(sql.includes('after update of status on public.applicants'));
  assert.ok(sql.includes('ai_interviews_queue_erasure'), 'every deletion reaches Witcher through the outbox');
  assert.ok(!/on delete cascade[^;]*ai_interview_deletions/.test(sql) && !/ai_interview_deletions[^;]*references/.test(sql), 'the outbox has no foreign keys, so it outlives the deleted job');
});

test('the migration stores no secret and no Witcher address', () => {
  assert.ok(!/sk_|whsec_|WITCHER_API_KEY|WITCHER_WEBHOOK_SECRET|functions\/v1/.test(sql));
  assert.ok(sql.includes("cron.schedule('ai-interview-tick', '10 seconds'"));
});
