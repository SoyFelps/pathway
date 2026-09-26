revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.get_published_flow(uuid) from public, authenticated;
grant execute on function public.get_published_flow(uuid) to anon;
revoke all on function public.set_updated_at() from public, anon, authenticated;
