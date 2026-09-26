create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null default 'My workspace' check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.application_flows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  company_name text not null check (char_length(company_name) between 1 and 200),
  job_title text not null check (char_length(job_title) between 1 and 200),
  flow_data jsonb not null check (jsonb_typeof(flow_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists application_flows_workspace_updated_idx
  on public.application_flows (workspace_id, updated_at desc);

create table if not exists public.published_flows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  flow_id uuid not null references public.application_flows(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists published_flows_workspace_created_idx
  on public.published_flows (workspace_id, created_at desc);

alter table public.workspaces enable row level security;
alter table public.application_flows enable row level security;
alter table public.published_flows enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_name text;
begin
  workspace_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'workspace_name'), ''), 'My workspace');
  insert into public.workspaces (owner_id, name)
  values (new.id, workspace_name)
  on conflict (owner_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_pathway_workspace on auth.users;
create trigger on_auth_user_created_pathway_workspace
after insert on auth.users
for each row execute function public.handle_new_user();

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

drop trigger if exists application_flows_set_updated_at on public.application_flows;
create trigger application_flows_set_updated_at
before update on public.application_flows
for each row execute function public.set_updated_at();

create policy "workspace owner can read own workspace"
on public.workspaces for select to authenticated
using (owner_id = (select auth.uid()));

create policy "workspace owner can update own workspace"
on public.workspaces for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy "owners can read flows in own workspace"
on public.application_flows for select to authenticated
using (exists (
  select 1 from public.workspaces w
  where w.id = application_flows.workspace_id and w.owner_id = (select auth.uid())
));

create policy "owners can create flows in own workspace"
on public.application_flows for insert to authenticated
with check (
  created_by = (select auth.uid()) and exists (
    select 1 from public.workspaces w
    where w.id = application_flows.workspace_id and w.owner_id = (select auth.uid())
  )
);

create policy "owners can update flows in own workspace"
on public.application_flows for update to authenticated
using (exists (
  select 1 from public.workspaces w
  where w.id = application_flows.workspace_id and w.owner_id = (select auth.uid())
))
with check (
  created_by = (select auth.uid()) and exists (
    select 1 from public.workspaces w
    where w.id = application_flows.workspace_id and w.owner_id = (select auth.uid())
  )
);

create policy "owners can delete flows in own workspace"
on public.application_flows for delete to authenticated
using (exists (
  select 1 from public.workspaces w
  where w.id = application_flows.workspace_id and w.owner_id = (select auth.uid())
));

create policy "owners can read published snapshots in own workspace"
on public.published_flows for select to authenticated
using (exists (
  select 1 from public.workspaces w
  where w.id = published_flows.workspace_id and w.owner_id = (select auth.uid())
));

create policy "owners can publish snapshots in own workspace"
on public.published_flows for insert to authenticated
with check (
  created_by = (select auth.uid()) and exists (
    select 1 from public.workspaces w
    where w.id = published_flows.workspace_id and w.owner_id = (select auth.uid())
  ) and exists (
    select 1 from public.application_flows f
    where f.id = published_flows.flow_id and f.workspace_id = published_flows.workspace_id
  )
);

create policy "owners can remove published snapshots in own workspace"
on public.published_flows for delete to authenticated
using (exists (
  select 1 from public.workspaces w
  where w.id = published_flows.workspace_id and w.owner_id = (select auth.uid())
));

revoke all on public.workspaces from anon, authenticated;
revoke all on public.application_flows from anon, authenticated;
revoke all on public.published_flows from anon, authenticated;
grant select, update on public.workspaces to authenticated;
grant select, insert, update, delete on public.application_flows to authenticated;
grant select, insert, delete on public.published_flows to authenticated;

create or replace function public.get_published_flow(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pf.snapshot
  from public.published_flows pf
  where pf.id = p_token
  limit 1;
$$;

revoke all on function public.get_published_flow(uuid) from public;
grant execute on function public.get_published_flow(uuid) to anon, authenticated;
