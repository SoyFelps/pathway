const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const sql = read('supabase/migrations/20261019130000_user_profiles.sql');

test('every account has a profile with a first and a last name, each person edits only their own', () => {
  assert.match(sql, /create table public\.profiles \(\s*user_id uuid primary key references auth\.users\(id\) on delete cascade/);
  assert.match(sql, /first_name text not null check \(char_length\(first_name\) between 1 and 60\)/);
  assert.match(sql, /last_name text not null check \(char_length\(last_name\) between 1 and 60\)/);
  assert.match(sql, /alter table public\.profiles enable row level security/);
  assert.match(sql, /for select to authenticated\s+using \(user_id = auth\.uid\(\)\)/);
  assert.match(sql, /for update to authenticated\s+using \(user_id = auth\.uid\(\)\) with check \(user_id = auth\.uid\(\)\)/);
  assert.match(sql, /grant update \(first_name, last_name\) on public\.profiles to authenticated/);
  assert.equal(/grant (insert|delete|all)[^;]*public\.profiles to authenticated/.test(sql), false, 'no direct insert or delete');
  assert.equal(/to anon/.test(sql), false);
});

test('existing accounts become "no name" and new accounts get the names typed at sign-up', () => {
  assert.match(sql, /select u\.id, 'no', 'name' from auth\.users u/);
  assert.match(sql, /raw_user_meta_data ->> 'first_name'/);
  assert.match(sql, /raw_user_meta_data ->> 'last_name'/);
  const handler = sql.slice(sql.indexOf('create or replace function public.handle_new_user()'), sql.indexOf('drop function public.list_workspace_people'));
  assert.ok(handler.indexOf('insert into public.profiles') < handler.indexOf("pathway_team_invite_pending"), 'invited people get a profile too');
  assert.match(handler, /insert into public\.workspaces/, 'owners still get their workspace');
});

test('the team functions also return the names', () => {
  assert.match(sql, /list_workspace_people[\s\S]*first_name text, last_name text\)/);
  assert.match(sql, /list_team_overview[\s\S]*member_since timestamptz, first_name text, last_name text\)/);
  assert.match(sql, /'firstName', p\.first_name, 'lastName', p\.last_name/);
  assert.match(sql, /revoke all on function public\.list_workspace_people\(uuid\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.list_team_overview\(uuid\) to authenticated, service_role;/);
});

test('sign-up (also by invitation) asks for first and last name and sends them along', () => {
  const auth = read('auth.js'), backend = read('backend.js');
  assert.ok(auth.includes('id="auth-first-name"') && auth.includes('id="auth-last-name"'));
  assert.ok(auth.includes('autocomplete="given-name"') && auth.includes('autocomplete="family-name"'));
  assert.ok(auth.includes("Enter your first and last name."));
  assert.ok(auth.includes('state.firstName, state.lastName'));
  assert.match(backend, /signUp: async \(email, password, workspaceName, inviteToken = '', firstName = '', lastName = ''\)/);
  assert.ok(backend.includes('pathway_team_invite_pending: true, pathway_team_invite_hash: await sha256Hex(inviteToken), first_name: firstName') && backend.includes('workspace_name: workspaceName, first_name: firstName'));
});

test('the backend reads and saves the profile and passes names through', () => {
  const backend = read('backend.js');
  assert.ok(backend.includes("from('profiles').select('first_name,last_name')"));
  assert.ok(backend.includes("from('profiles').update({ first_name: first, last_name: last })"));
  assert.ok(backend.includes('getMyProfile,') && backend.includes('updateMyProfile,'));
  assert.equal((backend.match(/user, profile,/g) || []).length, 3, 'all three signed-in session shapes carry the profile');
  assert.ok(backend.includes("firstName: person.first_name || ''") && backend.includes("firstName: row.first_name || ''"));
  assert.ok(backend.includes("firstName: String(person.firstName || '')"));
});

test('names replace e-mails in the team pickers, filters and applicant panel', () => {
  const builder = read('builder.js');
  assert.ok(builder.includes('function personName(person)') && builder.includes('function personLabel(person'));
  assert.ok(builder.includes('esc(personName(person) || person.email)') && builder.includes('class="multi-select-email"'), 'the picker shows the name with the e-mail below');
  assert.ok(builder.includes('esc(personLabel(person)) + (person.isOwner'), 'the dashboard filter lists names');
  assert.equal(builder.includes('applicant-tooltip-list'), false, 'the tooltip stays short, however many people are responsible');
  assert.ok(builder.includes('clash ? name'), 'equal names are told apart by the e-mail');
});

test('My Team always shows the e-mail, with the name above it when there is one', () => {
  const builder = read('builder.js');
  const markup = builder.slice(builder.indexOf('function teamPersonLines('), builder.indexOf('function renderMyTeamLoadingMarkup('));
  assert.ok(markup.includes('<span class="team-person-email">'));
  assert.equal((markup.match(/\$\{teamPersonLines\(/g) || []).length, 4, 'members, read-only list, own card and owner card');
  assert.ok(builder.includes("teamDirectory = await window.PathwayBackend.listTeamOverview(workspace.id)"));
});

test('Settings shows the name read-only and opens the fields only after Edit', () => {
  const builder = read('builder.js');
  assert.ok(builder.includes('id="settings-profile-edit"') && builder.includes('id="settings-profile-body"'));
  const view = builder.slice(builder.indexOf('const showProfileView ='), builder.indexOf('const showProfileForm ='));
  assert.equal(/<input|<form/.test(view), false, 'the view mode has no fields');
  const form = builder.slice(builder.indexOf('const showProfileForm ='), builder.indexOf("profileEdit.addEventListener('click', showProfileForm)"));
  assert.ok(form.includes('id="settings-first-name"') && form.includes('id="settings-last-name"') && form.includes('id="settings-profile-cancel"'));
  assert.ok(form.includes('window.PathwayBackend.updateMyProfile(first, last)'));
  assert.ok(form.includes("status.textContent = 'Enter your first and last name.'"));
  assert.ok(builder.includes('myProfile = context.profile || null;'));
});

test('changing the people responsible does not count as an unpublished change', () => {
  const builder = read('builder.js');
  assert.ok(builder.includes('const save = ({ internal = false } = {}) =>'));
  assert.ok(builder.includes("if (!internal && flow.publicationStatus === 'published' && flow.activePublishedFlowId) locallyUnpublishedFlows.add(flow);"));
  assert.ok(builder.includes('if (!internal) flow.updatedAt = new Date().toISOString();'));
  assert.ok(builder.includes('flow.responsibleIds = ids; save({ internal: true });'));
  const migration = read('supabase/migrations/20261019150000_responsible_changes_keep_updated_at.sql');
  assert.ok(migration.includes("(to_jsonb(new) - 'responsible_user_ids' - 'updated_at') = (to_jsonb(old) - 'responsible_user_ids' - 'updated_at')"));
  assert.ok(migration.includes('new.updated_at := old.updated_at;') && migration.includes('new.updated_at := now();'));
  assert.ok(migration.includes('before update on public.application_flows') && migration.includes('execute function public.set_flow_updated_at()'));
  assert.equal(/to anon/.test(migration), false);
});

test('the header shows the person\'s name, with the e-mail as tooltip, on every screen', () => {
  const builder = read('builder.js');
  assert.ok(builder.includes('function headerUserHtml()'));
  assert.ok(builder.includes("esc(name || user.email || '—')") && builder.includes('title="${esc(user.email || \'\')}"'));
  const headers = (builder.match(/\$\{headerUserHtml\(\)\}/g) || []).length;
  assert.equal(headers, 13, 'every header with a workspace uses it (one shared account menu)');
  assert.equal((builder.match(/\$\{workspaceSwitcherHtml\(\)\}/g) || []).length, headers + 0, 'and the same headers show the workspace selector');
  assert.equal(/class="workspace-name"/.test(builder), false, 'the old plain workspace name is gone from every header');
  assert.equal(/<span class="auth-user"[^>]*>\$\{esc\(user\.email/.test(builder), false, 'no header prints the e-mail directly');
  assert.ok(builder.includes("root.querySelector('.topbar .auth-user')"), 'saving the name updates the header at once');
});

test('the My Team notice for workspaces without Premium says "No team access"', () => {
  const builder = read('builder.js');
  assert.ok(builder.includes('<strong>No team access</strong>'));
  assert.equal(builder.includes('Team access is paused'), false);
});

test('Settings ends with a line linking the Terms of Use and the Privacy Policy', () => {
  const builder = read('builder.js');
  const settings = builder.slice(builder.indexOf('function renderSettings()'), builder.indexOf('window.PathwayAuth.start('));
  assert.ok(settings.includes('Legal questions? Check our <a href="legal.html#terms" target="_blank" rel="noopener">Terms of Use</a> and <a href="legal.html#privacy" target="_blank" rel="noopener">Privacy Policy</a>.'));
  assert.ok(settings.indexOf('settings-delete-account') < settings.indexOf('settings-legal-note'), 'it comes after the last card');
  const legal = read('legal.html');
  assert.ok(legal.includes('id="terms"') && legal.includes('id="privacy"'), 'the anchors exist on the legal page');
});

test('a responsible-only change also ignores the browser timestamp stored inside the flow JSON', () => {
  const sql = read('supabase/migrations/20261019200000_flow_updated_at_ignores_client_timestamp.sql');
  assert.ok(sql.includes("#- '{flow_data,updatedAt}'"), 'flow_data.updatedAt is left out of the comparison');
  assert.ok(sql.includes("- 'responsible_user_ids' - 'updated_at'"));
  assert.ok(sql.includes('new.updated_at := old.updated_at;') && sql.includes('new.updated_at := now();'));
  assert.equal(/\bgrant\b|\brevoke\b/i.test(sql.replace(/^--.*$/gm, '')), false, 'create or replace keeps the existing grants');
});
