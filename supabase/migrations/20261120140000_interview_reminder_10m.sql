-- A third reminder for human interviews: 10 minutes before the start (owner decision 2026-11-20), besides 24 h and 2 h.
-- Same rules as the others: confirmed interviews only, workspace with an active plan, and only when the invitation existed before the
-- reminder moment. The 2 h reminder is now skipped when only 10 minutes are left. The job runs every 5 minutes, so the 10-minute
-- e-mail leaves between about 10 and 5 minutes before the start.
-- Undo: restore the previous candidate_interview_reminders_due() (migration 20261119120000), then drop the column and put the old kind list back.
alter table public.candidate_interviews add column reminder_10m_sent_at timestamptz;

alter table public.candidate_interview_events drop constraint candidate_interview_events_kind_check;
alter table public.candidate_interview_events add constraint candidate_interview_events_kind_check
  check (kind in ('scheduled', 'updated', 'cancelled', 'resent', 'confirmed', 'declined', 'reschedule_requested', 'reminder_24h', 'reminder_2h', 'reminder_10m', 'finished', 'responsibles_changed'));

create or replace function public.candidate_interview_reminders_due()
returns table (interview_id uuid, reminder text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, '24h'
    from public.candidate_interviews i
   where i.state = 'confirmed' and i.reminder_24h_sent_at is null and i.invited_at is not null
     and i.starts_at - interval '24 hours' <= now() and i.starts_at - interval '2 hours' > now()
     and i.invited_at <= i.starts_at - interval '24 hours'
     and public.workspace_has_active_subscription(i.workspace_id)
  union all
  select i.id, '2h'
    from public.candidate_interviews i
   where i.state = 'confirmed' and i.reminder_2h_sent_at is null and i.invited_at is not null
     and i.starts_at - interval '2 hours' <= now() and i.starts_at - interval '10 minutes' > now()
     and i.invited_at <= i.starts_at - interval '2 hours'
     and public.workspace_has_active_subscription(i.workspace_id)
  union all
  select i.id, '10m'
    from public.candidate_interviews i
   where i.state = 'confirmed' and i.reminder_10m_sent_at is null and i.invited_at is not null
     and i.starts_at - interval '10 minutes' <= now() and i.starts_at > now()
     and i.invited_at <= i.starts_at - interval '10 minutes'
     and public.workspace_has_active_subscription(i.workspace_id);
$$;
revoke all on function public.candidate_interview_reminders_due() from public, anon, authenticated;
grant execute on function public.candidate_interview_reminders_due() to service_role;
