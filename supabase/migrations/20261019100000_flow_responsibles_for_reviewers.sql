-- Read-only: who is responsible for a job, for anyone who can review that workspace's candidates.
-- People who only have the Candidates permission cannot read the flows table, so the applicant panel asks this function.
-- It returns {"everyone": true, "people": []} when the job is set to "All", otherwise the e-mail addresses of the
-- responsible people (the list is already cleaned of people who left the team).

create or replace function public.get_flow_responsibles(p_flow_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_ids uuid[];
  v_people jsonb;
begin
  select f.workspace_id, f.responsible_user_ids into v_workspace, v_ids
  from public.application_flows f where f.id = p_flow_id;
  if auth.uid() is null or v_workspace is null or not public.workspace_user_has_permission(v_workspace, 'applicants') then
    raise exception 'You do not have access to applicants in this workspace.' using errcode = '42501';
  end if;
  if coalesce(cardinality(v_ids), 0) = 0 then
    return jsonb_build_object('everyone', true, 'people', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('email', p.email, 'isOwner', p.is_owner) order by p.is_owner desc, p.email), '[]'::jsonb)
  into v_people
  from (
    select u.email::text as email, true as is_owner
    from public.workspaces w join auth.users u on u.id = w.owner_id
    where w.id = v_workspace and w.owner_id = any (v_ids)
    union all
    select m.member_email, false
    from public.workspace_members m
    where m.workspace_id = v_workspace and m.user_id = any (v_ids)
  ) p;
  return jsonb_build_object('everyone', false, 'people', v_people);
end;
$$;

revoke all on function public.get_flow_responsibles(uuid) from public, anon, authenticated;
grant execute on function public.get_flow_responsibles(uuid) to authenticated, service_role;
