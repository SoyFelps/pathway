-- New fixed list of applicant stages (in board order): failed, new, screening, team_fit, skill_fit, interview,
-- promising, offer, withdrawn, hired. "approved" no longer exists: those candidates move to "offer" (approved to
-- receive an offer, not yet hired).
alter table public.applicants
  drop constraint if exists applicants_status_check;

update public.applicants set status = 'offer' where status = 'approved';

alter table public.applicants
  add constraint applicants_status_check
  check (status in ('failed', 'new', 'screening', 'team_fit', 'skill_fit', 'interview', 'promising', 'offer', 'withdrawn', 'hired'));

drop policy if exists "workspace applicant reviewers can update applicant status" on public.applicants;

create policy "workspace applicant reviewers can update applicant status"
on public.applicants for update to authenticated
using (public.workspace_user_has_permission(workspace_id, 'applicants'))
with check (
  status in ('failed', 'new', 'screening', 'team_fit', 'skill_fit', 'interview', 'promising', 'offer', 'withdrawn', 'hired')
  and public.workspace_user_has_permission(workspace_id, 'applicants')
);
