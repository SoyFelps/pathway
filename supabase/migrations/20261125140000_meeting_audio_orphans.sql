-- Leftover meeting audio (owner request, 2026-11-25). A piece of audio waits in the private bucket `meeting-audio` only until it is
-- transcribed, then the `meetings` function deletes it. If the interview is deleted in the meantime (the candidate, the job, the workspace or
-- the account is deleted while the meeting is going on), its pieces are erased from the database (on delete cascade) but their files would
-- stay in the bucket with nothing left to delete them. Now the minute job also finds files that no piece points to any more and the
-- `meetings` function deletes them through the Storage API.
--  * meeting_audio_orphans(p_limit): names of audio files older than 10 minutes that no row of meeting_audio_segments points to
--    (10 minutes so a file being uploaded right now, whose row is written a moment later, is never taken). Service role only.
--  * meeting_transcription_tick(): same as before, and also wakes the function when there is such a file.

create or replace function public.meeting_audio_orphans(p_limit integer default 100)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'meeting-audio'
     and o.created_at < now() - interval '10 minutes'
     and not exists (select 1 from public.meeting_audio_segments s where s.storage_path = o.name)
   order by o.created_at
   limit greatest(1, least(coalesce(p_limit, 100), 1000));
$$;
revoke all on function public.meeting_audio_orphans(integer) from public, anon, authenticated;
grant execute on function public.meeting_audio_orphans(integer) to service_role;

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
     and not exists (select 1 from public.meeting_audio_orphans(1))
  then return; end if;
  perform net.http_post(url := v_url, headers := '{"Content-Type": "application/json"}'::jsonb, body := '{"action": "tick"}'::jsonb);
end;
$$;
revoke all on function public.meeting_transcription_tick() from public, anon, authenticated;
grant execute on function public.meeting_transcription_tick() to service_role;
