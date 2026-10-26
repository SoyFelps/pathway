-- New standard Kanban column "AI Interview" (status key ai_interview), placed right before Interview.
--  * The applicant status check and the status-update policy accept the new key.
--  * New workspaces (no saved board setup) get it in the default order; create_custom_stage and save_board_settings know the new key.
--  * A custom column can no longer be named "AI Interview" (the name is reserved, like the other standard columns).
--  * Workspaces with a saved board setup get the column on automatically, in front of Interview (the app places an unknown standard stage
--    before the next one in the default order).
--  * Additive: no data changes. Old app code simply never uses the new key. The three functions below are the live definitions plus the new key.

alter table public.applicants drop constraint if exists applicants_status_check;
alter table public.applicants add constraint applicants_status_check check (
  status in ('failed', 'new', 'screening', 'team_fit', 'skill_fit', 'ai_interview', 'interview', 'promising', 'offer', 'withdrawn', 'hired')
  or status ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);

drop policy if exists "workspace applicant reviewers can update applicant status" on public.applicants;
create policy "workspace applicant reviewers can update applicant status"
on public.applicants for update to authenticated
using (public.workspace_user_has_permission(workspace_id, 'applicants'))
with check (
  (status in ('failed', 'new', 'screening', 'team_fit', 'skill_fit', 'ai_interview', 'interview', 'promising', 'offer', 'withdrawn', 'hired')
    or status ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  and public.workspace_user_has_permission(workspace_id, 'applicants')
);

create or replace function public.create_custom_stage(p_workspace_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
  v_default jsonb := '["screening","team_fit","skill_fit","ai_interview","interview","promising","offer","withdrawn"]'::jsonb;
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
  if lower(replace(v_name, '_', ' ')) = any (array['failed','new','screening','team fit','skill fit','ai interview','interview','promising','offer','withdrawn','hired']) then
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
  if lower(replace(v_name, '_', ' ')) = any (array['failed','new','screening','team fit','skill fit','ai interview','interview','promising','offer','withdrawn','hired']) then
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

create or replace function public.save_board_settings(p_workspace_id uuid, p_order jsonb, p_enabled jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_standard text[] := array['screening','team_fit','skill_fit','ai_interview','interview','promising','offer','withdrawn'];
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
