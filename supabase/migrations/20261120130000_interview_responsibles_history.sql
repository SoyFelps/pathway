-- History of a human interview: a new line kind, 'responsibles_changed' (who changed the responsible people, owner decision 2026-11-20).
-- The responsible people of an interview can be changed at any time in the Interview tab without sending anything to the candidate; the
-- history says who did it. Only the list of allowed kinds grows. Undo: put the old list back (after deleting the lines of this kind).
alter table public.candidate_interview_events drop constraint candidate_interview_events_kind_check;
alter table public.candidate_interview_events add constraint candidate_interview_events_kind_check
  check (kind in ('scheduled', 'updated', 'cancelled', 'resent', 'confirmed', 'declined', 'reschedule_requested', 'reminder_24h', 'reminder_2h', 'finished', 'responsibles_changed'));
