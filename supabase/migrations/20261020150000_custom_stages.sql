-- Custom applicant stages ("columns") and a new team permission: "Customize stages".
--  * workspace_members / workspace_invitations get can_customize_stages (default true, like the other permissions).
--  * workspace_custom_stages: up to 5 named columns per workspace. A candidate in one has status 'custom:<stage id>'.
--  * workspace_board_settings: which columns are on and in which order, shared by the whole workspace
--    (before this, that choice lived in each person's browser).
--  * Every change goes through checked functions; people with the permission can change the structure, everyone else only reads.

-- 1) Permission ---------------------------------------------------------------------------------------------------
alter table public.workspace_members add column if not exists can_customize_stages boolean not null default true;
alter table public.workspace_invitations add column if not exists can_customize_stages boolean not null default true;

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
          else false
        end
    )
  end;
$function$;

-- 2) Invitations and permission updates carry the new flag --------------------------------------------------------
drop function if exists public.create_team_invitation(uuid, text, text, boolean, boolean, boolean);
drop function if exists public.create_team_invitation(uuid, text, text, text, boolean, boolean, boolean);

create or replace function public.create_team_invitation(
  p_workspace_id uuid, p_email text, p_token_hash text, p_encrypted_token text,
  p_can_flows boolean default true, p_can_applicants boolean default true, p_can_manage_team boolean default true,
  p_can_customize_stages boolean default true
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
    workspace_id, invited_email, token_hash, encrypted_token, can_flows, can_applicants, can_manage_team, can_customize_stages, invited_by
  ) values (
    p_workspace_id, normalized_email, p_token_hash, p_encrypted_token,
    coalesce(p_can_flows, true), coalesce(p_can_applicants, true), coalesce(p_can_manage_team, true), coalesce(p_can_customize_stages, true), actor
  ) returning i.id, i.expires_at;
end;
$function$;

revoke all on function public.create_team_invitation(uuid, text, text, text, boolean, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.create_team_invitation(uuid, text, text, text, boolean, boolean, boolean, boolean) to authenticated, service_role;

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

  insert into public.workspace_members (workspace_id, user_id, member_email, can_flows, can_applicants, can_manage_team, can_customize_stages, invited_by)
  values (invitation.workspace_id, actor, actor_email, invitation.can_flows, invitation.can_applicants, invitation.can_manage_team, invitation.can_customize_stages, invitation.invited_by);
  update public.workspace_invitations set status = 'accepted', accepted_user_id = actor, accepted_at = now() where id = invitation.id;
  return query select w.id, w.name, invitation.can_flows, invitation.can_applicants, invitation.can_manage_team
    from public.workspaces w where w.id = invitation.workspace_id;
end;
$function$;

-- p_can_customize_stages is optional: an old caller that does not send it leaves the current value untouched.
drop function if exists public.update_team_member_permissions(uuid, uuid, boolean, boolean, boolean);
create or replace function public.update_team_member_permissions(
  p_workspace_id uuid, p_member_id uuid, p_can_flows boolean, p_can_applicants boolean, p_can_manage_team boolean,
  p_can_customize_stages boolean default null
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
    can_customize_stages = coalesce(p_can_customize_stages, can_customize_stages)
  where workspace_id = p_workspace_id and user_id = p_member_id;
  if not found then raise exception 'Team member not found. The workspace owner cannot be removed.' using errcode = '22023'; end if;
  return true;
end;
$function$;

revoke all on function public.update_team_member_permissions(uuid, uuid, boolean, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.update_team_member_permissions(uuid, uuid, boolean, boolean, boolean, boolean) to authenticated, service_role;

-- Read-only team view: now also shows who can customize stages.
drop function if exists public.list_team_overview(uuid);
create or replace function public.list_team_overview(p_workspace_id uuid)
returns table (user_id uuid, email text, is_owner boolean, can_flows boolean, can_applicants boolean, can_manage_team boolean, member_since timestamptz, first_name text, last_name text, can_customize_stages boolean)
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
    select w.owner_id, u.email::text, true, true, true, true, w.created_at, coalesce(p.first_name, 'no'), coalesce(p.last_name, 'name'), true
    from public.workspaces w
    join auth.users u on u.id = w.owner_id
    left join public.profiles p on p.user_id = w.owner_id
    where w.id = p_workspace_id
    union all
    select m.user_id, m.member_email, false, m.can_flows, m.can_applicants, m.can_manage_team, m.created_at, coalesce(p.first_name, 'no'), coalesce(p.last_name, 'name'), m.can_customize_stages
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
    'membership', (select jsonb_build_object('workspaceName', w.name, 'canManageFlows', m.can_flows, 'canReviewCandidates', m.can_applicants, 'canManageTeam', m.can_manage_team, 'canCustomizeStages', m.can_customize_stages, 'memberSince', m.created_at)
                   from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
                   where m.user_id = v_uid limit 1),
    'jobsCreated', coalesce((select jsonb_agg(jsonb_build_object('title', f.job_title, 'company', f.company_name, 'status', f.publication_status, 'createdAt', f.created_at, 'updatedAt', f.updated_at) order by f.created_at)
                             from public.application_flows f
                             where f.created_by = v_uid and public.workspace_user_has_permission(f.workspace_id, 'flows')), '[]'::jsonb)
  ) into v;
  return v;
end;
$function$;

-- 3) Tables --------------------------------------------------------------------------------------------------------
create table public.workspace_custom_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  created_at timestamptz not null default now()
);
create unique index workspace_custom_stages_workspace_name_key on public.workspace_custom_stages (workspace_id, lower(name));

create table public.workspace_board_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  stage_order jsonb not null default '[]'::jsonb,
  stage_enabled jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.workspace_custom_stages enable row level security;
alter table public.workspace_board_settings enable row level security;
revoke all on public.workspace_custom_stages, public.workspace_board_settings from public, anon, authenticated;
grant select on public.workspace_custom_stages, public.workspace_board_settings to authenticated;
grant all on public.workspace_custom_stages, public.workspace_board_settings to service_role;

create policy "workspace people read custom stages" on public.workspace_custom_stages
  for select to authenticated
  using (public.workspace_user_has_permission(workspace_id, 'applicants') or public.workspace_user_has_permission(workspace_id, 'customize_stages'));
create policy "workspace people read board settings" on public.workspace_board_settings
  for select to authenticated
  using (public.workspace_user_has_permission(workspace_id, 'applicants') or public.workspace_user_has_permission(workspace_id, 'customize_stages'));

-- 4) Applicant status can also be a custom stage -------------------------------------------------------------------
alter table public.applicants drop constraint if exists applicants_status_check;
alter table public.applicants add constraint applicants_status_check check (
  status in ('failed', 'new', 'screening', 'team_fit', 'skill_fit', 'interview', 'promising', 'offer', 'withdrawn', 'hired')
  or status ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);

drop policy if exists "workspace applicant reviewers can update applicant status" on public.applicants;
create policy "workspace applicant reviewers can update applicant status"
on public.applicants for update to authenticated
using (public.workspace_user_has_permission(workspace_id, 'applicants'))
with check (
  (status in ('failed', 'new', 'screening', 'team_fit', 'skill_fit', 'interview', 'promising', 'offer', 'withdrawn', 'hired')
    or status ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  and public.workspace_user_has_permission(workspace_id, 'applicants')
);

-- A custom status must name a stage of the SAME workspace. The share lock keeps a stage from being deleted at the same moment.
create or replace function public.validate_applicant_custom_status()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.status like 'custom:%' then
    if new.status !~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'That column no longer exists. Refresh the board and try again.' using errcode = '23503';
    end if;
    perform 1 from public.workspace_custom_stages s
    where s.id = substr(new.status, 8)::uuid and s.workspace_id = new.workspace_id
    for share;
    if not found then
      raise exception 'That column no longer exists. Refresh the board and try again.' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function public.validate_applicant_custom_status() from public, anon, authenticated;
grant execute on function public.validate_applicant_custom_status() to service_role;

create trigger applicants_validate_custom_status
  before insert or update of status on public.applicants
  for each row execute function public.validate_applicant_custom_status();

-- 5) Functions that change the board -------------------------------------------------------------------------------
-- Standard stages that can be reordered (Failed and New stay first, Hired stays last).
create or replace function public.create_custom_stage(p_workspace_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
  v_default jsonb := '["screening","team_fit","skill_fit","interview","promising","offer","withdrawn"]'::jsonb;
  v_row public.workspace_board_settings%rowtype;
  v_order jsonb;
  v_key text;
begin
  if auth.uid() is null or not public.workspace_user_has_permission(p_workspace_id, 'customize_stages') then
    raise exception 'You do not have permission to customize the stages.' using errcode = '42501';
  end if;
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;
  if char_length(v_name) < 1 or char_length(v_name) > 30 or v_name ~ '[[:cntrl:]]' then
    raise exception 'Name the column with 1 to 30 characters.' using errcode = '22023';
  end if;
  if lower(replace(v_name, '_', ' ')) = any (array['failed','new','screening','team fit','skill fit','interview','promising','offer','withdrawn','hired']) then
    raise exception 'That name is already used by a standard column.' using errcode = '23505';
  end if;
  if exists (select 1 from public.workspace_custom_stages s where s.workspace_id = p_workspace_id and lower(s.name) = lower(v_name)) then
    raise exception 'A column with this name already exists.' using errcode = '23505';
  end if;
  if (select count(*) from public.workspace_custom_stages s where s.workspace_id = p_workspace_id) >= 5 then
    raise exception 'You can create up to 5 custom columns.' using errcode = '23514';
  end if;
  insert into public.workspace_custom_stages (workspace_id, name) values (p_workspace_id, v_name) returning id into v_id;
  v_key := 'custom:' || v_id::text;
  select * into v_row from public.workspace_board_settings b where b.workspace_id = p_workspace_id;
  v_order := case when found and jsonb_array_length(v_row.stage_order) > 0 then v_row.stage_order else v_default end;
  insert into public.workspace_board_settings as b (workspace_id, stage_order, stage_enabled, updated_at)
  values (p_workspace_id, v_order || to_jsonb(v_key), jsonb_build_object(v_key, true), now())
  on conflict (workspace_id) do update set
    stage_order = excluded.stage_order,
    stage_enabled = b.stage_enabled || jsonb_build_object(v_key, true),
    updated_at = now();
  return jsonb_build_object('id', v_id, 'name', v_name);
end;
$function$;

create or replace function public.rename_custom_stage(p_workspace_id uuid, p_stage_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null or not public.workspace_user_has_permission(p_workspace_id, 'customize_stages') then
    raise exception 'You do not have permission to customize the stages.' using errcode = '42501';
  end if;
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;
  if char_length(v_name) < 1 or char_length(v_name) > 30 or v_name ~ '[[:cntrl:]]' then
    raise exception 'Name the column with 1 to 30 characters.' using errcode = '22023';
  end if;
  if lower(replace(v_name, '_', ' ')) = any (array['failed','new','screening','team fit','skill fit','interview','promising','offer','withdrawn','hired']) then
    raise exception 'That name is already used by a standard column.' using errcode = '23505';
  end if;
  if exists (select 1 from public.workspace_custom_stages s where s.workspace_id = p_workspace_id and lower(s.name) = lower(v_name) and s.id <> p_stage_id) then
    raise exception 'A column with this name already exists.' using errcode = '23505';
  end if;
  update public.workspace_custom_stages set name = v_name where id = p_stage_id and workspace_id = p_workspace_id;
  if not found then raise exception 'That column no longer exists. Refresh the board and try again.' using errcode = '23503'; end if;
  return jsonb_build_object('id', p_stage_id, 'name', v_name);
end;
$function$;

create or replace function public.delete_custom_stage(p_workspace_id uuid, p_stage_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_key text := 'custom:' || p_stage_id::text;
begin
  if auth.uid() is null or not public.workspace_user_has_permission(p_workspace_id, 'customize_stages') then
    raise exception 'You do not have permission to customize the stages.' using errcode = '42501';
  end if;
  perform 1 from public.workspace_custom_stages s where s.id = p_stage_id and s.workspace_id = p_workspace_id for update;
  if not found then raise exception 'That column no longer exists. Refresh the board and try again.' using errcode = '23503'; end if;
  if exists (select 1 from public.applicants a where a.workspace_id = p_workspace_id and a.status = v_key) then
    raise exception 'This column contains applicants. Move them to another stage before deleting it.' using errcode = '23503';
  end if;
  delete from public.workspace_custom_stages where id = p_stage_id and workspace_id = p_workspace_id;
  update public.workspace_board_settings set
    stage_order = coalesce((select jsonb_agg(e) from jsonb_array_elements(stage_order) e where (e #>> '{}') <> v_key), '[]'::jsonb),
    stage_enabled = stage_enabled - v_key,
    updated_at = now()
  where workspace_id = p_workspace_id;
  return true;
end;
$function$;

-- Saves the whole board setup (order of the movable stages + which columns are on). A column holding candidates cannot be turned off.
create or replace function public.save_board_settings(p_workspace_id uuid, p_order jsonb, p_enabled jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_standard text[] := array['screening','team_fit','skill_fit','interview','promising','offer','withdrawn'];
  v_custom text[];
  v_valid text[];
  v_order text[] := '{}';
  v_enabled jsonb := '{}'::jsonb;
  v_existing jsonb;
  v_key text;
  v_value jsonb;
begin
  if auth.uid() is null or not public.workspace_user_has_permission(p_workspace_id, 'customize_stages') then
    raise exception 'You do not have permission to customize the stages.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_order) is distinct from 'array' or jsonb_typeof(p_enabled) is distinct from 'object' then
    raise exception 'The stage settings are invalid.' using errcode = '22023';
  end if;
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;
  select coalesce((select b.stage_enabled from public.workspace_board_settings b where b.workspace_id = p_workspace_id), '{}'::jsonb) into v_existing;
  select coalesce(array_agg('custom:' || s.id::text), '{}') into v_custom from public.workspace_custom_stages s where s.workspace_id = p_workspace_id;
  v_valid := v_standard || v_custom;
  for v_key in select jsonb_array_elements_text(p_order) loop
    if not (v_key = any (v_valid)) then raise exception 'The stage order contains an unknown stage. Refresh the board and try again.' using errcode = '22023'; end if;
    if not (v_key = any (v_order)) then v_order := v_order || v_key; end if;
  end loop;
  foreach v_key in array v_valid loop
    if not (v_key = any (v_order)) then v_order := v_order || v_key; end if;
  end loop;
  for v_key, v_value in select * from jsonb_each(p_enabled) loop
    if not (v_key = any (v_valid || array['hired'])) then raise exception 'The stage settings contain an unknown stage. Refresh the board and try again.' using errcode = '22023'; end if;
    if jsonb_typeof(v_value) <> 'boolean' then raise exception 'The stage settings are invalid.' using errcode = '22023'; end if;
    -- turning a column off is refused while it holds applicants (a column already stored as off is left alone)
    if v_value = 'false'::jsonb and v_existing -> v_key is distinct from 'false'::jsonb
       and exists (select 1 from public.applicants a where a.workspace_id = p_workspace_id and a.status = v_key) then
      raise exception 'A column that contains applicants cannot be turned off. Move them to another stage first.' using errcode = '23503';
    end if;
    v_enabled := v_enabled || jsonb_build_object(v_key, v_value);
  end loop;
  insert into public.workspace_board_settings (workspace_id, stage_order, stage_enabled, updated_at)
  values (p_workspace_id, to_jsonb(v_order), v_enabled, now())
  on conflict (workspace_id) do update set stage_order = excluded.stage_order, stage_enabled = excluded.stage_enabled, updated_at = now();
  return jsonb_build_object('order', to_jsonb(v_order), 'enabled', v_enabled);
end;
$function$;

revoke all on function public.create_custom_stage(uuid, text) from public, anon, authenticated;
revoke all on function public.rename_custom_stage(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.delete_custom_stage(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_board_settings(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_custom_stage(uuid, text) to authenticated, service_role;
grant execute on function public.rename_custom_stage(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.delete_custom_stage(uuid, uuid) to authenticated, service_role;
grant execute on function public.save_board_settings(uuid, jsonb, jsonb) to authenticated, service_role;
