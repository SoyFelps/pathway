-- Leftover company logos (owner request, 2026-11-26). Deleting a workspace (or the account) removed the resumes but not the company logos,
-- and 8 old logos were left in production by a storage-rule bug fixed on 2026-10-06. Now the daily job (`billing-reconcile`, 07:00 UTC) also
-- deletes, through the Storage API, every logo file that no company points to any more.
--  * company_logo_orphans(p_limit): names of files in the public bucket `company-logos` older than 1 day that are not the logo_path of any
--    company (1 day so a logo being uploaded right now, whose company is saved a moment later, is never taken). Service role only.

create or replace function public.company_logo_orphans(p_limit integer default 100)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'company-logos'
     and o.created_at < now() - interval '1 day'
     and not exists (select 1 from public.workspace_companies c where c.logo_path = o.name)
   order by o.created_at
   limit greatest(1, least(coalesce(p_limit, 100), 1000));
$$;
revoke all on function public.company_logo_orphans(integer) from public, anon, authenticated;
grant execute on function public.company_logo_orphans(integer) to service_role;
