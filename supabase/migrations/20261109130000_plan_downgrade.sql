-- Plans, phase 4a (plano-planos.md): the scheduled downgrade from Agency to Business.
-- A row here says: "on effective_at (the end of the period already paid) this workspace goes back to Business and keeps ONE company; the other
-- companies are deleted with their jobs, candidates, resumes and AI interviews". Only one pending change per workspace (a cancellation of the
-- subscription is the other kind of pending change and the billing function keeps them from existing together).
-- Nobody writes here from the browser: the billing function (service role) schedules and cancels, the daily reconciliation function carries it out.
-- The owner can read it (the app shows a countdown banner). The notice columns are for the e-mails of phase 4b (an e-mail that fails never stops it).
-- To undo: drop table public.workspace_plan_changes (nothing else depends on it).

create table public.workspace_plan_changes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  target_plan text not null check (target_plan = 'business'),
  -- The company that stays. Empty when the workspace had no company at the time, or when the person deleted the chosen one afterwards
  -- (the daily run then waits and the banner asks to choose again; nothing is deleted without a valid choice).
  keep_company_id uuid references public.workspace_companies (id) on delete set null,
  effective_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'running', 'done', 'cancelled')),
  stripe_schedule_id text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  confirmation_sent_at timestamptz,
  notice_week_sent_at timestamptz,
  notice_day_sent_at timestamptz
);

create unique index workspace_plan_changes_one_pending_idx on public.workspace_plan_changes (workspace_id) where status in ('scheduled', 'running');
create index workspace_plan_changes_due_idx on public.workspace_plan_changes (effective_at) where status in ('scheduled', 'running');

alter table public.workspace_plan_changes enable row level security;
revoke all on public.workspace_plan_changes from public, anon, authenticated;
grant select on public.workspace_plan_changes to authenticated;
grant all on public.workspace_plan_changes to service_role;

create policy "workspace owners read their plan changes" on public.workspace_plan_changes
  for select to authenticated
  using (exists (select 1 from public.workspaces w where w.id = workspace_plan_changes.workspace_id and w.owner_id = (select auth.uid())));
