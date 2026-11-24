-- Interviews, owner decisions 2026-11-24:
--  * An interview still WAITING to be scheduled can be cancelled (Interview tab). It never had a date, so it stays without one:
--    candidate_interviews_details_check also accepts a cancelled row with no date (local_start null). Nothing is sent to the candidate (no invitation went out).
--  * Once someone opened the Nellio meeting room of an interview, the interview can no longer be edited or cancelled (only join, change the responsible
--    people, re-send the link or finalize). candidate_interviews.room_opened_at keeps the first opening; written only by the `meetings` edge function
--    (service role), read by the browser (column grant) and checked by the `interviews` edge function.
--  * candidate_interview_events.kind: new line 'room_opened' (history of the Interview tab and the Logs tab).
-- Additive: no existing row changes. Undo: put the previous check and kind list (20261121100000) back and drop the column.

alter table public.candidate_interviews drop constraint candidate_interviews_details_check;
alter table public.candidate_interviews add constraint candidate_interviews_details_check check (
  state = 'awaiting_schedule'
  or (state = 'cancelled' and local_start is null)
  or (kind is not null and local_start is not null and time_zone is not null and starts_at is not null and duration_minutes is not null
      and (kind = 'online' or (kind = 'in_person' and address is not null)))
);

alter table public.candidate_interviews add column room_opened_at timestamptz;
grant select (room_opened_at) on public.candidate_interviews to authenticated;

alter table public.candidate_interview_events drop constraint candidate_interview_events_kind_check;
alter table public.candidate_interview_events add constraint candidate_interview_events_kind_check
  check (kind in ('scheduled', 'updated', 'cancelled', 'resent', 'confirmed', 'declined', 'reschedule_requested', 'reminder_24h', 'reminder_2h', 'reminder_10m', 'finished', 'responsibles_changed', 'finalized', 'result_corrected', 'link_missing', 'room_opened'));
