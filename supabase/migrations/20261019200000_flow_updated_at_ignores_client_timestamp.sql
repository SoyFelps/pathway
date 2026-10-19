-- Follow-up to 20261019133617_responsible_changes_keep_updated_at: the flow's JSON (flow_data) also carries an
-- "updatedAt" value written by the browser, which changes on every save. It made a responsible-only change look like a
-- content change. It is ignored in the comparison now; every other change still refreshes updated_at as before.
create or replace function public.set_flow_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if ((to_jsonb(new) - 'responsible_user_ids' - 'updated_at') #- '{flow_data,updatedAt}')
     = ((to_jsonb(old) - 'responsible_user_ids' - 'updated_at') #- '{flow_data,updatedAt}') then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;
