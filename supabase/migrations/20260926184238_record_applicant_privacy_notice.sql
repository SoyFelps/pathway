alter table public.applicants
  add column privacy_notice_version text not null default '2026-09-26-v1',
  add column privacy_acknowledged_at timestamptz not null default now();

alter table public.pending_applicant_submissions
  add column privacy_notice_version text not null default '2026-09-26-v1',
  add column privacy_acknowledged_at timestamptz not null default now();

create or replace function public.consume_applicant_submission_limit(p_flow_id uuid, p_client_key_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
begin
  if p_client_key_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  delete from public.applicant_submission_limits
  where window_started_at < now() - interval '1 day';

  insert into public.applicant_submission_limits (flow_id, client_key_hash, window_started_at, request_count)
  values (p_flow_id, p_client_key_hash, now(), 1)
  on conflict (flow_id, client_key_hash) do update set
    window_started_at = case
      when public.applicant_submission_limits.window_started_at < now() - interval '1 hour' then now()
      else public.applicant_submission_limits.window_started_at
    end,
    request_count = case
      when public.applicant_submission_limits.window_started_at < now() - interval '1 hour' then 1
      else public.applicant_submission_limits.request_count + 1
    end
  returning request_count into current_count;

  return current_count <= 20;
end;
$$;
revoke all on function public.consume_applicant_submission_limit(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_applicant_submission_limit(uuid, text) to service_role;
