-- The public job page is shown in the job's language (plan: plano-idiomas.md, phase 2).
-- get_published_flow now also returns "jobLanguage": the job's current language ('en', 'pt', 'es' or null), read live from
-- application_flows.interview_language (the same field that decides the AI interview language). Choosing another language in the
-- editor changes the page at once, without republishing. Everything else is exactly as in 20261020180000_unpublish_damaged_jobs.sql.
-- Rollback: run the get_published_flow definition from that migration again.

create or replace function public.get_published_flow(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select (case
    when jsonb_typeof(pf.snapshot -> 'nodes') = 'array' then
      jsonb_set(
        pf.snapshot,
        '{nodes}',
        coalesce(
          (select jsonb_agg(
             case when jsonb_typeof(n.node) = 'object' then (n.node - 'autoFailOptions') - 'autoFailBelow' else n.node end
             order by n.ord)
           from jsonb_array_elements(pf.snapshot -> 'nodes') with ordinality as n(node, ord)),
          '[]'::jsonb
        )
      )
    else pf.snapshot
  end) || jsonb_build_object('jobLanguage', f.interview_language)
  from public.published_flows pf
  join public.application_flows f
    on f.id = pf.flow_id
   and f.workspace_id = pf.workspace_id
  where pf.id = p_token
    and f.publication_status = 'published'
    and f.active_published_flow_id = pf.id
    and public.flow_data_is_valid(f.flow_data)
    and public.workspace_has_active_subscription(pf.workspace_id)
  limit 1;
$function$;
