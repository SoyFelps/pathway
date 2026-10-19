-- Internal team comments on a candidate. A "candidate" is one job + one e-mail address (repeat applications are one
-- candidate), so a comment belongs to that pair and shows on every application of the candidate.
-- Comments are add-only: the author's name is stored with the comment, so it stays readable if that person later
-- leaves the team or deletes their account. Only people with the Applicants permission can read or write them.

create table public.applicant_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  flow_id uuid not null references public.application_flows(id) on delete cascade,
  candidate_email text not null check (char_length(candidate_email) between 3 and 254),
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null check (char_length(author_name) between 1 and 200),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index applicant_comments_candidate_idx on public.applicant_comments (flow_id, candidate_email, created_at);
create index applicant_comments_workspace_idx on public.applicant_comments (workspace_id);

alter table public.applicant_comments enable row level security;
create policy "applicant reviewers can read comments" on public.applicant_comments as permissive for select to authenticated
  using (public.workspace_user_has_permission(workspace_id, 'applicants'));
revoke all on public.applicant_comments from public, anon, authenticated;
grant select on public.applicant_comments to authenticated;
grant all on public.applicant_comments to service_role;

create or replace function public.add_applicant_comment(p_flow_id uuid, p_candidate_email text, p_body text)
returns public.applicant_comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_email text := lower(btrim(coalesce(p_candidate_email, '')));
  v_body text := btrim(coalesce(p_body, ''));
  v_name text;
  v_row public.applicant_comments;
begin
  select f.workspace_id into v_workspace from public.application_flows f where f.id = p_flow_id;
  if auth.uid() is null or v_workspace is null or not public.workspace_user_has_permission(v_workspace, 'applicants') then
    raise exception 'You do not have access to applicants in this workspace.' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'A comment needs between 1 and 2000 characters.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.applicants a where a.flow_id = p_flow_id and lower(btrim(a.candidate_email)) = v_email) then
    raise exception 'Candidate not found.' using errcode = '22023';
  end if;
  select coalesce(nullif(btrim(p.first_name || ' ' || p.last_name), ''), u.email::text, 'Team member')
  into v_name
  from auth.users u left join public.profiles p on p.user_id = u.id
  where u.id = auth.uid();
  insert into public.applicant_comments (workspace_id, flow_id, candidate_email, author_id, author_name, body)
  values (v_workspace, p_flow_id, v_email, auth.uid(), coalesce(v_name, 'Team member'), v_body)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.add_applicant_comment(uuid, text, text) from public, anon, authenticated;
grant execute on function public.add_applicant_comment(uuid, text, text) to authenticated, service_role;
