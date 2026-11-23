-- Nellio's own meeting rooms (Phase 1 of plano-reunioes.md, owner decision 2026-11-23: our own video rooms, no Google Meet).
-- One room per human interview. Its link is https://nellio.app/meeting.html#<secret>; only the SHA-256 of the secret is kept here,
-- like the answer page of the candidate (candidate_interview_tokens). Anyone with the link may join (owner decision): no sign-in.
-- The room is open from 30 minutes before the interview until 1 day after it, read from the interview itself, so a new time moves the window.
-- The video goes straight between the browsers; the server only hands out, to whoever has the secret and is inside the window, the name of the
-- Realtime channel the browsers use to find each other (channel_key, never derived from the secret) and short-lived TURN credentials.
-- Only the `meetings` edge function (service role) reads or writes this table: no grant to the browser.

create table public.meeting_rooms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  interview_id uuid not null unique references public.candidate_interviews (id) on delete cascade,
  secret_hash text not null unique check (char_length(secret_hash) = 64),
  channel_key text not null unique check (char_length(channel_key) between 32 and 64),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.meeting_rooms enable row level security;
revoke all on public.meeting_rooms from public, anon, authenticated;
grant all on public.meeting_rooms to service_role;
comment on table public.meeting_rooms is 'Nellio meeting room of a human interview: hash of the link secret and the Realtime channel key. Only the meetings edge function touches it.';
