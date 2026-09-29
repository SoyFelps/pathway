-- Pathway My Team: three member seats per Premium workspace, with one workspace per user.

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  member_email text not null check (char_length(member_email) between 3 and 254),
  can_flows boolean not null default true,
  can_applicants boolean not null default true,
  can_manage_team boolean not null default true,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index workspace_members_workspace_idx on public.workspace_members(workspace_id, created_at);

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invited_email text not null check (char_length(invited_email) between 3 and 254),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  can_flows boolean not null default true,
  can_applicants boolean not null default true,
  can_manage_team boolean not null default true,
  invited_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create index workspace_invitations_pending_email_idx on public.workspace_invitations (lower(invited_email), expires_at) where status = 'pending';
create index workspace_invitations_workspace_idx on public.workspace_invitations(workspace_id, created_at desc);

alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
revoke all on public.workspace_members, public.workspace_invitations from public, anon, authenticated;
grant select on public.workspace_members, public.workspace_invitations to authenticated;
grant all on public.workspace_members, public.workspace_invitations to service_role;

create or replace function public.workspace_user_has_permission(p_workspace_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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
          else false
        end
    )
  end;
$$;
revoke all on function public.workspace_user_has_permission(uuid, text) from public, anon;
grant execute on function public.workspace_user_has_permission(uuid, text) to authenticated;

create or replace function public.workspace_has_active_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and public.workspace_has_active_subscription(p_workspace_id)
  );
$$;
revoke all on function public.workspace_has_active_member(uuid) from public, anon;
grant execute on function public.workspace_has_active_member(uuid) to authenticated;

create or replace function public.workspace_user_is_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = auth.uid()
  );
$$;
revoke all on function public.workspace_user_is_member(uuid) from public, anon;
grant execute on function public.workspace_user_is_member(uuid) to authenticated;

create or replace function public.workspace_user_has_active_subscription(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and (
      exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_id = auth.uid())
      or public.workspace_user_is_member(p_workspace_id)
    )
    and public.workspace_has_active_subscription(p_workspace_id);
$$;
revoke all on function public.workspace_user_has_active_subscription(uuid) from public, anon;
grant execute on function public.workspace_user_has_active_subscription(uuid) to authenticated;

create or replace function public.current_user_can_create_workspace()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and not exists (select 1 from public.workspaces w where w.owner_id = auth.uid())
    and not exists (select 1 from public.workspace_members m where m.user_id = auth.uid());
$$;
revoke all on function public.current_user_can_create_workspace() from public, anon;
grant execute on function public.current_user_can_create_workspace() to authenticated;

create or replace function public.current_user_can_manage_team(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_id = auth.uid())
    or exists (
      select 1 from public.workspace_members m
      where m.workspace_id = p_workspace_id and m.user_id = auth.uid()
        and m.can_manage_team and public.workspace_has_active_subscription(p_workspace_id)
    )
  );
$$;
revoke all on function public.current_user_can_manage_team(uuid) from public, anon;
grant execute on function public.current_user_can_manage_team(uuid) to authenticated;

create policy "workspace members can read own membership"
on public.workspace_members for select to authenticated
using (user_id = (select auth.uid()) or public.current_user_can_manage_team(workspace_id));

create policy "workspace team managers can read invitations"
on public.workspace_invitations for select to authenticated
using (public.current_user_can_manage_team(workspace_id));

-- Workspace owners can read their subscription record; members deliberately cannot.
create policy "active workspace members can read workspace profile"
on public.workspaces for select to authenticated
using (public.workspace_user_is_member(id));

-- A former team member keeps their Auth account and can create a private workspace.
grant insert on public.workspaces to authenticated;
create policy "unassigned users can create their own workspace"
on public.workspaces for insert to authenticated
with check (owner_id = (select auth.uid()) and public.current_user_can_create_workspace());

-- Flow permission grants full flow access; applicant permission is separate.
drop policy if exists "owners can read flows in own workspace" on public.application_flows;
drop policy if exists "owners can create flows in own workspace" on public.application_flows;
drop policy if exists "owners can update flows in own workspace" on public.application_flows;
drop policy if exists "owners can delete flows in own workspace" on public.application_flows;
create policy "workspace flow editors can read flows"
on public.application_flows for select to authenticated
using (public.workspace_user_has_permission(workspace_id, 'flows'));
create policy "workspace flow editors can create flows"
on public.application_flows for insert to authenticated
with check (created_by = (select auth.uid()) and public.workspace_user_has_permission(workspace_id, 'flows'));
create policy "workspace flow editors can update flows"
on public.application_flows for update to authenticated
using (public.workspace_user_has_permission(workspace_id, 'flows'))
with check (public.workspace_user_has_permission(workspace_id, 'flows'));
create policy "workspace flow editors can delete flows"
on public.application_flows for delete to authenticated
using (public.workspace_user_has_permission(workspace_id, 'flows'));

create or replace function public.prevent_flow_tenant_and_creator_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id or new.created_by is distinct from old.created_by then
    raise exception 'Flow workspace and creator cannot be changed.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_flow_tenant_and_creator_change() from public, anon, authenticated;
drop trigger if exists application_flows_prevent_tenant_change on public.application_flows;
create trigger application_flows_prevent_tenant_change
before update on public.application_flows
for each row execute function public.prevent_flow_tenant_and_creator_change();

-- Snapshot creation/removal also requires Flow permission; the existing paid-publication trigger stays authoritative.
drop policy if exists "owners can read published snapshots in own workspace" on public.published_flows;
drop policy if exists "owners can publish snapshots in own workspace" on public.published_flows;
drop policy if exists "owners can remove published snapshots in own workspace" on public.published_flows;
create policy "workspace flow editors can read published snapshots"
on public.published_flows for select to authenticated
using (public.workspace_user_has_permission(workspace_id, 'flows'));
create policy "workspace flow editors can publish snapshots"
on public.published_flows for insert to authenticated
with check (
  created_by = (select auth.uid())
  and public.workspace_user_has_permission(workspace_id, 'flows')
  and exists (
    select 1 from public.application_flows f
    where f.id = published_flows.flow_id and f.workspace_id = published_flows.workspace_id
  )
);
create policy "workspace flow editors can remove published snapshots"
on public.published_flows for delete to authenticated
using (public.workspace_user_has_permission(workspace_id, 'flows'));

-- Applicant permission grants review and stage changes; the existing column grant limits edits to status.
drop policy if exists "workspace owners can read applicants" on public.applicants;
drop policy if exists "workspace owners can update applicant status" on public.applicants;
create policy "workspace applicant reviewers can read applicants"
on public.applicants for select to authenticated
using (public.workspace_user_has_permission(workspace_id, 'applicants'));
create policy "workspace applicant reviewers can update applicant status"
on public.applicants for update to authenticated
using (public.workspace_user_has_permission(workspace_id, 'applicants'))
with check (status in ('new', 'failed', 'promising', 'approved') and public.workspace_user_has_permission(workspace_id, 'applicants'));

-- Resume blobs follow the same separate Applicants capability.
drop policy if exists "workspace owners can view applicant resumes" on storage.objects;
create policy "workspace applicant reviewers can view applicant resumes"
on storage.objects for select to authenticated
using (
  bucket_id = 'applicant-resumes'
  and exists (
    select 1 from public.workspaces w
    where w.id::text = (storage.foldername(storage.objects.name))[1]
      and public.workspace_user_has_permission(w.id, 'applicants')
  )
);

-- One-time invitation creation reserves a member seat, serialized by locking the workspace row.
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
    workspace_id, invited_email, token_hash, can_flows, can_applicants, can_manage_team, invited_by
  ) values (
    p_workspace_id, normalized_email, p_token_hash, coalesce(p_can_flows, true), coalesce(p_can_applicants, true), coalesce(p_can_manage_team, true), actor
  ) returning i.id, i.expires_at;
end;
$$;
revoke all on function public.create_team_invitation(uuid, text, text, boolean, boolean, boolean) from public, anon;
grant execute on function public.create_team_invitation(uuid, text, text, boolean, boolean, boolean) to authenticated;

create or replace function public.accept_team_invitation(p_token_hash text)
returns table (workspace_id uuid, workspace_name text, can_flows boolean, can_applicants boolean, can_manage_team boolean)
language plpgsql
security definer
set search_path = ''
as $$
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

  insert into public.workspace_members (workspace_id, user_id, member_email, can_flows, can_applicants, can_manage_team, invited_by)
  values (invitation.workspace_id, actor, actor_email, invitation.can_flows, invitation.can_applicants, invitation.can_manage_team, invitation.invited_by);
  update public.workspace_invitations set status = 'accepted', accepted_user_id = actor, accepted_at = now() where id = invitation.id;
  return query select w.id, w.name, invitation.can_flows, invitation.can_applicants, invitation.can_manage_team
    from public.workspaces w where w.id = invitation.workspace_id;
end;
$$;
revoke all on function public.accept_team_invitation(text) from public, anon;
grant execute on function public.accept_team_invitation(text) to authenticated;

create or replace function public.update_team_member_permissions(
  p_workspace_id uuid, p_member_id uuid, p_can_flows boolean, p_can_applicants boolean, p_can_manage_team boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.current_user_can_manage_team(p_workspace_id) then
    raise exception 'You do not have permission to manage this team.' using errcode = '42501';
  end if;
  update public.workspace_members set
    can_flows = coalesce(p_can_flows, false),
    can_applicants = coalesce(p_can_applicants, false),
    can_manage_team = coalesce(p_can_manage_team, false)
  where workspace_id = p_workspace_id and user_id = p_member_id;
  if not found then raise exception 'Team member not found. The workspace owner cannot be removed.' using errcode = '22023'; end if;
  return true;
end;
$$;
revoke all on function public.update_team_member_permissions(uuid, uuid, boolean, boolean, boolean) from public, anon;
grant execute on function public.update_team_member_permissions(uuid, uuid, boolean, boolean, boolean) to authenticated;

create or replace function public.remove_team_member(p_workspace_id uuid, p_member_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.current_user_can_manage_team(p_workspace_id) then
    raise exception 'You do not have permission to manage this team.' using errcode = '42501';
  end if;
  if exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_id = p_member_id) then
    raise exception 'The workspace owner cannot be removed.' using errcode = '42501';
  end if;
  delete from public.workspace_invitations
  where workspace_id = p_workspace_id
    and (accepted_user_id = p_member_id or lower(invited_email) = (
      select lower(m.member_email) from public.workspace_members m
      where m.workspace_id = p_workspace_id and m.user_id = p_member_id
    ));
  delete from public.workspace_members where workspace_id = p_workspace_id and user_id = p_member_id;
  if not found then raise exception 'Team member not found.' using errcode = '22023'; end if;
  return true;
end;
$$;
revoke all on function public.remove_team_member(uuid, uuid) from public, anon;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated;

create or replace function public.revoke_team_invitation(p_workspace_id uuid, p_invitation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.current_user_can_manage_team(p_workspace_id) then
    raise exception 'You do not have permission to manage this team.' using errcode = '42501';
  end if;
  update public.workspace_invitations set status = 'revoked'
  where id = p_invitation_id and workspace_id = p_workspace_id and status = 'pending';
  if not found then raise exception 'Pending invitation not found.' using errcode = '22023'; end if;
  return true;
end;
$$;
revoke all on function public.revoke_team_invitation(uuid, uuid) from public, anon;
grant execute on function public.revoke_team_invitation(uuid, uuid) to authenticated;

create or replace function public.leave_workspace_team(p_workspace_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to leave this team.' using errcode = '42501'; end if;
  if exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_id = auth.uid()) then
    raise exception 'The workspace owner cannot leave their own workspace.' using errcode = '42501';
  end if;
  delete from public.workspace_invitations
  where workspace_id = p_workspace_id
    and (accepted_user_id = auth.uid() or lower(invited_email) = (
      select lower(m.member_email) from public.workspace_members m
      where m.workspace_id = p_workspace_id and m.user_id = auth.uid()
    ));
  delete from public.workspace_members where workspace_id = p_workspace_id and user_id = auth.uid();
  if not found then raise exception 'Team membership not found.' using errcode = '22023'; end if;
  return true;
end;
$$;
revoke all on function public.leave_workspace_team(uuid) from public, anon;
grant execute on function public.leave_workspace_team(uuid) to authenticated;

-- A valid pending invitation in user_metadata keeps new invitees from getting an owner workspace at signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_name text;
begin
  if new.raw_user_meta_data ->> 'pathway_team_invite_pending' = 'true' then
    return new;
  end if;
  workspace_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'workspace_name'), ''), 'My workspace');
  insert into public.workspaces (owner_id, name) values (new.id, workspace_name) on conflict (owner_id) do nothing;
  return new;
end;
$$;

comment on table public.workspace_members is 'Workspace member identities and capability permissions. Premium entitlement is required for member access.';
comment on table public.workspace_invitations is 'Revocable seven-day workspace invitations; only SHA-256 token hashes are stored.';
