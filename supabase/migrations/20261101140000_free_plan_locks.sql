-- A workspace that goes back to the free plan (owner decisions 2026-11-01):
--  1. Nobody can move candidates between stages while the workspace has no active plan (the board shows a note to the owner).
--     The rule lives in the database: the policy that lets reviewers change applicants.status now also needs an active plan, for the
--     owner too. Candidates enter a job and fail automatically only through published jobs, which the plan loss already takes offline.
--  2. AI interviews that were created but not done are dealt with when the plan is lost:
--       pending / blocked (only here, or created in Witcher without an e-mail): deleted (the erasure trigger tells Witcher when needed);
--       invited (sent, candidate has not started): cancel_requested_at is set and the worker cancels it in Witcher, with retries;
--       in_progress: left alone, the candidate finishes.
--  3. ai_interviews.cancel_reason = 'plan' says why a cancelled interview was cancelled (the panel explains it).
--  Additive apart from the replaced policy and function. Undo: put back the policy of 20261022 (permission check only), drop the trigger
--  and the helper, and restore ai_interview_kick() from 20261029100000_ai_interviews.sql.

alter table public.ai_interviews add column if not exists cancel_reason text check (cancel_reason in ('plan'));
alter table public.ai_interviews add column if not exists cancel_requested_at timestamptz;
grant select (cancel_reason) on public.ai_interviews to authenticated;

-- 1. Stage moves need an active plan.
drop policy if exists "workspace applicant reviewers can update applicant status" on public.applicants;
create policy "workspace applicant reviewers can update applicant status" on public.applicants
  for update to authenticated
  using (public.workspace_user_has_permission(workspace_id, 'applicants') and public.workspace_user_has_active_subscription(workspace_id))
  with check (
    (status = any (array['failed', 'new', 'screening', 'team_fit', 'skill_fit', 'ai_interview', 'interview', 'promising', 'offer', 'withdrawn', 'hired'])
      or status ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and public.workspace_user_has_permission(workspace_id, 'applicants')
    and public.workspace_user_has_active_subscription(workspace_id)
  );

-- 2. What happens to the interviews that were not done.
create or replace function public.ai_interview_free_plan_cleanup(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.ai_interviews where workspace_id = p_workspace_id and state in ('pending', 'blocked');
  update public.ai_interviews set cancel_requested_at = now()
   where workspace_id = p_workspace_id and state = 'invited' and cancel_requested_at is null;
end;
$$;
revoke all on function public.ai_interview_free_plan_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.ai_interview_free_plan_cleanup(uuid) to service_role;

create or replace function public.ai_interview_on_plan_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has boolean := new.status = 'active' and coalesce(new.current_period_end, '-infinity'::timestamptz) > now();
  -- Only the status counts for "had it": Stripe's end-of-period notice arrives AFTER the stored end date, so looking at the date would miss it.
  v_had boolean := tg_op = 'UPDATE' and old.status = 'active';
begin
  -- Only the moment the plan is lost (or a subscription is recorded that never had access).
  if not v_has and (tg_op = 'INSERT' or v_had) then
    perform public.ai_interview_free_plan_cleanup(new.workspace_id);
  end if;
  return null;
end;
$$;
revoke all on function public.ai_interview_on_plan_change() from public, anon, authenticated;

drop trigger if exists workspace_subscriptions_ai_interview_plan on public.workspace_subscriptions;
create trigger workspace_subscriptions_ai_interview_plan
after insert or update of status, current_period_end on public.workspace_subscriptions
for each row execute function public.ai_interview_on_plan_change();

-- The worker is woken also when a cancellation is due.
create or replace function public.ai_interview_kick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  select value into v_url from public.ai_interview_settings where key = 'worker_url';
  if v_url is null or v_url = '' then return; end if;
  if not (
    exists (select 1 from public.ai_interviews
             where state in ('pending', 'blocked') and send_at <= now() and (lease_until is null or lease_until < now()))
    or exists (select 1 from public.ai_interview_deletions where next_at <= now())
    or exists (select 1 from public.ai_interviews where state = 'invited' and cancel_requested_at is not null and cancel_requested_at <= now())
  ) then return; end if;
  perform net.http_post(url := v_url, headers := '{"Content-Type": "application/json"}'::jsonb, body := '{"action": "tick"}'::jsonb);
end;
$$;
revoke all on function public.ai_interview_kick() from public, anon, authenticated;
grant execute on function public.ai_interview_kick() to service_role;

-- Workspaces that are already on the free plan get the same treatment once (for example the leftover waiting interviews).
select public.ai_interview_free_plan_cleanup(w.id)
  from public.workspaces w
 where not public.workspace_has_active_subscription(w.id)
   and exists (select 1 from public.ai_interviews i where i.workspace_id = w.id and i.state in ('pending', 'blocked', 'invited'));
