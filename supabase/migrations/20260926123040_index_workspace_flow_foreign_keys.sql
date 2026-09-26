create index if not exists application_flows_created_by_idx
  on public.application_flows (created_by);

create index if not exists published_flows_flow_id_idx
  on public.published_flows (flow_id);

create index if not exists published_flows_created_by_idx
  on public.published_flows (created_by);
