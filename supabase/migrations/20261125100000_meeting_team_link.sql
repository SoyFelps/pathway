-- Nellio meeting rooms: two links per room (owner decision, 2026-11-25). The CANDIDATE link (the one in the candidate's e-mails, as before)
-- and a separate HIRING TEAM link (internal e-mails and the app's "Join meeting" button). Both open the same room; the role comes from the
-- link that was used, never from being signed in. The two secrets are random and unrelated, so one cannot be turned into the other.
--  * meeting_rooms.team_secret_hash: SHA-256 of the team secret (the secret itself is never stored, like the candidate one).
--  * meeting_rooms.team_link: the team link, kept so the app and the internal e-mails can show it again (service role only).
--  * candidate_interviews.team_meeting_link: the team link of the room whose candidate link is saved in meeting_link (null otherwise),
--    written by the edge functions; the browser reads it (column grant) for "Join meeting".
-- Existing rooms whose candidate link is saved get a team link now. Additive: no candidate link changes.

alter table public.meeting_rooms
  add column team_secret_hash text unique check (team_secret_hash is null or char_length(team_secret_hash) = 64),
  add column team_link text check (team_link is null or char_length(team_link) <= 500);

alter table public.candidate_interviews add column team_meeting_link text check (team_meeting_link is null or (char_length(team_meeting_link) <= 500 and team_meeting_link ~* '^https?://'));
grant select (team_meeting_link) on public.candidate_interviews to authenticated;

do $$
declare
  v_room record;
  v_secret text;
  v_base text;
begin
  for v_room in
    select r.id, r.interview_id, ci.meeting_link
      from public.meeting_rooms r
      join public.candidate_interviews ci on ci.id = r.interview_id
     where r.team_secret_hash is null
       and ci.meeting_link like '%#%'
       and encode(extensions.digest(split_part(ci.meeting_link, '#', 2), 'sha256'), 'hex') = r.secret_hash
  loop
    v_secret := left(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_'), 43);
    v_base := split_part(v_room.meeting_link, '#', 1);
    update public.meeting_rooms
       set team_secret_hash = encode(extensions.digest(v_secret, 'sha256'), 'hex'), team_link = v_base || '#' || v_secret
     where id = v_room.id;
    update public.candidate_interviews set team_meeting_link = v_base || '#' || v_secret where id = v_room.interview_id;
  end loop;
end $$;
