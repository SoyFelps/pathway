-- The result of a human interview, written by hand (owner decisions, 2026-11-20).
--  * 'finished' is now 100% MANUAL: it means "the team registered how the interview went". The every-5-minutes job no longer closes past
--    interviews. An interview whose time has passed and has no result is shown as "Waiting for results" (the screen decides, the state is
--    still invited / confirmed / declined / reschedule_requested).
--  * The result lives in columns of the interview: what happened, the impression (positive / mixed / negative, like the AI interview), whether
--    the team recommends the candidate, notes, who registered it and when. It can be corrected later; every correction is a history line.
--  * Interviews the old job closed on its own (state 'finished' with no result) stay as they are; the screen shows them as waiting for results
--    too, so a person can still register how they went.
-- Undo: put the old tick function back (migration 20261119120000), drop the columns and the two history kinds (after deleting those lines).
alter table public.candidate_interviews
  add column result_reason text check (result_reason in ('held', 'no_show', 'other')),
  add column result_impression text check (result_impression in ('positive', 'mixed', 'negative')),
  add column result_recommended boolean,
  add column result_notes text check (result_notes is null or char_length(result_notes) <= 2000),
  add column result_at timestamptz,
  add column result_by uuid references auth.users (id) on delete set null;

alter table public.candidate_interviews add constraint candidate_interviews_result_check check (
  result_at is null
  or (state = 'finished' and result_reason is not null
      and (result_reason <> 'held' or (result_impression is not null and result_recommended is not null)))
);

-- The browser reads the result like the rest of the interview (the same people, by the same policies); it never writes it.
grant select (result_reason, result_impression, result_recommended, result_notes, result_at, result_by) on public.candidate_interviews to authenticated;

alter table public.candidate_interview_events drop constraint candidate_interview_events_kind_check;
alter table public.candidate_interview_events add constraint candidate_interview_events_kind_check
  check (kind in ('scheduled', 'updated', 'cancelled', 'resent', 'confirmed', 'declined', 'reschedule_requested', 'reminder_24h', 'reminder_2h', 'reminder_10m', 'finished', 'responsibles_changed', 'finalized', 'result_corrected'));

-- Every 5 minutes: only wakes the worker function when a reminder is due (no longer closes past interviews).
create or replace function public.candidate_interview_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  select value into v_url from public.candidate_interview_settings where key = 'worker_url';
  if v_url is null or v_url = '' then return; end if;
  if not exists (select 1 from public.candidate_interview_reminders_due()) then return; end if;
  perform net.http_post(url := v_url, headers := '{"Content-Type": "application/json"}'::jsonb, body := '{"action": "tick"}'::jsonb);
end;
$$;
revoke all on function public.candidate_interview_tick() from public, anon, authenticated;
grant execute on function public.candidate_interview_tick() to service_role;
