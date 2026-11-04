-- The language of the AI interview of a job (decided by the owner on 2026-11-04). It is the language of the job description:
-- the job editor detects it while the employer types and shows it, and the employer can choose another one. Pathway sends it to Witcher
-- when the interview is created; Witcher then talks in that language, expects the answers in it, writes its pages and the e-mail in it
-- and judges the answers in it (an answer in another language gives a negative impression).
--
--  * application_flows.interview_language: 'en', 'pt' or 'es'; null means "not chosen yet". A column of its own, like interview_questions,
--    NEVER inside flow_data (flow_data is copied into the public snapshot). Changing it does not count as a change of the job.
--  * application_flows.interview_language_manual: true once a person chose the language, so that editing the description later never
--    changes a choice made on purpose. false means the language was detected from the description.
--  * ai_interviews.blocked_reason gets a new value, 'no_language': an interview whose job has no language yet waits (like one without
--    questions) and goes out by itself once a person chooses the language. Nothing is sent in a language that nobody decided.
--
-- Additive: no existing row changes. The privileges of application_flows are table-wide for the signed-in role, as before, so the new columns
-- need no new grant. After applying this, existing jobs get their language with tools\backfill-interview-language.js (detected from
-- the description and checked by a person), so interviews that work today keep working.
--
-- To undo (only while no interview waits for a language):
--   alter table public.ai_interviews drop constraint ai_interviews_blocked_reason_check;
--   alter table public.ai_interviews add constraint ai_interviews_blocked_reason_check check (blocked_reason in ('no_questions', 'no_plan', 'no_company_name'));
--   alter table public.application_flows drop column interview_language_manual, drop column interview_language;
--   (and put set_flow_updated_at back to the text of 20261029100000_ai_interviews.sql)

alter table public.application_flows add column if not exists interview_language text;
alter table public.application_flows add column if not exists interview_language_manual boolean not null default false;
alter table public.application_flows drop constraint if exists application_flows_interview_language_check;
alter table public.application_flows add constraint application_flows_interview_language_check
  check (interview_language is null or interview_language in ('en', 'pt', 'es'));

alter table public.ai_interviews drop constraint if exists ai_interviews_blocked_reason_check;
alter table public.ai_interviews add constraint ai_interviews_blocked_reason_check
  check (blocked_reason in ('no_questions', 'no_plan', 'no_company_name', 'no_language'));

-- Same as the live definition, plus: a change of the interview language alone leaves updated_at alone (like interview_questions).
create or replace function public.set_flow_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if (to_jsonb(new) - 'responsible_user_ids' - 'interview_questions' - 'interview_language' - 'interview_language_manual' - 'updated_at' - 'flow_data') = (to_jsonb(old) - 'responsible_user_ids' - 'interview_questions' - 'interview_language' - 'interview_language_manual' - 'updated_at' - 'flow_data')
     and (new.flow_data - 'nodes' - 'updatedAt') = (old.flow_data - 'nodes' - 'updatedAt')
     and (select coalesce(jsonb_agg(case when jsonb_typeof(n) = 'object' then n - 'x' - 'y' else n end order by ord), '[]'::jsonb)
          from jsonb_array_elements(case when jsonb_typeof(new.flow_data -> 'nodes') = 'array' then new.flow_data -> 'nodes' else '[]'::jsonb end) with ordinality as t(n, ord))
       = (select coalesce(jsonb_agg(case when jsonb_typeof(n) = 'object' then n - 'x' - 'y' else n end order by ord), '[]'::jsonb)
          from jsonb_array_elements(case when jsonb_typeof(old.flow_data -> 'nodes') = 'array' then old.flow_data -> 'nodes' else '[]'::jsonb end) with ordinality as t(n, ord))
  then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$function$;
