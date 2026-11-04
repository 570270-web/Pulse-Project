-- =====================================================================
-- 1. send_message: with room_id and reply_to_id support
-- =====================================================================
CREATE OR REPLACE FUNCTION public.send_message(
  p_token text,
  p_content text,
  p_room_id uuid DEFAULT NULL,
  p_reply_to_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_member_count int;
BEGIN
  SELECT p.* INTO v_profile
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_SESSION';
  END IF;

  UPDATE public.profiles SET last_active_at = now() WHERE id = v_profile.id;
  UPDATE public.sessions SET last_used_at = now() WHERE token = p_token;

  IF p_room_id IS NOT NULL THEN
    SELECT count(*) INTO v_member_count
    FROM public.chat_room_members
    WHERE room_id = p_room_id
      AND nickname = v_profile.nickname;

    IF v_member_count = 0 THEN
      RAISE EXCEPTION 'NOT_ROOM_MEMBER';
    END IF;
  END IF;

  INSERT INTO public.messages (profile_id, nickname, content, room_id, reply_to_id)
  VALUES (v_profile.id, v_profile.nickname, p_content, p_room_id, p_reply_to_id);
END;
$function$;

-- =====================================================================
-- 2. leave_room: returns 'left' | 'room_deleted' | 'admin'
-- =====================================================================
CREATE OR REPLACE FUNCTION public.leave_room(
  p_token text,
  p_room_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nickname text;
  v_owner text;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  if public.pulse_room_is_admin(p_token) then
    return 'admin';
  end if;

  select owner_nickname into v_owner
  from public.chat_rooms
  where chat_rooms.id = p_room_id;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if v_owner = v_nickname then
    delete from public.chat_room_members where room_id = p_room_id;
    delete from public.messages where room_id = p_room_id;
    delete from public.chat_rooms where id = p_room_id;
    return 'room_deleted';
  end if;

  delete from public.chat_room_members
  where room_id = p_room_id
    and nickname = v_nickname;

  return 'left';
end;
$function$;

-- =====================================================================
-- 3. list_admin_rooms: use chat_rooms tables
-- =====================================================================
CREATE OR REPLACE FUNCTION public.list_admin_rooms(p_token text)
RETURNS TABLE(
  id uuid,
  code text,
  name text,
  visibility text,
  created_at timestamp with time zone,
  created_by text,
  owner_nickname text,
  member_count bigint,
  message_count bigint,
  password_set boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nickname text;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  if not public.pulse_room_is_admin(p_token) then
    raise exception 'NOT_ADMIN';
  end if;

  return query
  select
    r.id,
    r.code,
    r.name,
    r.visibility,
    r.created_at,
    r.owner_nickname as created_by,
    r.owner_nickname,
    (select count(*) from public.chat_room_members m where m.room_id = r.id),
    (select count(*) from public.messages msg where msg.room_id = r.id),
    (r.password_hash is not null and r.password_hash <> '')
  from public.chat_rooms r
  order by r.created_at desc;
end;
$function$;

-- =====================================================================
-- 4. list_public_rooms: with role
-- =====================================================================
CREATE OR REPLACE FUNCTION public.list_public_rooms(p_token text)
RETURNS TABLE(
  id uuid,
  name text,
  code text,
  visibility text,
  owner_nickname text,
  created_at timestamp with time zone,
  member_count bigint,
  role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nickname text;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  return query
  select
    r.id,
    r.name,
    r.code,
    r.visibility,
    r.owner_nickname,
    r.created_at,
    (select count(*) from public.chat_room_members m where m.room_id = r.id) as member_count,
    m.role
  from public.chat_rooms r
  left join public.chat_room_members m
    on m.room_id = r.id
    and m.nickname = v_nickname
  where r.visibility = 'public'
  order by r.created_at desc;
end;
$function$;

-- =====================================================================
-- 5. find_room_by_code: with role
-- =====================================================================
CREATE OR REPLACE FUNCTION public.find_room_by_code(
  p_token text,
  p_code text
)
RETURNS TABLE(
  id uuid,
  name text,
  code text,
  visibility text,
  owner_nickname text,
  created_at timestamp with time zone,
  member_count bigint,
  role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nickname text;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  return query
  select
    r.id,
    r.name,
    r.code,
    r.visibility,
    r.owner_nickname,
    r.created_at,
    (select count(*) from public.chat_room_members m where m.room_id = r.id) as member_count,
    m.role
  from public.chat_rooms r
  left join public.chat_room_members m
    on m.room_id = r.id
    and m.nickname = v_nickname
  where r.code = upper(trim(p_code))
  limit 1;
end;
$function$;

-- =====================================================================
-- 6. get_joined_rooms
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_joined_rooms(p_token text)
RETURNS TABLE(
  room_id uuid,
  code text,
  name text,
  visibility text,
  role text,
  joined_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nickname text;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  return query
  select
    r.id as room_id,
    r.code,
    r.name,
    r.visibility,
    m.role,
    m.joined_at
  from public.chat_room_members m
  join public.chat_rooms r on r.id = m.room_id
  where m.nickname = v_nickname
  order by m.joined_at desc;
end;
$function$;

-- =====================================================================
-- 7. join_room(p_token, p_room_code, p_room_password)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.join_room(
  p_token text,
  p_room_code text,
  p_room_password text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  code text,
  name text,
  visibility text,
  role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nickname text;
  v_room public.chat_rooms%rowtype;
  v_existing_role text;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  select * into v_room
  from public.chat_rooms
  where code = upper(trim(p_room_code));

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  select role into v_existing_role
  from public.chat_room_members
  where room_id = v_room.id
    and nickname = v_nickname;

  if found then
    return query
    select v_room.id, v_room.code, v_room.name, v_room.visibility, v_existing_role;
    return;
  end if;

  if v_room.visibility = 'restricted' then
    if p_room_password is null or p_room_password = '' then
      raise exception 'INVALID_ROOM_PASSWORD';
    end if;

    if v_room.password_hash is null
       or v_room.password_hash = ''
       or v_room.password_hash <> crypt(p_room_password, v_room.password_hash) then
      raise exception 'INVALID_ROOM_PASSWORD';
    end if;
  end if;

  insert into public.chat_room_members (room_id, nickname, role)
  values (v_room.id, v_nickname, 'member');

  return query
  select v_room.id, v_room.code, v_room.name, v_room.visibility, 'member'::text;
end;
$function$;

-- =====================================================================
-- 8. get_room_messages
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_room_messages(
  p_token text,
  p_room_id uuid,
  p_before timestamp with time zone DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS TABLE(
  id uuid,
  nickname text,
  content text,
  created_at timestamp with time zone,
  reply_to_id uuid,
  deleted boolean,
  is_system boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nickname text;
  v_is_member boolean;
  v_is_admin boolean;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);
  v_is_admin := public.pulse_room_is_admin(p_token);

  select exists(
    select 1 from public.chat_room_members
    where room_id = p_room_id
      and nickname = v_nickname
  ) into v_is_member;

  if not v_is_member and not v_is_admin then
    raise exception 'NOT_ROOM_MEMBER';
  end if;

  return query
  select
    m.id,
    m.nickname,
    m.content,
    m.created_at,
    m.reply_to_id,
    m.deleted,
    m.is_system
  from public.messages m
  where m.room_id = p_room_id
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit least(p_limit, 200);
end;
$function$;

-- =====================================================================
-- 9. edit_message
-- =====================================================================
CREATE OR REPLACE FUNCTION public.edit_message(
  p_token text,
  p_message_id uuid,
  p_content text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_profile public.profiles%ROWTYPE;
  v_message public.messages%ROWTYPE;
begin
  select p.* into v_profile
  from public.profiles p
  join public.sessions s on s.profile_id = p.id
  where s.token = p_token;

  if not found then
    raise exception 'INVALID_SESSION';
  end if;

  select * into v_message
  from public.messages
  where id = p_message_id;

  if not found then
    raise exception 'MESSAGE_NOT_FOUND';
  end if;

  if v_message.profile_id <> v_profile.id
     and not v_profile.is_admin then
    raise exception 'MESSAGE_NOT_OWNED';
  end if;

  if v_message.deleted then
    raise exception 'MESSAGE_DELETED';
  end if;

  if length(trim(p_content)) = 0 then
    raise exception 'INVALID_MESSAGE_CONTENT';
  end if;

  update public.messages
  set content = p_content
  where id = p_message_id;
end;
$function$;

-- =====================================================================
-- 10. delete_message (soft delete)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.delete_message(
  p_token text,
  p_message_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_profile public.profiles%ROWTYPE;
  v_message public.messages%ROWTYPE;
begin
  select p.* into v_profile
  from public.profiles p
  join public.sessions s on s.profile_id = p.id
  where s.token = p_token;

  if not found then
    raise exception 'INVALID_SESSION';
  end if;

  select * into v_message
  from public.messages
  where id = p_message_id;

  if not found then
    raise exception 'MESSAGE_NOT_FOUND';
  end if;

  if v_message.profile_id <> v_profile.id
     and not v_profile.is_admin then
    raise exception 'MESSAGE_NOT_OWNED';
  end if;

  update public.messages
  set deleted = true,
      content = ''
  where id = p_message_id;
end;
$function$;

-- =====================================================================
-- 11. change_account_password
-- =====================================================================
CREATE OR REPLACE FUNCTION public.change_account_password(
  p_token text,
  p_current_password text,
  p_new_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_profile public.profiles%ROWTYPE;
begin
  select p.* into v_profile
  from public.profiles p
  join public.sessions s on s.profile_id = p.id
  where s.token = p_token;

  if not found then
    raise exception 'INVALID_SESSION';
  end if;

  if v_profile.password_hash <> crypt(p_current_password, v_profile.password_hash) then
    raise exception 'INVALID_CURRENT_PASSWORD';
  end if;

  if length(p_new_password) < 4 then
    raise exception 'PASSWORD_TOO_SHORT';
  end if;

  update public.profiles
  set password_hash = crypt(p_new_password, gen_salt('bf'))
  where id = v_profile.id;
end;
$function$;

-- =====================================================================
-- 12. admin_reset_account_password
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_reset_account_password(
  p_token text,
  p_target_nickname text,
  p_new_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_admin public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
begin
  select p.* into v_admin
  from public.profiles p
  join public.sessions s on s.profile_id = p.id
  where s.token = p_token;

  if not found or v_admin.is_admin is not true then
    raise exception 'NOT_ADMIN';
  end if;

  if length(p_new_password) < 4 then
    raise exception 'PASSWORD_TOO_SHORT';
  end if;

  select * into v_target
  from public.profiles
  where nickname = trim(p_target_nickname);

  if not found then
    raise exception 'NICKNAME_NOT_FOUND';
  end if;

  update public.profiles
  set password_hash = crypt(p_new_password, gen_salt('bf'))
  where id = v_target.id;
end;
$function$;

-- =====================================================================
-- 13. approve_room_request
-- =====================================================================
CREATE OR REPLACE FUNCTION public.approve_room_request(
  p_token text,
  p_request_id uuid
)
RETURNS TABLE(
  id uuid,
  code text,
  name text,
  visibility text,
  owner_nickname text
)
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

  return query
  select v_room_id, v_code, v_request.room_name, v_request.visibility, v_request.requester_nickname;
end;
$function$;

-- =====================================================================
-- 14. reject_room_request
-- =====================================================================
CREATE OR REPLACE FUNCTION public.reject_room_request(
  p_token text,
  p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nickname text;
  v_request public.chat_room_requests%rowtype;
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

  update public.chat_room_requests
  set status = 'rejected',
      reviewed_by = v_nickname,
      reviewed_at = now()
  where id = p_request_id;
end;
$function$;

-- =====================================================================
-- 15. admin_delete_room
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_delete_room(
  p_token text,
  p_room_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nickname text;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  if not public.pulse_room_is_admin(p_token) then
    raise exception 'NOT_ADMIN';
  end if;

  if not exists(select 1 from public.chat_rooms where id = p_room_id) then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  delete from public.chat_room_members where room_id = p_room_id;
  delete from public.messages where room_id = p_room_id;
  delete from public.chat_rooms where id = p_room_id;
end;
$function$;

-- =====================================================================
-- 16. admin_clear_room_messages
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_clear_room_messages(
  p_token text,
  p_room_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nickname text;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  if not public.pulse_room_is_admin(p_token) then
    raise exception 'NOT_ADMIN';
  end if;

  if not exists(select 1 from public.chat_rooms where id = p_room_id) then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  delete from public.messages where room_id = p_room_id;
end;
$function$;

-- =====================================================================
-- 17. list_my_rooms: with role
-- =====================================================================
CREATE OR REPLACE FUNCTION public.list_my_rooms(p_token text)
RETURNS TABLE(
  id uuid,
  name text,
  code text,
  visibility text,
  owner_nickname text,
  created_at timestamp with time zone,
  member_count bigint,
  role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nickname text;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  return query
  select
    r.id,
    r.name,
    r.code,
    r.visibility,
    r.owner_nickname,
    r.created_at,
    count(m.nickname) as member_count,
    mine.role
  from public.chat_rooms r
  join public.chat_room_members mine
    on mine.room_id = r.id
    and mine.nickname = v_nickname
  left join public.chat_room_members m
    on m.room_id = r.id
  group by r.id, mine.role
  order by r.created_at desc;
end;
$function$;

-- =====================================================================
-- 18. admin_list_room_requests: return table type
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_list_room_requests(p_token text)
RETURNS TABLE(
  id uuid,
  requester_nickname text,
  room_name text,
  visibility text,
  status text,
  rejection_reason text,
  reviewed_by text,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.pulse_room_current_nickname(p_token);

  if not public.pulse_room_is_admin(p_token) then
    raise exception 'NOT_ADMIN';
  end if;

  return query
  select
    r.id,
    r.requester_nickname,
    r.room_name,
    r.visibility,
    r.status,
    r.rejection_reason,
    r.reviewed_by,
    r.reviewed_at,
    r.created_at
  from public.chat_room_requests r
  order by r.created_at asc;
end;
$function$;

-- =====================================================================
-- 19. list_my_room_requests: return table type
-- =====================================================================
CREATE OR REPLACE FUNCTION public.list_my_room_requests(p_token text)
RETURNS TABLE(
  id uuid,
  requester_nickname text,
  room_name text,
  visibility text,
  status text,
  rejection_reason text,
  reviewed_by text,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nickname text;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  return query
  select
    r.id,
    r.requester_nickname,
    r.room_name,
    r.visibility,
    r.status,
    r.rejection_reason,
    r.reviewed_by,
    r.reviewed_at,
    r.created_at
  from public.chat_room_requests r
  where r.requester_nickname = v_nickname
  order by r.created_at desc;
end;
$function$;

-- =====================================================================
-- 20. join_public_room
-- =====================================================================
CREATE OR REPLACE FUNCTION public.join_public_room(
  p_token text,
  p_room_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nickname text;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  if not exists(
    select 1 from public.chat_rooms
    where id = p_room_id and visibility = 'public'
  ) then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if exists(
    select 1 from public.chat_room_members
    where room_id = p_room_id and nickname = v_nickname
  ) then
    return true;
  end if;

  insert into public.chat_room_members (room_id, nickname, role)
  values (p_room_id, v_nickname, 'member');

  return true;
end;
$function$;

-- =====================================================================
-- 21. join_restricted_room
-- =====================================================================
CREATE OR REPLACE FUNCTION public.join_restricted_room(
  p_token text,
  p_room_id uuid,
  p_password text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nickname text;
  v_room public.chat_rooms%rowtype;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  select * into v_room
  from public.chat_rooms
  where id = p_room_id and visibility = 'restricted';

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if exists(
    select 1 from public.chat_room_members
    where room_id = p_room_id and nickname = v_nickname
  ) then
    return true;
  end if;

  if v_room.password_hash is null
     or v_room.password_hash = ''
     or v_room.password_hash <> crypt(p_password, v_room.password_hash) then
    raise exception 'INVALID_ROOM_PASSWORD';
  end if;

  insert into public.chat_room_members (room_id, nickname, role)
  values (p_room_id, v_nickname, 'member');

  return true;
end;
$function$;

-- =====================================================================
-- 22. change_room_password
-- =====================================================================
CREATE OR REPLACE FUNCTION public.change_room_password(
  p_token text,
  p_room_id uuid,
  p_new_password text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nickname text;
  v_owner text;
  v_role text;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  if p_new_password is null
     or length(p_new_password) < 4
     or length(p_new_password) > 128 then
    raise exception 'INVALID_ROOM_PASSWORD_LENGTH';
  end if;

  select owner_nickname into v_owner
  from public.chat_rooms
  where chat_rooms.id = p_room_id;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  select role into v_role
  from public.chat_room_members
  where room_id = p_room_id
    and nickname = v_nickname;

  if v_owner <> v_nickname
     and coalesce(v_role, '') <> 'co_admin'
     and not public.pulse_room_is_admin(p_token) then
    raise exception 'ROOM_PERMISSION_DENIED';
  end if;

  update public.chat_rooms
  set password_hash = crypt(p_new_password, gen_salt('bf'))
  where id = p_room_id
    and visibility = 'restricted';

  return true;
end;
$function$;

-- =====================================================================
-- Grants
-- =====================================================================
GRANT EXECUTE ON FUNCTION public.send_message(text, text, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leave_room(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_rooms(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_rooms(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_room_by_code(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_joined_rooms(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_room(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_room_messages(text, uuid, timestamp with time zone, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_message(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_message(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_account_password(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_account_password(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_room_request(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_room_request(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_room(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clear_room_messages(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_rooms(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_room_requests(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_room_requests(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_public_room(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_restricted_room(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_room_password(text, uuid, text) TO anon, authenticated;
