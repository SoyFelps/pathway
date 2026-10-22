-- Moving a step on the canvas is not a change to the job: the position (x, y) of the steps no longer moves application_flows.updated_at,
-- so it never shows "You have changes that aren't published yet" (the editor and the database now agree).
-- Everything else behaves as before: a change in any other part of the flow (questions, options, connections, details, title...)
-- still moves updated_at; responsible_user_ids and flow_data.updatedAt are still ignored.
-- No new table and no new grants: this only replaces the body of an existing trigger function.

create or replace function public.set_flow_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if (to_jsonb(new) - 'responsible_user_ids' - 'updated_at' - 'flow_data') = (to_jsonb(old) - 'responsible_user_ids' - 'updated_at' - 'flow_data')
     and (new.flow_data - 'nodes' - 'updatedAt') = (old.flow_data - 'nodes' - 'updatedAt')
     and (select coalesce(jsonb_agg(case when jsonb_typeof(n) = 'object' then n - 'x' - 'y' else n end order by ord), '[]'::jsonb)
          from jsonb_array_elements(case when jsonb_typeof(new.flow_data -> 'nodes') = 'array' then new.flow_data -> 'nodes' else '[]'::jsonb end) with ordinality as t(n, ord))
       = (select coalesce(jsonb_agg(case when jsonb_typeof(n) = 'object' then n - 'x' - 'y' else n end order by ord), '[]'::jsonb)
          from jsonb_array_elements(case when jsonb_typeof(old.flow_data -> 'nodes') = 'array' then old.flow_data -> 'nodes' else '[]'::jsonb end) with ordinality as t(n, ord))
  then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$function$;
