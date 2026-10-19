const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

test('migration keeps the responsible list in its own column, cleans it on every write and when a member leaves', () => {
  const sql = read('supabase/migrations/20261018120000_flow_responsible_members.sql');
  assert.match(sql, /add column responsible_user_ids uuid\[\] not null default '\{\}'/);
  assert.match(sql, /create trigger application_flows_clean_responsible\s+before insert or update of responsible_user_ids/);
  assert.match(sql, /select w\.owner_id from public\.workspaces w[\s\S]*union[\s\S]*select m\.user_id from public\.workspace_members m/, 'only the owner and current members are kept');
  assert.match(sql, /create trigger workspace_members_clear_flow_responsibles\s+after delete on public\.workspace_members/);
  assert.match(sql, /array_remove\(responsible_user_ids, old\.user_id\)/);
  assert.match(sql, /list_workspace_people[\s\S]*workspaces w where w\.id = p_workspace_id and w\.owner_id = auth\.uid\(\)[\s\S]*workspace_members m where m\.workspace_id = p_workspace_id and m\.user_id = auth\.uid\(\)/, 'owner and every member may read the list');
  assert.match(sql, /revoke all on function public\.list_workspace_people\(uuid\) from public, anon, authenticated;\s*[\s\S]*grant execute on function public\.list_workspace_people\(uuid\) to authenticated, service_role;/);
  assert.equal(/to anon/.test(sql), false, 'nothing here is callable by anonymous visitors');
});

test('the responsible people never travel inside flow_data or the public published snapshot', () => {
  const backend = read('backend.js');
  const destructures = backend.match(/activePublishedFlowId, publishedAt, responsibleIds, \.\.\.flowData \} = flow;/g) || [];
  assert.equal(destructures.length, 2, 'both the draft save and the publish snapshot strip responsibleIds');
  assert.ok(backend.includes('responsible_user_ids: Array.isArray(responsibleIds) ? responsibleIds : [], flow_data: flowData'));
  assert.ok(backend.includes("flow_data,responsible_user_ids,publication_status"));
  assert.ok(backend.includes("client.rpc('list_workspace_people', { p_workspace_id: workspaceId })"));
});

test('the create-flow modal and the first step both offer the multi-select', () => {
  const builder = read('builder.js');
  assert.ok(builder.includes('id="new-responsible"') && builder.includes('id="role-responsible"'));
  const modal = builder.slice(builder.indexOf('function showNewFlow('), builder.indexOf('function showFlowMenu('));
  assert.ok(modal.indexOf('id="new-description"') < modal.indexOf('id="new-responsible"'), 'the field sits below the job description');
  assert.ok(modal.includes('flow.responsibleIds = currentResponsibleIds(newResponsible);'));
  assert.ok(builder.includes("ids => { flow.responsibleIds = ids; save({ internal: true }); }"), 'editing the first step saves the flow');
  assert.ok(builder.includes("if (input.hasAttribute('data-all-people')) ids = [];"), 'choosing All clears the individual choices');
  assert.ok(builder.includes("if (!names.length) return 'All';"), 'an empty selection reads as All');
});
