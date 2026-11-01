-- AI Interview: a new invitation after a cancelled, abandoned or expired one is only sent on purpose (the "Invite again" button of
-- the AI Interview tab), in whatever column the candidate is.
--  * ai_interviews.manual: true for an interview created by that button. It is sent at once and does not depend on the column,
--    so moving the card never removes it.
--  * Moving a card into the AI Interview column creates a pending interview only when the candidate has no interview in this job
--    at all. With an earlier one (any state) nothing is created; a card that was moved there again keeps its earlier tag.
--  * Moving out still removes a waiting (pending or blocked) interview, but never a manual one.
--  Additive: no data changes.

alter table public.ai_interviews add column if not exists manual boolean not null default false;

create or replace function public.ai_interview_on_stage_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(new.candidate_email));
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.status = 'ai_interview' then
    -- A card moved in twice (or by several applications of one candidate) refreshes the 10 seconds of a waiting interview.
    update public.ai_interviews
       set send_at = now() + interval '10 seconds',
           state = 'pending', blocked_reason = null, attempts = 0
     where flow_id = new.flow_id and candidate_email = v_email and state in ('pending', 'blocked') and not manual;
    insert into public.ai_interviews (workspace_id, flow_id, candidate_email, applicant_id, state, send_at)
    select new.workspace_id, new.flow_id, v_email, new.id, 'pending', now() + interval '10 seconds'
     where not exists (select 1 from public.ai_interviews i where i.flow_id = new.flow_id and i.candidate_email = v_email);
  elsif old.status = 'ai_interview' then
    delete from public.ai_interviews
     where flow_id = new.flow_id and candidate_email = v_email and state in ('pending', 'blocked') and not manual;
  end if;
  return null;
end;
$$;
revoke all on function public.ai_interview_on_stage_change() from public, anon, authenticated;
