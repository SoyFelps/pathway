-- Plans, phase 1 (plano-planos.md): the plan of a workspace and the limits that depend on it.
--   * workspace_subscriptions.plan ('business' or 'agency'). Every subscription that exists today becomes 'agency' (the decision of the owner,
--     2026-11-09: all of them are test accounts); a subscription written without a plan (the checkout of today) is 'agency' too, until the
--     Stripe phase writes the plan from the price.
--   * workspace_plan(workspace): 'free' without an active subscription, otherwise the plan of the subscription.
--   * plan_company_limit: free 1, business 1, agency 10 (it was 3 for everyone).  plan_seat_limit: free 0, business 3, agency 6 (it was 3).
--   * The companies trigger and the two team functions read these limits. The triggers only act when something is CREATED: a workspace that
--     already holds more than its plan allows keeps everything.
--   * list_my_workspaces also returns the plan (last column), so the app shows the right limit to everyone in the workspace.
-- Adding the column does not fire the plan-change trigger of the AI interviews (it only listens to status and current_period_end).
-- To undo: recreate list_my_workspaces, enforce_workspace_companies_limit, accept_team_invitation and create_team_invitation from the text of
-- Backups\2026-11-09\supabase\schema\03_functions.sql, then drop the three helper functions and "alter table public.workspace_subscriptions drop column plan".

alter table public.workspace_subscriptions
  add column plan text not null default 'agency' check (plan in ('business', 'agency'));

create or replace function public.workspace_plan(p_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (select s.plan from public.workspace_subscriptions s
      where s.workspace_id = p_workspace_id and s.status = 'active' and s.current_period_end > now()),
    'free');
$function$;

create or replace function public.plan_company_limit(p_plan text)
returns integer
language sql
immutable
set search_path to ''
as $function$
  select case p_plan when 'agency' then 10 else 1 end;
$function$;

create or replace function public.plan_seat_limit(p_plan text)
returns integer
language sql
immutable
set search_path to ''
as $function$
  select case p_plan when 'agency' then 6 when 'business' then 3 else 0 end;
$function$;

revoke all on function public.workspace_plan(uuid) from public, anon, authenticated;
grant execute on function public.workspace_plan(uuid) to service_role;
revoke all on function public.plan_company_limit(text) from public, anon, authenticated;
grant execute on function public.plan_company_limit(text) to service_role;
revoke all on function public.plan_seat_limit(text) from public, anon, authenticated;
grant execute on function public.plan_seat_limit(text) to service_role;

-- Companies: the limit now depends on the plan.
create or replace function public.enforce_workspace_companies_limit()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_plan text;
begin
  perform 1 from public.workspaces where id = new.workspace_id for update;
  if not found then
    raise exception 'Workspace does not exist.' using errcode = '23503';
  end if;
  v_plan := public.workspace_plan(new.workspace_id);
  if (select count(*) from public.workspace_companies where workspace_id = new.workspace_id) >= public.plan_company_limit(v_plan) then
    if v_plan = 'agency' then
      raise exception 'The Agency plan includes up to 10 companies.' using errcode = '23514';
    end if;
    raise exception 'Your plan includes one company. Upgrade to Agency to add up to 10.' using errcode = '23514';
  end if;
  return new;
end;
$function$;

-- Team seats: the limit now depends on the plan.
CREATE OR REPLACE FUNCTION public.accept_team_invitation(p_token_hash text)
 RETURNS TABLE(workspace_id uuid, workspace_name text, can_flows boolean, can_applicants boolean, can_manage_team boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    raise exception 'This workspace no longer has an active plan. Ask its owner to restore it before accepting.' using errcode = '42501';
  end if;
  if exists (select 1 from public.workspaces w where w.id = invitation.workspace_id and w.owner_id = actor)
     or exists (select 1 from public.workspace_members m where m.workspace_id = invitation.workspace_id and m.user_id = actor) then
    raise exception 'You already belong to this workspace.' using errcode = '23505';
  end if;
  select count(*) into seat_count from public.workspace_members m where m.workspace_id = invitation.workspace_id;
  if seat_count >= public.plan_seat_limit(public.workspace_plan(invitation.workspace_id)) then raise exception 'This workspace no longer has an available member seat.' using errcode = '23514'; end if;

  insert into public.workspace_members (workspace_id, user_id, member_email, can_flows, can_applicants, can_manage_team, can_customize_stages, can_view_reports, can_diversity, invited_by)
  values (invitation.workspace_id, actor, actor_email, invitation.can_flows, invitation.can_applicants, invitation.can_manage_team, invitation.can_customize_stages, invitation.can_view_reports, invitation.can_diversity, invitation.invited_by);
  update public.workspace_invitations set status = 'accepted', accepted_user_id = actor, accepted_at = now() where id = invitation.id;
  update public.profiles set last_workspace_id = invitation.workspace_id where user_id = actor;
  return query select w.id, w.name, invitation.can_flows, invitation.can_applicants, invitation.can_manage_team
    from public.workspaces w where w.id = invitation.workspace_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_team_invitation(p_workspace_id uuid, p_email text, p_token_hash text, p_encrypted_token text, p_can_flows boolean DEFAULT true, p_can_applicants boolean DEFAULT true, p_can_manage_team boolean DEFAULT true, p_can_customize_stages boolean DEFAULT true, p_can_view_reports boolean DEFAULT true, p_can_diversity boolean DEFAULT false)
 RETURNS TABLE(invitation_id uuid, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    raise exception 'An active plan is required to add team members.' using errcode = '42501';
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
  if seat_count >= public.plan_seat_limit(public.workspace_plan(p_workspace_id)) then raise exception 'This workspace already uses all the team member seats of its plan.' using errcode = '23514'; end if;

  return query
  insert into public.workspace_invitations as i (
    workspace_id, invited_email, token_hash, encrypted_token, can_flows, can_applicants, can_manage_team, can_customize_stages, can_view_reports, can_diversity, invited_by
  ) values (
    p_workspace_id, normalized_email, p_token_hash, p_encrypted_token,
    coalesce(p_can_flows, true), coalesce(p_can_applicants, true), coalesce(p_can_manage_team, true), coalesce(p_can_customize_stages, true), coalesce(p_can_view_reports, true), coalesce(p_can_diversity, false), actor
  ) returning i.id, i.expires_at;
end;
$function$
;

-- The list of workspaces of the person now ends with the plan of each one.
drop function public.list_my_workspaces();
create function public.list_my_workspaces()
 returns table(workspace_id uuid, name text, created_at timestamp with time zone, is_owner boolean, is_last boolean, premium_active boolean, can_flows boolean, can_applicants boolean, can_manage_team boolean, can_customize_stages boolean, can_view_reports boolean, can_diversity boolean, plan text)
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  if auth.uid() is null then raise exception 'Sign in to see your workspaces.' using errcode = '42501'; end if;
  return query
    select w.id, w.name, w.created_at, true, coalesce(p.last_workspace_id = w.id, false), public.workspace_has_active_subscription(w.id),
           true, true, true, true, true, true, public.workspace_plan(w.id)
    from public.workspaces w left join public.profiles p on p.user_id = auth.uid()
    where w.owner_id = auth.uid()
    union all
    select w.id, w.name, w.created_at, false, coalesce(p.last_workspace_id = w.id, false), public.workspace_has_active_subscription(w.id),
           m.can_flows, m.can_applicants, m.can_manage_team, m.can_customize_stages, m.can_view_reports, m.can_diversity, public.workspace_plan(w.id)
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
    left join public.profiles p on p.user_id = auth.uid()
    where m.user_id = auth.uid()
    order by 3, 1;
end;
$function$;
revoke all on function public.list_my_workspaces() from public, anon, authenticated;
grant execute on function public.list_my_workspaces() to authenticated, service_role;
