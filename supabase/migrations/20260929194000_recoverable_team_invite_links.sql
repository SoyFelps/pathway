-- Keep the bearer token encrypted at rest so authorized team managers can copy
-- the same pending invitation link again. Acceptance still uses only token_hash.
alter table public.workspace_invitations
  add column if not exists encrypted_token text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workspace_invitations'::regclass
      and conname = 'workspace_invitations_encrypted_token_format'
  ) then
    alter table public.workspace_invitations
      add constraint workspace_invitations_encrypted_token_format
      check (encrypted_token is null or encrypted_token ~ '^v1[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{107}$');
  end if;
end;
$$;

-- Keep the original RPC during rollout; this overload atomically stores both
-- the one-way lookup hash and the service-key-encrypted token.

create function public.create_team_invitation(
  p_workspace_id uuid,
  p_email text,
  p_token_hash text,
  p_encrypted_token text,
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
  update public.workspace_invitations set status = 'expired'
  where workspace_id = p_workspace_id and lower(invited_email) = normalized_email
    and status = 'pending' and expires_at <= now();
  if exists (select 1 from public.workspace_invitations i where lower(i.invited_email) = normalized_email and i.status = 'pending' and i.expires_at > now()) then
    raise exception 'An invitation for this email is already pending.' using errcode = '23505';
  end if;
  select (select count(*) from public.workspace_members m where m.workspace_id = p_workspace_id)
       + (select count(*) from public.workspace_invitations i where i.workspace_id = p_workspace_id and i.status = 'pending' and i.expires_at > now())
    into seat_count;
  if seat_count >= 3 then raise exception 'This Premium workspace already uses all 3 team member seats.' using errcode = '23514'; end if;

  return query
  insert into public.workspace_invitations as i (
    workspace_id, invited_email, token_hash, encrypted_token, can_flows, can_applicants, can_manage_team, invited_by
  ) values (
    p_workspace_id, normalized_email, p_token_hash, p_encrypted_token,
    coalesce(p_can_flows, true), coalesce(p_can_applicants, true), coalesce(p_can_manage_team, true), actor
  ) returning i.id, i.expires_at;
end;
$$;
revoke all on function public.create_team_invitation(uuid, text, text, text, boolean, boolean, boolean) from public, anon;
grant execute on function public.create_team_invitation(uuid, text, text, text, boolean, boolean, boolean) to authenticated;

comment on table public.workspace_invitations is 'Revocable seven-day workspace invitations; lookup uses SHA-256 token hashes and managers can recover links through authenticated service-key-encrypted token storage.';
