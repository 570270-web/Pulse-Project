CREATE OR REPLACE FUNCTION public.request_room_creation(
  p_token text,
  p_room_name text,
  p_visibility text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nickname text;
  v_request public.chat_room_requests%rowtype;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  if length(trim(p_room_name)) < 2
  or length(trim(p_room_name)) > 50 then
    raise exception 'INVALID_ROOM_NAME';
  end if;

  if p_visibility not in ('public', 'restricted') then
    raise exception 'INVALID_VISIBILITY';
  end if;

  insert into public.chat_room_requests (
    requester_nickname, room_name, visibility
  )
  values (
    v_nickname, trim(p_room_name), p_visibility
  )
  returning * into v_request;

  return to_jsonb(v_request);
end;
$function$;

GRANT EXECUTE ON FUNCTION public.request_room_creation(text, text, text) TO anon, authenticated;
