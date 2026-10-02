const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Settings and workspace setup expose the shared password-confirmed account deletion flow', () => {
  const builder = read('builder.js');
  const auth = read('auth.js');
  assert.match(builder, /id="settings-delete-account"/);
  assert.match(builder, /showAccountDeletionConfirmation\(\{ isOwner, workspaceName: workspace\.name, email: user\.email \}\)/);
  assert.match(auth, /function showAccountDeletionConfirmation\(options = \{\}\)/);
  assert.match(auth, /deleteAccountButton\.id = 'setup-delete-account'/);
  assert.match(auth, /autocomplete="current-password"/);
  assert.match(auth, /Delete account permanently/);
});

test('confirmation explains the distinct owner/member outcomes and never submits without a password', () => {
  const auth = read('auth.js');
  assert.match(auth, /deletes your Pathway account and workspace[\s\S]*candidate applications, private resumes/i);
  assert.match(auth, /Any subscription attached to the workspace will be canceled immediately/i);
  assert.match(auth, /workspace, job flows, candidate applications, private resumes, and subscription remain/i);
  assert.match(auth, /if \(submitting \|\| !passwordInput\.value\) return/);
  assert.match(auth, /showAccountDeletionConfirmation/);
});

test('browser sends the password only to the authenticated delete-account function, then clears local session', () => {
  const backend = read('backend.js');
  assert.match(backend, /const DELETE_ACCOUNT_FUNCTION = .*functions\/v1\/delete-account/);
  assert.match(backend, /async function deleteAccount\(password\)/);
  assert.match(backend, /Authorization: `Bearer \$\{session\.access_token\}`/);
  assert.match(backend, /JSON\.stringify\(\{ password \}\)/);
  assert.match(backend, /signOut\(\{ scope: 'local' \}\)/);
  assert.match(backend, /deleteAccount,/);
});

test('account deletion request uses only headers allowed by the Edge Function CORS preflight', () => {
  const backend = read('backend.js');
  const edge = read('supabase/functions/delete-account/index.ts');
  const start = backend.indexOf('async function deleteAccount(password)');
  const end = backend.indexOf('async function createWorkspace', start);
  const request = backend.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(request, /['"]Cache-Control['"]\s*:/);
  assert.match(edge, /Access-Control-Allow-Headers", "authorization, apikey, x-client-info, content-type/);
});

test('server requires a valid bearer user and matching password before any destructive operation', () => {
  const edge = read('supabase/functions/delete-account/index.ts');
  const userAuth = edge.indexOf('admin.auth.getUser(bearer)');
  const passwordAuth = edge.indexOf('verifier.auth.signInWithPassword');
  const ownerLookup = edge.indexOf('from("workspaces").select("id,name")');
  const hardDelete = edge.indexOf('admin.auth.admin.deleteUser(auth.user.id, false)');
  assert.ok(userAuth >= 0 && passwordAuth > userAuth && ownerLookup > passwordAuth && hardDelete > ownerLookup);
  assert.match(edge, /verifiedUserId !== auth\.user\.id/);
  assert.ok(edge.includes('"Cache-Control": "no-store"'));
  assert.doesNotMatch(edge, /console\.(log|error)\([^\n]*password/i);
});

test('owners must complete existing workspace and subscription cleanup before hard account deletion', () => {
  const edge = read('supabase/functions/delete-account/index.ts');
  const ownerStart = edge.indexOf('if (ownedWorkspace) {');
  const billingCall = edge.indexOf('/functions/v1/billing', ownerStart);
  const invitationCleanup = edge.indexOf('revokeAccountInvitations(auth.user.id', ownerStart);
  const hardDelete = edge.indexOf('admin.auth.admin.deleteUser(auth.user.id, false)');
  assert.ok(ownerStart >= 0 && billingCall > ownerStart && invitationCleanup > billingCall && hardDelete > invitationCleanup);
  assert.match(edge, /JSON\.stringify\(\{ action: "deleteWorkspace" \}\)/);
  assert.match(edge, /billingResult\.deleted !== true/);
  assert.match(edge, /workspace_deleted: workspaceDeleted/);
});

test('member account deletion cleans invite records while leaving workspace, jobs, applicants and resumes to the existing workspace', () => {
  const edge = read('supabase/functions/delete-account/index.ts');
  const billingCall = edge.indexOf('/functions/v1/billing');
  const ownerBranch = edge.indexOf('if (ownedWorkspace) {');
  const memberLookup = edge.indexOf('from("workspace_members").select("workspace_id,member_email")');
  const revoke = edge.indexOf('update({ status: "revoked" })');
  assert.ok(memberLookup >= 0 && revoke >= 0);
  assert.ok(edge.indexOf('revokeAccountInvitations(auth.user.id') > ownerBranch);
  assert.ok(billingCall > ownerBranch);
  assert.match(edge, /delete\(\)\.eq\("accepted_user_id", userId\)/);
  assert.doesNotMatch(edge, /from\("application_flows"\)\.delete\(\)/);
  assert.doesNotMatch(edge, /from\("applicants"\)\.delete\(\)/);
});

test('forward migration preserves flow and publication rows by clearing creator references and blocks deleted JWT session reuse', () => {
  const migration = read('supabase/migrations/20260930161532_account_deletion_safety.sql');
  assert.match(migration, /alter column created_by drop not null/);
  assert.equal((migration.match(/foreign key \(created_by\) references auth\.users\(id\) on delete set null/g) || []).length, 2);
  assert.match(migration, /not exists \(select 1 from auth\.users u where u\.id = old\.created_by\)/);
  assert.match(migration, /auth\.sessions s[\s\S]*s\.id::text = \(select auth\.jwt\(\) ->> 'session_id'\)/);
  assert.match(migration, /create or replace function public\.current_user_can_create_workspace\(\)[\s\S]*current_auth_session_is_active\(\)/);
});

test('delete-account Edge Function is explicitly JWT-protected and frontend assets use the new cache version', () => {
  const config = read('supabase/config.toml');
  const html = read('index.html');
  assert.match(config, /\[functions\.delete-account\]\s*\nverify_jwt = true/);
  assert.match(html, /styles\.css\?v=applicant-fit-toggles-20261002/);
  assert.match(html, /backend\.js\?v=flow-publish-20261001/);
  assert.match(html, /auth\.js\?v=password-recovery-20261001/);
  assert.match(html, /builder\.js\?v=applicant-fit-order-20261002/);
});
