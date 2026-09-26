create policy "workspace owners can delete applicant resumes"
on storage.objects for delete to authenticated
using (
  bucket_id = 'applicant-resumes'
  and exists (
    select 1 from public.workspaces w
    where w.id::text = (storage.foldername(name))[1]
      and w.owner_id = (select auth.uid())
  )
);
