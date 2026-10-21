-- Form versions: when the STRUCTURE of a job's published form changes, a new version starts, and the counters that feed
-- "Where candidates drop off" are kept per version (so a change can be compared with what came before).
--  * job_form_versions: one row per version (compact copy of the form: steps, connections, labels). Closed to the app roles.
--  * A version starts when the steps, their types, the connections, "numbers only", the endings or the optional first-page
--    fields change. Renaming a question does NOT start a version: the latest version just gets the new text.
--  * It is created by a trigger on the published form (first publish, publish of changes, publish after unpublishing).
--  * job_event_counts / job_step_counts get version_id. Every OTHER report keeps summing all versions together, so nothing
--    else changes. The candidate pages and the intake function are untouched (the counting functions look the version up).
--  * get_report_steps takes an optional version and returns the list of versions, so the page can offer a selector.
-- Aggregated numbers only. The new table has RLS on and no access for the app roles (only security-definer functions read it).

-- 1) Versions ------------------------------------------------------------------------------------------------------
create table public.job_form_versions (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.application_flows(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  version_no integer not null check (version_no >= 1),
  signature text not null,
  structure jsonb not null,
  created_at timestamptz not null default now(),
  unique (flow_id, version_no)
);
create index job_form_versions_flow_idx on public.job_form_versions (flow_id, created_at desc);
alter table public.job_form_versions enable row level security;
revoke all on public.job_form_versions from public, anon, authenticated;
grant all on public.job_form_versions to service_role;

-- A compact copy of a published form: no positions, no descriptions, no auto-fail rules.
create or replace function public.form_structure(p_snapshot jsonb)
returns jsonb
language sql
immutable
set search_path to ''
as $function$
  select jsonb_build_object(
    'nodes', coalesce((select jsonb_agg(jsonb_build_object(
                'id', n ->> 'id', 'type', n ->> 'type', 'label', left(coalesce(n ->> 'label', ''), 200),
                'subtype', n ->> 'subtype', 'numericOnly', (n -> 'numericOnly') = 'true'::jsonb) order by n ->> 'id')
              from jsonb_array_elements(case when jsonb_typeof(p_snapshot -> 'nodes') = 'array' then p_snapshot -> 'nodes' else '[]'::jsonb end) n), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(jsonb_build_object('from', e ->> 'fromNodeId', 'to', e ->> 'toNodeId', 'option', e ->> 'optionValue')
                order by e ->> 'fromNodeId', e ->> 'toNodeId', coalesce(e ->> 'optionValue', ''))
              from jsonb_array_elements(case when jsonb_typeof(p_snapshot -> 'edges') = 'array' then p_snapshot -> 'edges' else '[]'::jsonb end) e), '[]'::jsonb),
    'fields', coalesce((select jsonb_agg(f.key order by f.key)
              from jsonb_each(case when jsonb_typeof(p_snapshot -> 'candidateInfoFields') = 'object' then p_snapshot -> 'candidateInfoFields' else '{}'::jsonb end) f
              where f.value = 'true'::jsonb), '[]'::jsonb)
  )
$function$;

-- What makes two forms "the same version": everything in the structure except the question texts.
create or replace function public.form_signature(p_structure jsonb)
returns text
language sql
immutable
set search_path to ''
as $function$
  select md5(jsonb_build_object(
    'nodes', coalesce((select jsonb_agg(n - 'label' order by n ->> 'id') from jsonb_array_elements(p_structure -> 'nodes') n), '[]'::jsonb),
    'edges', p_structure -> 'edges',
    'fields', p_structure -> 'fields')::text)
$function$;
revoke all on function public.form_structure(jsonb) from public, anon, authenticated;
revoke all on function public.form_signature(jsonb) from public, anon, authenticated;
grant execute on function public.form_structure(jsonb) to service_role;
grant execute on function public.form_signature(jsonb) to service_role;

-- Starts a new version when the structure differs from the latest one; otherwise only refreshes the question texts.
create or replace function public.sync_form_version(p_flow_id uuid, p_workspace_id uuid, p_snapshot jsonb)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_structure jsonb := public.form_structure(p_snapshot);
  v_signature text;
  v_last public.job_form_versions%rowtype;
  v_id uuid;
begin
  v_signature := public.form_signature(v_structure);
  select * into v_last from public.job_form_versions where flow_id = p_flow_id order by created_at desc, version_no desc limit 1;
  if not found then
    insert into public.job_form_versions (flow_id, workspace_id, version_no, signature, structure)
    values (p_flow_id, p_workspace_id, 1, v_signature, v_structure) returning id into v_id;
  elsif v_last.signature <> v_signature then
    insert into public.job_form_versions (flow_id, workspace_id, version_no, signature, structure)
    values (p_flow_id, p_workspace_id, v_last.version_no + 1, v_signature, v_structure) returning id into v_id;
  else
    if v_last.structure is distinct from v_structure then
      update public.job_form_versions set structure = v_structure where id = v_last.id;
    end if;
    v_id := v_last.id;
  end if;
  return v_id;
end;
$function$;
revoke all on function public.sync_form_version(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_form_version(uuid, uuid, jsonb) to service_role;

-- The version a visit belongs to right now (one indexed lookup; a form without any version gets its first one here).
create or replace function public.current_form_version(p_flow_id uuid, p_workspace_id uuid, p_snapshot jsonb)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
begin
  select v.id into v_id from public.job_form_versions v where v.flow_id = p_flow_id order by v.created_at desc, v.version_no desc limit 1;
  if v_id is null then v_id := public.sync_form_version(p_flow_id, p_workspace_id, p_snapshot); end if;
  return v_id;
end;
$function$;
revoke all on function public.current_form_version(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.current_form_version(uuid, uuid, jsonb) to service_role;

create or replace function public.published_flow_form_version()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform public.sync_form_version(new.flow_id, new.workspace_id, new.snapshot);
  return null;
end;
$function$;
revoke all on function public.published_flow_form_version() from public, anon, authenticated;
grant execute on function public.published_flow_form_version() to service_role;

create trigger published_flows_form_version
  after insert or update of snapshot on public.published_flows
  for each row execute function public.published_flow_form_version();

-- 2) Existing jobs: version 1 is the form as it is now, from the first publication (or the first application) on --------
insert into public.job_form_versions (flow_id, workspace_id, version_no, signature, structure, created_at)
select f.id, f.workspace_id, 1, public.form_signature(public.form_structure(s.snapshot)), public.form_structure(s.snapshot),
       least(s.first_published, coalesce(ap.first_application, s.first_published))
from public.application_flows f
join lateral (
  select pf.snapshot, (select min(p2.created_at) from public.published_flows p2 where p2.flow_id = f.id) as first_published
  from public.published_flows pf where pf.flow_id = f.id
  order by (pf.id = f.active_published_flow_id) desc, pf.created_at desc limit 1
) s on true
left join lateral (select min(a.submitted_at) as first_application from public.applicants a where a.flow_id = f.id) ap on true;

-- 3) The counters remember their version (the other reports still sum every version) ----------------------------------
alter table public.job_event_counts add column version_id uuid references public.job_form_versions(id) on delete cascade;
update public.job_event_counts c set version_id = v.id from public.job_form_versions v where v.flow_id = c.flow_id and v.version_no = 1;
delete from public.job_event_counts where version_id is null;
alter table public.job_event_counts alter column version_id set not null;
alter table public.job_event_counts drop constraint job_event_counts_pkey;
alter table public.job_event_counts add primary key (flow_id, day, event, version_id);

alter table public.job_step_counts add column version_id uuid references public.job_form_versions(id) on delete cascade;
update public.job_step_counts c set version_id = v.id from public.job_form_versions v where v.flow_id = c.flow_id and v.version_no = 1;
delete from public.job_step_counts where version_id is null;
alter table public.job_step_counts alter column version_id set not null;
alter table public.job_step_counts drop constraint job_step_counts_pkey;
alter table public.job_step_counts add primary key (flow_id, day, node_id, from_node_id, version_id);

-- 4) The counting functions record the version ----------------------------------------------------------------------------
create or replace function public.record_job_event(p_published_flow_id uuid, p_event text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_flow uuid;
  v_workspace uuid;
  v_snapshot jsonb;
  v_version uuid;
begin
  if p_event not in ('view', 'start') then return false; end if;
  select f.id, f.workspace_id, pf.snapshot into v_flow, v_workspace, v_snapshot
  from public.published_flows pf
  join public.application_flows f on f.id = pf.flow_id and f.workspace_id = pf.workspace_id
  where pf.id = p_published_flow_id
    and f.publication_status = 'published'
    and f.active_published_flow_id = pf.id
    and public.flow_data_is_valid(f.flow_data);
  if v_flow is null then return false; end if;
  v_version := public.current_form_version(v_flow, v_workspace, v_snapshot);
  insert into public.job_event_counts as c (flow_id, workspace_id, day, event, n, version_id)
  values (v_flow, v_workspace, (now() at time zone 'utc')::date, p_event, 1, v_version)
  on conflict (flow_id, day, event, version_id) do update set n = c.n + 1;
  return true;
end;
$function$;
revoke all on function public.record_job_event(uuid, text) from public, anon, authenticated;
grant execute on function public.record_job_event(uuid, text) to service_role;

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
  v_version uuid;
begin
  if p_node_id is null or char_length(p_node_id) not between 1 and 80 then return false; end if;
  if p_from_node_id is not null and char_length(p_from_node_id) not between 1 and 80 then return false; end if;
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

  v_version := public.current_form_version(v_flow, v_workspace, v_snapshot);
  insert into public.job_step_counts as c (flow_id, workspace_id, day, node_id, from_node_id, n, version_id)
  values (v_flow, v_workspace, (now() at time zone 'utc')::date, p_node_id, v_from, 1, v_version)
  on conflict (flow_id, day, node_id, from_node_id, version_id) do update set n = c.n + 1;
  return true;
end;
$function$;
revoke all on function public.record_job_step(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_job_step(uuid, text, text) to service_role;

-- 5) The steps report, for one version (the latest unless another is asked for) -------------------------------------------
drop function if exists public.get_report_steps(uuid, uuid, date, date);

create or replace function public.get_report_steps(
  p_workspace_id uuid, p_flow_id uuid, p_from date default null, p_to date default null, p_version_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_versions jsonb;
  v_ver record;
  v_new date;
  v_legacy date;
  v_since date;
  v_from date;
  v_to date;
  v_info jsonb;
  v_result jsonb;
begin
  if auth.uid() is null or not public.workspace_user_has_permission(p_workspace_id, 'reports') then
    raise exception 'You do not have permission to view the reports.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.application_flows f where f.id = p_flow_id and f.workspace_id = p_workspace_id) then
    raise exception 'This job could not be found.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'number', x.version_no, 'startedAt', x.created_at, 'endedAt', x.ended_at, 'current', x.ended_at is null)
                            order by x.created_at desc, x.version_no desc), '[]'::jsonb)
    into v_versions
  from (select v.id, v.version_no, v.created_at, lead(v.created_at) over (order by v.created_at, v.version_no) as ended_at
        from public.job_form_versions v where v.flow_id = p_flow_id) x;

  select x.id, x.version_no, x.created_at, x.ended_at, x.structure into v_ver
  from (select v.id, v.version_no, v.created_at, v.structure, lead(v.created_at) over (order by v.created_at, v.version_no) as ended_at
        from public.job_form_versions v where v.flow_id = p_flow_id) x
  where (p_version_id is null and x.ended_at is null) or x.id = p_version_id
  order by x.created_at desc limit 1;
  if p_version_id is not null and v_ver.id is null then
    raise exception 'This version could not be found.' using errcode = '22023';
  end if;
  if v_ver.id is null then return jsonb_build_object('hasData', false, 'versions', v_versions); end if;

  v_info := jsonb_build_object('id', v_ver.id, 'number', v_ver.version_no, 'startedAt', v_ver.created_at, 'endedAt', v_ver.ended_at, 'current', v_ver.ended_at is null);

  -- Counters written before origins were recorded (from_node_id = '') cannot be used for the drop per step: the window starts
  -- on the first full day after them.
  select min(c.day) into v_new from public.job_step_counts c where c.flow_id = p_flow_id and c.version_id = v_ver.id and c.from_node_id <> '';
  if v_new is null then return jsonb_build_object('hasData', false, 'versions', v_versions, 'version', v_info); end if;
  select max(c.day) into v_legacy from public.job_step_counts c where c.flow_id = p_flow_id and c.version_id = v_ver.id and c.from_node_id = '';
  v_since := greatest(v_new, coalesce(v_legacy + 1, v_new));

  v_to := least(coalesce(p_to, v_today), v_today);
  if v_since > v_to then return jsonb_build_object('hasData', false, 'versions', v_versions, 'version', v_info); end if;
  v_from := greatest(coalesce(p_from, v_since), v_since);
  if v_from > v_to then v_from := v_to; end if;

  select jsonb_build_object(
    'hasData', true,
    'versions', v_versions,
    'version', v_info,
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'since', v_since,
    'views', coalesce((select sum(e.n) from public.job_event_counts e
                       where e.flow_id = p_flow_id and e.version_id = v_ver.id and e.event = 'view' and e.day between v_from and v_to), 0),
    'starts', coalesce((select sum(e.n) from public.job_event_counts e
                        where e.flow_id = p_flow_id and e.version_id = v_ver.id and e.event = 'start' and e.day between v_from and v_to), 0),
    'submitted', (select count(*) from public.applicants a
                  where a.workspace_id = p_workspace_id and a.flow_id = p_flow_id
                    and a.submitted_at >= v_ver.created_at and (v_ver.ended_at is null or a.submitted_at < v_ver.ended_at)
                    and (a.submitted_at at time zone 'utc')::date between v_from and v_to),
    'transitions', coalesce((select jsonb_object_agg(x.k, x.n)
                             from (select c.from_node_id || '>' || c.node_id as k, sum(c.n)::bigint as n from public.job_step_counts c
                                   where c.flow_id = p_flow_id and c.version_id = v_ver.id and c.from_node_id <> '' and c.day between v_from and v_to
                                   group by 1) x), '{}'::jsonb),
    'completions', coalesce((select jsonb_object_agg(x.node_id, x.n)
                             from (select coalesce(a.responses -> (jsonb_array_length(a.responses) - 1) ->> 'nodeId', 'details') as node_id, count(*) as n
                                   from public.applicants a
                                   where a.workspace_id = p_workspace_id and a.flow_id = p_flow_id
                                     and a.submitted_at >= v_ver.created_at and (v_ver.ended_at is null or a.submitted_at < v_ver.ended_at)
                                     and (a.submitted_at at time zone 'utc')::date between v_from and v_to
                                   group by 1) x), '{}'::jsonb),
    'nodes', coalesce((select jsonb_agg(jsonb_build_object('id', n ->> 'id', 'type', n ->> 'type', 'label', n ->> 'label', 'subtype', n ->> 'subtype'))
                       from jsonb_array_elements(v_ver.structure -> 'nodes') n), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(jsonb_build_object('from', e ->> 'from', 'to', e ->> 'to', 'option', e ->> 'option'))
                       from jsonb_array_elements(v_ver.structure -> 'edges') e), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.get_report_steps(uuid, uuid, date, date, uuid) from public, anon, authenticated;
grant execute on function public.get_report_steps(uuid, uuid, date, date, uuid) to authenticated, service_role;
