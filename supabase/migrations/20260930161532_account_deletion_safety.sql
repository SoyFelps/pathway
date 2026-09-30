begin;

-- Preserve a workspace's flows and published snapshots when a former member's Auth identity is deleted.
-- The creator attribution becomes NULL rather than deleting or falsely reassigning workspace content.
alter table public.application_flows alter column created_by drop not null;
alter table public.published_flows alter column created_by drop not null;

alter table public.application_flows
  drop constraint if exists application_flows_created_by_fkey;
alter table public.application_flows
  add constraint application_flows_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.published_flows
  drop constraint if exists published_flows_created_by_fkey;
alter table public.published_flows
  add constraint published_flows_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

-- Keep creator/workspace immutable to clients. Permit ON DELETE SET NULL only after the referenced Auth user is gone.
create or replace function public.prevent_flow_tenant_and_creator_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'Flow workspace and creator cannot be changed.' using errcode = '42501';
  end if;
  if new.created_by is distinct from old.created_by then
    if new.created_by is null
       and old.created_by is not null
       and not exists (select 1 from auth.users u where u.id = old.created_by) then
      return new;
    end if;
    raise exception 'Flow workspace and creator cannot be changed.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_flow_tenant_and_creator_change() from public, anon, authenticated;

-- Supabase deletes sessions and refresh tokens with the Auth user, but an already-issued JWT may remain
-- valid until exp. Require its session row before allowing the account to create a new workspace.
create or replace function public.current_auth_session_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from auth.sessions s
      where s.id::text = (select auth.jwt() ->> 'session_id')
        and s.user_id = (select auth.uid())
    );
$$;
revoke all on function public.current_auth_session_is_active() from public, anon, authenticated;

create or replace function public.current_user_can_create_workspace()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_auth_session_is_active()
    and not exists (select 1 from public.workspaces w where w.owner_id = (select auth.uid()))
    and not exists (select 1 from public.workspace_members m where m.user_id = (select auth.uid()));
$$;
revoke all on function public.current_user_can_create_workspace() from public, anon;
grant execute on function public.current_user_can_create_workspace() to authenticated;

commit;
