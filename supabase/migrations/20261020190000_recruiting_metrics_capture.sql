-- Phase 1 of recruiting metrics: only CAPTURE the data (it cannot be rebuilt later). Dashboards come afterwards.
--  1) applicant_stage_history: every stage change with its date (conversion, time in stage, time to fill).
--  2) job_event_counts: anonymous daily counters of page views and form starts per job (no IP, no cookie, no person).
-- (No automatic "source" capture: it was tried and dropped on purpose, a link address is copied and forwarded, so it misleads.)

-- 1) Stage history -------------------------------------------------------------------------------------------------
create table public.applicant_stage_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  flow_id uuid not null references public.application_flows(id) on delete cascade,
  applicant_id uuid not null references public.applicants(id) on delete cascade,
  from_status text,
  to_status text not null,
  kind text not null check (kind in ('submitted', 'moved', 'backfill')),
  changed_at timestamptz not null default now()
);
create index applicant_stage_history_flow_idx on public.applicant_stage_history (flow_id, changed_at);
create index applicant_stage_history_applicant_idx on public.applicant_stage_history (applicant_id, changed_at);

alter table public.applicant_stage_history enable row level security;
revoke all on public.applicant_stage_history from public, anon, authenticated;
grant select on public.applicant_stage_history to authenticated;
grant all on public.applicant_stage_history to service_role;
create policy "applicant reviewers read stage history" on public.applicant_stage_history
  for select to authenticated
  using (public.workspace_user_has_permission(workspace_id, 'applicants'));

-- Candidates that already exist: one entry marked "backfill" (their current stage, dated by the last update). Approximate on purpose.
insert into public.applicant_stage_history (workspace_id, flow_id, applicant_id, from_status, to_status, kind, changed_at)
select a.workspace_id, a.flow_id, a.id, null, a.status, 'backfill', coalesce(a.updated_at, a.submitted_at)
from public.applicants a;

create or replace function public.record_applicant_stage_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.applicant_stage_history (workspace_id, flow_id, applicant_id, from_status, to_status, kind)
    values (new.workspace_id, new.flow_id, new.id, null, new.status, 'submitted');
  elsif new.status is distinct from old.status then
    insert into public.applicant_stage_history (workspace_id, flow_id, applicant_id, from_status, to_status, kind)
    values (new.workspace_id, new.flow_id, new.id, old.status, new.status, 'moved');
  end if;
  return null;
end;
$function$;
revoke all on function public.record_applicant_stage_change() from public, anon, authenticated;
grant execute on function public.record_applicant_stage_change() to service_role;

create trigger applicants_record_stage_change
  after insert or update of status on public.applicants
  for each row execute function public.record_applicant_stage_change();

-- 2) Anonymous counters --------------------------------------------------------------------------------------------
create table public.job_event_counts (
  flow_id uuid not null references public.application_flows(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  day date not null,
  event text not null check (event in ('view', 'start')),
  n integer not null default 0,
  primary key (flow_id, day, event)
);

alter table public.job_event_counts enable row level security;
revoke all on public.job_event_counts from public, anon, authenticated;
grant select on public.job_event_counts to authenticated;
grant all on public.job_event_counts to service_role;
create policy "applicant reviewers read job event counts" on public.job_event_counts
  for select to authenticated
  using (public.workspace_user_has_permission(workspace_id, 'applicants'));

-- Called only by the candidate intake function. Counts one event for an ACTIVE job; never stores who did it.
create or replace function public.record_job_event(p_published_flow_id uuid, p_event text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_flow uuid;
  v_workspace uuid;
begin
  if p_event not in ('view', 'start') then return false; end if;
  select f.id, f.workspace_id into v_flow, v_workspace
  from public.published_flows pf
  join public.application_flows f on f.id = pf.flow_id and f.workspace_id = pf.workspace_id
  where pf.id = p_published_flow_id
    and f.publication_status = 'published'
    and f.active_published_flow_id = pf.id
    and public.flow_data_is_valid(f.flow_data);
  if v_flow is null then return false; end if;
  insert into public.job_event_counts as c (flow_id, workspace_id, day, event, n)
  values (v_flow, v_workspace, (now() at time zone 'utc')::date, p_event, 1)
  on conflict (flow_id, day, event) do update set n = c.n + 1;
  return true;
end;
$function$;
revoke all on function public.record_job_event(uuid, text) from public, anon, authenticated;
grant execute on function public.record_job_event(uuid, text) to service_role;
