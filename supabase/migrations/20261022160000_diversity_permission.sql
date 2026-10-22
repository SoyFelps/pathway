-- Diversity: a new team permission, "Diversity", OFF by default (unlike the other permissions, which are on by default).
--  * workspace_members / workspace_invitations get can_diversity (default false).
--  * The workspace owner always has it (like every permission); a member only has it when the owner ticks it.
--  * No new table, so no new grants are needed. The diversity reports themselves come in the next migration.
--  * Every function below is the live definition (identical to 20261020210000_reports.sql) plus the new permission.

-- 1) Permission ---------------------------------------------------------------------------------------------------
alter table public.workspace_members add column if not exists can_diversity boolean not null default false;
alter table public.workspace_invitations add column if not exists can_diversity boolean not null default false;

create or replace function public.workspace_user_has_permission(p_workspace_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when auth.uid() is null then false
    when exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_id = auth.uid()) then true
    else exists (
      select 1
      from public.workspace_members m
      where m.workspace_id = p_workspace_id
        and m.user_id = auth.uid()
        and public.workspace_has_active_subscription(p_workspace_id)
        and case p_permission
          when 'flows' then m.can_flows
          when 'applicants' then m.can_applicants
          when 'team' then m.can_manage_team
          when 'customize_stages' then m.can_customize_stages
          when 'reports' then m.can_view_reports
          when 'diversity' then m.can_diversity
          else false
        end
    )
  end;
$function$;

-- 2) Invitations and permission updates carry the new flag --------------------------------------------------------
-- p_can_diversity is optional everywhere: an older caller that does not send it keeps working
-- (invitations default to OFF for this permission, permission updates leave the current value untouched).
drop function if exists public.create_team_invitation(uuid, text, text, text, boolean, boolean, boolean, boolean, boolean);

create or replace function public.create_team_invitation(
  p_workspace_id uuid, p_email text, p_token_hash text, p_encrypted_token text,
  p_can_flows boolean default true, p_can_applicants boolean default true, p_can_manage_team boolean default true,
  p_can_customize_stages boolean default true, p_can_view_reports boolean default true, p_can_diversity boolean default false
)
returns table (invitation_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  actor uuid := auth.uid();
  normalized_email text := lower(trim(p_email));
  seat_count integer;
  workspace_owner uuid;
begin
  if actor is null then raise exception 'Sign in to invite a team member.' using errcode = '42501'; end if;
  if normalized_email is null or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(normalized_email) > 254 then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation token.' using errcode = '22023'; end if;
  if p_encrypted_token is null or p_encrypted_token !~ '^v1[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{107}$' then
    raise exception 'Invalid encrypted invitation token.' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(normalized_email, 0));

  select w.owner_id into workspace_owner from public.workspaces w where w.id = p_workspace_id for update;
  if workspace_owner is null or not public.current_user_can_manage_team(p_workspace_id) then
    raise exception 'You do not have permission to manage this team.' using errcode = '42501';
  end if;
  if not public.workspace_has_active_subscription(p_workspace_id) then
    raise exception 'An active Premium plan is required to add team members.' using errcode = '42501';
  end if;
  if normalized_email = (select lower(u.email) from auth.users u where u.id = workspace_owner) then
    raise exception 'The workspace owner is already part of this team.' using errcode = '22023';
  end if;
  if exists (
    select 1 from auth.users u
    where lower(u.email) = normalized_email
      and (exists (select 1 from public.workspaces w where w.owner_id = u.id)
        or exists (select 1 from public.workspace_members m where m.user_id = u.id))
  ) then
    raise exception 'That account already belongs to a workspace. Accounts can join one workspace at a time.' using errcode = '23505';
  end if;
  update public.workspace_invitations as wi set status = 'expired'
  where wi.workspace_id = p_workspace_id and lower(wi.invited_email) = normalized_email
    and wi.status = 'pending' and wi.expires_at <= now();
  if exists (select 1 from public.workspace_invitations i where lower(i.invited_email) = normalized_email and i.status = 'pending' and i.expires_at > now()) then
    raise exception 'An invitation for this email is already pending.' using errcode = '23505';
  end if;
  select (select count(*) from public.workspace_members m where m.workspace_id = p_workspace_id)
       + (select count(*) from public.workspace_invitations i where i.workspace_id = p_workspace_id and i.status = 'pending' and i.expires_at > now())
    into seat_count;
  if seat_count >= 3 then raise exception 'This Premium workspace already uses all 3 team member seats.' using errcode = '23514'; end if;

  return query
  insert into public.workspace_invitations as i (
    workspace_id, invited_email, token_hash, encrypted_token, can_flows, can_applicants, can_manage_team, can_customize_stages, can_view_reports, can_diversity, invited_by
  ) values (
    p_workspace_id, normalized_email, p_token_hash, p_encrypted_token,
    coalesce(p_can_flows, true), coalesce(p_can_applicants, true), coalesce(p_can_manage_team, true), coalesce(p_can_customize_stages, true), coalesce(p_can_view_reports, true), coalesce(p_can_diversity, false), actor
  ) returning i.id, i.expires_at;
end;
$function$;

revoke all on function public.create_team_invitation(uuid, text, text, text, boolean, boolean, boolean, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.create_team_invitation(uuid, text, text, text, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated, service_role;

create or replace function public.accept_team_invitation(p_token_hash text)
returns table (workspace_id uuid, workspace_name text, can_flows boolean, can_applicants boolean, can_manage_team boolean)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  actor uuid := auth.uid();
  actor_email text;
  actor_email_verified boolean;
  invitation public.workspace_invitations%rowtype;
  seat_count integer;
begin
  if actor is null then raise exception 'Sign in to accept this invitation.' using errcode = '42501'; end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'This invitation link is invalid.' using errcode = '22023'; end if;
  select lower(u.email), u.email_confirmed_at is not null into actor_email, actor_email_verified
  from auth.users u where u.id = actor;
  if actor_email is null or actor_email_verified is not true then
    raise exception 'Confirm the invited email address before joining this workspace.' using errcode = '42501';
  end if;

  select i.* into invitation from public.workspace_invitations i where i.token_hash = p_token_hash for update;
  if not found or invitation.status <> 'pending' or invitation.expires_at <= now() then
    if found and invitation.status = 'pending' and invitation.expires_at <= now() then
      update public.workspace_invitations set status = 'expired' where id = invitation.id;
    end if;
    raise exception 'This invitation has expired, been revoked, or was already used.' using errcode = '22023';
  end if;
  if lower(invitation.invited_email) <> actor_email then
    raise exception 'Sign in or create an account with the email address this invitation was sent to.' using errcode = '42501';
  end if;
  perform 1 from public.workspaces w where w.id = invitation.workspace_id for update;
  if not public.workspace_has_active_subscription(invitation.workspace_id) then
    raise exception 'This workspace no longer has an active Premium plan. Ask its owner to restore Premium before accepting.' using errcode = '42501';
  end if;
  if exists (select 1 from public.workspaces w where w.owner_id = actor)
     or exists (select 1 from public.workspace_members m where m.user_id = actor) then
    raise exception 'This account already belongs to a workspace. Leave that workspace before accepting another invitation.' using errcode = '23505';
  end if;
  select count(*) into seat_count from public.workspace_members m where m.workspace_id = invitation.workspace_id;
  if seat_count >= 3 then raise exception 'This workspace no longer has an available member seat.' using errcode = '23514'; end if;

  insert into public.workspace_members (workspace_id, user_id, member_email, can_flows, can_applicants, can_manage_team, can_customize_stages, can_view_reports, can_diversity, invited_by)
  values (invitation.workspace_id, actor, actor_email, invitation.can_flows, invitation.can_applicants, invitation.can_manage_team, invitation.can_customize_stages, invitation.can_view_reports, invitation.can_diversity, invitation.invited_by);
  update public.workspace_invitations set status = 'accepted', accepted_user_id = actor, accepted_at = now() where id = invitation.id;
  return query select w.id, w.name, invitation.can_flows, invitation.can_applicants, invitation.can_manage_team
    from public.workspaces w where w.id = invitation.workspace_id;
end;
$function$;

drop function if exists public.update_team_member_permissions(uuid, uuid, boolean, boolean, boolean, boolean, boolean);
create or replace function public.update_team_member_permissions(
  p_workspace_id uuid, p_member_id uuid, p_can_flows boolean, p_can_applicants boolean, p_can_manage_team boolean,
  p_can_customize_stages boolean default null, p_can_view_reports boolean default null, p_can_diversity boolean default null
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null or not public.current_user_can_manage_team(p_workspace_id) then
    raise exception 'You do not have permission to manage this team.' using errcode = '42501';
  end if;
  update public.workspace_members set
    can_flows = coalesce(p_can_flows, false),
    can_applicants = coalesce(p_can_applicants, false),
    can_manage_team = coalesce(p_can_manage_team, false),
    can_customize_stages = coalesce(p_can_customize_stages, can_customize_stages),
    can_view_reports = coalesce(p_can_view_reports, can_view_reports),
    can_diversity = coalesce(p_can_diversity, can_diversity)
  where workspace_id = p_workspace_id and user_id = p_member_id;
  if not found then raise exception 'Team member not found. The workspace owner cannot be removed.' using errcode = '22023'; end if;
  return true;
end;
$function$;

revoke all on function public.update_team_member_permissions(uuid, uuid, boolean, boolean, boolean, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.update_team_member_permissions(uuid, uuid, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated, service_role;

-- Read-only team view: now also shows who can see the diversity reports.
drop function if exists public.list_team_overview(uuid);
create or replace function public.list_team_overview(p_workspace_id uuid)
returns table (user_id uuid, email text, is_owner boolean, can_flows boolean, can_applicants boolean, can_manage_team boolean, member_since timestamptz, first_name text, last_name text, can_customize_stages boolean, can_view_reports boolean, can_diversity boolean)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null
     or not (
       exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_id = auth.uid())
       or exists (select 1 from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = auth.uid())
     ) then
    raise exception 'You do not have access to this workspace.' using errcode = '42501';
  end if;
  return query
    select w.owner_id, u.email::text, true, true, true, true, w.created_at, coalesce(p.first_name, 'no'), coalesce(p.last_name, 'name'), true, true, true
    from public.workspaces w
    join auth.users u on u.id = w.owner_id
    left join public.profiles p on p.user_id = w.owner_id
    where w.id = p_workspace_id
    union all
    select m.user_id, m.member_email, false, m.can_flows, m.can_applicants, m.can_manage_team, m.created_at, coalesce(p.first_name, 'no'), coalesce(p.last_name, 'name'), m.can_customize_stages, m.can_view_reports, m.can_diversity
    from public.workspace_members m
    left join public.profiles p on p.user_id = m.user_id
    where m.workspace_id = p_workspace_id
    order by 3 desc, 7;
end;
$function$;

revoke all on function public.list_team_overview(uuid) from public, anon, authenticated;
grant execute on function public.list_team_overview(uuid) to authenticated, service_role;

-- "Download my data": the membership section lists the new permission too.
create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
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
    'membership', (select jsonb_build_object('workspaceName', w.name, 'canManageFlows', m.can_flows, 'canReviewCandidates', m.can_applicants, 'canManageTeam', m.can_manage_team, 'canCustomizeStages', m.can_customize_stages, 'canViewReports', m.can_view_reports, 'canDiversity', m.can_diversity, 'memberSince', m.created_at)
                   from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
                   where m.user_id = v_uid limit 1),
    'jobsCreated', coalesce((select jsonb_agg(jsonb_build_object('title', f.job_title, 'company', f.company_name, 'status', f.publication_status, 'createdAt', f.created_at, 'updatedAt', f.updated_at) order by f.created_at)
                             from public.application_flows f
                             where f.created_by = v_uid and public.workspace_user_has_permission(f.workspace_id, 'flows')), '[]'::jsonb)
  ) into v;
  return v;
end;
$function$;
