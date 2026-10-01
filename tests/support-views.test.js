const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261001112307_support_views.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');

test('support views use a private schema with no application/API access', () => {
  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS support/i);
  assert.match(migration, /REVOKE ALL ON SCHEMA support FROM anon, authenticated, service_role/i);
  assert.match(migration, /REVOKE ALL ON ALL TABLES IN SCHEMA support FROM PUBLIC, anon, authenticated, service_role/i);
  assert.doesNotMatch(migration, /GRANT\s+SELECT\s+ON\s+(?:ALL\s+TABLES\s+IN\s+SCHEMA\s+)?support\b/i);
});

test('Premium support view matches the app entitlement and keeps period-end cancellations active until expiry', () => {
  assert.match(migration, /CREATE OR REPLACE VIEW support\.premium_workspaces AS[\s\S]*s\.status = 'active'[\s\S]*s\.current_period_end > pg_catalog\.now\(\)/i);
  assert.match(migration, /s\.cancel_at_period_end/i);
  assert.match(migration, /Scheduled end-of-period cancellations remain included until the period ends/i);
});

test('active-users view excludes deleted/currently banned Auth accounts and marks workspace role and email confirmation', () => {
  assert.match(migration, /CREATE OR REPLACE VIEW support\.active_users AS[\s\S]*u\.deleted_at IS NULL[\s\S]*u\.banned_until IS NULL OR u\.banned_until <= pg_catalog\.now\(\)/i);
  assert.match(migration, /u\.email_confirmed_at IS NOT NULL\) AS email_confirmed/i);
  assert.match(migration, /THEN 'owner'[\s\S]*THEN 'member'/i);
  assert.match(migration, /workspace_is_premium/i);
});
