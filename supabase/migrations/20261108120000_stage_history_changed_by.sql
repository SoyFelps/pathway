-- Logs tab of the candidate panel: who moved a candidate. The stage history already says what moved and when; this adds WHO.
-- changed_by is the signed-in person who made the change (auth.uid()). It stays empty for entries made before this migration, for the
-- first entry of an application (the candidate applied, nobody moved anyone) and for changes made by the system.
-- If the person's account is deleted the entry stays and only the name link is dropped.
alter table public.applicant_stage_history
  add column changed_by uuid references auth.users (id) on delete set null;

create or replace function public.record_applicant_stage_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.applicant_stage_history (workspace_id, flow_id, applicant_id, from_status, to_status, kind)
    values (new.workspace_id, new.flow_id, new.id, null, new.status, 'submitted');
  elsif new.status is distinct from old.status then
    insert into public.applicant_stage_history (workspace_id, flow_id, applicant_id, from_status, to_status, kind, changed_by)
    values (new.workspace_id, new.flow_id, new.id, old.status, new.status, 'moved', auth.uid());
  end if;
  return null;
end;
$function$;
revoke all on function public.record_applicant_stage_change() from public, anon, authenticated;
grant execute on function public.record_applicant_stage_change() to service_role;
