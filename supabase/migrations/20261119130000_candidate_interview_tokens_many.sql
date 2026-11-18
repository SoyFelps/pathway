-- Interview scheduling, part 1b: more than one link per interview.
-- The secret is stored only as a hash, so the e-mail function cannot rebuild an old link. Every e-mail (invitation, update, reminder,
-- re-send) therefore mints its own secret, and the earlier ones keep working until they expire (7 days after the interview), so an old
-- e-mail never leads to a dead page. Before: one row per interview (primary key on interview_id). Now: many rows, one per link.
-- The table is still empty when this runs (nothing writes to it before the edge function exists), so nothing is lost.
alter table public.candidate_interview_tokens drop constraint candidate_interview_tokens_pkey;
alter table public.candidate_interview_tokens add column id uuid not null default gen_random_uuid();
alter table public.candidate_interview_tokens add constraint candidate_interview_tokens_pkey primary key (id);
create index candidate_interview_tokens_interview_idx on public.candidate_interview_tokens (interview_id);
comment on table public.candidate_interview_tokens is 'Hashed secrets of the candidate answer page, one per link sent. Service role only.';
