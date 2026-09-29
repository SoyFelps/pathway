-- Invitation data, including the encrypted bearer token, is served only through
-- the authenticated Team Edge Function. No app client reads this table directly.
revoke select on public.workspace_invitations from authenticated;
