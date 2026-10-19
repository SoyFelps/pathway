-- Auto-fail screening rules. The employer marks answers (options of a choice question, or a minimum number) that move a
-- candidate to Failed once the questionnaire is finished. The rules live inside the flow's nodes (autoFailOptions,
-- autoFailBelow) and are applied by the "applications" edge function, which reads the stored snapshot.
--
-- 1) Candidates must not be able to read the rules, so the public copy of a published job (get_published_flow) is
--    returned without them. Same checks and grants as before; only the two keys are removed from every node.
-- 2) applicants.auto_fail_reason says why a NEW candidate was moved to Failed by the system, for the hiring team.

alter table public.applicants
  add column auto_fail_reason text check (auto_fail_reason is null or char_length(auto_fail_reason) <= 600);

create or replace function public.get_published_flow(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
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
  end
  from public.published_flows pf
  join public.application_flows f
    on f.id = pf.flow_id
   and f.workspace_id = pf.workspace_id
  where pf.id = p_token
    and f.publication_status = 'published'
    and f.active_published_flow_id = pf.id
    and public.workspace_has_active_subscription(pf.workspace_id)
  limit 1;
$$;
