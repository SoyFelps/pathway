-- The "All notifications" page lists the candidates' answers to interview invitations, like the bell does.
--
-- Owner decision (2026-11-18): everything that appears in the bell must also appear on the notifications page. The bell already shows
-- the answers to human-interview invitations (confirmed / cannot attend / asked for another time, migration 20261119120000), but
-- get_notification_history did not. Now it adds a fourth kind, 'candidate_interview', with the same rules as the bell
-- (get_candidate_interview_notices): only people responsible for the job (or everybody when nobody is named), only answers after the
-- person joined the workspace, and "seen" = the person opened that very answer (candidate_interview_notice_seen with the same notice_at).
--
-- The result gets a new column (`state`, the answer), and a function cannot change its result columns in place: it is dropped and
-- created again with the same name, arguments and grants. Nothing else calls it except the browser.
-- Undo: drop it and put back the body of 20261103160000.

drop function if exists public.get_notification_history(uuid, integer);

create function public.get_notification_history(p_workspace_id uuid, p_utc_offset_minutes integer default 0)
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
  human_interviews as (
    select 'candidate_interview'::text, i.notice_at,
      exists (select 1 from public.candidate_interview_notice_seen s where s.interview_id = i.id and s.user_id = auth.uid() and s.notice_at = i.notice_at),
      i.flow_id, f.job_title, coalesce(wc.name, w.name),
      coalesce((select a.candidate_name from public.applicants a where a.id = i.applicant_id), i.candidate_email),
      i.candidate_email, null::integer, null::text, null::text, i.id, i.state
    from public.candidate_interviews i
    join public.application_flows f on f.id = i.flow_id
    join public.workspaces w on w.id = i.workspace_id
    left join public.workspace_companies wc on wc.id = f.company_id
    where i.workspace_id = p_workspace_id
      and i.state in ('confirmed', 'declined', 'reschedule_requested')
      and i.notice_at is not null
      and (cardinality(f.responsible_user_ids) = 0 or auth.uid() = any (f.responsible_user_ids))
      and i.notice_at > v_joined
      and i.notice_at >= v_since
  )
  select * from (
    select * from new_candidates
    union all select * from mentions
    union all select * from interviews
    union all select * from human_interviews
  ) all_items
  order by all_items.event_at desc
  limit 500;
end;
$$;

revoke all on function public.get_notification_history(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_notification_history(uuid, integer) to authenticated, service_role;
