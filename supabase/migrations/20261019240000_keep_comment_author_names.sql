-- Comments written by a team member are the employer's internal records. When that person leaves or deletes their
-- account, their account data (e-mail, profile, access) is deleted, but the comments keep the name they were written
-- under, and the @mentions of that person keep their name. Undoes the two triggers of 20261019220000 that replaced the
-- author name with "Former team member" and removed the person from the stored mention lists.

drop trigger if exists applicant_comments_anonymize_author on public.applicant_comments;
drop function if exists public.anonymize_comment_author();
drop trigger if exists profiles_scrub_mentions on public.profiles;
drop function if exists public.scrub_deleted_user_mentions();
