const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Settings is in workspace navigation and shows email/workspace read-only with shared sign-out', () => {
  const builder = read('builder.js');
  assert.match(builder, /data-route="settings"/);
  assert.match(builder, /function renderSettings\(\)/);
  assert.match(builder, /Email address/);
  assert.match(builder, /<h2 id="settings-account-heading">Account and workspace<\/h2>/);
  assert.match(builder, /id="settings-signout"[\s\S]*?doSignOut/);
  assert.match(builder, /else if \(requestedPage === 'settings'\) renderSettings\(\)/);
});

test('Settings exposes leave only to members, workspace deletion only to owners, and password-confirmed account deletion', () => {
  const builder = read('builder.js');
  assert.match(builder, /isOwner \? '<button class="btn btn-danger" id="settings-delete-workspace"/);
  assert.match(builder, /: teamMember \? '<button class="btn btn-danger" id="settings-leave-workspace"/);
  assert.match(builder, /id="settings-delete-account"/);
  assert.match(builder, /showAccountDeletionConfirmation/);
  assert.doesNotMatch(builder, /Delete account · Coming soon/);
  assert.match(builder, /showLeaveTeamConfirmation/);
  assert.match(builder, /immediately lose access to this workspace and its data/);
});

test('owner must type the exact workspace name and sees immediate cancellation and irreversible deletion consequences', () => {
  const builder = read('builder.js');
  const start = builder.indexOf('function showDeleteWorkspaceConfirmation()');
  const end = builder.indexOf('function formatInvoiceAmount(', start);
  const modal = builder.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(modal, /action is irreversible/i);
  assert.match(modal, /canceled immediately/i);
  assert.match(modal, /not automatically refunded/i);
  assert.match(modal, /input\.value\.trim\(\) !== name/);
  assert.match(modal, /await window\.PathwayBackend\.deleteWorkspace\(\)/);
});

test('workspace deletion request contains no client-supplied workspace ID and requires an authenticated session', () => {
  const backend = read('backend.js');
  assert.match(backend, /async function deleteWorkspace\(\)/);
  assert.match(backend, /const session = await requireSession\(\)/);
  assert.match(backend, /JSON\.stringify\(\{ action: 'deleteWorkspace' \}\)/);
  assert.match(backend, /if \(!payload\.deleted\)/);
  assert.match(backend, /deleteWorkspace,/);
});

test('server deletion is owner-verified, cancels immediately, revokes access, cleans storage, then deletes the workspace', () => {
  const edge = read('supabase/functions/billing/index.ts');
  assert.match(edge, /from\("workspaces"\)\.select\("id,name"\)\.eq\("owner_id", auth\.user\.id\)/);
  assert.match(edge, /action !== "deleteWorkspace"/);
  const start = edge.indexOf('if (action === "deleteWorkspace")');
  const end = edge.indexOf('if (action === "listPaymentHistory")', start);
  const deletion = edge.slice(start, end);
  assert.ok(start >= 0 && end > start);
  const unpublish = deletion.indexOf('from("application_flows")');
  const cancel = deletion.indexOf('stripe.subscriptions.cancel(existing.stripe_subscription_id, { invoice_now: false, prorate: false })');
  const invitations = deletion.indexOf('from("workspace_invitations").delete()');
  const members = deletion.indexOf('from("workspace_members").delete()');
  const storage = deletion.indexOf('removeWorkspaceResumeFiles(workspace.id)');
  const workspaceDelete = deletion.indexOf('from("workspaces").delete()');
  assert.ok(unpublish >= 0 && unpublish < cancel);
  assert.ok(cancel < invitations && invitations < members && members < storage && storage < workspaceDelete);
  assert.match(edge, /status: "canceled", current_period_end: new Date\(\)\.toISOString\(\), cancel_at_period_end: false/);
  assert.match(edge, /admin\.storage\.from\(RESUME_BUCKET\)\.list/);
  assert.match(edge, /admin\.storage\.from\(RESUME_BUCKET\)\.remove/);
  assert.doesNotMatch(deletion, /auth\.admin\.deleteUser/);
});

test('late signed Stripe events cannot recreate a deleted workspace subscription and cancel any live orphan subscription', () => {
  const webhook = read('supabase/functions/billing-webhook/index.ts');
  assert.match(webhook, /async function cancelSubscriptionForDeletedWorkspace/);
  assert.match(webhook, /stripe\.subscriptions\.cancel\(subscriptionId, \{ invoice_now: false, prorate: false \}\)/);
  assert.match(webhook, /from\("workspaces"\)[\s\S]*?if \(!workspace\)[\s\S]*?cancelSubscriptionForDeletedWorkspace\(subscription\.id\)/);
});

test('Settings uses a fresh cache version for frontend assets', () => {
  const html = read('index.html');
  assert.match(html, /styles\.css\?v=applicant-fit-stages-20261002/);
  assert.match(html, /backend\.js\?v=flow-publish-20261001/);
  assert.match(html, /auth\.js\?v=password-recovery-20261001/);
  assert.match(html, /builder\.js\?v=applicant-fit-stages-20261002/);
});
