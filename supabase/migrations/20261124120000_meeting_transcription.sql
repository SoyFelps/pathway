-- Nellio meeting rooms, Phase 3 of plano-reunioes.md (transcription and minutes), owner decisions 2026-11-21 / 2026-11-24.
--  * candidate_interviews.transcription_enabled / minutes_enabled: the two switches of the schedule window (on by default; minutes need the transcription).
--  * candidate_interviews.transcription_consent_at / transcription_refused_at: the candidate accepts or refuses on the entry screen of the room.
--    Refusing makes the interview "declined" (Denied the interview) and the history says why (line 'transcription_refused').
--  * meeting_audio_segments: each browser records ONLY its own microphone in pieces of about a minute and sends them to the `meetings` function,
--    so we know who spoke. The audio file lives in the private bucket `meeting-audio` only until it is transcribed, then it is deleted.
--    Service role only (no grant to the browser).
--  * meeting_transcripts: one per interview: the merged transcript (who said what, when), the minutes, and the Gemini tokens spent on each
--    (to know the cost of each feature). The team reads it (Candidates permission, like the interviews); written only by the `meetings` function.
--  * meeting_transcription_tick(): every minute, when something is due, wakes the `meetings` function (retries and the final transcript + minutes).
-- Everything is erased with the interview (on delete cascade), so it follows the candidate data rules. Additive: no existing row changes.

alter table public.candidate_interviews
  add column transcription_enabled boolean not null default true,
  add column minutes_enabled boolean not null default true,
  add column transcription_consent_at timestamptz,
  add column transcription_refused_at timestamptz;
grant select (transcription_enabled, minutes_enabled, transcription_consent_at, transcription_refused_at) on public.candidate_interviews to authenticated;

alter table public.candidate_interview_events drop constraint candidate_interview_events_kind_check;
alter table public.candidate_interview_events add constraint candidate_interview_events_kind_check
  check (kind in ('scheduled', 'updated', 'cancelled', 'resent', 'confirmed', 'declined', 'reschedule_requested', 'reminder_24h', 'reminder_2h', 'reminder_10m', 'finished', 'responsibles_changed', 'finalized', 'result_corrected', 'link_missing', 'room_opened', 'transcription_accepted', 'transcription_refused', 'transcription_ended'));

create table public.meeting_audio_segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  interview_id uuid not null references public.candidate_interviews (id) on delete cascade,
  speaker_key text not null check (char_length(speaker_key) between 1 and 64),
  speaker_name text not null check (char_length(speaker_name) between 1 and 60),
  speaker_role text not null check (speaker_role in ('team', 'candidate')),
  speaker_user_id uuid references auth.users (id) on delete set null,
  started_at timestamptz not null,
  duration_ms integer not null check (duration_ms between 0 and 600000),
  mime_type text not null check (char_length(mime_type) <= 80),
  bytes integer not null check (bytes between 1 and 5000000),
  storage_path text,
  state text not null default 'pending' check (state in ('pending', 'done', 'failed')),
  attempts integer not null default 0,
  utterances jsonb,
  model text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
create index meeting_audio_segments_interview on public.meeting_audio_segments (interview_id, started_at);
create index meeting_audio_segments_pending on public.meeting_audio_segments (created_at) where state = 'pending';
alter table public.meeting_audio_segments enable row level security;
revoke all on public.meeting_audio_segments from public, anon, authenticated;
grant all on public.meeting_audio_segments to service_role;
comment on table public.meeting_audio_segments is 'One recorded piece (about a minute) of ONE person''s microphone in a Nellio meeting room. The audio file is deleted once transcribed. Only the meetings edge function touches it.';

create table public.meeting_transcripts (
  interview_id uuid primary key references public.candidate_interviews (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  state text not null default 'recording' check (state in ('recording', 'processing', 'done', 'failed')),
  ended_at timestamptz,
  last_audio_at timestamptz,
  transcript jsonb,
  minutes text,
  audio_seconds integer not null default 0,
  transcript_input_tokens integer not null default 0,
  transcript_output_tokens integer not null default 0,
  minutes_input_tokens integer,
  minutes_output_tokens integer,
  error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.meeting_transcripts enable row level security;
revoke all on public.meeting_transcripts from public, anon, authenticated;
grant select (interview_id, workspace_id, state, ended_at, transcript, minutes, processed_at, created_at, updated_at) on public.meeting_transcripts to authenticated;
grant all on public.meeting_transcripts to service_role;
create policy "applicant reviewers can read meeting transcripts" on public.meeting_transcripts
  for select to authenticated using (public.workspace_user_has_permission(workspace_id, 'applicants'));
comment on table public.meeting_transcripts is 'Transcript and minutes of the Nellio meeting room of an interview (team only). Written only by the meetings edge function; erased with the interview.';

insert into storage.buckets (id, name, public, file_size_limit)
values ('meeting-audio', 'meeting-audio', false, 5000000)
on conflict (id) do nothing;

create or replace function public.meeting_transcription_tick()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
begin
  select value into v_url from public.candidate_interview_settings where key = 'meetings_worker_url';
  if v_url is null or v_url = '' then return; end if;
  if not exists (select 1 from public.meeting_audio_segments where state = 'pending' and created_at < now() - interval '2 minutes' and attempts < 3)
     and not exists (select 1 from public.meeting_transcripts where state = 'recording' and (ended_at is not null or last_audio_at < now() - interval '6 minutes'))
  then return; end if;
  perform net.http_post(url := v_url, headers := '{"Content-Type": "application/json"}'::jsonb, body := '{"action": "tick"}'::jsonb);
end;
$$;
revoke all on function public.meeting_transcription_tick() from public, anon, authenticated;
grant execute on function public.meeting_transcription_tick() to service_role;
select cron.schedule('meeting-transcription-tick', '* * * * *', $$select public.meeting_transcription_tick()$$);
