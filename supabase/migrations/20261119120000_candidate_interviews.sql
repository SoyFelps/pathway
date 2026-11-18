-- Human interviews with scheduling, invitation and confirmation (v1), part 1: database. Plan: D:\Pathway\plano-entrevistas.md.
-- Not the AI interview (ai_interviews): this is the "Interview" column of the board.
--  * candidate_interviews: one open row per candidate (job + e-mail). Moving a card into the Interview column creates it as
--    'awaiting_schedule'; the recruiter then schedules it (edge function, later phase), the candidate answers on a public page
--    (confirm, decline or ask for another time) and the reminders go out 24 h and 2 h before, to confirmed interviews only.
--  * The time is stored as the wall-clock time the recruiter picked (local_start) plus the IANA time zone; starts_at is computed
--    from them by a trigger. 14:00 in Sao Paulo stays 14:00; the zone only matters to show the candidate his own clock.
--  * Rules enforced here as a safety net (the edge function checks them first): an interview cannot be set in the past or more than
--    6 months ahead; the other times a candidate suggests (up to 3) go from today to 30 days after the scheduled date.
--  * Leaving the column never cancels anything: a row that was already scheduled keeps living (and keeps its reminders) until the
--    recruiter cancels it by hand. A row still 'awaiting_schedule' is removed when the card leaves the column.
--  * candidate_interview_tokens: the secret of the public answer page, stored only as a hash. Service role only.
--  * candidate_interview_events: the history shown in the candidate panel. candidate_interview_notice_seen: bell notices.
--  * A database job runs every 5 minutes: it closes past interviews and wakes the worker function only when a reminder is due.
--  Additive: no existing data changes. New tables follow the explicit-grants rule (RLS on, revoke all, exact grants).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Interviews of candidates
create table public.candidate_interviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  flow_id uuid not null references public.application_flows (id) on delete cascade,
  -- Lower-cased and trimmed, like the candidate grouping used everywhere else.
  candidate_email text not null check (char_length(candidate_email) between 3 and 254 and candidate_email = lower(btrim(candidate_email))),
  -- The application the invitation is built from (name); the candidate may have several.
  applicant_id uuid references public.applicants (id) on delete set null,
  -- awaiting_schedule: in the column, not scheduled yet. invited: invitation sent, no answer. confirmed / declined /
  -- reschedule_requested: the candidate's answer. cancelled: by the recruiter. finished: the time has passed (history).
  state text not null default 'awaiting_schedule'
    check (state in ('awaiting_schedule', 'invited', 'confirmed', 'declined', 'reschedule_requested', 'cancelled', 'finished')),
  kind text check (kind in ('online', 'in_person')),
  local_start timestamp,
  time_zone text check (time_zone is null or char_length(time_zone) between 1 and 64),
  starts_at timestamptz,
  duration_minutes int check (duration_minutes is null or duration_minutes between 5 and 480),
  meeting_link text check (meeting_link is null or (char_length(meeting_link) <= 500 and meeting_link ~* '^https?://')),
  address text check (address is null or char_length(address) <= 300),
  notes text check (notes is null or char_length(notes) <= 1000),
  -- Grows on every change of the invitation.
  sequence int not null default 0,
  response_note text check (response_note is null or char_length(response_note) <= 1000),
  -- Up to 3 times the candidate suggests: [{"local": "2026-12-03T14:00"}, ...] (wall-clock time, in the interview's time zone).
  proposed_times jsonb not null default '[]'::jsonb
    check (jsonb_typeof(proposed_times) = 'array' and jsonb_array_length(proposed_times) <= 3),
  invited_at timestamptz,
  responded_at timestamptz,
  reminder_24h_sent_at timestamptz,
  reminder_2h_sent_at timestamptz,
  -- Set when the candidate answers (any answer); each person marks it seen on their own.
  notice_at timestamptz,
  scheduled_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Everything but 'awaiting_schedule' needs the details of the meeting.
  constraint candidate_interviews_details_check check (
    state = 'awaiting_schedule'
    or (kind is not null and local_start is not null and time_zone is not null and starts_at is not null and duration_minutes is not null
        and ((kind = 'online' and meeting_link is not null) or (kind = 'in_person' and address is not null)))
  )
);

-- One interview in play per candidate and job. A cancelled or finished one does not block a new round.
create unique index candidate_interviews_one_open_idx on public.candidate_interviews (flow_id, candidate_email)
  where state in ('awaiting_schedule', 'invited', 'confirmed', 'declined', 'reschedule_requested');
create index candidate_interviews_workspace_idx on public.candidate_interviews (workspace_id);
create index candidate_interviews_flow_email_idx on public.candidate_interviews (flow_id, candidate_email);
create index candidate_interviews_applicant_idx on public.candidate_interviews (applicant_id) where applicant_id is not null;
create index candidate_interviews_reminders_idx on public.candidate_interviews (starts_at) where state = 'confirmed';
create index candidate_interviews_open_idx on public.candidate_interviews (starts_at)
  where state in ('invited', 'confirmed', 'declined', 'reschedule_requested');

create trigger candidate_interviews_set_updated_at
before update on public.candidate_interviews
for each row execute function public.set_updated_at();

alter table public.candidate_interviews enable row level security;
revoke all on public.candidate_interviews from public, anon, authenticated;
-- The browser reads the interviews of the candidates it may review; it never writes (the edge function does, as service role).
grant select (id, workspace_id, flow_id, candidate_email, applicant_id, state, kind, local_start, time_zone, starts_at, duration_minutes,
              meeting_link, address, notes, sequence, response_note, proposed_times, invited_at, responded_at, notice_at, scheduled_by,
              created_at, updated_at)
  on public.candidate_interviews to authenticated;
grant all on public.candidate_interviews to service_role;
create policy "applicant reviewers can read candidate interviews" on public.candidate_interviews
  for select to authenticated
  using (public.workspace_user_has_permission(workspace_id, 'applicants'));
comment on table public.candidate_interviews is 'Human interviews of candidates (Interview column): schedule, invitation and the candidate answer. Browser: read only.';

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Safety-net rules (BEFORE insert/update)
-- Computes starts_at from the wall-clock time and the zone, and enforces the time windows when the time or the suggestions change.
create or replace function public.candidate_interview_check_times()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_item jsonb;
  v_local timestamp;
  v_limit timestamptz;
begin
  if new.time_zone is not null and not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = new.time_zone) then
    raise exception 'Unknown time zone.' using errcode = '22023';
  end if;

  if new.local_start is not null and new.time_zone is not null then
    new.starts_at := new.local_start at time zone new.time_zone;
  else
    new.starts_at := null;
  end if;

  -- Window of the recruiter: never in the past, never more than 6 months ahead (checked only when the time was set or changed).
  if new.starts_at is not null
     and (tg_op = 'INSERT' or new.starts_at is distinct from old.starts_at)
     and new.state in ('invited', 'confirmed', 'declined', 'reschedule_requested') then
    if new.starts_at <= now() then
      raise exception 'The interview must be in the future.' using errcode = '22023';
    end if;
    if new.starts_at > now() + interval '6 months' then
      raise exception 'The interview cannot be more than 6 months ahead.' using errcode = '22023';
    end if;
  end if;

  -- Window of the candidate: from today to 30 days after the scheduled date (checked only when the suggestions change).
  if new.proposed_times <> '[]'::jsonb and (tg_op = 'INSERT' or new.proposed_times is distinct from old.proposed_times) then
    if new.starts_at is null then
      raise exception 'There is no scheduled time to suggest another one for.' using errcode = '22023';
    end if;
    v_limit := new.starts_at + interval '30 days';
    for v_item in select value from jsonb_array_elements(new.proposed_times) loop
      if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'local') <> 'string'
         or (v_item ->> 'local') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then
        raise exception 'Each suggested time must look like 2026-12-03T14:00.' using errcode = '22023';
      end if;
      v_local := (v_item ->> 'local')::timestamp;
      if (v_local at time zone new.time_zone) <= now() or (v_local at time zone new.time_zone) > v_limit then
        raise exception 'A suggested time must be between now and 30 days after the interview.' using errcode = '22023';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.candidate_interview_check_times() from public, anon, authenticated;

create trigger candidate_interviews_check_times
before insert or update on public.candidate_interviews
for each row execute function public.candidate_interview_check_times();

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Tokens of the public answer page, events and bell notices
create table public.candidate_interview_tokens (
  interview_id uuid primary key references public.candidate_interviews (id) on delete cascade,
  -- SHA-256 of the secret in the link; the secret itself is never stored.
  token_hash text not null unique check (char_length(token_hash) = 64),
  -- The link stops working 7 days after the interview.
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.candidate_interview_tokens enable row level security;
revoke all on public.candidate_interview_tokens from public, anon, authenticated;
grant all on public.candidate_interview_tokens to service_role;
comment on table public.candidate_interview_tokens is 'Hashed secrets of the candidate answer page. Service role only.';

create table public.candidate_interview_events (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.candidate_interviews (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('scheduled', 'updated', 'cancelled', 'resent', 'confirmed', 'declined', 'reschedule_requested', 'reminder_24h', 'reminder_2h', 'finished')),
  actor text not null check (actor in ('recruiter', 'candidate', 'system')),
  actor_user_id uuid references auth.users (id) on delete set null,
  -- Small, non-secret details (for example the suggested times); the candidate message stays in candidate_interviews.
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 4000),
  created_at timestamptz not null default now()
);
create index candidate_interview_events_interview_idx on public.candidate_interview_events (interview_id, created_at);
alter table public.candidate_interview_events enable row level security;
revoke all on public.candidate_interview_events from public, anon, authenticated;
grant select on public.candidate_interview_events to authenticated;
grant all on public.candidate_interview_events to service_role;
create policy "applicant reviewers can read candidate interview events" on public.candidate_interview_events
  for select to authenticated
  using (public.workspace_user_has_permission(workspace_id, 'applicants'));
comment on table public.candidate_interview_events is 'History of a human interview. Browser: read only.';

-- Who has already seen the bell notice of a candidate answer. One row per person and interview; it remembers WHICH answer was seen,
-- so a later answer (for example a new request for another time) shows up again.
create table public.candidate_interview_notice_seen (
  user_id uuid not null,
  interview_id uuid not null references public.candidate_interviews (id) on delete cascade,
  notice_at timestamptz not null,
  seen_at timestamptz not null default now(),
  primary key (user_id, interview_id)
);
alter table public.candidate_interview_notice_seen enable row level security;
revoke all on public.candidate_interview_notice_seen from public, anon, authenticated;
grant all on public.candidate_interview_notice_seen to service_role;
comment on table public.candidate_interview_notice_seen is 'Bell notices already seen. Written only through mark_candidate_interview_notice_seen.';

create table public.candidate_interview_settings (
  key text primary key check (char_length(key) between 1 and 80),
  value text not null check (char_length(value) <= 500)
);
alter table public.candidate_interview_settings enable row level security;
revoke all on public.candidate_interview_settings from public, anon, authenticated;
grant all on public.candidate_interview_settings to service_role;
comment on table public.candidate_interview_settings is 'Per-project values that are not secrets (worker_url). Service role only.';

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Triggers on the applicants
-- Moving a card into the Interview column creates the waiting row; moving it out removes it only while it is still waiting.
create or replace function public.candidate_interview_on_stage_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(new.candidate_email));
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.status = 'interview' then
    insert into public.candidate_interviews (workspace_id, flow_id, candidate_email, applicant_id, state)
    values (new.workspace_id, new.flow_id, v_email, new.id, 'awaiting_schedule')
    on conflict (flow_id, candidate_email) where state in ('awaiting_schedule', 'invited', 'confirmed', 'declined', 'reschedule_requested')
    do nothing;
  elsif old.status = 'interview' then
    delete from public.candidate_interviews
     where flow_id = new.flow_id and candidate_email = v_email and state = 'awaiting_schedule';
  end if;
  return null;
end;
$$;
revoke all on function public.candidate_interview_on_stage_change() from public, anon, authenticated;

create trigger applicants_candidate_interview_stage
after update of status on public.applicants
for each row execute function public.candidate_interview_on_stage_change();

-- Deleting the last application of a candidate deletes his interviews, tokens and history too.
create or replace function public.candidate_interview_on_applicant_deleted()
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
    delete from public.candidate_interviews where flow_id = old.flow_id and candidate_email = v_email;
  end if;
  return null;
end;
$$;
revoke all on function public.candidate_interview_on_applicant_deleted() from public, anon, authenticated;

create trigger applicants_candidate_interview_deleted
after delete on public.applicants
for each row execute function public.candidate_interview_on_applicant_deleted();

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Bell notices (candidate answers)
-- People responsible for the job (or everyone with access when nobody is named) see a notice for each answer given after they joined
-- the workspace and that they have not opened yet.
create or replace function public.get_candidate_interview_notices(p_workspace_id uuid)
returns table (interview_id uuid, flow_id uuid, job_title text, company_name text, candidate_name text, candidate_email text, state text, starts_at timestamptz, notice_at timestamptz)
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
         i.candidate_email, i.state, i.starts_at, i.notice_at
  from public.candidate_interviews i
  join public.application_flows f on f.id = i.flow_id
  join public.workspaces w on w.id = i.workspace_id
  left join public.workspace_companies wc on wc.id = f.company_id
  where i.workspace_id = p_workspace_id
    and i.state in ('confirmed', 'declined', 'reschedule_requested')
    and i.notice_at is not null
    and (cardinality(f.responsible_user_ids) = 0 or auth.uid() = any (f.responsible_user_ids))
    and i.notice_at > coalesce((select m.created_at from public.workspace_members m where m.workspace_id = i.workspace_id and m.user_id = auth.uid()), '-infinity'::timestamptz)
    and not exists (select 1 from public.candidate_interview_notice_seen s where s.interview_id = i.id and s.user_id = auth.uid() and s.notice_at = i.notice_at)
  order by i.notice_at desc
  limit 50;
end;
$$;
revoke all on function public.get_candidate_interview_notices(uuid) from public, anon;
grant execute on function public.get_candidate_interview_notices(uuid) to authenticated, service_role;

create or replace function public.mark_candidate_interview_notice_seen(p_interview_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_notice timestamptz;
begin
  select i.workspace_id, i.notice_at into v_workspace, v_notice from public.candidate_interviews i where i.id = p_interview_id;
  if auth.uid() is null or v_workspace is null or not public.workspace_user_has_permission(v_workspace, 'applicants') then
    raise exception 'You do not have access to applicants in this workspace.' using errcode = '42501';
  end if;
  if v_notice is null then return; end if;
  insert into public.candidate_interview_notice_seen (user_id, interview_id, notice_at)
  values (auth.uid(), p_interview_id, v_notice)
  on conflict (user_id, interview_id) do update set notice_at = excluded.notice_at, seen_at = now();
end;
$$;
revoke all on function public.mark_candidate_interview_notice_seen(uuid) from public, anon;
grant execute on function public.mark_candidate_interview_notice_seen(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Every 5 minutes: close past interviews and wake the worker function only when a reminder is due
-- A reminder is due for a CONFIRMED interview of a workspace with an active plan, and only when the invitation existed before the
-- reminder moment (an interview booked less than 24 h ahead gets no 24 h reminder, less than 2 h ahead no 2 h reminder). A 24 h
-- reminder that is still unsent when only 2 h are left is skipped.
create or replace function public.candidate_interview_reminders_due()
returns table (interview_id uuid, reminder text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, '24h'
    from public.candidate_interviews i
   where i.state = 'confirmed' and i.reminder_24h_sent_at is null and i.invited_at is not null
     and i.starts_at - interval '24 hours' <= now() and i.starts_at - interval '2 hours' > now()
     and i.invited_at <= i.starts_at - interval '24 hours'
     and public.workspace_has_active_subscription(i.workspace_id)
  union all
  select i.id, '2h'
    from public.candidate_interviews i
   where i.state = 'confirmed' and i.reminder_2h_sent_at is null and i.invited_at is not null
     and i.starts_at - interval '2 hours' <= now() and i.starts_at > now()
     and i.invited_at <= i.starts_at - interval '2 hours'
     and public.workspace_has_active_subscription(i.workspace_id);
$$;
revoke all on function public.candidate_interview_reminders_due() from public, anon, authenticated;
grant execute on function public.candidate_interview_reminders_due() to service_role;

create or replace function public.candidate_interview_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_row record;
begin
  -- Interviews whose end has passed become history, so a new round can be scheduled.
  for v_row in
    update public.candidate_interviews i
       set state = 'finished'
     where i.state in ('invited', 'confirmed', 'declined', 'reschedule_requested')
       and i.starts_at + make_interval(mins => i.duration_minutes) < now()
    returning i.id, i.workspace_id
  loop
    insert into public.candidate_interview_events (interview_id, workspace_id, kind, actor) values (v_row.id, v_row.workspace_id, 'finished', 'system');
  end loop;

  select value into v_url from public.candidate_interview_settings where key = 'worker_url';
  if v_url is null or v_url = '' then return; end if;
  if not exists (select 1 from public.candidate_interview_reminders_due()) then return; end if;
  perform net.http_post(url := v_url, headers := '{"Content-Type": "application/json"}'::jsonb, body := '{"action": "tick"}'::jsonb);
end;
$$;
revoke all on function public.candidate_interview_tick() from public, anon, authenticated;
grant execute on function public.candidate_interview_tick() to service_role;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('candidate-interview-tick', '*/5 * * * *', $$select public.candidate_interview_tick()$$);
