-- "Download my data" (Settings): everything Pathway holds about the signed-in person, as one JSON document that the app
-- turns into a CSV file. It only ever reads rows that belong to the caller (auth.uid()). It does not include other people's
-- personal data: not the e-mails of teammates, and not the candidates' details (those belong to the employer; the hiring
-- team exports candidates themselves). Authentication data such as password hashes is never included.

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
                             from public.application_flows f where f.created_by = v_uid), '[]'::jsonb),
    'commentsWritten', coalesce((select jsonb_agg(jsonb_build_object('writtenAt', c.created_at, 'job', f.job_title, 'text', c.body) order by c.created_at)
                                 from public.applicant_comments c left join public.application_flows f on f.id = c.flow_id
                                 where c.author_id = v_uid), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

revoke all on function public.export_my_data() from public, anon, authenticated;
grant execute on function public.export_my_data() to authenticated, service_role;
