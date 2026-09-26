drop policy if exists "workspace owners can view applicant resumes" on storage.objects;
create policy "workspace owners can view applicant resumes"
on storage.objects for select to authenticated
using (
  bucket_id = 'applicant-resumes'
  and exists (
    select 1 from public.workspaces as w
    where w.id::text = (storage.foldername(storage.objects.name))[1]
      and w.owner_id = (select auth.uid())
  )
);

drop policy if exists "workspace owners can delete applicant resumes" on storage.objects;
create policy "workspace owners can delete applicant resumes"
on storage.objects for delete to authenticated
using (
  bucket_id = 'applicant-resumes'
  and exists (
    select 1 from public.workspaces as w
    where w.id::text = (storage.foldername(storage.objects.name))[1]
      and w.owner_id = (select auth.uid())
  )
);
