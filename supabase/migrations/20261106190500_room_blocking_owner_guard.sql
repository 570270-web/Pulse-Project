-- 방장 보호 수정
--
-- chat_room_members.role 에는 'owner' 가 저장되지 않는다(제약: member/co_admin).
-- 방장 여부는 chat_rooms.owner_nickname 으로 판정해야 하므로, 그 기준으로
-- 방장·자기 자신은 차단할 수 없게 막는다.
CREATE OR REPLACE FUNCTION public.set_room_member_blocked(
  p_token text,
  p_room_id uuid,
  p_nickname text,
  p_blocked boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_caller text;
  v_owner text;
  v_caller_role text;
  v_target_role text;
  v_block boolean := coalesce(p_blocked, true);
begin
  v_caller := public.pulse_room_current_nickname(p_token);

  if v_caller is null then
    raise exception 'INVALID_SESSION';
  end if;

  select r.owner_nickname into v_owner
  from public.chat_rooms r
  where r.id = p_room_id;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  select m.role into v_target_role
  from public.chat_room_members m
  where m.room_id = p_room_id
    and m.nickname = p_nickname;

  if v_target_role is null then
    raise exception 'NOT_ROOM_MEMBER';
  end if;

  -- 자기 자신과 방장은 아무도 차단할 수 없다.
  if p_nickname = v_caller or p_nickname = v_owner then
    raise exception 'ROOM_PERMISSION_DENIED';
  end if;

  select m.role into v_caller_role
  from public.chat_room_members m
  where m.room_id = p_room_id
    and m.nickname = v_caller;

  if not (
    coalesce(public.pulse_room_is_admin(p_token), false)
    or v_owner = v_caller
    or (v_caller_role = 'co_admin' and v_target_role = 'member')
  ) then
    raise exception 'ROOM_PERMISSION_DENIED';
  end if;

  update public.chat_room_members m
     set blocked_at = case when v_block then now() else null end,
         blocked_by = case when v_block then v_caller else null end
   where m.room_id = p_room_id
     and m.nickname = p_nickname;

  return v_block;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.set_room_member_blocked(text, uuid, text, boolean) TO anon, authenticated;
