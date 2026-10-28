-- AI Interview (Witcher) integration, part 1: database.
--  * application_flows.interview_questions: the 1 to 5 questions of the AI interview, one list per job. A column of its own, NEVER
--    inside flow_data (flow_data is copied into the public snapshot). Changing only this column does not count as a change of the job.
--  * ai_interviews: one row per candidate (job + e-mail) that was moved into the "AI Interview" column. Pathway keeps only the state and
--    the impression badge; the evaluation and the transcript are fetched live from Witcher. Written by triggers and by the edge
--    functions (service_role); the browser can only read it.
--  * Moving a candidate into the column creates a pending row that is sent 10 seconds later; moving out before that removes it.
--    After it was sent, the interview goes on whatever column the card is in.
--  * ai_interview_deletions: outbox of interviews that must be erased in Witcher (deleted candidate, job, workspace or account). The
--    worker function empties it; no secret is ever stored in the database.
--  * ai_interview_settings: per-project values that are not secrets (the address of the worker function), filled in with SQL.
--  * A database job runs every 10 seconds and wakes the worker function only when something is due.
--  * Bell notices for finished interviews: get_ai_interview_notices / mark_ai_interview_notice_seen.
--  Additive: no existing data changes. New tables follow the explicit-grants rule (RLS on, revoke all, exact grants).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. The questions of the job
create or replace function public.interview_questions_are_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'array'
    and jsonb_array_length(p) <= 5
    and not exists (
      select 1 from jsonb_array_elements(p) e
      where jsonb_typeof(e) <> 'string' or char_length(btrim(e #>> '{}')) < 3 or char_length(e #>> '{}') > 500
    );
$$;

alter table public.application_flows add column if not exists interview_questions jsonb not null default '[]'::jsonb;
alter table public.application_flows drop constraint if exists application_flows_interview_questions_check;
alter table public.application_flows add constraint application_flows_interview_questions_check
  check (public.interview_questions_are_valid(interview_questions));

-- Same as the live definition, plus: a change of interview_questions alone leaves updated_at alone (like responsible_user_ids).
create or replace function public.set_flow_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if (to_jsonb(new) - 'responsible_user_ids' - 'interview_questions' - 'updated_at' - 'flow_data') = (to_jsonb(old) - 'responsible_user_ids' - 'interview_questions' - 'updated_at' - 'flow_data')
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

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Interviews of candidates
create table public.ai_interviews (
  -- Also the externalId sent to Witcher, so a retried call never creates a second interview.
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  flow_id uuid not null references public.application_flows (id) on delete cascade,
  -- Lower-cased and trimmed, like the candidate grouping used everywhere else.
  candidate_email text not null check (char_length(candidate_email) between 3 and 254 and candidate_email = lower(btrim(candidate_email))),
  -- The application the invitation is built from (name); the candidate may have several.
  applicant_id uuid references public.applicants (id) on delete set null,
  -- pending: waiting for send_at. blocked: cannot be sent yet (see blocked_reason); checked again every minute while the card
  -- stays in the column. The other states follow the interview in Witcher. failed: Witcher could not be reached many times.
  state text not null default 'pending'
    check (state in ('pending', 'blocked', 'invited', 'in_progress', 'completed', 'cancelled', 'abandoned', 'expired', 'failed')),
  blocked_reason text check (blocked_reason in ('no_questions', 'no_plan', 'no_company_name')),
  send_at timestamptz not null default (now() + interval '10 seconds'),
  witcher_interview_id uuid,
  impression text check (impression in ('positive', 'negative')),
  -- false when the AI could not write the evaluation (the panel then offers a retry).
  evaluation_ready boolean not null default false,
  completed_at timestamptz,
  -- Set when a finished interview should reach the bell; each person marks it seen on their own.
  notice_at timestamptz,
  attempts int not null default 0,
  last_error text check (last_error is null or char_length(last_error) <= 200),
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One interview in play per candidate and job; a cancelled, expired or abandoned one does not block a new invitation.
create unique index ai_interviews_one_active_idx on public.ai_interviews (flow_id, candidate_email)
  where state in ('pending', 'blocked', 'invited', 'in_progress', 'completed', 'failed');
create index ai_interviews_workspace_idx on public.ai_interviews (workspace_id);
create index ai_interviews_flow_email_idx on public.ai_interviews (flow_id, candidate_email);
create index ai_interviews_due_idx on public.ai_interviews (send_at) where state in ('pending', 'blocked');
create index ai_interviews_applicant_idx on public.ai_interviews (applicant_id) where applicant_id is not null;

create trigger ai_interviews_set_updated_at
before update on public.ai_interviews
for each row execute function public.set_updated_at();

alter table public.ai_interviews enable row level security;
revoke all on public.ai_interviews from public, anon, authenticated;
-- The browser reads the state of the interviews of the candidates it may review, never the internal columns.
grant select (id, workspace_id, flow_id, candidate_email, applicant_id, state, blocked_reason, send_at, witcher_interview_id,
              impression, evaluation_ready, completed_at, created_at, updated_at)
  on public.ai_interviews to authenticated;
grant all on public.ai_interviews to service_role;
create policy "applicant reviewers can read ai interviews" on public.ai_interviews
  for select to authenticated
  using (public.workspace_user_has_permission(workspace_id, 'applicants'));
comment on table public.ai_interviews is 'AI interviews of candidates (state and badge only; evaluation and transcript live in Witcher). Browser: read only.';

-- Outbox: interviews to erase in Witcher. No foreign keys on purpose: the rows must outlive the deleted job or workspace.
create table public.ai_interview_deletions (
  id uuid primary key default gen_random_uuid(),
  ai_interview_id uuid not null unique,
  workspace_id uuid not null,
  next_at timestamptz not null default now(),
  attempts int not null default 0,
  last_error text check (last_error is null or char_length(last_error) <= 200),
  created_at timestamptz not null default now()
);
alter table public.ai_interview_deletions enable row level security;
revoke all on public.ai_interview_deletions from public, anon, authenticated;
grant all on public.ai_interview_deletions to service_role;
comment on table public.ai_interview_deletions is 'Interviews waiting to be erased in Witcher. Service role only.';

create table public.ai_interview_settings (
  key text primary key check (char_length(key) between 1 and 80),
  value text not null check (char_length(value) <= 500)
);
alter table public.ai_interview_settings enable row level security;
revoke all on public.ai_interview_settings from public, anon, authenticated;
grant all on public.ai_interview_settings to service_role;
comment on table public.ai_interview_settings is 'Per-project values that are not secrets (worker_url). Service role only.';

-- Who has already seen the bell notice of a finished interview.
create table public.ai_interview_notice_seen (
  user_id uuid not null,
  ai_interview_id uuid not null references public.ai_interviews (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, ai_interview_id)
);
alter table public.ai_interview_notice_seen enable row level security;
revoke all on public.ai_interview_notice_seen from public, anon, authenticated;
grant all on public.ai_interview_notice_seen to service_role;
comment on table public.ai_interview_notice_seen is 'Bell notices already seen. Written only through mark_ai_interview_notice_seen.';

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Triggers
-- Moving a candidate into the AI Interview column creates (or refreshes) the pending row; moving out removes a pending or blocked one.
create or replace function public.ai_interview_on_stage_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(new.candidate_email));
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.status = 'ai_interview' then
    insert into public.ai_interviews as ai (workspace_id, flow_id, candidate_email, applicant_id, state, send_at)
    values (new.workspace_id, new.flow_id, v_email, new.id, 'pending', now() + interval '10 seconds')
    on conflict (flow_id, candidate_email) where state in ('pending', 'blocked', 'invited', 'in_progress', 'completed', 'failed')
    do update set
      send_at = case when ai.state in ('pending', 'blocked') then excluded.send_at else ai.send_at end,
      state = case when ai.state = 'blocked' then 'pending' else ai.state end,
      blocked_reason = case when ai.state = 'blocked' then null else ai.blocked_reason end,
      attempts = case when ai.state = 'blocked' then 0 else ai.attempts end;
  elsif old.status = 'ai_interview' then
    delete from public.ai_interviews
     where flow_id = new.flow_id and candidate_email = v_email and state in ('pending', 'blocked');
  end if;
  return null;
end;
$$;
revoke all on function public.ai_interview_on_stage_change() from public, anon, authenticated;

create trigger applicants_ai_interview_stage
after update of status on public.applicants
for each row execute function public.ai_interview_on_stage_change();

-- Deleting the last application of a candidate deletes the interview too (and, through the outbox, in Witcher).
create or replace function public.ai_interview_on_applicant_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(old.candidate_email));
begin
  if not exists (
    select 1 from public.applicants a
     where a.flow_id = old.flow_id and lower(btrim(a.candidate_email)) = v_email and a.id <> old.id
  ) then
    delete from public.ai_interviews where flow_id = old.flow_id and candidate_email = v_email;
  end if;
  return null;
end;
$$;
revoke all on function public.ai_interview_on_applicant_deleted() from public, anon, authenticated;

create trigger applicants_ai_interview_deleted
after delete on public.applicants
for each row execute function public.ai_interview_on_applicant_deleted();

-- Whatever deletes an interview row (candidate, job, workspace or account), Witcher is told through the outbox.
-- A row that was never sent has nothing to erase there.
create or replace function public.ai_interview_queue_erasure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state not in ('pending', 'blocked') then
    insert into public.ai_interview_deletions (ai_interview_id, workspace_id)
    values (old.id, old.workspace_id)
    on conflict (ai_interview_id) do nothing;
  end if;
  return null;
end;
$$;
revoke all on function public.ai_interview_queue_erasure() from public, anon, authenticated;

create trigger ai_interviews_queue_erasure
after delete on public.ai_interviews
for each row execute function public.ai_interview_queue_erasure();

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Wake-up of the worker function
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.ai_interview_kick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  select value into v_url from public.ai_interview_settings where key = 'worker_url';
  if v_url is null or v_url = '' then return; end if;
  if not (
    exists (select 1 from public.ai_interviews
             where state in ('pending', 'blocked') and send_at <= now() and (lease_until is null or lease_until < now()))
    or exists (select 1 from public.ai_interview_deletions where next_at <= now())
  ) then return; end if;
  perform net.http_post(url := v_url, headers := '{"Content-Type": "application/json"}'::jsonb, body := '{"action": "tick"}'::jsonb);
end;
$$;
revoke all on function public.ai_interview_kick() from public, anon, authenticated;
grant execute on function public.ai_interview_kick() to service_role;

select cron.schedule('ai-interview-tick', '10 seconds', $$select public.ai_interview_kick()$$);

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Bell notices (finished interviews)
-- People responsible for the job (or everyone with access when nobody is named) see a notice for each finished interview that
-- ended after they joined the workspace and that they have not opened yet.
create or replace function public.get_ai_interview_notices(p_workspace_id uuid)
returns table (ai_interview_id uuid, flow_id uuid, job_title text, company_name text, candidate_name text, candidate_email text, impression text, completed_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.workspace_user_has_permission(p_workspace_id, 'applicants') then
    raise exception 'You do not have access to applicants in this workspace.' using errcode = '42501';
  end if;
  return query
  select i.id, i.flow_id, f.job_title, coalesce(wc.name, w.name),
         coalesce((select a.candidate_name from public.applicants a where a.id = i.applicant_id), i.candidate_email),
         i.candidate_email, i.impression, i.completed_at
  from public.ai_interviews i
  join public.application_flows f on f.id = i.flow_id
  join public.workspaces w on w.id = i.workspace_id
  left join public.workspace_companies wc on wc.id = f.company_id
  where i.workspace_id = p_workspace_id
    and i.state = 'completed'
    and i.notice_at is not null
    and (cardinality(f.responsible_user_ids) = 0 or auth.uid() = any (f.responsible_user_ids))
    and i.notice_at > coalesce((select m.created_at from public.workspace_members m where m.workspace_id = i.workspace_id and m.user_id = auth.uid()), '-infinity'::timestamptz)
    and not exists (select 1 from public.ai_interview_notice_seen s where s.ai_interview_id = i.id and s.user_id = auth.uid())
  order by i.notice_at desc
  limit 50;
end;
$$;
revoke all on function public.get_ai_interview_notices(uuid) from public, anon;
grant execute on function public.get_ai_interview_notices(uuid) to authenticated, service_role;

create or replace function public.mark_ai_interview_notice_seen(p_ai_interview_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  select i.workspace_id into v_workspace from public.ai_interviews i where i.id = p_ai_interview_id;
  if auth.uid() is null or v_workspace is null or not public.workspace_user_has_permission(v_workspace, 'applicants') then
    raise exception 'You do not have access to applicants in this workspace.' using errcode = '42501';
  end if;
  insert into public.ai_interview_notice_seen (user_id, ai_interview_id)
  values (auth.uid(), p_ai_interview_id)
  on conflict (user_id, ai_interview_id) do nothing;
end;
$$;
revoke all on function public.mark_ai_interview_notice_seen(uuid) from public, anon;
grant execute on function public.mark_ai_interview_notice_seen(uuid) to authenticated, service_role;
