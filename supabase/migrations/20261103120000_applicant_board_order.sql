-- Manual order of the candidate cards inside a board column.
--
-- A card's place in its column is kept in applicants.board_position (a number; smaller = higher up). NULL means "never ordered by
-- hand": such cards sit at the top, newest first (what the board did before this change), so a new candidate always shows up first.
-- Dragging a card to a spot gives the cards of that column positions 1000, 2000, ... in their new order.
-- Every application of one candidate (same job and e-mail) carries the same number, because the stage belongs to the candidate.
--
-- Who may do it: exactly who may move a candidate between stages, because the same update policy applies (permission "applicants"
-- and an active plan). The function is SECURITY INVOKER on purpose, so row level security and the column grant are enforced.
-- It never touches `status`, so the stage-change triggers (AI interview invitations, recruiting metrics) do not fire.
-- Undo: drop the function and the column (nothing else depends on them).

alter table public.applicants
  add column if not exists board_position double precision;

grant update (board_position) on public.applicants to authenticated;

create or replace function public.set_applicant_order(p_items jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'The new order is not valid.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) = 0 then
    return 0;
  end if;
  if jsonb_array_length(p_items) > 2000 then
    raise exception 'Too many cards were reordered at once.' using errcode = '22023';
  end if;

  update public.applicants a
     set board_position = v.position
    from jsonb_to_recordset(p_items) as v(id uuid, position double precision)
   where a.id = v.id
     and v.position is not null
     and v.position between 0 and 1000000000;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.set_applicant_order(jsonb) from public, anon;
grant execute on function public.set_applicant_order(jsonb) to authenticated;
