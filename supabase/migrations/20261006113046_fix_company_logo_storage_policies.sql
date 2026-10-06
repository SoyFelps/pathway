-- Avoid resolving unqualified `name` to workspace_companies.name inside the
-- correlated EXISTS subqueries. `objects.name` explicitly refers to the
-- outer storage.objects row and enforces the intended workspace/company path.
drop policy if exists "workspace flow managers can upload company logos" on storage.objects;
create policy "workspace flow managers can upload company logos"
on storage.objects for insert to authenticated
with check (
  objects.bucket_id = 'company-logos'
  and exists (
    select 1 from public.workspace_companies c
    where c.workspace_id::text = (storage.foldername(objects.name))[1]
      and c.id::text = (storage.foldername(objects.name))[2]
      and objects.name ~ ('^' || c.workspace_id::text || '/' || c.id::text || '/logo(-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\.(png|jpg|webp)$')
      and public.workspace_user_has_permission(c.workspace_id, 'flows')
  )
);

drop policy if exists "workspace flow managers can delete company logos" on storage.objects;
create policy "workspace flow managers can delete company logos"
on storage.objects for delete to authenticated
using (
  objects.bucket_id = 'company-logos'
  and exists (
    select 1 from public.workspace_companies c
    where c.workspace_id::text = (storage.foldername(objects.name))[1]
      and c.id::text = (storage.foldername(objects.name))[2]
      and objects.name ~ ('^' || c.workspace_id::text || '/' || c.id::text || '/logo(-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\.(png|jpg|webp)$')
      and public.workspace_user_has_permission(c.workspace_id, 'flows')
  )
);
