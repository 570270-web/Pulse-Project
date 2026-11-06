-- 방 멤버 차단(강퇴)
--
-- 계정 자체는 지우지 않는다. chat_room_members 에 차단 시각을 남기고,
-- 메시지 조회/전송 RPC 가 차단된 멤버에게 ROOM_BLOCKED 를 돌려준다.
-- 사이트 관리자는 차단 대상이 되지 않는다(항상 통과).

ALTER TABLE public.chat_room_members
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_by text;

-- 이 토큰 사용자가 해당 방에서 차단되었는지
CREATE OR REPLACE FUNCTION public.pulse_room_is_blocked(p_token text, p_room_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nick text;
begin
  if coalesce(public.pulse_room_is_admin(p_token), false) then
    return false;
  end if;

  v_nick := public.pulse_room_current_nickname(p_token);

  if v_nick is null then
    return false;
  end if;

  return exists (
    select 1
    from public.chat_room_members m
    where m.room_id = p_room_id
      and m.nickname = v_nick
      and m.blocked_at is not null
  );
end;
$function$;

-- ── 메시지 기록 조회: 차단된 멤버는 막는다 ──
CREATE OR REPLACE FUNCTION public.get_room_messages(p_token text, p_room_id uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, nickname text, content text, created_at timestamp with time zone, reply_to_id uuid, deleted boolean, is_system boolean, attachment_path text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if public.pulse_room_is_blocked(p_token, p_room_id) then raise exception 'ROOM_BLOCKED'; end if;
  if not public.pulse_room_can_read(p_token, p_room_id) then raise exception 'NOT_ROOM_MEMBER'; end if;
  return query
  select m.id, m.nickname, (case when m.deleted then '' else m.content end)::text, m.created_at, m.reply_to_id,
    coalesce(m.deleted, false), coalesce(m.is_system, false),
    (case when m.deleted then null else m.attachment_path end)::text
  from public.messages as m
  where m.room_id = p_room_id and (p_before is null or m.created_at < p_before)
  order by m.created_at desc limit least(greatest(p_limit, 1), 200);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_room_messages_after(p_token text, p_room_id uuid, p_after timestamp with time zone, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, nickname text, content text, created_at timestamp with time zone, reply_to_id uuid, deleted boolean, is_system boolean, attachment_path text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if public.pulse_room_is_blocked(p_token, p_room_id) then raise exception 'ROOM_BLOCKED'; end if;
  if not public.pulse_room_can_read(p_token, p_room_id) then raise exception 'NOT_ROOM_MEMBER'; end if;
  return query
  select m.id, m.nickname, (case when m.deleted then '' else m.content end)::text, m.created_at, m.reply_to_id,
    coalesce(m.deleted, false), coalesce(m.is_system, false),
    (case when m.deleted then null else m.attachment_path end)::text
  from public.messages as m
  where m.room_id = p_room_id and m.created_at > p_after
  order by m.created_at asc limit least(greatest(p_limit, 1), 200);
end;
$function$;

-- ── 메시지 전송: 차단된 멤버는 막는다 ──
CREATE OR REPLACE FUNCTION public.send_message(p_token text, p_content text, p_room_id uuid DEFAULT NULL::uuid, p_reply_to_id uuid DEFAULT NULL::uuid, p_attachment_path text DEFAULT NULL::text)
 RETURNS messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_profile public.profiles%ROWTYPE;
v_member_count int;
v_message public.messages%ROWTYPE;
v_recent_count int;
v_oldest_ts timestamptz;
v_wait_secs int;
v_content text := coalesce(p_content, '');
v_attachment text := nullif(btrim(coalesce(p_attachment_path, '')), '');
BEGIN
SELECT p.* INTO v_profile FROM public.profiles p JOIN public.sessions s ON s.profile_id = p.id WHERE s.token = p_token;
IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
IF p_room_id IS NOT NULL AND public.pulse_room_is_blocked(p_token, p_room_id) THEN RAISE EXCEPTION 'ROOM_BLOCKED'; END IF;
UPDATE public.profiles SET last_active_at = now() WHERE id = v_profile.id;
UPDATE public.sessions SET last_used_at = now() WHERE token = p_token;
SELECT count(*), min(created_at) INTO v_recent_count, v_oldest_ts FROM public.messages WHERE profile_id = v_profile.id AND created_at > now() - interval '60 seconds';
IF v_recent_count >= 60 THEN
v_wait_secs := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_oldest_ts + interval '60 seconds' - now()))));
RAISE EXCEPTION 'RATE_LIMIT_EXCEEDED:%', v_wait_secs;
END IF;
IF p_room_id IS NOT NULL THEN
SELECT count(*) INTO v_member_count FROM public.chat_room_members WHERE room_id = p_room_id AND nickname = v_profile.nickname;
IF v_member_count = 0 THEN RAISE EXCEPTION 'NOT_ROOM_MEMBER'; END IF;
END IF;
IF v_attachment IS NOT NULL THEN
IF p_room_id IS NULL OR v_attachment !~ ('^' || p_room_id::text || '/[0-9]{9,12}/[0-9a-f]{64}/[A-Za-z0-9_-]{1,80}\.[A-Za-z0-9]{2,5}$') THEN
RAISE EXCEPTION 'INVALID_ATTACHMENT';
END IF;
END IF;
IF v_attachment IS NULL AND btrim(v_content) = '' THEN RAISE EXCEPTION 'INVALID_MESSAGE_CONTENT'; END IF;
INSERT INTO public.messages (profile_id, nickname, content, room_id, reply_to_id, attachment_path)
VALUES (v_profile.id, v_profile.nickname, v_content, p_room_id, p_reply_to_id, v_attachment)
RETURNING * INTO v_message;
RETURN v_message;
END;
$function$;

-- ── 읽음 기록: 차단된 멤버는 읽음으로 남기지 않는다 ──
CREATE OR REPLACE FUNCTION public.mark_room_read(p_token text, p_room_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nickname text;
  v_at timestamp with time zone := clock_timestamp();
begin
  select p.nickname into v_nickname
  from public.profiles p
  join public.sessions s on s.profile_id = p.id
  where s.token = p_token;

  if v_nickname is null then
    raise exception 'INVALID_SESSION';
  end if;

  if public.pulse_room_is_blocked(p_token, p_room_id) then
    raise exception 'ROOM_BLOCKED';
  end if;

  if not public.pulse_room_can_read(p_token, p_room_id) then
    raise exception 'NOT_ROOM_MEMBER';
  end if;

  update public.chat_room_members m
     set last_read_at = v_at
   where m.room_id = p_room_id
     and m.nickname = v_nickname
     and (m.last_read_at is null or m.last_read_at < v_at);

  return v_at;
end;
$function$;

-- ── 멤버 목록: 차단 여부를 함께 돌려준다 (반환 타입 변경이라 재생성) ──
DROP FUNCTION IF EXISTS public.get_room_members(text, uuid);

CREATE FUNCTION public.get_room_members(p_token text, p_room_id uuid)
 RETURNS TABLE(nickname text, role text, joined_at timestamp with time zone, blocked boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.pulse_room_can_read(p_token, p_room_id) then
    raise exception 'NOT_ROOM_MEMBER';
  end if;

  return query
  select
    m.nickname,
    (case when r.owner_nickname = m.nickname then 'owner' else m.role end)::text,
    m.joined_at,
    (m.blocked_at is not null)
  from public.chat_room_members m
  join public.chat_rooms r on r.id = m.room_id
  where m.room_id = p_room_id
  order by
    (r.owner_nickname = m.nickname) desc,
    (m.role = 'co_admin') desc,
    m.joined_at asc;
end;
$function$;

-- ── 차단 / 해제 ──
-- 권한: 사이트 관리자, 방장은 누구나(방장 제외), 부방장은 일반 멤버만.
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

  if p_nickname = v_caller or v_target_role = 'owner' then
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
GRANT EXECUTE ON FUNCTION public.pulse_room_is_blocked(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_room_members(text, uuid) TO anon, authenticated;
