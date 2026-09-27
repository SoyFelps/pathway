create table public.workspace_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  status text not null check (status in ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);
create index workspace_subscriptions_customer_idx on public.workspace_subscriptions (stripe_customer_id);
alter table public.workspace_subscriptions enable row level security;
revoke all on public.workspace_subscriptions from public, anon, authenticated;
grant select on public.workspace_subscriptions to authenticated;
grant all on public.workspace_subscriptions to service_role;
create policy "workspace owners can read their subscription status"
on public.workspace_subscriptions for select to authenticated
using (exists (
  select 1 from public.workspaces w
  where w.id = workspace_subscriptions.workspace_id and w.owner_id = (select auth.uid())
));
create trigger workspace_subscriptions_set_updated_at
before update on public.workspace_subscriptions
for each row execute function public.set_updated_at();

create or replace function public.workspace_has_active_subscription(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_subscriptions s
    where s.workspace_id = p_workspace_id
      and s.status = 'active'
      and s.current_period_end > now()
  );
$$;
revoke all on function public.workspace_has_active_subscription(uuid) from public, anon, authenticated;
grant execute on function public.workspace_has_active_subscription(uuid) to service_role;

create or replace function public.require_paid_publication_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.workspace_has_active_subscription(new.workspace_id) then
    raise exception 'An active subscription is required to publish job flows.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.require_paid_publication_insert() from public, anon, authenticated;
drop trigger if exists published_flows_require_paid_subscription on public.published_flows;
create trigger published_flows_require_paid_subscription
before insert on public.published_flows
for each row execute function public.require_paid_publication_insert();

create or replace function public.require_paid_flow_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  should_validate boolean := false;
begin
  if new.publication_status = 'published' then
    if tg_op = 'INSERT' then
      should_validate := true;
    elsif old.publication_status is distinct from 'published'
      or old.active_published_flow_id is distinct from new.active_published_flow_id then
      should_validate := true;
    end if;
  end if;
  if should_validate then
    if not public.workspace_has_active_subscription(new.workspace_id) then
      raise exception 'An active subscription is required to publish job flows.' using errcode = '42501';
    end if;
    if new.active_published_flow_id is null or not exists (
      select 1 from public.published_flows pf
      where pf.id = new.active_published_flow_id
        and pf.flow_id = new.id
        and pf.workspace_id = new.workspace_id
    ) then
      raise exception 'The active publication must belong to this job flow.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.require_paid_flow_activation() from public, anon, authenticated;
drop trigger if exists application_flows_require_paid_subscription on public.application_flows;
create trigger application_flows_require_paid_subscription
before insert or update of publication_status, active_published_flow_id on public.application_flows
for each row execute function public.require_paid_flow_activation();

-- Existing flows have no verified paid entitlement at cutover. Pause them so old
-- public snapshots cannot become live again merely because a workspace subscribes later.
update public.application_flows
set publication_status = 'draft', active_published_flow_id = null
where publication_status = 'published';

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
    and public.workspace_has_active_subscription(pf.workspace_id)
  limit 1;
$$;
revoke all on function public.get_published_flow(uuid) from public, authenticated;
grant execute on function public.get_published_flow(uuid) to anon;

grant execute on function public.workspace_has_active_subscription(uuid) to service_role;

create or replace function public.validate_applicant_active_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.application_flows f
    join public.published_flows pf
      on pf.id = new.published_flow_id
     and pf.flow_id = f.id
     and pf.workspace_id = f.workspace_id
    where f.id = new.flow_id
      and f.workspace_id = new.workspace_id
      and f.publication_status = 'published'
      and f.active_published_flow_id = pf.id
      and public.workspace_has_active_subscription(f.workspace_id)
  ) then
    raise exception 'The application job is no longer actively published.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_applicant_active_publication() from public, anon, authenticated;
drop trigger if exists applicants_require_active_publication on public.applicants;
create trigger applicants_require_active_publication
before insert on public.applicants
for each row execute function public.validate_applicant_active_publication();
