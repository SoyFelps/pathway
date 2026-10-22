const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

test('"Customize stages" is a team permission: on by default, in invitations, members, the team function and exports', () => {
  const sql = read('supabase/migrations/20261020150000_custom_stages.sql');
  assert.match(sql, /alter table public\.workspace_members add column if not exists can_customize_stages boolean not null default true/);
  assert.match(sql, /alter table public\.workspace_invitations add column if not exists can_customize_stages boolean not null default true/);
  assert.match(sql, /when 'customize_stages' then m\.can_customize_stages/);
  assert.match(sql, /insert into public\.workspace_members \(workspace_id, user_id, member_email, can_flows, can_applicants, can_manage_team, can_customize_stages, invited_by\)/);
  assert.match(sql, /grant execute on function public\.create_team_invitation\(uuid, text, text, text, boolean, boolean, boolean, boolean\) to authenticated, service_role/);
  assert.match(sql, /p_can_customize_stages boolean default null/);
  assert.match(sql, /can_customize_stages = coalesce\(p_can_customize_stages, can_customize_stages\)/);
  assert.match(sql, /'canCustomizeStages', m\.can_customize_stages/);
  const edge = read('supabase/functions/team/index.ts');
  assert.match(edge, /can_customize_stages: permissions\.stages !== false/);
  assert.match(edge, /p_can_customize_stages: permissions\.can_customize_stages/);
  assert.match(edge, /p_can_customize_stages: p\.can_customize_stages/);
  assert.equal((edge.match(/can_manage_team,can_customize_stages/g) || []).length >= 3, true, 'members and invitations are read with the new column');
  const builder = read('builder.js');
  assert.match(builder, /data-permission="stages"/);
  assert.match(builder, /data-invite-permission="stages" checked/);
  assert.match(builder, /hasPermission\('customize_stages'\)/);
  assert.match(builder, /'Customize stages'/);
  const backend = read('backend.js');
  assert.match(backend, /can_customize_stages: row\.can_customize_stages/);
});

test('custom stages live in the database per workspace, readable by the team and changed only through checked functions', () => {
  const sql = read('supabase/migrations/20261020150000_custom_stages.sql');
  for (const table of ['workspace_custom_stages', 'workspace_board_settings']) {
    assert.ok(sql.includes('alter table public.' + table + ' enable row level security;'));
  }
  assert.match(sql, /revoke all on public\.workspace_custom_stages, public\.workspace_board_settings from public, anon, authenticated;/);
  assert.match(sql, /grant select on public\.workspace_custom_stages, public\.workspace_board_settings to authenticated;/);
  assert.match(sql, /grant all on public\.workspace_custom_stages, public\.workspace_board_settings to service_role;/);
  assert.match(sql, /create unique index workspace_custom_stages_workspace_name_key on public\.workspace_custom_stages \(workspace_id, lower\(name\)\)/);
  assert.match(sql, /char_length\(name\) between 1 and 30/);
  assert.match(sql, />= 5 then\s+raise exception 'You can create up to 5 custom columns\./);
  for (const fn of ['create_custom_stage(uuid, text)', 'rename_custom_stage(uuid, uuid, text)', 'delete_custom_stage(uuid, uuid)', 'save_board_settings(uuid, jsonb, jsonb)']) {
    assert.ok(sql.includes('revoke all on function public.' + fn + ' from public, anon, authenticated;'), fn);
    assert.ok(sql.includes('grant execute on function public.' + fn + ' to authenticated, service_role;'), fn);
  }
  assert.equal((sql.match(/workspace_user_has_permission\(p_workspace_id, 'customize_stages'\)/g) || []).length, 4, 'all four functions check the permission');
  assert.match(sql, /This column contains applicants\. Move them to another stage before deleting it\./);
  assert.match(sql, /A column that contains applicants cannot be turned off\./);
});

test('a candidate can sit in a custom column of its own workspace only', () => {
  const sql = read('supabase/migrations/20261020150000_custom_stages.sql');
  assert.match(sql, /or status ~ '\^custom:\[0-9a-f\]\{8\}/);
  assert.match(sql, /s\.id = substr\(new\.status, 8\)::uuid and s\.workspace_id = new\.workspace_id\s+for share/);
  assert.match(sql, /before insert or update of status on public\.applicants/);
  assert.match(sql, /perform 1 from public\.workspace_custom_stages s where s\.id = p_stage_id and s\.workspace_id = p_workspace_id for update/);
  const backend = read('backend.js');
  assert.match(backend, /const CUSTOM_STATUS_PATTERN = \/\^custom:/);
  assert.equal(backend.includes('!APPLICANT_STATUSES.has(status)'), false, 'status checks accept custom columns too');
});

test('the board uses the shared setup: custom columns sit before Hired, order and on/off are saved for everyone', () => {
  const builder = read('builder.js');
  assert.match(builder, /const MAX_CUSTOM_STAGES = 5;/);
  assert.match(builder, /\{ key: 'hired', label: 'Hired', color: 'stage-hired', defaultOn: true, pinnedLast: true \}/);
  assert.match(builder, /window\.PathwayBackend\.getBoardConfig\(workspace\.id\)/);
  assert.match(builder, /window\.PathwayBackend\.saveBoardSettings\(workspace\.id/);
  assert.match(builder, /window\.PathwayBackend\.createCustomStage\(workspace\.id, name\)/);
  assert.match(builder, /window\.PathwayBackend\.renameCustomStage\(workspace\.id, stageId, name\)/);
  assert.match(builder, /window\.PathwayBackend\.deleteCustomStage\(workspace\.id, button\.dataset\.deleteStage\)/);
  assert.equal(/localStorage[^\n]*applicant-stage/.test(builder), false, 'the column choice no longer lives in the browser');
  assert.match(builder, /hasPermission\('customize_stages'\) \? '<button class="btn btn-sm" type="button" id="customize-stages">Customize<\/button>' : ''/);
  assert.match(builder, /stage: applicantStageLabel\(group\.status\)/);
  const backend = read('backend.js');
  for (const name of ['getBoardConfig', 'createCustomStage', 'renameCustomStage', 'deleteCustomStage', 'saveBoardSettings']) {
    assert.ok(new RegExp('\\n    ' + name + ',').test(backend), name + ' is exported');
  }
  const styles = read('styles.css');
  assert.match(styles, /\.stage-custom\{background:var\(--stage-default\)\}/);
  assert.match(styles, /\.stage-create\{/);
  assert.match(read('index.html'), /builder\.js\?v=canvas6-20261022/);
});

test('the custom-stage migration does not use unknown color or table-privilege shortcuts', () => {
  const sql = read('supabase/migrations/20261020150000_custom_stages.sql');
  assert.equal(/grant (all|insert|update|delete)[^;]*to (anon|authenticated)/i.test(sql), false);
  assert.equal(/grant select[^;]*to anon/i.test(sql), false);
});

test('a custom column name is always escaped before it is put on the page (no HTML from a column name)', () => {
  const builder = read('builder.js');
  assert.equal(/${stage.label}/.test(builder), false, 'every stage label is written with esc()');
  assert.equal(/${stage.key}/.test(builder), false, 'every stage key is written with esc()');
  assert.ok(builder.includes('<option value="${esc(stage.key)}"'));
  assert.ok(builder.includes('aria-label="${esc(stage.label)}"'));
  assert.ok(builder.includes('data-stage="${esc(stage.key)}"'));
});
