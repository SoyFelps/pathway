create table if not exists public.workspace_companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null check (char_length(btrim(description)) between 1 and 3000),
  logo_path text check (logo_path is null or logo_path ~ ('^' || workspace_id::text || '/' || id::text || '/logo\.(png|jpg|webp)$')),
  created_at timestamptz not null default now()
);

create index if not exists workspace_companies_workspace_created_idx
  on public.workspace_companies (workspace_id, created_at asc);

alter table public.application_flows
  add column if not exists company_id uuid references public.workspace_companies(id) on delete set null;

create or replace function public.enforce_workspace_companies_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.workspaces where id = new.workspace_id for update;
  if not found then
    raise exception 'Workspace does not exist.' using errcode = '23503';
  end if;
  if (select count(*) from public.workspace_companies where workspace_id = new.workspace_id) >= 3 then
    raise exception 'A workspace can have at most three companies.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_workspace_companies_limit() from public, anon, authenticated;

drop trigger if exists workspace_companies_enforce_limit on public.workspace_companies;
create trigger workspace_companies_enforce_limit
before insert on public.workspace_companies
for each row execute function public.enforce_workspace_companies_limit();

create or replace function public.validate_flow_company_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.company_id is not null and not exists (
    select 1 from public.workspace_companies c
    where c.id = new.company_id and c.workspace_id = new.workspace_id
  ) then
    raise exception 'The selected company does not belong to this workspace.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_flow_company_workspace() from public, anon, authenticated;

drop trigger if exists application_flows_validate_company_workspace on public.application_flows;
create trigger application_flows_validate_company_workspace
before insert or update of company_id, workspace_id on public.application_flows
for each row execute function public.validate_flow_company_workspace();

alter table public.workspace_companies enable row level security;
revoke all on public.workspace_companies from anon, authenticated;
grant select, insert, delete on public.workspace_companies to authenticated;
grant update (logo_path) on public.workspace_companies to authenticated;

drop policy if exists "workspace flow managers can read companies" on public.workspace_companies;
create policy "workspace flow managers can read companies"
on public.workspace_companies for select to authenticated
using (public.workspace_user_has_permission(workspace_id, 'flows'));

drop policy if exists "workspace flow managers can create companies" on public.workspace_companies;
create policy "workspace flow managers can create companies"
on public.workspace_companies for insert to authenticated
with check (created_by = (select auth.uid()) and public.workspace_user_has_permission(workspace_id, 'flows'));

drop policy if exists "workspace flow managers can attach company logos" on public.workspace_companies;
create policy "workspace flow managers can attach company logos"
on public.workspace_companies for update to authenticated
using (public.workspace_user_has_permission(workspace_id, 'flows'))
with check (public.workspace_user_has_permission(workspace_id, 'flows'));

drop policy if exists "workspace flow managers can delete companies" on public.workspace_companies;
create policy "workspace flow managers can delete companies"
on public.workspace_companies for delete to authenticated
using (public.workspace_user_has_permission(workspace_id, 'flows'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "workspace flow managers can upload company logos" on storage.objects;
create policy "workspace flow managers can upload company logos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'company-logos'
  and exists (
    select 1 from public.workspace_companies c
    where c.workspace_id::text = (storage.foldername(name))[1]
      and c.id::text = (storage.foldername(name))[2]
      and name ~ ('^' || c.workspace_id::text || '/' || c.id::text || '/logo\.(png|jpg|webp)$')
      and public.workspace_user_has_permission(c.workspace_id, 'flows')
  )
);

drop policy if exists "workspace flow managers can delete company logos" on storage.objects;
create policy "workspace flow managers can delete company logos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'company-logos'
  and exists (
    select 1 from public.workspace_companies c
    where c.workspace_id::text = (storage.foldername(name))[1]
      and c.id::text = (storage.foldername(name))[2]
      and name ~ ('^' || c.workspace_id::text || '/' || c.id::text || '/logo\.(png|jpg|webp)$')
      and public.workspace_user_has_permission(c.workspace_id, 'flows')
  )
);
