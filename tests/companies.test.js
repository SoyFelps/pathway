const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const migrationPath = 'supabase/migrations/20261005180004_workspace_companies_and_logos.sql';

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

test('candidate page shows the selected company logo and description below vacancy details', () => {
  const candidate = read('candidate.js');
  const lockup = candidate.indexOf('class="company-lockup"');
  const about = candidate.indexOf('class="company-details"');
  const apply = candidate.indexOf('class="job-about"');
  assert.ok(lockup >= 0 && about > lockup && apply > about);
  assert.match(candidate, /safeCompanyLogoUrl\(flow\.companyProfile\?\.logoUrl/);
  assert.match(candidate, /class="company-avatar\$\{logoUrl \? ' has-logo'/);
  assert.match(candidate, /<h2>About \$\{C\.esc\(brandName\)\}<\/h2>/);
  assert.match(candidate, /PATHWAY_SUPABASE_CONFIG\?\.url/);
  assert.match(candidate, /company-logos/);
});
