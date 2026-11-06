const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const migrationPath = 'supabase/migrations/20261005180004_workspace_companies_and_logos.sql';
const managementMigrationPath = 'supabase/migrations/20261005183104_manage_workspace_companies.sql';
const policyFixMigrationPath = 'supabase/migrations/20261006113046_fix_company_logo_storage_policies.sql';
const legacyLogoConstraintMigrationPath = 'supabase/migrations/20261006114843_drop_legacy_company_logo_constraint.sql';

test('company profiles are workspace-scoped and capped at three by a serialized database trigger', () => {
  const migration = read(migrationPath);
  assert.match(migration, /create table if not exists public\.workspace_companies/i);
  assert.match(migration, /workspace_id uuid not null references public\.workspaces\(id\) on delete cascade/i);
  assert.match(migration, /created_by uuid default auth\.uid\(\) references auth\.users\(id\) on delete set null/i);
  assert.match(migration, /workspace_user_has_permission\(workspace_id, 'flows'\)/);
  assert.match(migration, /created_by = \(select auth\.uid\(\)\)/);
  assert.match(migration, /enforce_workspace_companies_limit/);
  assert.match(migration, /for update/);
  assert.match(migration, /count\(\*\).*workspace_companies[\s\S]*?>= 3/);
  assert.match(migration, /add column if not exists company_id uuid references public\.workspace_companies\(id\)/);
  assert.match(migration, /validate_flow_company_workspace/);
});

test('legacy logo check is removed while the UUID-compatible logo path check remains enforced', () => {
  const migration = read(legacyLogoConstraintMigrationPath);
  const managementMigration = read(managementMigrationPath);
  assert.match(migration, /drop constraint if exists workspace_companies_check/i);
  assert.match(managementMigration, /add constraint workspace_companies_logo_path_check[\s\S]*?logo\(-\[0-9a-f\]\{8\}/i);
});

test('logo bucket limits files to 2 MB and secure formats with workspace permission policies', () => {
  const migration = read(migrationPath);
  const backend = read('backend.js');
  const builder = read('builder.js');
  assert.match(migration, /'company-logos',[\s\S]*?true, 2097152, array\['image\/png', 'image\/jpeg', 'image\/webp'\]/);
  assert.match(migration, /workspace flow managers can upload company logos/);
  assert.match(migration, /workspace flow managers can delete company logos/);
  assert.match(migration, /name ~ \('\^' \|\| c\.workspace_id::text \|\| '\/' \|\| c\.id::text \|\| '\/logo\\\.\(png\|jpg\|webp\)\$'\)/);
  assert.match(migration, /workspace_user_has_permission\(c\.workspace_id, 'flows'\)/);
  assert.match(backend, /logoFile\.size > 2 \* 1024 \* 1024/);
  assert.match(backend, /'image\/png', 'image\/jpeg', 'image\/webp'/);
  assert.match(backend, /bucket\.upload\(logoPath, logoFile/);
  assert.match(builder, /Maximum 2 MB/);
});

test('My Companies page lists profiles, creates them, and selects a profile on flows', () => {
  const builder = read('builder.js');
  const backend = read('backend.js');
  assert.match(builder, /data-route="my-companies"/);
  assert.match(builder, /function renderMyCompanies\(\)/);
  assert.match(builder, /companies\.length >= 3/);
  assert.match(builder, /window\.PathwayBackend\.createCompany/);
  assert.match(builder, /new-company-id/);
  assert.match(builder, /companyOptionsHtml\(flow\.companyId/);
  assert.match(builder, /flow\.companyProfile = companySnapshot\(company\)/);
  assert.match(builder, /C\.createFlow\(company\?\.name \|\| workspace\.name/);
  assert.match(backend, /async function listCompanies\(workspaceId\)/);
  assert.match(backend, /\.limit\(3\)/);
  assert.match(backend, /async function createCompany\(input, workspace\)/);
  assert.match(backend, /company_id: companyId \|\| null/);
});

test('company cards have fixed height and truncate long descriptions', () => {
  const builder = read('builder.js');
  const styles = read('styles.css');
  assert.match(builder, /<p title="\$\{esc\(company\.description\)\}">\$\{esc\(company\.description\)\}<\/p>/);
  assert.match(styles, /\.company-card\{[^}]*height:260px;[^}]*display:flex;[^}]*flex-direction:column/);
  assert.match(styles, /\.company-card>p\{[^}]*-webkit-line-clamp:4[^}]*overflow:hidden/);
  assert.match(styles, /\.company-card-actions\{[^}]*margin-top:auto/);
});

test('edit modal defers logo removal until save and offers the confirmed company delete flow', () => {
  const builder = read('builder.js');
  const styles = read('styles.css');
  assert.match(builder, /id="remove-company-logo" type="button" aria-label="\$\{t\('Remove current logo'\)\}"/);
  assert.match(builder, /name="removeLogo" value="false"/);
  assert.match(builder, /id="company-logo-removal-pending" hidden/);
  assert.match(builder, /removeLogoInput\.value = 'true'/);
  assert.match(builder, /removeLogo: form\.elements\.removeLogo\?\.value === 'true'/);
  assert.match(builder, /id="restore-company-logo" type="button"/);
  assert.match(builder, /id="delete-company-from-edit" type="button">' \+ t\('Delete'\)/);
  assert.match(builder, /addEventListener\('click', \(\) => showDeleteCompany\(company\)\)/);
  assert.match(styles, /\.company-logo-remove\{[^}]*color:var\(--red\)/);
  assert.match(styles, /\.company-edit-actions \.company-delete-from-edit\{[^}]*margin-right:auto/);
});

test('company edits propagate atomically to linked drafts and active published snapshots', () => {
  const migration = read(managementMigrationPath);
  const backend = read('backend.js');
  const builder = read('builder.js');
  const styles = read('styles.css');
  assert.match(migration, /function public\.update_workspace_company_profile/i);
  assert.match(migration, /security definer[\s\S]*workspace_user_has_permission\(v_company\.workspace_id, 'flows'\)/);
  assert.match(migration, /update public\.application_flows f[\s\S]*company_name = v_company\.name[\s\S]*'\{companyProfile\}', v_profile/);
  assert.match(migration, /update public\.published_flows pf[\s\S]*active_published_flow_id = pf\.id/);
  assert.match(migration, /'logoPath', v_company\.logo_path/);
  assert.match(backend, /async function updateCompany\(input, company, workspace\)/);
  assert.match(backend, /rpc\('update_workspace_company_profile'/);
  assert.match(builder, /window\.PathwayBackend\.updateCompany/);
  assert.match(builder, /Company updated in its linked flows/);
  assert.match(styles, /\.company-card-actions/);
  assert.match(read('index.html'), /builder\.js\?v=mw3-20261106b/);
  assert.match(read('apply.html'), /candidate\.js\?v=mw3-20261106b/);
});

test('company deletion requires all linked flows removed first and the UI confirms candidate-data loss', () => {
  const migration = read(managementMigrationPath);
  const backend = read('backend.js');
  const builder = read('builder.js');
  const appFunction = read('supabase/functions/applications/index.ts');
  assert.match(migration, /function public\.delete_workspace_company/i);
  assert.match(migration, /workspace_user_has_permission\(v_workspace_id, 'flows'\)/);
  assert.match(migration, /if exists \(select 1 from public\.application_flows where company_id = p_company_id\)/);
  assert.match(backend, /async function deleteCompany\(company, workspace, linkedFlows/);
  assert.match(backend, /await deleteFlow\(flow, workspace\)/);
  assert.match(backend, /rpc\('delete_workspace_company'/);
  assert.match(backend, /failure\.deletedFlowIds = deletedFlowIds/);
  assert.match(appFunction, /async function deleteFlowForOwner/);
  assert.match(appFunction, /applicant-resumes|const BUCKET = "applicant-resumes"/);
  assert.match(builder, /all candidate applications and answers, uploaded resumes, and their public job links/);
  assert.match(builder, /t\('Type \{name\} to confirm', \{ name: '<strong>' \+ esc\(company\.name\) \+ '<\/strong>' \}\)/);
  assert.match(builder, /const deleteLabel = linkedFlows\.length \? t\('Delete company and jobs'\) : t\('Delete company'\);/);
});

test('company Storage policies qualify the outer object path instead of shadowed company name', () => {
  const migration = read(policyFixMigrationPath);
  assert.equal((migration.match(/storage\.foldername\(objects\.name\)/g) || []).length, 4);
  assert.match(migration, /objects\.name ~/);
  assert.match(migration, /workspace_user_has_permission\(c\.workspace_id, 'flows'\)/);
  assert.doesNotMatch(migration, /storage\.foldername\(name\)/);
});

test('candidate page shows the selected company logo in the header and the description below vacancy details', () => {
  const candidate = read('candidate.js');
  const styles = read('styles.css');
  const lockup = candidate.indexOf('class="company-lockup"');
  const about = candidate.indexOf('class="company-details"');
  const apply = candidate.indexOf('class="job-about"');
  assert.ok(lockup >= 0 && about > lockup && apply > about);
  assert.match(candidate, /safeCompanyLogoUrl\(profile\?\.logoUrl/);
  assert.match(candidate, /\$\{logoUrl \? `<span class="candidate-header-divider" aria-hidden="true"><\/span><img class="candidate-header-logo"/, 'logo in the header, after the Pathway brand, only when there is one');
  assert.equal(candidate.includes('company-avatar'), false, 'no logo box in the job details any more');
  assert.equal(candidate.includes('Careers'), false);
  assert.match(candidate, /<h2>\$\{t\('About \{company\}', \{ company: C\.esc\(brandName\) \}\)\}<\/h2>/);
  assert.match(candidate, /PATHWAY_SUPABASE_CONFIG\?\.url/);
  assert.match(candidate, /company-logos/);
  assert.match(candidate, /function companyLogoUrl\(profile\)/);
  assert.match(candidate, /profile\?\.logoPath/);
  assert.match(styles, /\.candidate-header-logo\{height:36px;/);
});

test('a company can have an optional primary colour that is stored, edited and sent to Witcher', () => {
  const migration = read('supabase/migrations/20261103100000_company_primary_color.sql');
  assert.match(migration, /add column if not exists primary_color text/i);
  assert.match(migration, /primary_color is null or primary_color ~ '\^#\[0-9a-f\]\{6\}\$'/i, 'only #rrggbb or nothing');
  assert.match(migration, /p_primary_color text/i);
  assert.match(migration, /revoke all on function public\.update_workspace_company_profile\(uuid, text, text, text, text\) from public, anon;/i);
  assert.match(migration, /grant execute on function public\.update_workspace_company_profile\(uuid, text, text, text, text\) to authenticated;/i);
  assert.doesNotMatch(migration, /drop function/i, 'the 4-argument function stays so the live site keeps working until the new site is published');
  const backend = read('backend.js');
  assert.match(backend, /function companyColor\(value\)/);
  assert.match(backend, /primary_color: primaryColor/);
  assert.match(backend, /p_primary_color: primaryColor/);
  assert.match(backend, /primaryColor: row\.primary_color \|\| ''/);
  const builder = read('builder.js');
  assert.match(builder, /type="color"/);
  assert.match(builder, /name="primaryColor"/);
  assert.equal((builder.match(/\$\{companyFieldsHtml\(/g) || []).length, 2, 'the new and the edit form share the same fields');
  assert.match(builder, /id="company-logo-picker"\$\{hasLogo \? ' hidden' : ''\}/, 'with a logo, the file chooser stays hidden until the logo is removed');
  assert.match(builder, /logoPicker\.hidden = false;/);
  assert.match(builder, /class="company-link-btn" type="button" id="company-color-reset"/, 'Use default is plain text, not a bordered button');
  assert.match(builder, /primaryColor: form\.elements\.primaryColor\.value/);
  const webhook = read('supabase/functions/ai-interview-webhook/index.ts');
  assert.match(webhook, /select\("name,logo_path,primary_color"\)/);
  assert.match(webhook, /color: company\?\.primary_color \?\? null/);
});

test('a chosen logo file shows a preview with a remove button instead of the file name, and only then can another be chosen', () => {
  const builder = read('builder.js');
  assert.match(builder, /id="company-logo-chosen" hidden/);
  assert.match(builder, /id="clear-company-logo" type="button" aria-label="\$\{t\('Remove selected logo'\)\}"/);
  assert.match(builder, /URL\.createObjectURL\(file\)/);
  assert.match(builder, /URL\.revokeObjectURL\(previewUrl\)/, 'the preview address is released');
  assert.match(builder, /picker\.classList\.toggle\('has-file', Boolean\(file\)\)/);
  assert.doesNotMatch(builder, /company-file-name|No file chosen/, 'no file name is shown any more');
  assert.match(read('styles.css'), /\.company-logo-picker\.has-file \.company-file-btn\{display:none\}/, 'the chooser is hidden while a file is chosen');
});
