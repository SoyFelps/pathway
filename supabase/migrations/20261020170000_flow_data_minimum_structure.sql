-- A job (application flow) must keep the minimum structure the editor and the public page need:
-- an object with a list of nodes (2 to 200: exactly one "candidateInfo", at least one "end", unique ids, known types,
-- choice questions with an options list) and a list of edges (up to 400) that only connect existing nodes.
-- The rule runs only when a job is inserted or its flow_data changes, so a job that is already damaged can still be
-- unpublished or deleted (by the owner or by support) without being blocked by this rule.

create or replace function public.flow_data_is_valid(p jsonb)
returns boolean
language plpgsql
immutable
set search_path to ''
as $function$
declare
  n jsonb;
  e jsonb;
  ids text[] := '{}';
  node_type text;
  info_count integer := 0;
  end_count integer := 0;
begin
  if p is null or jsonb_typeof(p) is distinct from 'object' then return false; end if;
  if jsonb_typeof(p -> 'nodes') is distinct from 'array' or jsonb_typeof(p -> 'edges') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p -> 'nodes') not between 2 and 200 or jsonb_array_length(p -> 'edges') > 400 then return false; end if;
  for n in select value from jsonb_array_elements(p -> 'nodes') loop
    if jsonb_typeof(n) is distinct from 'object'
       or jsonb_typeof(n -> 'id') is distinct from 'string'
       or jsonb_typeof(n -> 'type') is distinct from 'string' then return false; end if;
    node_type := n ->> 'type';
    if node_type not in ('candidateInfo', 'shortText', 'singleChoice', 'multiChoice', 'end') then return false; end if;
    if (n ->> 'id') = any (ids) then return false; end if;
    ids := ids || (n ->> 'id');
    if node_type = 'candidateInfo' then info_count := info_count + 1; end if;
    if node_type = 'end' then end_count := end_count + 1; end if;
    if node_type in ('singleChoice', 'multiChoice') and jsonb_typeof(n -> 'options') is distinct from 'array' then return false; end if;
  end loop;
  if info_count <> 1 or end_count < 1 then return false; end if;
  for e in select value from jsonb_array_elements(p -> 'edges') loop
    if jsonb_typeof(e) is distinct from 'object'
       or jsonb_typeof(e -> 'fromNodeId') is distinct from 'string'
       or jsonb_typeof(e -> 'toNodeId') is distinct from 'string' then return false; end if;
    if not ((e ->> 'fromNodeId') = any (ids)) or not ((e ->> 'toNodeId') = any (ids)) then return false; end if;
  end loop;
  return true;
end;
$function$;
revoke all on function public.flow_data_is_valid(jsonb) from public, anon, authenticated;
grant execute on function public.flow_data_is_valid(jsonb) to service_role;

create or replace function public.require_valid_flow_data()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' or new.flow_data is distinct from old.flow_data then
    if not public.flow_data_is_valid(new.flow_data) then
      raise exception 'This job is incomplete and cannot be saved. Reload the page and try again.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function public.require_valid_flow_data() from public, anon, authenticated;
grant execute on function public.require_valid_flow_data() to service_role;

create trigger application_flows_require_valid_flow_data
  before insert or update on public.application_flows
  for each row execute function public.require_valid_flow_data();
