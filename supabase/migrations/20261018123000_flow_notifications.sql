-- In-app notifications: one notification per job, "There are new applications for <job>".
-- Nothing is stored per application. Each person has a "seen until" time per job; the notification exists while
-- candidates whose FIRST application is newer than that time are waiting. Opening the job's applicants board
-- moves "seen until" to now, so the notification disappears and the next new candidate brings it back.
--
-- Rules: only people with the Candidates permission; only the job's responsible people (everyone when the job is
-- set to "All"); repeat applications from the same e-mail are not new candidates; candidates in Failed do not count.

create table public.flow_notification_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  flow_id uuid not null references public.application_flows(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, flow_id)
);
create index flow_notification_state_flow_idx on public.flow_notification_state(flow_id);

-- Nobody reads or writes this table directly; the two functions below do it for the signed-in person.
alter table public.flow_notification_state enable row level security;
revoke all on public.flow_notification_state from public, anon, authenticated;
grant all on public.flow_notification_state to service_role;

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
    select f.id as fid, f.job_title as title, f.company_name as company,
      -- Candidates that applied before this feature existed, before the job existed, or before this person joined never notify.
      greatest(
        f.created_at,
        timestamptz '2026-10-18 12:30:00+00',
        coalesce((select m.created_at from public.workspace_members m where m.workspace_id = f.workspace_id and m.user_id = auth.uid()), '-infinity'::timestamptz),
        coalesce(s.seen_at, '-infinity'::timestamptz)
      ) as since
    from public.application_flows f
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

create or replace function public.mark_flow_notification_seen(p_flow_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  select f.workspace_id into v_workspace from public.application_flows f where f.id = p_flow_id;
  if auth.uid() is null or v_workspace is null or not public.workspace_user_has_permission(v_workspace, 'applicants') then
    raise exception 'You do not have access to applicants in this workspace.' using errcode = '42501';
  end if;
  insert into public.flow_notification_state (user_id, flow_id, seen_at)
  values (auth.uid(), p_flow_id, now())
  on conflict (user_id, flow_id) do update set seen_at = excluded.seen_at;
end;
$$;

revoke all on function public.get_flow_notifications(uuid) from public, anon, authenticated;
revoke all on function public.mark_flow_notification_seen(uuid) from public, anon, authenticated;
grant execute on function public.get_flow_notifications(uuid) to authenticated, service_role;
grant execute on function public.mark_flow_notification_seen(uuid) to authenticated, service_role;
