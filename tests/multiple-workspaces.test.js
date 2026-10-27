const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20261026150000_multiple_workspaces.sql');
const team = read('supabase/functions/team/index.ts');
const billing = read('supabase/functions/billing/index.ts');

test('the database no longer limits a person to one workspace, but caps owned workspaces at 5', () => {
  assert.match(migration, /drop constraint if exists workspaces_owner_id_key/);
  assert.match(migration, /drop constraint if exists workspace_members_user_id_key/);
  assert.match(migration, /enforce_workspace_limit/);
  assert.match(migration, /You can own up to 5 workspaces\./);
  assert.match(migration, /pg_advisory_xact_lock/);
});

test('the last workspace is remembered in the profile without touching updated_at', () => {
  assert.match(migration, /last_workspace_id uuid references (public\.)?workspaces \(id\) on delete set null/);
  assert.match(migration, /before update of first_name, last_name/i);
});

test('workspace functions are closed to anon and open to signed-in users', () => {
  for (const name of ['list_my_workspaces', 'create_workspace', 'rename_workspace', 'set_last_workspace']) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated`), `${name} revoked`);
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated, service_role`), `${name} granted`);
  }
  assert.match(migration, /Only the workspace owner can rename it\./);
});

test('invitations work per workspace and joining remembers the new workspace', () => {
  assert.match(migration, /That person is already a member of this workspace\./);
  assert.match(migration, /You already belong to this workspace\./);
  assert.doesNotMatch(migration, /already belongs to a workspace/);
});

test('team function: optional workspaceId, 403 for a workspace the person does not belong to, and the new actions', () => {
  assert.match(team, /async function getWorkspaceContext\(userId: string, requestedId = ""\)/);
  assert.match(team, /last_workspace_id/);
  assert.match(team, /You do not belong to this workspace\./);
  for (const action of ['listWorkspaces', 'setLastWorkspace', 'renameWorkspace']) assert.ok(team.includes(`body.action === "${action}"`), action);
  assert.match(team, /pathway_team_invite_hash/);
  assert.doesNotMatch(team, /\.eq\("invited_email", email\)\.eq\("status", "pending"\)\s*\.gt\("expires_at", new Date\(\)\.toISOString\(\)\)\.maybeSingle\(\)/);
});

test('billing works on the workspace the app names and refuses to guess when a person owns several', () => {
  assert.match(billing, /requestedWorkspaceId/);
  assert.match(billing, /Choose a workspace\./);
  assert.match(billing, /\.eq\("owner_id", auth\.user\.id\)/);
});

test('account deletion removes every owned workspace before the account', () => {
  const edge = read('supabase/functions/delete-account/index.ts');
  assert.match(edge, /for \(const ownedWorkspace of ownedWorkspaces \|\| \[\]\)/);
  assert.ok(edge.indexOf('for (const ownedWorkspace') < edge.indexOf('admin.auth.admin.deleteUser'));
});

const builder = read('builder.js');
const backend = read('backend.js');
const auth = read('auth.js');

test('repeated workspace names get roman numerals on screen only, oldest first, and recalculate from the current list', () => {
  const start = builder.indexOf('const ROMAN_NUMERALS');
  const end = builder.indexOf('const workspaceLabel =');
  assert.ok(start >= 0 && end > start);
  const labels = new Function('myWorkspaces', `${builder.slice(start, end)}; return workspaceLabels;`)([]);
  const list = [
    { id: 'b', name: 'Acme', createdAt: '2026-02-01' },
    { id: 'a', name: 'acme ', createdAt: '2026-01-01' },
    { id: 'c', name: 'Solo', createdAt: '2026-03-01' },
  ];
  const result = labels(list);
  assert.equal(result.get('a'), 'acme  I');
  assert.equal(result.get('b'), 'Acme II');
  assert.equal(result.get('c'), 'Solo');
  assert.equal(labels([list[0], list[2]]).get('b'), 'Acme', 'a single remaining workspace loses its numeral');
  const many = Array.from({ length: 21 }, (_, index) => ({ id: `w${index}`, name: 'Same', createdAt: `2026-01-${String(index + 1).padStart(2, '0')}` }));
  assert.equal(labels(many).get('w19'), 'Same XX');
  assert.equal(labels(many).get('w20'), 'Same 21', 'beyond 20 it falls back to digits');
});

test('the header selector is a custom accessible menu with an owner/member badge, a New workspace entry and a disabled empty state', () => {
  assert.match(builder, /function workspaceSwitcherHtml\(\)/);
  assert.match(builder, /role="menuitemradio" aria-checked=/);
  assert.match(builder, /aria-haspopup="menu" aria-expanded="false"/);
  assert.match(builder, /No workspace<\/span><\/button>/);
  assert.match(builder, /New workspace<\/button>/);
  assert.match(builder, /event\.key === 'Escape'/);
  assert.match(builder, /ArrowDown/);
  assert.doesNotMatch(builder, /<select[^>]*ws-switch/);
});

test('switching saves the choice, waits for pending saves, reloads and lands on the Dashboard', () => {
  const start = builder.indexOf('async function flushPendingWork()');
  const end = builder.indexOf('function refreshHeaderSwitcher()');
  const code = builder.slice(start, end);
  assert.match(code, /await run\(\)/);
  assert.match(code, /selectWorkspace\(workspaceId\)/);
  assert.match(code, /#dashboard/);
  assert.match(code, /window\.location\.reload\(\)/);
  assert.match(builder, /pendingCloudSave = runCloudSave/);
});

test('New workspace modal warns at the limit of 5 and creating goes through the checked database function', () => {
  assert.match(builder, /const MAX_OWNED_WORKSPACES = 5/);
  assert.match(builder, /You can own up to \$\{MAX_OWNED_WORKSPACES\} workspaces\./);
  assert.match(backend, /client\.rpc\('create_workspace', \{ p_name: cleanName \}\)/);
  assert.doesNotMatch(backend, /from\('workspaces'\)\.insert/);
});

test('the app passes the current workspace to the server and loads it from the list (last used, else first owned, else first)', () => {
  assert.match(backend, /let currentWorkspaceId = ''/);
  assert.match(backend, /body = \{ \.\.\.body, workspaceId: currentWorkspaceId \}/);
  assert.match(backend, /workspaces\.find\(row => row\.id === preferredWorkspaceId\) \|\| workspaces\.find\(row => row\.isLast\) \|\| workspaces\.find\(row => row\.isOwner\) \|\| workspaces\[0\]/);
  assert.match(backend, /pathway_team_invite_hash: await sha256Hex\(inviteToken\)/);
});

test('owners rename from Settings and My Team; nobody else sees the button; no workspace shows the empty state with Settings only', () => {
  assert.match(builder, /data-ws-rename="\$\{esc\(workspace\.id\)\}">Rename workspace/);
  assert.match(builder, /isOwner \? `<button class="btn btn-sm team-rename"/);
  assert.match(builder, /function renderNoWorkspace\(\)/);
  assert.match(builder, /if \(!workspace\) \{ if \(requestedPage === 'settings'\) renderSettings\(\); else renderNoWorkspace\(\); \}/);
  assert.match(auth, /No workspace is fine: the app shows its empty screen/);
});

test('being removed from the open workspace shows a notice and opens another one instead of leaving the page stuck', () => {
  assert.match(backend, /window\.dispatchEvent\(new CustomEvent\('pathway:workspace-lost'\)\)/);
  assert.match(backend, /do not belong to this workspace/);
  assert.match(builder, /addEventListener\('pathway:workspace-lost'/);
  assert.match(builder, /You no longer have access to this workspace\. Opening another one…/);
});

test('team permissions are a multiselect: same checkboxes and handlers, shown in a dropdown with chips', () => {
  assert.equal((builder.match(/class="perm-multi"/g) || []).length, 2, 'the invite form and every person/invitation card share it');
  assert.match(builder, /data-invite-permission="flows" checked/);
  assert.match(builder, /data-permission="flows"/);
  assert.match(builder, /function paintPermissionMulti\(multi\)/);
  assert.match(builder, /bindPermissionMultis\(\);/);
  assert.doesNotMatch(builder, /team-permission-grid/);
});
