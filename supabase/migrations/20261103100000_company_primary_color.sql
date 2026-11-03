-- Companies get an optional primary colour (#rrggbb). It is sent to Witcher so the AI interview page and the invitation
-- e-mail use the company's colour. NULL means "use the default".
--
-- Inserts already work (table-level insert grant). Updates go through the profile function, so no column grant changes.
-- The previous 4-argument profile function is kept untouched on purpose: the site that is live today still calls it,
-- and it keeps working until the new site is published (it never changes the colour). Drop it in a later migration.

alter table public.workspace_companies
  add column if not exists primary_color text;

alter table public.workspace_companies
  drop constraint if exists workspace_companies_primary_color_check;
alter table public.workspace_companies
  add constraint workspace_companies_primary_color_check
  check (primary_color is null or primary_color ~ '^#[0-9a-f]{6}$');

create or replace function public.update_workspace_company_profile(
  p_company_id uuid,
  p_name text,
  p_description text,
  p_logo_path text,
  p_primary_color text
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
  v_color text := nullif(lower(btrim(coalesce(p_primary_color, ''))), '');
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
  if v_color is not null and v_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'Choose a valid primary colour.' using errcode = '23514';
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
  set name = btrim(p_name), description = btrim(p_description), logo_path = p_logo_path, primary_color = v_color
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
    'primary_color', v_company.primary_color,
    'created_at', v_company.created_at
  );
end;
$$;
revoke all on function public.update_workspace_company_profile(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_workspace_company_profile(uuid, text, text, text, text) to authenticated;
