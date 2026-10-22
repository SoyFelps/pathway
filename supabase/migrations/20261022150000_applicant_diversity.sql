-- Voluntary self-identification ("Diversity questions" page of the application form): gender identity, sexual orientation, race and ethnicity, disability.
-- These answers are SENSITIVE (special-category data under GDPR/LGPD, self-identification data under the US EEO rules), so they are NOT stored in
-- applicants.candidate_info, which every candidate reviewer can read. They live in their own table that no signed-in user can read directly:
--  * written only by the "applications" Edge Function (service_role), one row per application, together with the application;
--  * read only through security-definer functions that return combined numbers (the aggregated report comes in a later migration);
--  * removed automatically with the application (on delete cascade), so deleting a candidate deletes their answers too.
-- Every question has a "Prefer not to say" answer; the values are checked in the Edge Function (geo.ts) and bounded here.
-- New table: RLS on, no access for anon/authenticated, full access for service_role (see CLAUDE.md, "New tables need explicit grants").

create table public.applicant_diversity (
  applicant_id uuid primary key references public.applicants(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  flow_id uuid not null references public.application_flows(id) on delete cascade,
  gender_identity text not null check (char_length(gender_identity) between 1 and 80),
  sexual_orientation text not null check (char_length(sexual_orientation) between 1 and 80),
  race_ethnicity text not null check (char_length(race_ethnicity) between 1 and 120),
  disability text not null check (char_length(disability) between 1 and 40),
  disability_type text check (disability_type is null or char_length(disability_type) between 1 and 120),
  created_at timestamptz not null default now()
);
create index applicant_diversity_flow_idx on public.applicant_diversity (workspace_id, flow_id);

alter table public.applicant_diversity enable row level security;
revoke all on public.applicant_diversity from public, anon, authenticated;
grant all on public.applicant_diversity to service_role;
