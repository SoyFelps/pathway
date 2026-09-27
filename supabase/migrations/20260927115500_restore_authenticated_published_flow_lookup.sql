-- Authenticated workspace users may also open a public candidate preview while signed in.
-- The security-definer function still returns only active, published snapshots and verifies
-- that the owning workspace has a current paid subscription.
grant execute on function public.get_published_flow(uuid) to authenticated;
