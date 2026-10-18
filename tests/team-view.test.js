const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

test('every person in the workspace can read the team, but the function only reads', () => {
  const sql = read('supabase/migrations/20261018140000_team_overview_for_members.sql');
  assert.match(sql, /workspaces w where w\.id = p_workspace_id and w\.owner_id = auth\.uid\(\)[\s\S]*workspace_members m where m\.workspace_id = p_workspace_id and m\.user_id = auth\.uid\(\)/, 'only the owner and members of that workspace');
  assert.equal(/\b(insert|update|delete)\b\s+(into\s+)?public\./i.test(sql), false, 'it never writes');
  assert.equal(/invitation/i.test(sql.replace(/^--.*$/gm, '')), false, 'pending invitations and their links are not part of it');
  assert.match(sql, /revoke all on function public\.list_team_overview\(uuid\) from public, anon, authenticated;\s*grant execute on function public\.list_team_overview\(uuid\) to authenticated, service_role;/);
  assert.equal(/to anon/.test(sql), false);
});

test('people without the Team permission see the whole team read-only, with no management controls', () => {
  const builder = read('builder.js');
  const markup = builder.slice(builder.indexOf('function renderMyTeamMarkup('), builder.indexOf('function renderMyTeamLoadingMarkup('));
  assert.ok(builder.includes("if (!data.canManage && !isOwner && teamMember) {") && builder.includes('window.PathwayBackend.listTeamOverview(workspace.id)'));
  const readOnlyCard = markup.slice(markup.indexOf('data.readOnlyTeam ? data.readOnlyTeam.filter'), markup.indexOf(': teamMember ?'));
  assert.ok(readOnlyCard.includes('describe(person)'), 'permissions are shown as text');
  assert.equal(/data-remove-member|data-permission|<input|<button/.test(readOnlyCard), false, 'no remove button, no checkboxes');
  assert.ok(markup.includes('${manager ? `<section class="team-card">'), 'the invite form is still manager-only');
  assert.ok(markup.includes('${manager && data.invitations?.length ?'), 'pending invitations are still manager-only');
  assert.ok(markup.includes('(data.isOwner || data.readOnlyTeam) ?'), 'the owner is listed for everyone');
  assert.ok(markup.includes('<strong>View only</strong>'));
  assert.ok(markup.includes("id=\"leave-team\"") , 'leaving your own membership is still possible');
});

test('the browser layer exposes the read-only team call', () => {
  const backend = read('backend.js');
  assert.ok(backend.includes("client.rpc('list_team_overview', { p_workspace_id: workspaceId })"));
  assert.match(backend, /listTeamOverview,\n/);
});
