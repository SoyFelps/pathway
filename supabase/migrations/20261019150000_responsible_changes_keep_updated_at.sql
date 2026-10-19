-- Changing only the people responsible for a job is internal: it is not shared with candidates and does not touch the
-- published job page, so it must not make the job look "changed since it was published".
-- Every other change still refreshes updated_at exactly as before.
create or replace function public.set_flow_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'responsible_user_ids' - 'updated_at') = (to_jsonb(old) - 'responsible_user_ids' - 'updated_at') then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.set_flow_updated_at() from public, anon, authenticated;
grant execute on function public.set_flow_updated_at() to service_role;

drop trigger if exists application_flows_set_updated_at on public.application_flows;
create trigger application_flows_set_updated_at
before update on public.application_flows
for each row execute function public.set_flow_updated_at();
