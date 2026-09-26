alter table public.applicants
  add column resume_filename text not null default 'resume.pdf' check (char_length(resume_filename) between 1 and 255),
  add column resume_content_type text not null default 'application/pdf' check (resume_content_type in ('application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));

create table public.pending_applicant_submissions (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  flow_id uuid not null references public.application_flows(id) on delete cascade,
  published_flow_id uuid not null references public.published_flows(id) on delete cascade,
  candidate_name text not null check (char_length(candidate_name) between 1 and 200),
  candidate_email text not null check (char_length(candidate_email) between 3 and 254),
  candidate_info jsonb not null check (jsonb_typeof(candidate_info) = 'object'),
  responses jsonb not null check (jsonb_typeof(responses) = 'array'),
  outcome_status text not null check (outcome_status in ('new', 'failed')),
  resume_path text not null unique,
  resume_filename text not null check (char_length(resume_filename) between 1 and 255),
  resume_content_type text not null check (resume_content_type in ('application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  expires_at timestamptz not null default now() + interval '2 hours',
  created_at timestamptz not null default now()
);

create index pending_applicant_submissions_expiry_idx on public.pending_applicant_submissions (expires_at);
alter table public.pending_applicant_submissions enable row level security;
revoke all on public.pending_applicant_submissions from public, anon, authenticated;
grant all on public.pending_applicant_submissions to service_role;
