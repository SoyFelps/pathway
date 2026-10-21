-- Where candidates drop off, step by step, for ONE job (shown inside Reports when a job is chosen).
-- get_report_steps returns the raw ingredients; the page works out the order and the drop per step:
--  * nodes / edges: the steps and connections of the job's PUBLISHED form (the version candidates see);
--  * counts: how many visits reached each step (job_step_counts: "details" = the first page was completed, then each question);
--  * completions: how many applications ended at each step (the last question answered), taken from the saved applications,
--    so people who reached an ending are not counted as "left";
--  * views / starts / submitted: the page counters and the saved applications, over the SAME days as the step counters.
-- The window starts at the first day this job has step counters, so the funnel never mixes days that were only partly recorded.
-- Aggregated numbers only: no name, e-mail or answer text is returned. No new table, so no new grants.

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

  select min(c.day) into v_since from public.job_step_counts c where c.flow_id = p_flow_id and c.workspace_id = p_workspace_id;
  if v_since is null then return jsonb_build_object('hasData', false); end if;

  v_to := least(coalesce(p_to, v_today), v_today);
  v_from := greatest(coalesce(p_from, v_since), v_since);
  if v_from > v_to then v_from := v_to; end if;

  -- The form candidates see now (or, when the job is paused, the last one that was published).
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
    'counts', coalesce((select jsonb_object_agg(x.node_id, x.n)
                        from (select c.node_id, sum(c.n)::bigint as n from public.job_step_counts c
                              where c.flow_id = p_flow_id and c.workspace_id = p_workspace_id and c.day between v_from and v_to
                              group by c.node_id) x), '{}'::jsonb),
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
