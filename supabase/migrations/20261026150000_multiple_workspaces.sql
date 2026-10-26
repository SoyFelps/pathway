-- Several workspaces per person (Entrega A: database; invisible to the current app).
--  * A person can own up to 5 workspaces and belong to any number of others as a member (limit enforced by a trigger, race-safe).
--  * Invitations no longer refuse people who already have workspaces; pending invitations are per workspace; accepting one makes that workspace the current one.
--  * New: list_my_workspaces(), create_workspace(), rename_workspace() (owner only), set_last_workspace() and profiles.last_workspace_id.
--  * export_my_data lists every workspace (the old single keys stay for the previous app version); support.active_users has one row per person and workspace.
--  * Everything else (RLS, reports, candidates, billing rows) already works per workspace id and is untouched.
--  * Additive for data: no rows change. The unique constraints on workspaces.owner_id and workspace_members.user_id are dropped.

-- 1) The two "one per person" rules --------------------------------------------------------------------------------
alter table public.workspaces drop constraint if exists workspaces_owner_id_key;
alter table public.workspace_members drop constraint if exists workspace_members_user_id_key;
create index if not exists workspaces_owner_id_idx on public.workspaces (owner_id);
create index if not exists workspace_members_user_id_idx on public.workspace_members (user_id);

-- 2) Last workspace used (database, so it follows the person to any device) ------------------------------------------
alter table public.profiles add column if not exists last_workspace_id uuid references public.workspaces (id) on delete set null;
-- switching workspace is not a profile edit: only a change of the names updates profiles.updated_at
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update of first_name, last_name on public.profiles
  for each row execute function public.set_updated_at();

-- 3) Limit of 5 owned workspaces (a lock per person keeps two parallel creations from passing it) -------------------
create or replace function public.enforce_workspace_limit()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  c_max constant integer := 5;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workspace-limit:' || new.owner_id::text, 0));
  if (select count(*) from public.workspaces w where w.owner_id = new.owner_id) >= c_max then
    raise exception 'You can own up to 5 workspaces.' using errcode = '23514';
  end if;
  return new;
end;
$function$;
revoke all on function public.enforce_workspace_limit() from public, anon, authenticated;
grant execute on function public.enforce_workspace_limit() to service_role;
drop trigger if exists workspaces_enforce_limit on public.workspaces;
create trigger workspaces_enforce_limit before insert on public.workspaces
  for each row execute function public.enforce_workspace_limit();

create or replace function public.current_user_can_create_workspace()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select public.current_auth_session_is_active()
    and (select count(*) from public.workspaces w where w.owner_id = (select auth.uid())) < 5;
$function$;

drop policy if exists "unassigned users can create their own workspace" on public.workspaces;
drop policy if exists "users can create their own workspaces" on public.workspaces;
create policy "users can create their own workspaces" on public.workspaces
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.current_user_can_create_workspace());

-- 4) Sign-up: same behaviour, without the one-workspace-per-owner conflict target --------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  workspace_name text;
begin
  insert into public.profiles (user_id, first_name, last_name)
  values (
    new.id,
    coalesce(nullif(btrim(left(coalesce(new.raw_user_meta_data ->> 'first_name', ''), 60)), ''), 'no'),
    coalesce(nullif(btrim(left(coalesce(new.raw_user_meta_data ->> 'last_name', ''), 60)), ''), 'name')
  )
  on conflict (user_id) do nothing;
  if new.raw_user_meta_data ->> 'pathway_team_invite_pending' = 'true' then
    return new;
  end if;
  workspace_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'workspace_name'), ''), 'My workspace');
  insert into public.workspaces (owner_id, name) values (new.id, workspace_name);
  return new;
end;
$function$;

-- 5) Invitations and the personal data export -----------------------------------------------------------------------
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
    join public.workspace_members m on m.user_id = u.id
    where lower(u.email) = normalized_email and m.workspace_id = p_workspace_id
  ) then
    raise exception 'That person is already a member of this workspace.' using errcode = '23505';
  end if;
  update public.workspace_invitations as wi set status = 'expired'
  where wi.workspace_id = p_workspace_id and lower(wi.invited_email) = normalized_email
    and wi.status = 'pending' and wi.expires_at <= now();
  if exists (select 1 from public.workspace_invitations i where i.workspace_id = p_workspace_id and lower(i.invited_email) = normalized_email and i.status = 'pending' and i.expires_at > now()) then
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
  if exists (select 1 from public.workspaces w where w.id = invitation.workspace_id and w.owner_id = actor)
     or exists (select 1 from public.workspace_members m where m.workspace_id = invitation.workspace_id and m.user_id = actor) then
    raise exception 'You already belong to this workspace.' using errcode = '23505';
  end if;
  select count(*) into seat_count from public.workspace_members m where m.workspace_id = invitation.workspace_id;
  if seat_count >= 3 then raise exception 'This workspace no longer has an available member seat.' using errcode = '23514'; end if;

  insert into public.workspace_members (workspace_id, user_id, member_email, can_flows, can_applicants, can_manage_team, can_customize_stages, can_view_reports, can_diversity, invited_by)
  values (invitation.workspace_id, actor, actor_email, invitation.can_flows, invitation.can_applicants, invitation.can_manage_team, invitation.can_customize_stages, invitation.can_view_reports, invitation.can_diversity, invitation.invited_by);
  update public.workspace_invitations set status = 'accepted', accepted_user_id = actor, accepted_at = now() where id = invitation.id;
  update public.profiles set last_workspace_id = invitation.workspace_id where user_id = actor;
  return query select w.id, w.name, invitation.can_flows, invitation.can_applicants, invitation.can_manage_team
    from public.workspaces w where w.id = invitation.workspace_id;
end;
$function$;

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
                       where w.owner_id = v_uid order by w.created_at, w.id limit 1),
    'ownedWorkspaces', coalesce((select jsonb_agg(jsonb_build_object('name', w.name, 'createdAt', w.created_at,
                         'planStatus', s.status, 'planCurrentPeriodEnd', s.current_period_end, 'planCancelAtPeriodEnd', s.cancel_at_period_end) order by w.created_at, w.id)
                       from public.workspaces w left join public.workspace_subscriptions s on s.workspace_id = w.id
                       where w.owner_id = v_uid), '[]'::jsonb),
    'membership', (select jsonb_build_object('workspaceName', w.name, 'canManageFlows', m.can_flows, 'canReviewCandidates', m.can_applicants, 'canManageTeam', m.can_manage_team, 'canCustomizeStages', m.can_customize_stages, 'canViewReports', m.can_view_reports, 'canDiversity', m.can_diversity, 'memberSince', m.created_at)
                   from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
                   where m.user_id = v_uid order by m.created_at, m.id limit 1),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object('workspaceName', w.name, 'canManageFlows', m.can_flows, 'canReviewCandidates', m.can_applicants, 'canManageTeam', m.can_manage_team, 'canCustomizeStages', m.can_customize_stages, 'canViewReports', m.can_view_reports, 'canDiversity', m.can_diversity, 'memberSince', m.created_at) order by m.created_at, m.id)
                   from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
                   where m.user_id = v_uid), '[]'::jsonb),
    'jobsCreated', coalesce((select jsonb_agg(jsonb_build_object('title', f.job_title, 'company', f.company_name, 'status', f.publication_status, 'createdAt', f.created_at, 'updatedAt', f.updated_at) order by f.created_at)
                             from public.application_flows f
                             where f.created_by = v_uid and public.workspace_user_has_permission(f.workspace_id, 'flows')), '[]'::jsonb)
  ) into v;
  return v;
end;
$function$;

-- 6) The new workspace functions --------------------------------------------------------------------------------------
-- Every workspace the signed-in person belongs to, oldest first (the app numbers repeated names I, II, III in this order).
create or replace function public.list_my_workspaces()
returns table (workspace_id uuid, name text, created_at timestamptz, is_owner boolean, is_last boolean, premium_active boolean,
               can_flows boolean, can_applicants boolean, can_manage_team boolean, can_customize_stages boolean, can_view_reports boolean, can_diversity boolean)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null then raise exception 'Sign in to see your workspaces.' using errcode = '42501'; end if;
  return query
    select w.id, w.name, w.created_at, true, coalesce(p.last_workspace_id = w.id, false), public.workspace_has_active_subscription(w.id),
           true, true, true, true, true, true
    from public.workspaces w left join public.profiles p on p.user_id = auth.uid()
    where w.owner_id = auth.uid()
    union all
    select w.id, w.name, w.created_at, false, coalesce(p.last_workspace_id = w.id, false), public.workspace_has_active_subscription(w.id),
           m.can_flows, m.can_applicants, m.can_manage_team, m.can_customize_stages, m.can_view_reports, m.can_diversity
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
    left join public.profiles p on p.user_id = auth.uid()
    where m.user_id = auth.uid()
    order by 3, 1;
end;
$function$;
revoke all on function public.list_my_workspaces() from public, anon, authenticated;
grant execute on function public.list_my_workspaces() to authenticated, service_role;

create or replace function public.create_workspace(p_name text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
  v_created timestamptz;
begin
  if auth.uid() is null or not public.current_auth_session_is_active() then
    raise exception 'Sign in to create a workspace.' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 120 or v_name ~ '[[:cntrl:]]' then
    raise exception 'Name the workspace with 1 to 120 characters.' using errcode = '22023';
  end if;
  -- the trigger on workspaces enforces the limit of 5 (and its lock), so the same message comes from any path
  insert into public.workspaces (owner_id, name) values (auth.uid(), v_name) returning id, created_at into v_id, v_created;
  update public.profiles set last_workspace_id = v_id where user_id = auth.uid();
  return jsonb_build_object('id', v_id, 'name', v_name, 'created_at', v_created);
end;
$function$;
revoke all on function public.create_workspace(text) from public, anon, authenticated;
grant execute on function public.create_workspace(text) to authenticated, service_role;

create or replace function public.rename_workspace(p_workspace_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null or not exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_id = auth.uid()) then
    raise exception 'Only the workspace owner can rename it.' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 120 or v_name ~ '[[:cntrl:]]' then
    raise exception 'Name the workspace with 1 to 120 characters.' using errcode = '22023';
  end if;
  update public.workspaces set name = v_name where id = p_workspace_id and owner_id = auth.uid();
  return jsonb_build_object('id', p_workspace_id, 'name', v_name);
end;
$function$;
revoke all on function public.rename_workspace(uuid, text) from public, anon, authenticated;
grant execute on function public.rename_workspace(uuid, text) to authenticated, service_role;

create or replace function public.set_last_workspace(p_workspace_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null then raise exception 'Sign in to choose a workspace.' using errcode = '42501'; end if;
  if not (exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_id = auth.uid())
          or exists (select 1 from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = auth.uid())) then
    raise exception 'You do not belong to this workspace.' using errcode = '42501';
  end if;
  update public.profiles set last_workspace_id = p_workspace_id where user_id = auth.uid();
  return true;
end;
$function$;
revoke all on function public.set_last_workspace(uuid) from public, anon, authenticated;
grant execute on function public.set_last_workspace(uuid) to authenticated, service_role;

-- 7) Support view: one row per person AND workspace (a person can now own several and belong to others) -----------------
create or replace view support.active_users as
select
  u.id as user_id,
  u.email,
  u.created_at as account_created_at,
  u.last_sign_in_at,
  u.email_confirmed_at,
  (u.email_confirmed_at is not null) as email_confirmed,
  r.workspace_id,
  r.workspace_name,
  r.workspace_role,
  subscription.status as workspace_subscription_status,
  subscription.current_period_end as workspace_current_period_end,
  subscription.cancel_at_period_end as workspace_cancel_at_period_end,
  coalesce(subscription.status = 'active' and subscription.current_period_end > pg_catalog.now(), false) as workspace_is_premium
from auth.users as u
left join lateral (
  select w.id as workspace_id, w.name as workspace_name, 'owner'::text as workspace_role
  from public.workspaces as w where w.owner_id = u.id
  union all
  select w.id, w.name, 'member'::text
  from public.workspace_members as m join public.workspaces as w on w.id = m.workspace_id where m.user_id = u.id
) as r on true
left join public.workspace_subscriptions as subscription on subscription.workspace_id = r.workspace_id
where u.deleted_at is null
  and (u.banned_until is null or u.banned_until <= pg_catalog.now());
