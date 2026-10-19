-- @mentions in candidate comments. A comment can mention teammates who have access to applicants; each mentioned
-- person (except the author) gets an in-app notification until they open that candidate. No e-mail is sent.
-- The mentioned names are stored with the comment (so the @Name text can be highlighted later); the people are
-- checked on the server: only the owner and members with the Applicants permission can be mentioned.

alter table public.applicant_comments
  add column mentions jsonb not null default '[]'::jsonb check (jsonb_typeof(mentions) = 'array');

create table public.applicant_comment_mentions (
  comment_id uuid not null references public.applicant_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index applicant_comment_mentions_unseen_idx on public.applicant_comment_mentions (user_id) where seen_at is null;

-- Nobody reads or writes this table directly; the functions below do it for the signed-in person.
alter table public.applicant_comment_mentions enable row level security;
revoke all on public.applicant_comment_mentions from public, anon, authenticated;
grant all on public.applicant_comment_mentions to service_role;

drop function public.add_applicant_comment(uuid, text, text);
create function public.add_applicant_comment(p_flow_id uuid, p_candidate_email text, p_body text, p_mentions uuid[] default '{}')
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
  v_mentions jsonb;
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

  -- Only people who can open applicants in this workspace can be mentioned (at most 10 per comment).
  select coalesce(jsonb_agg(jsonb_build_object('userId', t.uid, 'name', t.name)), '[]'::jsonb)
  into v_mentions
  from (
    select u.id as uid, coalesce(nullif(btrim(p.first_name || ' ' || p.last_name), ''), u.email::text) as name
    from (select distinct x as uid from unnest(coalesce(p_mentions, '{}'::uuid[])) as x limit 10) ids
    join auth.users u on u.id = ids.uid
    left join public.profiles p on p.user_id = u.id
    where exists (select 1 from public.workspaces w where w.id = v_workspace and w.owner_id = u.id)
       or exists (select 1 from public.workspace_members m where m.workspace_id = v_workspace and m.user_id = u.id and m.can_applicants)
  ) t;

  insert into public.applicant_comments (workspace_id, flow_id, candidate_email, author_id, author_name, body, mentions)
  values (v_workspace, p_flow_id, v_email, auth.uid(), coalesce(v_name, 'Team member'), v_body, v_mentions)
  returning * into v_row;

  insert into public.applicant_comment_mentions (comment_id, user_id)
  select v_row.id, (m ->> 'userId')::uuid
  from jsonb_array_elements(v_mentions) m
  where (m ->> 'userId')::uuid <> auth.uid();

  return v_row;
end;
$$;

-- Unseen mentions of the signed-in person in this workspace (newest first).
create or replace function public.get_comment_mentions(p_workspace_id uuid)
returns table (comment_id uuid, flow_id uuid, candidate_email text, candidate_name text, job_title text, author_name text, created_at timestamptz)
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
    select c.id, c.flow_id, c.candidate_email,
      coalesce((select a.candidate_name from public.applicants a where a.flow_id = c.flow_id and lower(btrim(a.candidate_email)) = c.candidate_email order by a.submitted_at desc limit 1), c.candidate_email),
      f.job_title, c.author_name, c.created_at
    from public.applicant_comment_mentions m
    join public.applicant_comments c on c.id = m.comment_id
    join public.application_flows f on f.id = c.flow_id
    where m.user_id = auth.uid() and m.seen_at is null and c.workspace_id = p_workspace_id
    order by c.created_at desc
    limit 50;
end;
$$;

-- Opening a candidate marks that person's mentions on this candidate as seen. Only the caller's own rows change.
create or replace function public.mark_comment_mentions_seen(p_flow_id uuid, p_candidate_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  update public.applicant_comment_mentions m
  set seen_at = now()
  from public.applicant_comments c
  where m.comment_id = c.id and m.user_id = auth.uid() and m.seen_at is null
    and c.flow_id = p_flow_id and c.candidate_email = lower(btrim(coalesce(p_candidate_email, '')));
end;
$$;

revoke all on function public.add_applicant_comment(uuid, text, text, uuid[]) from public, anon, authenticated;
revoke all on function public.get_comment_mentions(uuid) from public, anon, authenticated;
revoke all on function public.mark_comment_mentions_seen(uuid, text) from public, anon, authenticated;
grant execute on function public.add_applicant_comment(uuid, text, text, uuid[]) to authenticated, service_role;
grant execute on function public.get_comment_mentions(uuid) to authenticated, service_role;
grant execute on function public.mark_comment_mentions_seen(uuid, text) to authenticated, service_role;
