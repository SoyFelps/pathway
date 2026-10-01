-- Admin-only support reporting. This schema is intentionally not exposed through PostgREST.
CREATE SCHEMA IF NOT EXISTS support;
COMMENT ON SCHEMA support IS 'Private, read-only support reporting views; do not expose through the application API.';

REVOKE ALL ON SCHEMA support FROM PUBLIC;
REVOKE ALL ON SCHEMA support FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA support
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;

-- Matches public.workspace_has_active_subscription: active status and an unexpired period.
-- A subscription scheduled to cancel at period end remains Premium until current_period_end.
CREATE OR REPLACE VIEW support.premium_workspaces AS
SELECT
  w.id AS workspace_id,
  w.name AS workspace_name,
  w.owner_id AS owner_user_id,
  u.email AS owner_email,
  s.status AS subscription_status,
  s.current_period_end,
  s.cancel_at_period_end,
  s.updated_at AS subscription_updated_at
FROM public.workspaces AS w
JOIN public.workspace_subscriptions AS s
  ON s.workspace_id = w.id
JOIN auth.users AS u
  ON u.id = w.owner_id
WHERE s.status = 'active'
  AND s.current_period_end > pg_catalog.now();

-- Active means not soft-deleted and not currently banned in Supabase Auth.
-- Accounts without a confirmed email remain visible; email_confirmed distinguishes them.
CREATE OR REPLACE VIEW support.active_users AS
SELECT
  u.id AS user_id,
  u.email,
  u.created_at AS account_created_at,
  u.last_sign_in_at,
  u.email_confirmed_at,
  (u.email_confirmed_at IS NOT NULL) AS email_confirmed,
  COALESCE(owner_workspace.id, member.workspace_id) AS workspace_id,
  COALESCE(owner_workspace.name, member_workspace.name) AS workspace_name,
  CASE
    WHEN owner_workspace.id IS NOT NULL THEN 'owner'
    WHEN member.workspace_id IS NOT NULL THEN 'member'
    ELSE NULL
  END AS workspace_role,
  subscription.status AS workspace_subscription_status,
  subscription.current_period_end AS workspace_current_period_end,
  subscription.cancel_at_period_end AS workspace_cancel_at_period_end,
  COALESCE(
    subscription.status = 'active'
      AND subscription.current_period_end > pg_catalog.now(),
    false
  ) AS workspace_is_premium
FROM auth.users AS u
LEFT JOIN public.workspaces AS owner_workspace
  ON owner_workspace.owner_id = u.id
LEFT JOIN public.workspace_members AS member
  ON member.user_id = u.id
LEFT JOIN public.workspaces AS member_workspace
  ON member_workspace.id = member.workspace_id
LEFT JOIN public.workspace_subscriptions AS subscription
  ON subscription.workspace_id = COALESCE(owner_workspace.id, member.workspace_id)
WHERE u.deleted_at IS NULL
  AND (u.banned_until IS NULL OR u.banned_until <= pg_catalog.now());

COMMENT ON VIEW support.premium_workspaces IS
  'Current Premium workspaces: subscription status is active and current_period_end is later than now. Scheduled end-of-period cancellations remain included until the period ends.';
COMMENT ON VIEW support.active_users IS
  'Supabase Auth accounts that are not soft-deleted and not currently banned. Unconfirmed email accounts remain included; use email_confirmed to distinguish them.';

-- Keep account emails and subscription support data inaccessible to application/API roles.
REVOKE ALL ON ALL TABLES IN SCHEMA support FROM PUBLIC, anon, authenticated, service_role;
