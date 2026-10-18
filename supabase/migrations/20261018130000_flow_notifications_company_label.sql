-- The notification shows the same company label as the rest of the app:
-- the job's company profile name, or the workspace name when the job has no company profile
-- (the company_name text stored on the flow can be stale, e.g. from before companies existed).

create or replace function public.get_flow_notifications(p_workspace_id uuid)
returns table (flow_id uuid, job_title text, company_name text, new_count integer, latest_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.workspace_user_has_permission(p_workspace_id, 'applicants') then
    raise exception 'You do not have access to applicants in this workspace.' using errcode = '42501';
  end if;
  return query
  with mine as (
    select f.id as fid, f.job_title as title, coalesce(wc.name, w.name) as company,
      greatest(
        f.created_at,
        timestamptz '2026-10-18 12:30:00+00',
        coalesce((select m.created_at from public.workspace_members m where m.workspace_id = f.workspace_id and m.user_id = auth.uid()), '-infinity'::timestamptz),
        coalesce(s.seen_at, '-infinity'::timestamptz)
      ) as since
    from public.application_flows f
    join public.workspaces w on w.id = f.workspace_id
    left join public.workspace_companies wc on wc.id = f.company_id
    left join public.flow_notification_state s on s.flow_id = f.id and s.user_id = auth.uid()
    where f.workspace_id = p_workspace_id
      and (cardinality(f.responsible_user_ids) = 0 or auth.uid() = any (f.responsible_user_ids))
  ),
  cand as (
    select a.flow_id as fid,
      min(a.submitted_at) as first_at,
      (array_agg(a.status order by a.submitted_at desc))[1] as current_status
    from public.applicants a
    join mine on mine.fid = a.flow_id
    group by a.flow_id, lower(btrim(a.candidate_email))
  )
  select mine.fid, mine.title, mine.company, count(*)::integer, max(cand.first_at)
  from mine
  join cand on cand.fid = mine.fid
  where cand.first_at > mine.since and cand.current_status <> 'failed'
  group by mine.fid, mine.title, mine.company
  order by max(cand.first_at) desc;
end;
$$;
