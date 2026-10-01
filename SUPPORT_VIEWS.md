# Pathway support views in Supabase

The PathwayAPP database has two read-only views in the private `support` schema. They are backed by live Auth/workspace/subscription data; they do not duplicate it.

## Open in Supabase Studio

1. Open the **PathwayAPP** project.
2. Go to **Database → Table Editor**.
3. Change the schema selector to **`support`**.
4. Open **`premium_workspaces`** or **`active_users`**. These are views, so they are read-only.

If the Table Editor does not show the `support` schema in your Studio version, use **SQL Editor** and run the queries below.

## Current Premium workspaces

`support.premium_workspaces` includes workspaces whose subscription has `status = 'active'` and `current_period_end` later than the current time. This matches the Pathway publishing entitlement. A subscription scheduled to cancel at period end remains Premium until that date.

Useful columns: workspace ID/name, owner user ID/email, subscription status, period end, whether cancellation is scheduled, and last subscription update.

```sql
select *
from support.premium_workspaces
order by workspace_name;
```

## Active user accounts

`support.active_users` includes Supabase Auth accounts that are not soft-deleted and are not currently banned. Unconfirmed email accounts are included so support can help them; check `email_confirmed` / `email_confirmed_at` to distinguish them.

Useful columns: user ID/email, account creation and last sign-in times, email confirmation, workspace ID/name/role, subscription status and period end, cancellation flag, and `workspace_is_premium`.

```sql
select *
from support.active_users
order by account_created_at desc;
```

## Access protection

The `support` schema is not exposed through the Pathway application API. `anon`, `authenticated`, and `service_role` have no schema usage or view `SELECT` privileges; project administrators can query the views in Studio. Do not grant these views to application roles because they contain account emails and subscription support information.
