-- Interface language chosen by each person in Settings (plan: plano-idiomas.md, phase 1).
-- Empty (null) = follow the browser language. It belongs to the person, not to the workspace: two teammates can use
-- different languages. The candidate page does not use it (it follows the job's language).

alter table public.profiles add column if not exists ui_language text;

alter table public.profiles drop constraint if exists profiles_ui_language_check;
alter table public.profiles add constraint profiles_ui_language_check
  check (ui_language is null or ui_language in ('en', 'pt-BR', 'es'));

-- The existing policy "users update their own names" already limits updates to the person's own row;
-- the column grant lets the browser write this one column as well (names stay as they were).
grant update (ui_language) on public.profiles to authenticated;
