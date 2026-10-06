-- The initial table migration created an unnamed logo_path check constraint
-- (workspace_companies_check) that only accepts /logo.<ext>. Company edits now
-- use unique /logo-<uuid>.<ext> paths, validated by the newer named constraint.
-- Remove the obsolete check; workspace_companies_logo_path_check remains enforced.
alter table public.workspace_companies
  drop constraint if exists workspace_companies_check;
