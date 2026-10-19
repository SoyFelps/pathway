-- Every account has a first and a last name, so teammates can be shown by name instead of by long e-mail addresses.
-- New accounts get the names typed on the sign-up form (sent as user metadata). Accounts that already existed, or that
-- come without names, get the placeholder "no name"; people can change it in Settings.

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 60),
  last_name text not null check (char_length(last_name) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Names are stored trimmed, with repeated spaces collapsed.
create or replace function public.clean_profile_names()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.first_name := btrim(regexp_replace(coalesce(new.first_name, ''), '\s+', ' ', 'g'));
  new.last_name := btrim(regexp_replace(coalesce(new.last_name, ''), '\s+', ' ', 'g'));
  return new;
end;
$$;

create trigger profiles_clean_names before insert or update of first_name, last_name on public.profiles
  for each row execute function public.clean_profile_names();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Each person reads and edits only their own row directly. Teammates' names are read through the functions below.
alter table public.profiles enable row level security;
create policy "users read their own profile" on public.profiles as permissive for select to authenticated
  using (user_id = auth.uid());
create policy "users update their own names" on public.profiles as permissive for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (first_name, last_name) on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- Accounts that already exist.
insert into public.profiles (user_id, first_name, last_name)
select u.id, 'no', 'name' from auth.users u
on conflict (user_id) do nothing;

-- New accounts: create the profile first (also for people who join through an invitation), then do what this
-- function always did (an owner gets a workspace; an invited person does not).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
  insert into public.workspaces (owner_id, name) values (new.id, workspace_name) on conflict (owner_id) do nothing;
  return new;
end;
$$;

-- Functions that already returned e-mail addresses now also return the names (extra columns are ignored by older code).
drop function public.list_workspace_people(uuid);
create function public.list_workspace_people(p_workspace_id uuid)
returns table (user_id uuid, email text, is_owner boolean, first_name text, last_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not (
       exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_id = auth.uid())
       or exists (select 1 from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = auth.uid())
     ) then
    raise exception 'You do not have access to this workspace.' using errcode = '42501';
  end if;
  return query
    select w.owner_id, u.email::text, true, coalesce(p.first_name, 'no'), coalesce(p.last_name, 'name')
    from public.workspaces w
    join auth.users u on u.id = w.owner_id
    left join public.profiles p on p.user_id = w.owner_id
    where w.id = p_workspace_id
    union all
    select m.user_id, m.member_email, false, coalesce(p.first_name, 'no'), coalesce(p.last_name, 'name')
    from public.workspace_members m
    left join public.profiles p on p.user_id = m.user_id
    where m.workspace_id = p_workspace_id
    order by 3 desc, 2;
end;
$$;

drop function public.list_team_overview(uuid);
create function public.list_team_overview(p_workspace_id uuid)
returns table (user_id uuid, email text, is_owner boolean, can_flows boolean, can_applicants boolean, can_manage_team boolean, member_since timestamptz, first_name text, last_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not (
       exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_id = auth.uid())
       or exists (select 1 from public.workspace_members m where m.workspace_id = p_workspace_id and m.user_id = auth.uid())
     ) then
    raise exception 'You do not have access to this workspace.' using errcode = '42501';
  end if;
  return query
    select w.owner_id, u.email::text, true, true, true, true, w.created_at, coalesce(p.first_name, 'no'), coalesce(p.last_name, 'name')
    from public.workspaces w
    join auth.users u on u.id = w.owner_id
    left join public.profiles p on p.user_id = w.owner_id
    where w.id = p_workspace_id
    union all
    select m.user_id, m.member_email, false, m.can_flows, m.can_applicants, m.can_manage_team, m.created_at, coalesce(p.first_name, 'no'), coalesce(p.last_name, 'name')
    from public.workspace_members m
    left join public.profiles p on p.user_id = m.user_id
    where m.workspace_id = p_workspace_id
    order by 3 desc, 7;
end;
$$;

create or replace function public.get_flow_responsibles(p_flow_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_ids uuid[];
  v_people jsonb;
begin
  select f.workspace_id, f.responsible_user_ids into v_workspace, v_ids
  from public.application_flows f where f.id = p_flow_id;
  if auth.uid() is null or v_workspace is null or not public.workspace_user_has_permission(v_workspace, 'applicants') then
    raise exception 'You do not have access to applicants in this workspace.' using errcode = '42501';
  end if;
  if coalesce(cardinality(v_ids), 0) = 0 then
    return jsonb_build_object('everyone', true, 'people', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('email', p.email, 'isOwner', p.is_owner, 'firstName', p.first_name, 'lastName', p.last_name) order by p.is_owner desc, p.email), '[]'::jsonb)
  into v_people
  from (
    select u.email::text as email, true as is_owner, coalesce(pr.first_name, 'no') as first_name, coalesce(pr.last_name, 'name') as last_name
    from public.workspaces w
    join auth.users u on u.id = w.owner_id
    left join public.profiles pr on pr.user_id = w.owner_id
    where w.id = v_workspace and w.owner_id = any (v_ids)
    union all
    select m.member_email, false, coalesce(pr.first_name, 'no'), coalesce(pr.last_name, 'name')
    from public.workspace_members m
    left join public.profiles pr on pr.user_id = m.user_id
    where m.workspace_id = v_workspace and m.user_id = any (v_ids)
  ) p;
  return jsonb_build_object('everyone', false, 'people', v_people);
end;
$$;

revoke all on function public.clean_profile_names() from public, anon, authenticated;
revoke all on function public.list_workspace_people(uuid) from public, anon, authenticated;
revoke all on function public.list_team_overview(uuid) from public, anon, authenticated;
grant execute on function public.clean_profile_names() to service_role;
grant execute on function public.list_workspace_people(uuid) to authenticated, service_role;
grant execute on function public.list_team_overview(uuid) to authenticated, service_role;
