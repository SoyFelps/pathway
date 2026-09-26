create table public.applicants (
  id uuid primary key,
  submission_key uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  flow_id uuid not null references public.application_flows(id) on delete cascade,
  published_flow_id uuid not null references public.published_flows(id) on delete cascade,
  candidate_name text not null check (char_length(candidate_name) between 1 and 200),
  candidate_email text not null check (char_length(candidate_email) between 3 and 254),
  candidate_info jsonb not null default '{}'::jsonb check (jsonb_typeof(candidate_info) = 'object'),
  responses jsonb not null default '[]'::jsonb check (jsonb_typeof(responses) = 'array'),
  resume_path text not null,
  status text not null default 'new' check (status in ('new', 'failed', 'promising', 'approved')),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint applicants_flow_submission_key_unique unique (flow_id, submission_key)
);

create index applicants_workspace_submitted_idx on public.applicants (workspace_id, submitted_at desc);
create index applicants_flow_submitted_idx on public.applicants (flow_id, submitted_at desc);
create index applicants_workspace_status_submitted_idx on public.applicants (workspace_id, status, submitted_at desc);

alter table public.applicants enable row level security;
revoke all on public.applicants from anon, authenticated;
grant select on public.applicants to authenticated;
grant update (status) on public.applicants to authenticated;
grant all on public.applicants to service_role;

create policy "workspace owners can read applicants"
on public.applicants for select to authenticated
using (exists (
  select 1 from public.workspaces w
  where w.id = applicants.workspace_id and w.owner_id = (select auth.uid())
));

create policy "workspace owners can update applicant status"
on public.applicants for update to authenticated
using (exists (
  select 1 from public.workspaces w
  where w.id = applicants.workspace_id and w.owner_id = (select auth.uid())
))
with check (status in ('new', 'failed', 'promising', 'approved') and exists (
  select 1 from public.workspaces w
  where w.id = applicants.workspace_id and w.owner_id = (select auth.uid())
));

create trigger applicants_set_updated_at
before update on public.applicants
for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'applicant-resumes',
  'applicant-resumes',
  false,
  10485760,
  array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "workspace owners can view applicant resumes"
on storage.objects for select to authenticated
using (
  bucket_id = 'applicant-resumes'
  and exists (
    select 1 from public.workspaces w
    where w.id::text = (storage.foldername(name))[1]
      and w.owner_id = (select auth.uid())
  )
);

create table public.applicant_submission_limits (
  flow_id uuid not null references public.application_flows(id) on delete cascade,
  client_key_hash text not null check (client_key_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0),
  primary key (flow_id, client_key_hash)
);
alter table public.applicant_submission_limits enable row level security;
revoke all on public.applicant_submission_limits from public, anon, authenticated;
grant all on public.applicant_submission_limits to service_role;

create or replace function public.consume_applicant_submission_limit(p_flow_id uuid, p_client_key_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
begin
  if p_client_key_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  delete from public.applicant_submission_limits
  where window_started_at < now() - interval '1 day';

  insert into public.applicant_submission_limits (flow_id, client_key_hash, window_started_at, request_count)
  values (p_flow_id, p_client_key_hash, now(), 1)
  on conflict (flow_id, client_key_hash) do update set
    window_started_at = case
      when public.applicant_submission_limits.window_started_at < now() - interval '1 hour' then now()
      else public.applicant_submission_limits.window_started_at
    end,
    request_count = case
      when public.applicant_submission_limits.window_started_at < now() - interval '1 hour' then 1
      else public.applicant_submission_limits.request_count + 1
    end
  returning request_count into current_count;

  return current_count <= 8;
end;
$$;
revoke all on function public.consume_applicant_submission_limit(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_applicant_submission_limit(uuid, text) to service_role;
