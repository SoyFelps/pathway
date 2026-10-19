-- A comment can be deleted by the person who wrote it or by the workspace owner. Nobody else can, and the table itself
-- still has no direct delete permission: deleting goes through this one checked function.
create or replace function public.delete_applicant_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment public.applicant_comments;
  v_is_owner boolean;
begin
  select * into v_comment from public.applicant_comments c where c.id = p_comment_id;
  if auth.uid() is null or v_comment.id is null then
    raise exception 'Comment not found.' using errcode = '42501';
  end if;
  select exists (select 1 from public.workspaces w where w.id = v_comment.workspace_id and w.owner_id = auth.uid()) into v_is_owner;
  if not (
    v_is_owner
    or (v_comment.author_id = auth.uid() and public.workspace_user_has_permission(v_comment.workspace_id, 'applicants'))
  ) then
    raise exception 'Only the author or the workspace owner can delete this comment.' using errcode = '42501';
  end if;
  delete from public.applicant_comments where id = p_comment_id;
end;
$$;

revoke all on function public.delete_applicant_comment(uuid) from public, anon, authenticated;
grant execute on function public.delete_applicant_comment(uuid) to authenticated, service_role;
