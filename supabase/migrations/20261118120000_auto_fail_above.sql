-- Auto-fail "if above" (2026-11-18): a number question can fail candidates who answer MORE than a maximum, besides the existing minimum
-- (autoFailBelow). The rule lives in the node as autoFailAbove and is applied by the "applications" edge function.
--
-- Candidates must not be able to read the rules, so the public copy of a published job (get_published_flow) is returned without
-- them. This is the SAME function as in 20261105150000_published_flow_language.sql (same checks, same jobLanguage, same grants:
-- create or replace keeps them); the only change is that the node key autoFailAbove is removed too.
--
-- ORDER OF A RELEASE: apply this migration BEFORE publishing the site that can save autoFailAbove, otherwise the maximum would be
-- visible to candidates until it is applied. (Applying it first is harmless: it removes a key nobody has yet.)
-- Rollback: run the get_published_flow definition of 20261105150000_published_flow_language.sql again.

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
             case when jsonb_typeof(n.node) = 'object' then ((n.node - 'autoFailOptions') - 'autoFailBelow') - 'autoFailAbove' else n.node end
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
