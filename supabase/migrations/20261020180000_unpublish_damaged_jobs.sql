-- A damaged job (one that fails the minimum structure of 20261020170000) must not keep collecting candidate data.
--  * It cannot be published (new rule on the existing trigger).
--  * The public job page does not serve it (get_published_flow).
--  * The candidate intake function checks it on every application and unpublishes it when it is damaged.
--  * Any job that is damaged and published right now is unpublished by this migration.
-- Candidate data already collected is untouched; the team can still review it.

create or replace function public.require_valid_flow_data()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if tg_op = 'INSERT'
     or new.flow_data is distinct from old.flow_data
     or (new.publication_status = 'published' and old.publication_status is distinct from 'published') then
    if not public.flow_data_is_valid(new.flow_data) then
      raise exception 'This job is incomplete and cannot be saved or published. Reload the page and try again.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

-- Used by the candidate intake function (service role only).
create or replace function public.application_flow_is_intact(p_flow_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce((select public.flow_data_is_valid(f.flow_data) from public.application_flows f where f.id = p_flow_id), false);
$function$;
revoke all on function public.application_flow_is_intact(uuid) from public, anon, authenticated;
grant execute on function public.application_flow_is_intact(uuid) to service_role;

create or replace function public.unpublish_damaged_flow(p_flow_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  changed integer;
begin
  update public.application_flows f
     set publication_status = 'draft', active_published_flow_id = null
   where f.id = p_flow_id and f.publication_status = 'published' and not public.flow_data_is_valid(f.flow_data);
  get diagnostics changed = row_count;
  return changed > 0;
end;
$function$;
revoke all on function public.unpublish_damaged_flow(uuid) from public, anon, authenticated;
grant execute on function public.unpublish_damaged_flow(uuid) to service_role;

-- The public job page no longer serves a damaged job.
create or replace function public.get_published_flow(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when jsonb_typeof(pf.snapshot -> 'nodes') = 'array' then
      jsonb_set(
        pf.snapshot,
        '{nodes}',
        coalesce(
          (select jsonb_agg(
             case when jsonb_typeof(n.node) = 'object' then (n.node - 'autoFailOptions') - 'autoFailBelow' else n.node end
             order by n.ord)
           from jsonb_array_elements(pf.snapshot -> 'nodes') with ordinality as n(node, ord)),
          '[]'::jsonb
        )
      )
    else pf.snapshot
  end
  from public.published_flows pf
  join public.application_flows f
    on f.id = pf.flow_id
   and f.workspace_id = pf.workspace_id
  where pf.id = p_token
    and f.publication_status = 'published'
    and f.active_published_flow_id = pf.id
    and public.flow_data_is_valid(f.flow_data)
    and public.workspace_has_active_subscription(pf.workspace_id)
  limit 1;
$function$;

-- One-time sweep: unpublish every job that is damaged and published right now.
update public.application_flows f
   set publication_status = 'draft', active_published_flow_id = null
 where f.publication_status = 'published' and not public.flow_data_is_valid(f.flow_data);
