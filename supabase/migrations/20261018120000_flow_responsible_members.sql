-- Flow owners ("responsible" people): which team members look after each job.
-- Stored in its own column (NOT inside flow_data), so it is never copied into the public published snapshot.
-- An empty list means "everyone" (the default and the fallback when the last responsible person leaves).

alter table public.application_flows
  add column responsible_user_ids uuid[] not null default '{}';

-- Keep the list clean on every write: only the workspace owner and current members, no duplicates, at most 20.
-- This also protects against a stale browser tab saving someone who has already left the team.
create or replace function public.clean_flow_responsible_users()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.responsible_user_ids := coalesce((
    select array_agg(u.id order by u.id)
    from (
      select distinct x.id
      from unnest(coalesce(new.responsible_user_ids, '{}'::uuid[])) as x(id)
      where x.id in (
        select w.owner_id from public.workspaces w where w.id = new.workspace_id
        union
        select m.user_id from public.workspace_members m where m.workspace_id = new.workspace_id
      )
      limit 20
    ) u
  ), '{}'::uuid[]);
  return new;
end;
$$;

create trigger application_flows_clean_responsible
  before insert or update of responsible_user_ids on public.application_flows
  for each row execute function public.clean_flow_responsible_users();

-- When a member leaves, is removed, or their account is deleted, take them off every job of that workspace.
-- A job left with nobody responsible goes back to "everyone" (empty list).
create or replace function public.remove_member_from_flow_responsibles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.application_flows
  set responsible_user_ids = array_remove(responsible_user_ids, old.user_id)
  where workspace_id = old.workspace_id
    and old.user_id = any(responsible_user_ids);
  return old;
end;
$$;

create trigger workspace_members_clear_flow_responsibles
  after delete on public.workspace_members
  for each row execute function public.remove_member_from_flow_responsibles();

-- Everyone in the workspace (owner and members, whatever their permissions) may see who is on the team,
-- so they can pick responsible people. Returns only id, e-mail and whether the person is the owner.
create or replace function public.list_workspace_people(p_workspace_id uuid)
returns table (user_id uuid, email text, is_owner boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not (
       exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_id = auth.uid())
       or exists (select 1 from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = auth.uid())
     ) then
    raise exception 'You do not have access to this workspace.' using errcode = '42501';
  end if;
  return query
    select w.owner_id, u.email::text, true
    from public.workspaces w
    join auth.users u on u.id = w.owner_id
    where w.id = p_workspace_id
    union all
    select m.user_id, m.member_email, false
    from public.workspace_members m
    where m.workspace_id = p_workspace_id
    order by 3 desc, 2;
end;
$$;

revoke all on function public.clean_flow_responsible_users() from public, anon, authenticated;
revoke all on function public.remove_member_from_flow_responsibles() from public, anon, authenticated;
revoke all on function public.list_workspace_people(uuid) from public, anon, authenticated;
grant execute on function public.clean_flow_responsible_users() to service_role;
grant execute on function public.remove_member_from_flow_responsibles() to service_role;
grant execute on function public.list_workspace_people(uuid) to authenticated, service_role;
