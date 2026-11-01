-- Fix to ai_interview_on_plan_change() of 20261101140000_free_plan_locks.sql (found right after it went live, 2026-11-01).
-- "Had the plan" now looks only at the old status. With the old date check, a normal cancellation at the end of the period was missed:
-- Stripe's end-of-period notice (customer.subscription.deleted) arrives AFTER the stored end date, so the date was already in the past,
-- v_had was false and the cleanup of the AI interviews did not run. A late renewal (status stays active, new end date in the future)
-- still does not trigger anything, because v_has stays true.
-- Undo: recreate the function from 20261101140000_free_plan_locks.sql.

create or replace function public.ai_interview_on_plan_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has boolean := new.status = 'active' and coalesce(new.current_period_end, '-infinity'::timestamptz) > now();
  v_had boolean := tg_op = 'UPDATE' and old.status = 'active';
begin
  if not v_has and (tg_op = 'INSERT' or v_had) then
    perform public.ai_interview_free_plan_cleanup(new.workspace_id);
  end if;
  return null;
end;
$$;
revoke all on function public.ai_interview_on_plan_change() from public, anon, authenticated;
