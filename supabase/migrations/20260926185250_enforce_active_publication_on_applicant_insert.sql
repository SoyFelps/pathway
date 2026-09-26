create or replace function public.validate_applicant_active_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.application_flows f
    join public.published_flows pf
      on pf.id = new.published_flow_id
     and pf.flow_id = f.id
     and pf.workspace_id = f.workspace_id
    where f.id = new.flow_id
      and f.workspace_id = new.workspace_id
      and f.publication_status = 'published'
      and f.active_published_flow_id = pf.id
  ) then
    raise exception 'The application job is no longer actively published.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_applicant_active_publication() from public, anon, authenticated;

drop trigger if exists applicants_require_active_publication on public.applicants;
create trigger applicants_require_active_publication
before insert on public.applicants
for each row execute function public.validate_applicant_active_publication();
