-- Daily Stripe reconciliation (owner decision 2026-11-01): once a day a database job wakes the `billing-reconcile` function, which compares
-- every subscription with Stripe and corrects the database from Stripe (the report goes by e-mail when something differed).
--  * billing_settings: per-project values that are not secrets (the address of the function), filled in with SQL. No browser access.
--  * billing_reconcile_runs: one row per run (counts, what was found, whether the report was e-mailed, any error). No browser access.
--  * billing_reconcile_kick(): called by the schedule; it only asks the function to run (pg_net), nothing else.
--  * Schedule: 07:00 UTC = 04:00 in Brazil, 02:00-03:00 US Eastern, 23:00-00:00 US Pacific (the quietest window for both).
--  Additive: two new tables, one function, one job. New tables follow the explicit-grants rule (RLS on, revoke all, service_role only).
--  Undo: select cron.unschedule('billing-reconcile'); drop function public.billing_reconcile_kick(); drop table public.billing_reconcile_runs; drop table public.billing_settings;

create table public.billing_settings (
  key text primary key check (char_length(key) between 1 and 80),
  value text not null check (char_length(value) <= 500)
);
alter table public.billing_settings enable row level security;
revoke all on public.billing_settings from public, anon, authenticated;
grant all on public.billing_settings to service_role;
comment on table public.billing_settings is 'Per-project values that are not secrets (reconcile_url). Service role only.';

create table public.billing_reconcile_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  checked int not null default 0,
  fixed int not null default 0,
  review int not null default 0,
  skipped_recent int not null default 0,
  -- Only ids and plan fields (no personal data) of what differed and what was done about it.
  report jsonb,
  emailed boolean not null default false,
  error text check (error is null or char_length(error) <= 300)
);
create index billing_reconcile_runs_started_idx on public.billing_reconcile_runs (started_at desc);
alter table public.billing_reconcile_runs enable row level security;
revoke all on public.billing_reconcile_runs from public, anon, authenticated;
grant all on public.billing_reconcile_runs to service_role;
comment on table public.billing_reconcile_runs is 'Runs of the daily Stripe reconciliation. Service role only.';

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.billing_reconcile_kick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  select value into v_url from public.billing_settings where key = 'reconcile_url';
  if v_url is null or v_url = '' then return; end if;
  perform net.http_post(url := v_url, headers := '{"Content-Type": "application/json"}'::jsonb, body := '{}'::jsonb);
end;
$$;
revoke all on function public.billing_reconcile_kick() from public, anon, authenticated;
grant execute on function public.billing_reconcile_kick() to service_role;

select cron.schedule('billing-reconcile', '0 7 * * *', $$select public.billing_reconcile_kick()$$);
