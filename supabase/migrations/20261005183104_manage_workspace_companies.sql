-- Allow workspace flow editors to safely edit company profiles and propagate changes
-- to all linked drafts and currently active public snapshots.

alter table public.workspace_companies
  drop constraint if exists workspace_companies_logo_path_check;
alter table public.workspace_companies
  add constraint workspace_companies_logo_path_check
  check (
    logo_path is null or logo_path ~ (
      '^' || workspace_id::text || '/' || id::text || '/logo(-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\.(png|jpg|webp)$'
    )
  );

-- Recreate storage policies to allow unique, replaceable logo objects without
-- granting update permissions over arbitrary storage objects.
drop policy if exists "workspace flow managers can upload company logos" on storage.objects;
create policy "workspace flow managers can upload company logos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'company-logos'
  and exists (
    select 1 from public.workspace_companies c
    where c.workspace_id::text = (storage.foldername(name))[1]
      and c.id::text = (storage.foldername(name))[2]
      and name ~ ('^' || c.workspace_id::text || '/' || c.id::text || '/logo(-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\.(png|jpg|webp)$')
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
      and name ~ ('^' || c.workspace_id::text || '/' || c.id::text || '/logo(-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\.(png|jpg|webp)$')
      and public.workspace_user_has_permission(c.workspace_id, 'flows')
  )
);

create or replace function public.update_workspace_company_profile(
  p_company_id uuid,
  p_name text,
  p_description text,
  p_logo_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_company public.workspace_companies%rowtype;
  v_profile jsonb;
begin
  if v_user_id is null then
    raise exception 'Sign in to edit this company.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120 then
    raise exception 'Enter a company name (up to 120 characters).' using errcode = '23514';
  end if;
  if char_length(btrim(coalesce(p_description, ''))) not between 1 and 3000 then
    raise exception 'Enter a company description (up to 3,000 characters).' using errcode = '23514';
  end if;

  select * into v_company
  from public.workspace_companies
  where id = p_company_id
  for update;
  if not found then
    raise exception 'This company no longer exists.' using errcode = 'P0002';
  end if;
  if not public.workspace_user_has_permission(v_company.workspace_id, 'flows') then
    raise exception 'You do not have permission to edit this company.' using errcode = '42501';
  end if;

  if p_logo_path is not null then
    if p_logo_path !~ ('^' || v_company.workspace_id::text || '/' || v_company.id::text || '/logo(-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\.(png|jpg|webp)$')
       or not exists (
         select 1 from storage.objects
         where bucket_id = 'company-logos' and name = p_logo_path
       ) then
      raise exception 'The selected company logo could not be verified.' using errcode = '23514';
    end if;
  end if;

  update public.workspace_companies
  set name = btrim(p_name), description = btrim(p_description), logo_path = p_logo_path
  where id = p_company_id
  returning * into v_company;

  v_profile := jsonb_build_object(
    'id', v_company.id,
    'name', v_company.name,
    'description', v_company.description,
    'logoPath', v_company.logo_path
  );

  update public.application_flows f
  set company_name = v_company.name,
      flow_data = jsonb_set(
        jsonb_set(coalesce(f.flow_data, '{}'::jsonb), '{companyName}', to_jsonb(v_company.name), true),
        '{companyProfile}', v_profile, true
      ),
      published_at = case when f.publication_status = 'published' and f.active_published_flow_id is not null then now() else f.published_at end
  where f.company_id = v_company.id
    and f.workspace_id = v_company.workspace_id;

  update public.published_flows pf
  set snapshot = jsonb_set(
    jsonb_set(pf.snapshot, '{companyName}', to_jsonb(v_company.name), true),
    '{companyProfile}', v_profile, true
  )
  from public.application_flows f
  where f.company_id = v_company.id
    and f.workspace_id = v_company.workspace_id
    and f.publication_status = 'published'
    and f.active_published_flow_id = pf.id
    and pf.flow_id = f.id
    and pf.workspace_id = f.workspace_id;

  return jsonb_build_object(
    'id', v_company.id,
    'workspace_id', v_company.workspace_id,
    'name', v_company.name,
    'description', v_company.description,
    'logo_path', v_company.logo_path,
    'created_at', v_company.created_at
  );
end;
$$;
revoke all on function public.update_workspace_company_profile(uuid, text, text, text) from public, anon;
grant execute on function public.update_workspace_company_profile(uuid, text, text, text) to authenticated;

create or replace function public.delete_workspace_company(p_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id
  from public.workspace_companies
  where id = p_company_id
  for update;
  if not found then
    raise exception 'This company no longer exists.' using errcode = 'P0002';
  end if;
  if not public.workspace_user_has_permission(v_workspace_id, 'flows') then
    raise exception 'You do not have permission to delete this company.' using errcode = '42501';
  end if;
  if exists (select 1 from public.application_flows where company_id = p_company_id) then
    raise exception 'Delete the company-linked flows before deleting this company.' using errcode = '23514';
  end if;

  delete from public.workspace_companies where id = p_company_id and workspace_id = v_workspace_id;
  return found;
end;
$$;
revoke all on function public.delete_workspace_company(uuid) from public, anon;
grant execute on function public.delete_workspace_company(uuid) to authenticated;
