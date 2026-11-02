-- Third impression level: "mixed" (owner decision, 2026-11-02). Witcher now sends positive, mixed or negative.
-- Old rows keep their value. Only the allowed values of the column change.
alter table public.ai_interviews drop constraint if exists ai_interviews_impression_check;
alter table public.ai_interviews
  add constraint ai_interviews_impression_check check (impression in ('positive', 'mixed', 'negative'));
