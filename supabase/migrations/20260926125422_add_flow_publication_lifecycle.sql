alter table public.application_flows
  add column if not exists publication_status text not null default 'draft'
    check (publication_status in ('draft', 'published')),
  add column if not exists active_published_flow_id uuid;

update public.application_flows f
set publication_status = 'published',
    active_published_flow_id = latest.id
from (
  select distinct on (pf.flow_id, pf.workspace_id)
    pf.flow_id, pf.workspace_id, pf.id
  from public.published_flows pf
  order by pf.flow_id, pf.workspace_id, pf.created_at desc
) latest
where latest.flow_id = f.id and latest.workspace_id = f.workspace_id;

create or replace function public.get_published_flow(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pf.snapshot
  from public.published_flows pf
  join public.application_flows f
    on f.id = pf.flow_id
   and f.workspace_id = pf.workspace_id
  where pf.id = p_token
    and f.publication_status = 'published'
    and f.active_published_flow_id = pf.id
  limit 1;
$$;
