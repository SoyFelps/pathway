-- Read-only view of the team for every person in the workspace (owner and members, whatever their permissions).
-- Managing the team (invite, remove, change permissions) stays restricted to people with the Team permission;
-- this function only reads. Pending invitations and invitation links are NOT part of it.

create or replace function public.list_team_overview(p_workspace_id uuid)
returns table (user_id uuid, email text, is_owner boolean, can_flows boolean, can_applicants boolean, can_manage_team boolean, member_since timestamptz)
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
    select w.owner_id, u.email::text, true, true, true, true, w.created_at
    from public.workspaces w
    join auth.users u on u.id = w.owner_id
    where w.id = p_workspace_id
    union all
    select m.user_id, m.member_email, false, m.can_flows, m.can_applicants, m.can_manage_team, m.created_at
    from public.workspace_members m
    where m.workspace_id = p_workspace_id
    order by 3 desc, 7;
end;
$$;

revoke all on function public.list_team_overview(uuid) from public, anon, authenticated;
grant execute on function public.list_team_overview(uuid) to authenticated, service_role;
