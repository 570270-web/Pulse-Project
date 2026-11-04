-- Fix approve_room_request: avoid ambiguous column reference
-- The RETURN TABLE column names clash with PL/pgSQL scope.
-- Solution: return a JSONB object instead of a TABLE type.
DROP FUNCTION IF EXISTS public.approve_room_request(text, uuid);

CREATE OR REPLACE FUNCTION public.approve_room_request(
  p_token text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nickname text;
  v_request public.chat_room_requests%rowtype;
  v_room_id uuid;
  v_code text;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  if not public.pulse_room_is_admin(p_token) then
    raise exception 'NOT_ADMIN';
  end if;

  select * into v_request
  from public.chat_room_requests
  where id = p_request_id;

  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'REQUEST_ALREADY_PROCESSED';
  end if;

  v_code := upper(substr(
    replace(
      encode(gen_random_bytes(6), 'hex'),
      '0123456789',
      'ABCDEFGHJKMNPQRSTUVWXYZ'
    ),
    1, 5
  ));

  insert into public.chat_rooms (name, code, visibility, owner_nickname)
  values (v_request.room_name, v_code, v_request.visibility, v_request.requester_nickname)
  returning id into v_room_id;

  insert into public.chat_room_members (room_id, nickname, role)
  values (v_room_id, v_request.requester_nickname, 'owner');

  update public.chat_room_requests
  set status = 'approved',
      reviewed_by = v_nickname,
      reviewed_at = now()
  where id = p_request_id;

  return jsonb_build_object(
    'id', v_room_id,
    'code', v_code,
    'name', v_request.room_name,
    'visibility', v_request.visibility,
    'owner_nickname', v_request.requester_nickname
  );
end;
$function$;

GRANT EXECUTE ON FUNCTION public.approve_room_request(text, uuid) TO anon, authenticated;
