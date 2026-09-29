-- `expires_at` is also an OUT parameter of this RETURNS TABLE function.
-- Qualify target-table columns to avoid PL/pgSQL variable/column ambiguity.
create or replace function public.create_team_invitation(
  p_workspace_id uuid,
  p_email text,
  p_token_hash text,
  p_can_flows boolean default true,
  p_can_applicants boolean default true,
  p_can_manage_team boolean default true
)
returns table (invitation_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
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
    workspace_id, invited_email, token_hash, can_flows, can_applicants, can_manage_team, invited_by
  ) values (
    p_workspace_id, normalized_email, p_token_hash, coalesce(p_can_flows, true), coalesce(p_can_applicants, true), coalesce(p_can_manage_team, true), actor
  ) returning i.id, i.expires_at;
end;
$$;
