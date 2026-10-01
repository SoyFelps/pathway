alter table public.application_flows
  add column if not exists published_at timestamptz;

update public.application_flows f
set published_at = pf.created_at
from public.published_flows pf
where f.publication_status = 'published'
  and f.active_published_flow_id = pf.id
  and f.id = pf.flow_id
  and f.workspace_id = pf.workspace_id
  and f.published_at is null;

create or replace function public.set_flow_published_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.publication_status = 'published' then
      new.published_at := now();
    end if;
  elsif new.publication_status = 'published'
    and (old.publication_status is distinct from new.publication_status
      or old.active_published_flow_id is distinct from new.active_published_flow_id) then
    new.published_at := now();
  elsif new.publication_status <> 'published' then
    new.published_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.set_flow_published_at() from public, anon, authenticated;
drop trigger if exists application_flows_set_published_at on public.application_flows;
create trigger application_flows_set_published_at
before insert or update of publication_status, active_published_flow_id on public.application_flows
for each row execute function public.set_flow_published_at();

create or replace function public.update_published_flow_snapshot(p_flow_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_publication_id uuid;
  v_snapshot jsonb;
  v_published_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Sign in to publish flow changes.' using errcode = '42501';
  end if;

  select f.workspace_id, f.active_published_flow_id, f.flow_data
    into v_workspace_id, v_publication_id, v_snapshot
  from public.application_flows f
  where f.id = p_flow_id
    and f.publication_status = 'published'
  for update;

  if not found or v_publication_id is null then
    raise exception 'This flow does not have an active public link to update.' using errcode = '23514';
  end if;
  if not public.workspace_user_has_permission(v_workspace_id, 'flows') then
    raise exception 'You do not have permission to publish changes to this flow.' using errcode = '42501';
  end if;
  if not public.workspace_has_active_subscription(v_workspace_id) then
    raise exception 'An active subscription is required to publish job flows.' using errcode = '42501';
  end if;

  update public.published_flows pf
  set snapshot = v_snapshot
  where pf.id = v_publication_id
    and pf.flow_id = p_flow_id
    and pf.workspace_id = v_workspace_id;

  if not found then
    raise exception 'The active public form could not be found.' using errcode = '23514';
  end if;

  update public.application_flows f
  set published_at = now()
  where f.id = p_flow_id
    and f.workspace_id = v_workspace_id
  returning f.published_at into v_published_at;

  return v_published_at;
end;
$$;
revoke all on function public.update_published_flow_snapshot(uuid) from public, anon;
grant execute on function public.update_published_flow_snapshot(uuid) to authenticated;
