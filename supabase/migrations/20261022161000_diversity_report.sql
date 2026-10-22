-- Diversity report 1 (one job at a time) and the "Do you identify as transgender?" answer.
--  * applicant_diversity gets a transgender column (older rows simply have no answer).
--  * get_diversity_jobs / get_diversity_report are security-definer functions that check the 'diversity' permission
--    themselves and return ONLY rounded percentages (never a name, an e-mail address, a head count or the number of
--    respondents). The respondents' rows are never readable by the hiring team.
--  * Privacy rules, all applied here on the server:
--      - a job shows nothing until at least 10 candidates have answered;
--      - a candidate only counts once the application is at least 7 days old (so moving or adding one person can not
--        be spotted by comparing the report before and after);
--      - a group with fewer than 5 people is never shown on its own: small groups are merged into "Other groups"
--        until the merged group has at least 5 people;
--      - percentages are rounded to whole numbers, and the number of respondents is only given as a band (10-29, 30-99, 100-199, 200-399, 400-999, 1000+);
--      - the numbers are recalculated at most once a day (diversity_report_cache).
--  * One candidate per e-mail address and job (a repeat application does not count twice).

-- 1) The new answer ------------------------------------------------------------------------------------------------
alter table public.applicant_diversity add column if not exists transgender text;

-- 2) Daily cache (only the security-definer function below reads and writes it) ------------------------------------------
create table if not exists public.diversity_report_cache (
  flow_id uuid primary key references public.application_flows (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  computed_at timestamptz not null default now(),
  result jsonb not null
);
alter table public.diversity_report_cache enable row level security;
revoke all on table public.diversity_report_cache from public, anon, authenticated;
grant all on table public.diversity_report_cache to service_role;

-- 3) Jobs that can be reported on ----------------------------------------------------------------------------------------
-- A job is listed when its published form asks the diversity questions or it has already collected answers.
create or replace function public.get_diversity_jobs(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null or not public.workspace_user_has_permission(p_workspace_id, 'diversity') then
    raise exception 'You do not have permission to view the diversity reports.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'title', coalesce(nullif(f.job_title, ''), 'Untitled role'), 'company', coalesce(f.company_name, '')) order by f.updated_at desc)
    from public.application_flows f
    where f.workspace_id = p_workspace_id
      and (
        exists (select 1 from public.applicant_diversity d where d.flow_id = f.id)
        or coalesce((select (pf.snapshot -> 'candidateInfoFields' ->> 'diversity') = 'true'
                     from public.published_flows pf where pf.id = f.active_published_flow_id), false)
      )
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.get_diversity_jobs(uuid) from public, anon, authenticated;
grant execute on function public.get_diversity_jobs(uuid) to authenticated, service_role;

-- 4) The report for one job ----------------------------------------------------------------------------------------------
create or replace function public.get_diversity_report(p_workspace_id uuid, p_flow_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  c_min_respondents constant integer := 10;
  c_min_group constant integer := 5;
  c_delay constant interval := interval '7 days';
  c_refresh constant interval := interval '1 day';
  v_cached record;
  v_candidates integer;
  v_respondents integer;
  v_rows jsonb;
  v_keys constant text[] := array['genderIdentity', 'transgender', 'sexualOrientation', 'raceEthnicity', 'disability', 'disabilityType'];
  v_key text;
  v_questions jsonb := '[]'::jsonb;
  v_total integer;
  v_pool integer;
  v_items jsonb;
  v_item record;
  v_merged boolean;
  v_result jsonb;
begin
  if auth.uid() is null or not public.workspace_user_has_permission(p_workspace_id, 'diversity') then
    raise exception 'You do not have permission to view the diversity reports.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.application_flows f where f.id = p_flow_id and f.workspace_id = p_workspace_id) then
    raise exception 'This job could not be found.' using errcode = '22023';
  end if;

  select c.computed_at, c.result into v_cached from public.diversity_report_cache c where c.flow_id = p_flow_id;
  if found and v_cached.computed_at > now() - c_refresh then
    return v_cached.result;
  end if;

  with apps as (
    select lower(btrim(a.candidate_email)) as email, a.id, a.submitted_at
    from public.applicants a
    where a.workspace_id = p_workspace_id and a.flow_id = p_flow_id
  ),
  candidates as (
    select email from apps group by email having min(submitted_at) <= now() - c_delay
  ),
  -- one set of answers per candidate: the earliest application that has one, counted only once it is 7 days old
  resp as (
    select distinct on (ap.email) ap.email, d.gender_identity, d.transgender, d.sexual_orientation, d.race_ethnicity, d.disability, d.disability_type
    from apps ap
    join public.applicant_diversity d on d.applicant_id = ap.id
    where ap.submitted_at <= now() - c_delay
    order by ap.email, ap.submitted_at
  ),
  counts as (
    select 'genderIdentity' as k, gender_identity as a, count(*) as n from resp where gender_identity is not null group by 2
    union all select 'transgender', transgender, count(*) from resp where transgender is not null group by 2
    union all select 'sexualOrientation', sexual_orientation, count(*) from resp where sexual_orientation is not null group by 2
    union all select 'raceEthnicity', race_ethnicity, count(*) from resp where race_ethnicity is not null group by 2
    union all select 'disability', disability, count(*) from resp where disability is not null group by 2
    union all select 'disabilityType', disability_type, count(*) from resp where disability = 'Yes' and disability_type is not null and disability_type <> '' group by 2
  )
  select (select count(*) from candidates), (select count(*) from resp),
         coalesce((select jsonb_agg(jsonb_build_object('k', k, 'a', a, 'n', n)) from counts), '[]'::jsonb)
    into v_candidates, v_respondents, v_rows;

  if v_respondents < c_min_respondents then
    v_result := jsonb_build_object('enough', false, 'generatedAt', now(), 'questions', '[]'::jsonb);
  else
    foreach v_key in array v_keys loop
      select coalesce(sum((r ->> 'n')::integer), 0) into v_total from jsonb_array_elements(v_rows) r where r ->> 'k' = v_key;
      if v_total < c_min_respondents then
        v_questions := v_questions || jsonb_build_array(jsonb_build_object('key', v_key, 'enough', false, 'items', '[]'::jsonb, 'other', null));
        continue;
      end if;
      v_pool := 0;
      v_merged := false;
      v_items := '[]'::jsonb;
      -- smallest groups first: groups under 5 people are merged; if the merged group is still under 5, the next smallest group joins it
      for v_item in
        select r ->> 'a' as answer, (r ->> 'n')::integer as n
        from jsonb_array_elements(v_rows) r where r ->> 'k' = v_key
        order by (r ->> 'n')::integer, r ->> 'a'
      loop
        if v_item.n < c_min_group or (v_merged and v_pool < c_min_group) then
          v_pool := v_pool + v_item.n;
          v_merged := true;
        else
          v_items := v_items || jsonb_build_array(jsonb_build_object('answer', v_item.answer, 'pct', round(100.0 * v_item.n / v_total)::integer));
        end if;
      end loop;
      v_questions := v_questions || jsonb_build_array(jsonb_build_object(
        'key', v_key, 'enough', true, 'items', v_items,
        'other', case when v_merged then jsonb_build_object('pct', round(100.0 * v_pool / v_total)::integer) else null end
      ));
    end loop;
    v_result := jsonb_build_object(
      'enough', true,
      -- only a coarse band of the number of respondents (never the exact number): it gives context without letting anyone
      -- work out a person's answer by comparing the report before and after one more candidate answers
      'size', case when v_respondents >= 1000 then '1000+' when v_respondents >= 400 then '400-999' when v_respondents >= 200 then '200-399' when v_respondents >= 100 then '100-199' when v_respondents >= 30 then '30-99' else '10-29' end,
      'coverage', case when v_candidates > 0 then least(100, round(100.0 * v_respondents / v_candidates)::integer) else null end,
      'generatedAt', now(),
      'questions', v_questions
    );
  end if;

  insert into public.diversity_report_cache (flow_id, workspace_id, computed_at, result)
  values (p_flow_id, p_workspace_id, now(), v_result)
  on conflict (flow_id) do update set workspace_id = excluded.workspace_id, computed_at = excluded.computed_at, result = excluded.result;
  return v_result;
end;
$function$;

revoke all on function public.get_diversity_report(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_diversity_report(uuid, uuid) to authenticated, service_role;
