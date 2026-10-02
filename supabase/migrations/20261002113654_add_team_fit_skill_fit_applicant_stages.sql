alter table public.applicants
  drop constraint if exists applicants_status_check;

alter table public.applicants
  add constraint applicants_status_check
  check (status in ('new', 'failed', 'promising', 'approved', 'team_fit', 'skill_fit'));

drop policy if exists "workspace applicant reviewers can update applicant status" on public.applicants;

create policy "workspace applicant reviewers can update applicant status"
on public.applicants for update to authenticated
using (public.workspace_user_has_permission(workspace_id, 'applicants'))
with check (
  status in ('new', 'failed', 'promising', 'approved', 'team_fit', 'skill_fit')
  and public.workspace_user_has_permission(workspace_id, 'applicants')
);
