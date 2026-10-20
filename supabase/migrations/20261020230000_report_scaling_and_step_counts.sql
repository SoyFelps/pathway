-- Reports that scale, and the capture of "how far candidates got" in the form.
--  1) job_step_counts: anonymous daily counters of how many visits reached each step of a job's form
--     ("details" = the first page with name, e-mail and resume, then every question). No IP, no cookie, no person.
--     Phase 1 is capture only; the page that shows the drop-off comes later (it cannot be rebuilt from old data).
--  2) record_job_step: called only by the candidate intake function. It accepts only a step that exists in the job's
--     published form, so nothing else can be written.
--  3) get_workspace_report gets a company filter and no longer returns the list of jobs (it was capped at 100 and had
--     no search). The auto-fail reasons are returned only when ONE job is chosen, grouped by question.
--  4) get_report_jobs: the list of jobs with search, sorting and paging (the database counts, so there is no cap).
-- New table: RLS on, no access for the app roles (only the security-definer report functions and the service role read it).

-- 1) Step counters ------------------------------------------------------------------------------------------------
create table public.job_step_counts (
  flow_id uuid not null references public.application_flows(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  day date not null,
  node_id text not null check (char_length(node_id) between 1 and 80),
  n integer not null default 0,
  primary key (flow_id, day, node_id)
);
alter table public.job_step_counts enable row level security;
revoke all on public.job_step_counts from public, anon, authenticated;
grant all on public.job_step_counts to service_role;

create or replace function public.record_job_step(p_published_flow_id uuid, p_node_id text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_flow uuid;
  v_workspace uuid;
begin
  if p_node_id is null or char_length(p_node_id) not between 1 and 80 then return false; end if;
  select f.id, f.workspace_id into v_flow, v_workspace
  from public.published_flows pf
  join public.application_flows f on f.id = pf.flow_id and f.workspace_id = pf.workspace_id
  where pf.id = p_published_flow_id
    and f.publication_status = 'published'
    and f.active_published_flow_id = pf.id
    and public.flow_data_is_valid(f.flow_data)
    and (
      p_node_id = 'details'
      or (case when jsonb_typeof(pf.snapshot -> 'nodes') = 'array' then exists (
            select 1 from jsonb_array_elements(pf.snapshot -> 'nodes') n
            where n ->> 'id' = p_node_id and n ->> 'type' in ('shortText', 'singleChoice', 'multiChoice')
          ) else false end)
    );
  if v_flow is null then return false; end if;
  insert into public.job_step_counts as c (flow_id, workspace_id, day, node_id, n)
  values (v_flow, v_workspace, (now() at time zone 'utc')::date, p_node_id, 1)
  on conflict (flow_id, day, node_id) do update set n = c.n + 1;
  return true;
end;
$function$;
revoke all on function public.record_job_step(uuid, text) from public, anon, authenticated;
grant execute on function public.record_job_step(uuid, text) to service_role;

-- 2) The overview report ------------------------------------------------------------------------------------------
drop function if exists public.get_workspace_report(uuid, date, date, uuid);

create or replace function public.get_workspace_report(
  p_workspace_id uuid, p_from date default null, p_to date default null, p_flow_id uuid default null, p_company text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_to date;
  v_from date;
  v_counter_since date;
  v_history_since date;
  v_first_app date;
  v_company_id uuid;
  v_no_company boolean := false;
  v_flow_ids uuid[];
  v_result jsonb;
begin
  if auth.uid() is null or not public.workspace_user_has_permission(p_workspace_id, 'reports') then
    raise exception 'You do not have permission to view the reports.' using errcode = '42501';
  end if;
  if p_flow_id is not null and not exists (select 1 from public.application_flows f where f.id = p_flow_id and f.workspace_id = p_workspace_id) then
    raise exception 'This job could not be found.' using errcode = '22023';
  end if;
  if p_company is not null and p_company <> '' then
    if p_company = 'none' then v_no_company := true;
    elsif p_company ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_company_id := p_company::uuid;
    else raise exception 'This company could not be found.' using errcode = '22023';
    end if;
  end if;

  -- The jobs this report is about: the chosen job, or every job (optionally of one company).
  select coalesce(array_agg(f.id), '{}') into v_flow_ids
  from public.application_flows f
  where f.workspace_id = p_workspace_id
    and (
      p_flow_id = f.id
      or (p_flow_id is null and (
            (v_company_id is null and not v_no_company)
            or (v_no_company and f.company_id is null)
            or f.company_id = v_company_id))
    );

  select min(c.day) into v_counter_since from public.job_event_counts c where c.workspace_id = p_workspace_id;
  select min((h.changed_at at time zone 'utc')::date) into v_history_since
    from public.applicant_stage_history h where h.workspace_id = p_workspace_id and h.kind <> 'backfill';
  select min((a.submitted_at at time zone 'utc')::date) into v_first_app
    from public.applicants a where a.workspace_id = p_workspace_id and a.flow_id = any (v_flow_ids);

  v_to := least(coalesce(p_to, v_today), v_today);
  v_from := coalesce(p_from, least(v_to, coalesce(v_first_app, v_to), coalesce(v_counter_since, v_to)));
  if v_from > v_to then v_from := v_to; end if;
  if v_to - v_from > 730 then v_from := v_to - 730; end if;

  with apps_all as (
    select a.flow_id, lower(btrim(a.candidate_email)) as email, a.status, a.submitted_at, a.auto_fail_reason,
           (a.submitted_at at time zone 'utc')::date as day
    from public.applicants a
    where a.workspace_id = p_workspace_id and a.flow_id = any (v_flow_ids)
  ),
  cand_all as (
    select ap.flow_id, ap.email,
           min(ap.submitted_at) as first_at,
           (array_agg(ap.status order by ap.submitted_at desc))[1] as status,
           (array_agg(ap.auto_fail_reason order by ap.submitted_at asc) filter (where ap.auto_fail_reason is not null))[1] as reason
    from apps_all ap
    group by ap.flow_id, ap.email
  ),
  cand_in as (
    select c.*, (c.first_at at time zone 'utc')::date as day
    from cand_all c
    where (c.first_at at time zone 'utc')::date between v_from and v_to
  ),
  apps_in as (select * from apps_all where day between v_from and v_to),
  ev as (
    select e.flow_id, e.day, e.event, e.n
    from public.job_event_counts e
    where e.workspace_id = p_workspace_id and e.flow_id = any (v_flow_ids) and e.day between v_from and v_to
  ),
  -- one row per auto-fail reason of a candidate (a candidate can have several, separated by "; ")
  parts as (
    select regexp_replace(x.part, '^Answered ([0-9]+) to ("[^"]*") \(minimum ([0-9]+)\)$', 'Entered a number below \3 for \2') as reason,
           coalesce((regexp_match(x.part, ' (?:to|for) "([^"]*)"(?: \(minimum [0-9]+\))?$'))[1], 'Not a match this time (ending)') as question
    from cand_in c, lateral regexp_split_to_table(c.reason, '; (?=Answered |Selected |Reached )') as x(part)
    where p_flow_id is not null and c.reason is not null
  ),
  days as (select d::date as day from generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') d)
  select jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'dataSince', jsonb_build_object('counters', v_counter_since, 'history', v_history_since, 'firstApplication', v_first_app),
    'jobCount', (select count(*) from public.application_flows f where f.workspace_id = p_workspace_id),
    'jobsInScope', coalesce(array_length(v_flow_ids, 1), 0),
    'selectedJob', (select jsonb_build_object('id', f.id, 'title', f.job_title, 'company', f.company_name)
                    from public.application_flows f where f.id = p_flow_id and f.workspace_id = p_workspace_id),
    'companies', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name) order by k.created_at)
                           from public.workspace_companies k where k.workspace_id = p_workspace_id), '[]'::jsonb),
    'hasJobsWithoutCompany', exists (select 1 from public.application_flows f where f.workspace_id = p_workspace_id and f.company_id is null),
    'totals', jsonb_build_object(
      'views', coalesce((select sum(n) from ev where event = 'view'), 0),
      'starts', coalesce((select sum(n) from ev where event = 'start'), 0),
      'candidates', (select count(*) from cand_in),
      'applications', (select count(*) from apps_in),
      'autoFailed', (select count(*) from cand_in where reason is not null),
      -- applications sent on days that the page counters already covered, so the completion rate compares like with like
      'funnelApplications', (select count(*) from apps_in where v_counter_since is not null and day >= v_counter_since)
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day,
        'views', coalesce((select sum(n) from ev where ev.day = d.day and ev.event = 'view'), 0),
        'starts', coalesce((select sum(n) from ev where ev.day = d.day and ev.event = 'start'), 0),
        'candidates', (select count(*) from cand_in where cand_in.day = d.day),
        'applications', (select count(*) from apps_in where apps_in.day = d.day)
      ) order by d.day), '[]'::jsonb)
      from days d
    ),
    'stages', (
      select coalesce(jsonb_agg(jsonb_build_object('status', s.status, 'n', s.n) order by s.n desc, s.status), '[]'::jsonb)
      from (select status, count(*) as n from cand_in group by status) s
    ),
    -- The reasons are specific to one job's form, so they are listed only when a single job is chosen: grouped by question.
    'autoFailGroups', case when p_flow_id is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object('question', g.question, 'n', g.n, 'reasons', g.reasons) order by g.n desc, g.question), '[]'::jsonb)
      from (
        select p.question, count(*) as n,
               (select jsonb_agg(jsonb_build_object('reason', r.reason, 'n', r.n) order by r.n desc, r.reason)
                from (select p2.reason, count(*) as n from parts p2 where p2.question = p.question group by p2.reason) r) as reasons
        from parts p
        group by p.question
        order by 2 desc
        limit 20
      ) g
    ) end
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.get_workspace_report(uuid, date, date, uuid, text) from public, anon, authenticated;
grant execute on function public.get_workspace_report(uuid, date, date, uuid, text) to authenticated, service_role;

-- 3) The list of jobs ----------------------------------------------------------------------------------------------
create or replace function public.get_report_jobs(
  p_workspace_id uuid, p_from date default null, p_to date default null, p_company text default null,
  p_search text default null, p_sort text default 'candidates', p_limit integer default 10, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_to date;
  v_from date;
  v_counter_since date;
  v_company_id uuid;
  v_no_company boolean := false;
  v_limit integer;
  v_offset integer;
  v_search text;
  v_sort text;
  v_result jsonb;
begin
  if auth.uid() is null or not public.workspace_user_has_permission(p_workspace_id, 'reports') then
    raise exception 'You do not have permission to view the reports.' using errcode = '42501';
  end if;
  if p_company is not null and p_company <> '' then
    if p_company = 'none' then v_no_company := true;
    elsif p_company ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_company_id := p_company::uuid;
    else raise exception 'This company could not be found.' using errcode = '22023';
    end if;
  end if;
  v_to := least(coalesce(p_to, v_today), v_today);
  v_from := coalesce(p_from, v_to - 730);
  if v_from > v_to then v_from := v_to; end if;
  if v_to - v_from > 730 then v_from := v_to - 730; end if;
  v_limit := greatest(1, least(coalesce(p_limit, 10), 50));
  v_offset := greatest(0, coalesce(p_offset, 0));
  v_search := lower(btrim(coalesce(p_search, '')));
  v_sort := case when p_sort in ('candidates', 'visits', 'completion', 'autofail') then p_sort else 'candidates' end;
  select min(c.day) into v_counter_since from public.job_event_counts c where c.workspace_id = p_workspace_id;

  with jobs as (
    select f.id, f.job_title as title, f.company_name as company, f.publication_status as status,
      coalesce((select sum(e.n) from public.job_event_counts e where e.flow_id = f.id and e.event = 'view' and e.day between v_from and v_to), 0) as views,
      coalesce((select sum(e.n) from public.job_event_counts e where e.flow_id = f.id and e.event = 'start' and e.day between v_from and v_to), 0) as starts,
      (select count(*) from (
         select 1 from public.applicants a where a.workspace_id = p_workspace_id and a.flow_id = f.id
         group by lower(btrim(a.candidate_email))
         having (min(a.submitted_at) at time zone 'utc')::date between v_from and v_to
       ) q) as candidates,
      (select count(*) from public.applicants a where a.workspace_id = p_workspace_id and a.flow_id = f.id
         and (a.submitted_at at time zone 'utc')::date between v_from and v_to) as applications,
      (select count(*) from public.applicants a where a.workspace_id = p_workspace_id and a.flow_id = f.id
         and (a.submitted_at at time zone 'utc')::date between v_from and v_to
         and v_counter_since is not null and (a.submitted_at at time zone 'utc')::date >= v_counter_since) as funnel_apps,
      (select count(*) from (
         select 1 from public.applicants a where a.workspace_id = p_workspace_id and a.flow_id = f.id
         group by lower(btrim(a.candidate_email))
         having (min(a.submitted_at) at time zone 'utc')::date between v_from and v_to and bool_or(a.auto_fail_reason is not null)
       ) q) as auto_failed
    from public.application_flows f
    where f.workspace_id = p_workspace_id
      and ((v_company_id is null and not v_no_company) or (v_no_company and f.company_id is null) or f.company_id = v_company_id)
      and (v_search = '' or position(v_search in lower(f.job_title)) > 0 or position(v_search in lower(f.company_name)) > 0)
  ),
  ranked as (
    select j.*, row_number() over (
      order by
        (case when v_sort = 'candidates' then j.candidates end) desc nulls last,
        (case when v_sort = 'visits' then j.views end) desc nulls last,
        (case when v_sort = 'completion' then (case when j.starts > 0 then least(1::numeric, j.funnel_apps::numeric / j.starts) else -1 end) end) desc nulls last,
        (case when v_sort = 'autofail' then (case when j.candidates > 0 then j.auto_failed::numeric / j.candidates else -1 end) end) desc nulls last,
        j.candidates desc, j.views desc, j.title, j.id
    ) as rn
    from jobs j
  )
  select jsonb_build_object(
    'total', (select count(*) from jobs),
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'title', r.title, 'company', r.company, 'status', r.status,
        'views', r.views, 'starts', r.starts, 'candidates', r.candidates, 'applications', r.applications,
        'funnelApplications', r.funnel_apps, 'autoFailed', r.auto_failed
      ) order by r.rn)
      from ranked r where r.rn > v_offset and r.rn <= v_offset + v_limit
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.get_report_jobs(uuid, date, date, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.get_report_jobs(uuid, date, date, text, text, text, integer, integer) to authenticated, service_role;
