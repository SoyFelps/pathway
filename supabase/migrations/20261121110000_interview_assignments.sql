-- Newly added responsible people are told (owner decision, 2026-11-21): when someone is INCLUDED in the responsible people of a human interview (in the schedule
-- window when it is created, or later in the Interview tab / the Interviews page), the edge function e-mails them and this migration gives them a bell notice.
--  * candidate_interview_assignments: one row per person and interview (who was added, when, and when that person saw the notice). Written only by the edge function.
--  * get_candidate_interview_notices and get_notification_history: same signatures; they also list the person's own unseen "added" notices as state 'responsible_added'
--    (only while the interview is on and the person is still in its list).
--  * mark_candidate_interview_notice_seen: also marks the person's "added" notice of that interview as seen.
-- Additive: no existing row changes. Undo: drop the table and put the previous function bodies (20261121100000, 20261119120000) back.

create table public.candidate_interview_assignments (
  interview_id uuid not null references public.candidate_interviews (id) on delete cascade,
  user_id uuid not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  seen_at timestamptz,
  primary key (interview_id, user_id)
);
create index candidate_interview_assignments_user_idx on public.candidate_interview_assignments (user_id, workspace_id) where seen_at is null;
alter table public.candidate_interview_assignments enable row level security;
revoke all on public.candidate_interview_assignments from public, anon, authenticated;
grant all on public.candidate_interview_assignments to service_role;
comment on table public.candidate_interview_assignments is 'Who was added as responsible for a human interview and whether they saw the bell notice. Written only by the interviews edge function; read through the notice functions.';

create or replace function public.get_candidate_interview_notices(p_workspace_id uuid)
returns table (interview_id uuid, flow_id uuid, job_title text, company_name text, candidate_name text, candidate_email text, state text, starts_at timestamptz, notice_at timestamptz)
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
  select * from (
  select i.id as interview_id, i.flow_id, f.job_title, coalesce(wc.name, w.name),
         coalesce((select a.candidate_name from public.applicants a where a.id = i.applicant_id), i.candidate_email),
         i.candidate_email, (case when i.notice_reason = 'link_missing' then 'link_missing' else i.state end), i.starts_at, i.notice_at
  from public.candidate_interviews i
  join public.application_flows f on f.id = i.flow_id
  join public.workspaces w on w.id = i.workspace_id
  left join public.workspace_companies wc on wc.id = f.company_id
  where i.workspace_id = p_workspace_id
    and i.state in ('confirmed', 'declined', 'reschedule_requested')
    and i.notice_at is not null
    and (case when cardinality(i.responsible_user_ids) > 0 then auth.uid() = any (i.responsible_user_ids)
              else (cardinality(f.responsible_user_ids) = 0 or auth.uid() = any (f.responsible_user_ids)) end)
    and i.notice_at > coalesce((select m.created_at from public.workspace_members m where m.workspace_id = i.workspace_id and m.user_id = auth.uid()), '-infinity'::timestamptz)
    and not exists (select 1 from public.candidate_interview_notice_seen s where s.interview_id = i.id and s.user_id = auth.uid() and s.notice_at = i.notice_at)
  union all
  select i.id, i.flow_id, f.job_title, coalesce(wc.name, w.name),
         coalesce((select ap.candidate_name from public.applicants ap where ap.id = i.applicant_id), i.candidate_email),
         i.candidate_email, 'responsible_added'::text, i.starts_at, a.assigned_at
  from public.candidate_interview_assignments a
  join public.candidate_interviews i on i.id = a.interview_id
  join public.application_flows f on f.id = i.flow_id
  join public.workspaces w on w.id = i.workspace_id
  left join public.workspace_companies wc on wc.id = f.company_id
  where a.user_id = auth.uid() and i.workspace_id = p_workspace_id
    and a.seen_at is null
    and i.state not in ('cancelled', 'finished')
    and auth.uid() = any (i.responsible_user_ids)
    and a.assigned_at > coalesce((select m.created_at from public.workspace_members m where m.workspace_id = i.workspace_id and m.user_id = auth.uid()), '-infinity'::timestamptz)
  ) all_notices
  order by all_notices.notice_at desc
  limit 50;
end;
$$;
revoke all on function public.get_candidate_interview_notices(uuid) from public, anon;
grant execute on function public.get_candidate_interview_notices(uuid) to authenticated, service_role;

create or replace function public.get_notification_history(p_workspace_id uuid, p_utc_offset_minutes integer default 0)
returns table (
  kind text,
  event_at timestamptz,
  seen boolean,
  flow_id uuid,
  job_title text,
  company_name text,
  candidate_name text,
  candidate_email text,
  new_count integer,
  author_name text,
  impression text,
  ref_id uuid,
  state text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_since timestamptz := now() - interval '30 days';
  v_offset interval := make_interval(mins => greatest(-840, least(840, coalesce(p_utc_offset_minutes, 0))));
  v_joined timestamptz;
begin
  if auth.uid() is null or not public.workspace_user_has_permission(p_workspace_id, 'applicants') then
    raise exception 'You do not have access to applicants in this workspace.' using errcode = '42501';
  end if;
  select coalesce((select m.created_at from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = auth.uid()), '-infinity'::timestamptz)
    into v_joined;

  return query
  with mine as (
    select f.id as fid, f.job_title as title, coalesce(wc.name, w.name) as company,
      greatest(f.created_at, timestamptz '2026-10-18 12:30:00+00', v_joined) as base,
      coalesce(s.seen_at, '-infinity'::timestamptz) as seen_until
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
      (array_agg(a.status order by a.submitted_at desc))[1] as current_status,
      (array_agg(a.auto_fail_reason order by a.submitted_at))[1] as first_fail
    from public.applicants a
    join mine on mine.fid = a.flow_id
    group by a.flow_id, lower(btrim(a.candidate_email))
  ),
  new_candidates as (
    select 'new_candidates'::text as kind, max(cand.first_at) as event_at, bool_and(cand.first_at <= mine.seen_until) as seen,
      mine.fid as flow_id, mine.title as job_title, mine.company as company_name,
      null::text as candidate_name, null::text as candidate_email, count(*)::integer as new_count,
      null::text as author_name, null::text as impression, null::uuid as ref_id, null::text as state
    from cand
    join mine on mine.fid = cand.fid
    where cand.first_at > mine.base and cand.first_at >= v_since
      and cand.current_status = 'new' and cand.first_fail is null
    group by mine.fid, mine.title, mine.company, date_trunc('day', (cand.first_at at time zone 'UTC') + v_offset)
  ),
  mentions as (
    select 'mention'::text, c.created_at, (m.seen_at is not null), c.flow_id, f.job_title, null::text,
      coalesce((select a.candidate_name from public.applicants a where a.flow_id = c.flow_id and lower(btrim(a.candidate_email)) = c.candidate_email order by a.submitted_at desc limit 1), c.candidate_email),
      c.candidate_email, null::integer, c.author_name, null::text, c.id, null::text
    from public.applicant_comment_mentions m
    join public.applicant_comments c on c.id = m.comment_id
    join public.application_flows f on f.id = c.flow_id
    where m.user_id = auth.uid() and c.workspace_id = p_workspace_id and c.created_at >= v_since
  ),
  interviews as (
    select 'ai_interview'::text, i.notice_at,
      exists (select 1 from public.ai_interview_notice_seen s where s.ai_interview_id = i.id and s.user_id = auth.uid()),
      i.flow_id, f.job_title, coalesce(wc.name, w.name),
      coalesce((select a.candidate_name from public.applicants a where a.id = i.applicant_id), i.candidate_email),
      i.candidate_email, null::integer, null::text, i.impression, i.id, null::text
    from public.ai_interviews i
    join public.application_flows f on f.id = i.flow_id
    join public.workspaces w on w.id = i.workspace_id
    left join public.workspace_companies wc on wc.id = f.company_id
    where i.workspace_id = p_workspace_id
      and i.state = 'completed'
      and i.notice_at is not null
      and (cardinality(f.responsible_user_ids) = 0 or auth.uid() = any (f.responsible_user_ids))
      and i.notice_at > v_joined
      and i.notice_at >= v_since
  ),
  assigned as (
    select 'candidate_interview'::text, a.assigned_at, (a.seen_at is not null),
      i.flow_id, f.job_title, coalesce(wc.name, w.name),
      coalesce((select ap.candidate_name from public.applicants ap where ap.id = i.applicant_id), i.candidate_email),
      i.candidate_email, null::integer, null::text, null::text, i.id, 'responsible_added'::text
    from public.candidate_interview_assignments a
    join public.candidate_interviews i on i.id = a.interview_id
    join public.application_flows f on f.id = i.flow_id
    join public.workspaces w on w.id = i.workspace_id
    left join public.workspace_companies wc on wc.id = f.company_id
    where a.user_id = auth.uid() and i.workspace_id = p_workspace_id
      and i.state not in ('cancelled', 'finished')
      and auth.uid() = any (i.responsible_user_ids)
      and a.assigned_at > v_joined
      and a.assigned_at >= v_since
  ),
  human_interviews as (
    select 'candidate_interview'::text, i.notice_at,
      exists (select 1 from public.candidate_interview_notice_seen s where s.interview_id = i.id and s.user_id = auth.uid() and s.notice_at = i.notice_at),
      i.flow_id, f.job_title, coalesce(wc.name, w.name),
      coalesce((select a.candidate_name from public.applicants a where a.id = i.applicant_id), i.candidate_email),
      i.candidate_email, null::integer, null::text, null::text, i.id, (case when i.notice_reason = 'link_missing' then 'link_missing' else i.state end)
    from public.candidate_interviews i
    join public.application_flows f on f.id = i.flow_id
    join public.workspaces w on w.id = i.workspace_id
    left join public.workspace_companies wc on wc.id = f.company_id
    where i.workspace_id = p_workspace_id
      and i.state in ('confirmed', 'declined', 'reschedule_requested')
      and i.notice_at is not null
      and (case when cardinality(i.responsible_user_ids) > 0 then auth.uid() = any (i.responsible_user_ids)
                else (cardinality(f.responsible_user_ids) = 0 or auth.uid() = any (f.responsible_user_ids)) end)
      and i.notice_at > v_joined
      and i.notice_at >= v_since
  )
  select * from (
    select * from new_candidates
    union all select * from mentions
    union all select * from interviews
    union all select * from human_interviews
    union all select * from assigned
  ) all_items
  order by all_items.event_at desc
  limit 500;
end;
$$;

revoke all on function public.get_notification_history(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_notification_history(uuid, integer) to authenticated, service_role;

create or replace function public.mark_candidate_interview_notice_seen(p_interview_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_notice timestamptz;
begin
  select i.workspace_id, i.notice_at into v_workspace, v_notice from public.candidate_interviews i where i.id = p_interview_id;
  if auth.uid() is null or v_workspace is null or not public.workspace_user_has_permission(v_workspace, 'applicants') then
    raise exception 'You do not have access to applicants in this workspace.' using errcode = '42501';
  end if;
  -- the person's "you were added as responsible" notice of this interview is seen too
  update public.candidate_interview_assignments set seen_at = now() where interview_id = p_interview_id and user_id = auth.uid() and seen_at is null;
  if v_notice is null then return; end if;
  insert into public.candidate_interview_notice_seen (user_id, interview_id, notice_at)
  values (auth.uid(), p_interview_id, v_notice)
  on conflict (user_id, interview_id) do update set notice_at = excluded.notice_at, seen_at = now();
end;
$$;
revoke all on function public.mark_candidate_interview_notice_seen(uuid) from public, anon;
grant execute on function public.mark_candidate_interview_notice_seen(uuid) to authenticated, service_role;
