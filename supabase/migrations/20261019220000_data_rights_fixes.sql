-- Fixes found while testing the data-rights tools on staging.
--
-- 1) "Download my data" must not hand out workspace content to someone who no longer has access to that workspace.
--    A removed team member could still download the text of the comments they had written (which can contain candidate
--    details). The comments are now included only while the person can still review candidates in that workspace, and the
--    list of jobs only while they can still manage jobs there. Account, profile and plan data are always included.
-- 2) When a person's account is deleted, their name no longer stays on the comments they wrote ("Former team member"),
--    and they are removed from the "mentioned people" list stored with other comments.

create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v jsonb;
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'exportedAt', now(),
    'account', (select jsonb_build_object('userId', u.id, 'email', u.email, 'createdAt', u.created_at, 'emailConfirmedAt', u.email_confirmed_at, 'lastSignInAt', u.last_sign_in_at)
                from auth.users u where u.id = v_uid),
    'profile', (select jsonb_build_object('firstName', p.first_name, 'lastName', p.last_name, 'createdAt', p.created_at, 'updatedAt', p.updated_at)
                from public.profiles p where p.user_id = v_uid),
    'ownedWorkspace', (select jsonb_build_object('name', w.name, 'createdAt', w.created_at,
                         'planStatus', s.status, 'planCurrentPeriodEnd', s.current_period_end, 'planCancelAtPeriodEnd', s.cancel_at_period_end)
                       from public.workspaces w left join public.workspace_subscriptions s on s.workspace_id = w.id
                       where w.owner_id = v_uid),
    'membership', (select jsonb_build_object('workspaceName', w.name, 'canManageFlows', m.can_flows, 'canReviewCandidates', m.can_applicants, 'canManageTeam', m.can_manage_team, 'memberSince', m.created_at)
                   from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
                   where m.user_id = v_uid limit 1),
    'jobsCreated', coalesce((select jsonb_agg(jsonb_build_object('title', f.job_title, 'company', f.company_name, 'status', f.publication_status, 'createdAt', f.created_at, 'updatedAt', f.updated_at) order by f.created_at)
                             from public.application_flows f
                             where f.created_by = v_uid and public.workspace_user_has_permission(f.workspace_id, 'flows')), '[]'::jsonb),
    'commentsWritten', coalesce((select jsonb_agg(jsonb_build_object('writtenAt', c.created_at, 'job', f.job_title, 'text', c.body) order by c.created_at)
                                 from public.applicant_comments c left join public.application_flows f on f.id = c.flow_id
                                 where c.author_id = v_uid and public.workspace_user_has_permission(c.workspace_id, 'applicants')), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

create or replace function public.anonymize_comment_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.author_id is not null and new.author_id is null then
    new.author_name := 'Former team member';
  end if;
  return new;
end;
$$;

create trigger applicant_comments_anonymize_author
before update of author_id on public.applicant_comments
for each row execute function public.anonymize_comment_author();

create or replace function public.scrub_deleted_user_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.applicant_comments c
  set mentions = coalesce((select jsonb_agg(m) from jsonb_array_elements(c.mentions) m where m ->> 'userId' <> old.user_id::text), '[]'::jsonb)
  where c.mentions @> jsonb_build_array(jsonb_build_object('userId', old.user_id));
  return old;
end;
$$;

create trigger profiles_scrub_mentions
after delete on public.profiles
for each row execute function public.scrub_deleted_user_mentions();

revoke all on function public.anonymize_comment_author() from public, anon, authenticated;
revoke all on function public.scrub_deleted_user_mentions() from public, anon, authenticated;
grant execute on function public.anonymize_comment_author() to service_role;
grant execute on function public.scrub_deleted_user_mentions() to service_role;
