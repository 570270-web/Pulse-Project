-- 5/18: Room roles and administrative room deletion.
-- Requires the helper functions from migration 3.

create or replace function public.set_room_co_admin(
  p_token text,
  p_room_id uuid,
  p_target_nickname text,
  p_make_co_admin boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nickname text;
  v_owner text;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  select owner_nickname
    into v_owner
  from public.chat_rooms
  where id = p_room_id;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  -- Only the room owner can appoint or remove co-admins.
  if v_owner <> v_nickname then
    raise exception 'ROOM_OWNER_REQUIRED';
  end if;

  if p_target_nickname is null
     or length(trim(p_target_nickname)) = 0 then
    raise exception 'INVALID_NICKNAME';
  end if;

  -- The owner cannot be made their own co-admin.
  if trim(p_target_nickname) = v_owner then
    raise exception 'OWNER_CANNOT_BE_CO_ADMIN';
  end if;

  if not exists (
    select 1
    from public.chat_room_members
    where room_id = p_room_id
      and nickname = trim(p_target_nickname)
  ) then
    raise exception 'TARGET_NOT_ROOM_MEMBER';
  end if;

  if p_make_co_admin then
    update public.chat_room_members
    set role = 'co_admin'
    where room_id = p_room_id
      and nickname = trim(p_target_nickname);
  else
    update public.chat_room_members
    set role = 'member'
    where room_id = p_room_id
      and nickname = trim(p_target_nickname)
      and role = 'co_admin';
  end if;

  return true;
end;
$$;


-- The room owner or a site admin can remove a room.
-- Co-admins cannot delete rooms.
create or replace function public.delete_chat_room(
  p_token text,
  p_room_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nickname text;
  v_owner text;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  select owner_nickname
    into v_owner
  from public.chat_rooms
  where id = p_room_id;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if v_owner <> v_nickname
     and not public.pulse_room_is_admin(p_token) then
    raise exception 'ROOM_PERMISSION_DENIED';
  end if;

  -- Memberships and room messages are removed by their foreign keys.
  delete from public.chat_rooms
  where id = p_room_id;

  return true;
end;
$$;


revoke all on function public.set_room_co_admin(
  text, uuid, text, boolean
) from public;

revoke all on function public.delete_chat_room(
  text, uuid
) from public;

grant execute on function public.set_room_co_admin(
  text, uuid, text, boolean
) to anon, authenticated;

grant execute on function public.delete_chat_room(
  text, uuid
) to anon, authenticated;