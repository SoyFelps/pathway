-- Step counters now remember WHERE the visit came from ("Q1 -> Q3"), so the drop-off per step is exact for any form, including
-- forms whose paths branch and meet again (counting only "reached Q3" cannot tell who came from Q1 and who came from Q2).
--  * job_step_counts gets from_node_id ('start' for the first page, 'details' for the first questions, otherwise the previous
--    question). Rows written before this migration keep from_node_id = '' and are ignored by the report.
--  * record_job_step takes the previous step and accepts only a real connection of the published form (first page ->
--    first question, or question -> question along an edge), so nothing else can be written.
--  * get_report_steps returns the transitions and starts its window on the first full day with origin-aware counters.
-- Still anonymous: no IP, no cookie, no person; the table stays closed to the app roles.

alter table public.job_step_counts add column from_node_id text not null default '' check (char_length(from_node_id) <= 80);
alter table public.job_step_counts drop constraint job_step_counts_pkey;
alter table public.job_step_counts add primary key (flow_id, day, node_id, from_node_id);

drop function if exists public.record_job_step(uuid, text);

create or replace function public.record_job_step(p_published_flow_id uuid, p_node_id text, p_from_node_id text default null)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_flow uuid;
  v_workspace uuid;
  v_snapshot jsonb;
  v_nodes jsonb;
  v_edges jsonb;
  v_from text;
begin
  if p_node_id is null or char_length(p_node_id) not between 1 and 80 then return false; end if;
  if p_from_node_id is not null and char_length(p_from_node_id) not between 1 and 80 then return false; end if;
  -- the first page has no previous step; every question must say where the visit came from
  v_from := coalesce(p_from_node_id, case when p_node_id = 'details' then 'start' end);
  if v_from is null then return false; end if;

  select f.id, f.workspace_id, pf.snapshot into v_flow, v_workspace, v_snapshot
  from public.published_flows pf
  join public.application_flows f on f.id = pf.flow_id and f.workspace_id = pf.workspace_id
  where pf.id = p_published_flow_id
    and f.publication_status = 'published'
    and f.active_published_flow_id = pf.id
    and public.flow_data_is_valid(f.flow_data);
  if v_flow is null then return false; end if;

  v_nodes := case when jsonb_typeof(v_snapshot -> 'nodes') = 'array' then v_snapshot -> 'nodes' else '[]'::jsonb end;
  v_edges := case when jsonb_typeof(v_snapshot -> 'edges') = 'array' then v_snapshot -> 'edges' else '[]'::jsonb end;

  if p_node_id = 'details' then
    if v_from <> 'start' then return false; end if;
  else
    if not exists (select 1 from jsonb_array_elements(v_nodes) n
                   where n ->> 'id' = p_node_id and n ->> 'type' in ('shortText', 'singleChoice', 'multiChoice')) then return false; end if;
    if v_from = 'details' then
      if not exists (select 1 from jsonb_array_elements(v_edges) e
                     join jsonb_array_elements(v_nodes) i on i ->> 'id' = e ->> 'fromNodeId' and i ->> 'type' = 'candidateInfo'
                     where e ->> 'toNodeId' = p_node_id) then return false; end if;
    else
      if not exists (select 1 from jsonb_array_elements(v_edges) e
                     join jsonb_array_elements(v_nodes) q on q ->> 'id' = e ->> 'fromNodeId' and q ->> 'type' in ('shortText', 'singleChoice', 'multiChoice')
                     where e ->> 'fromNodeId' = v_from and e ->> 'toNodeId' = p_node_id) then return false; end if;
    end if;
  end if;

  insert into public.job_step_counts as c (flow_id, workspace_id, day, node_id, from_node_id, n)
  values (v_flow, v_workspace, (now() at time zone 'utc')::date, p_node_id, v_from, 1)
  on conflict (flow_id, day, node_id, from_node_id) do update set n = c.n + 1;
  return true;
end;
$function$;
revoke all on function public.record_job_step(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_job_step(uuid, text, text) to service_role;

create or replace function public.get_report_steps(
  p_workspace_id uuid, p_flow_id uuid, p_from date default null, p_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_new date;
  v_legacy date;
  v_since date;
  v_from date;
  v_to date;
  v_active uuid;
  v_snapshot jsonb;
  v_result jsonb;
begin
  if auth.uid() is null or not public.workspace_user_has_permission(p_workspace_id, 'reports') then
    raise exception 'You do not have permission to view the reports.' using errcode = '42501';
  end if;
  select f.active_published_flow_id into v_active
  from public.application_flows f where f.id = p_flow_id and f.workspace_id = p_workspace_id;
  if not found then raise exception 'This job could not be found.' using errcode = '22023'; end if;

  -- Counters written before origins were recorded (from_node_id = '') cannot be used for the drop per step, so the window
  -- starts on the first full day after them.
  select min(c.day) into v_new from public.job_step_counts c where c.flow_id = p_flow_id and c.workspace_id = p_workspace_id and c.from_node_id <> '';
  if v_new is null then return jsonb_build_object('hasData', false); end if;
  select max(c.day) into v_legacy from public.job_step_counts c where c.flow_id = p_flow_id and c.workspace_id = p_workspace_id and c.from_node_id = '';
  v_since := greatest(v_new, coalesce(v_legacy + 1, v_new));

  v_to := least(coalesce(p_to, v_today), v_today);
  if v_since > v_to then return jsonb_build_object('hasData', false); end if;
  v_from := greatest(coalesce(p_from, v_since), v_since);
  if v_from > v_to then v_from := v_to; end if;

  select pf.snapshot into v_snapshot
  from public.published_flows pf
  where pf.flow_id = p_flow_id and pf.workspace_id = p_workspace_id
  order by (pf.id = v_active) desc, pf.created_at desc
  limit 1;

  select jsonb_build_object(
    'hasData', true,
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'since', v_since,
    'views', coalesce((select sum(e.n) from public.job_event_counts e
                       where e.flow_id = p_flow_id and e.workspace_id = p_workspace_id and e.event = 'view' and e.day between v_from and v_to), 0),
    'starts', coalesce((select sum(e.n) from public.job_event_counts e
                        where e.flow_id = p_flow_id and e.workspace_id = p_workspace_id and e.event = 'start' and e.day between v_from and v_to), 0),
    'submitted', (select count(*) from public.applicants a
                  where a.workspace_id = p_workspace_id and a.flow_id = p_flow_id
                    and (a.submitted_at at time zone 'utc')::date between v_from and v_to),
    -- how many visits moved from one step to the next ("from>to"); "start>details" is the first page being completed
    'transitions', coalesce((select jsonb_object_agg(x.k, x.n)
                             from (select c.from_node_id || '>' || c.node_id as k, sum(c.n)::bigint as n from public.job_step_counts c
                                   where c.flow_id = p_flow_id and c.workspace_id = p_workspace_id and c.from_node_id <> '' and c.day between v_from and v_to
                                   group by 1) x), '{}'::jsonb),
    'completions', coalesce((select jsonb_object_agg(x.node_id, x.n)
                             from (select coalesce(a.responses -> (jsonb_array_length(a.responses) - 1) ->> 'nodeId', 'details') as node_id, count(*) as n
                                   from public.applicants a
                                   where a.workspace_id = p_workspace_id and a.flow_id = p_flow_id
                                     and (a.submitted_at at time zone 'utc')::date between v_from and v_to
                                   group by 1) x), '{}'::jsonb),
    'nodes', coalesce((select jsonb_agg(jsonb_build_object('id', n ->> 'id', 'type', n ->> 'type', 'label', left(coalesce(n ->> 'label', ''), 200), 'subtype', n ->> 'subtype'))
                       from jsonb_array_elements(case when jsonb_typeof(v_snapshot -> 'nodes') = 'array' then v_snapshot -> 'nodes' else '[]'::jsonb end) n), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(jsonb_build_object('from', e ->> 'fromNodeId', 'to', e ->> 'toNodeId', 'option', e ->> 'optionValue'))
                       from jsonb_array_elements(case when jsonb_typeof(v_snapshot -> 'edges') = 'array' then v_snapshot -> 'edges' else '[]'::jsonb end) e), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.get_report_steps(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function public.get_report_steps(uuid, uuid, date, date) to authenticated, service_role;
