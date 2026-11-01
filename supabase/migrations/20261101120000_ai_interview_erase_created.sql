-- AI Interview: erase in Witcher also the interview that was created there but whose invitation never reached the state "invited".
-- Found in the first production test (2026-11-01): the card left the AI Interview column while the e-mail was still being retried,
-- the waiting row was deleted here, and the interview stayed in Witcher (with the candidate's name and e-mail) because only rows past
-- "pending"/"blocked" were queued for erasure. A waiting row that already has a witcher_interview_id exists in Witcher too, so it is queued.
--  Additive behaviour change in one function; no data changes.
--  Undo: recreate the function with `if old.state not in ('pending', 'blocked') then` (see 20261029100000_ai_interviews.sql).

create or replace function public.ai_interview_queue_erasure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state not in ('pending', 'blocked') or old.witcher_interview_id is not null then
    insert into public.ai_interview_deletions (ai_interview_id, workspace_id)
    values (old.id, old.workspace_id)
    on conflict (ai_interview_id) do nothing;
  end if;
  return null;
end;
$$;
revoke all on function public.ai_interview_queue_erasure() from public, anon, authenticated;
