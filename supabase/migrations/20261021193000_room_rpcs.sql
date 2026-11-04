-- PulseChat room RPCs
-- Requires the tables from 20261021190000_create_rooms.sql
-- Reuses the existing get_session_profile and check_is_admin RPCs.

create or replace function public.pulse_room_current_nickname(
  p_token text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_nickname text;
begin
  if p_token is null or length(p_token) = 0 then
    raise exception 'INVALID_SESSION';
  end if;

  select to_jsonb(p)
    into v_row
  from public.get_session_profile(p_token) as p
  limit 1;

  if v_row is null or v_row = 'null'::jsonb then
    raise exception 'INVALID_SESSION';
  end if;

  if jsonb_typeof(v_row) = 'object' then
    v_nickname := v_row ->> 'nickname';

    if v_nickname is null then
      select value into v_nickname
      from jsonb_each_text(v_row)
      where value is not null
      limit 1;
    end if;
  elsif jsonb_typeof(v_row) = 'string' then
    v_nickname := trim(both '"' from v_row::text);
  end if;

  if v_nickname is null or length(trim(v_nickname)) = 0 then
    raise exception 'INVALID_SESSION';
  end if;

  return v_nickname;
end;
$$;

create or replace function public.pulse_room_is_admin(
  p_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_value text;
begin
  select to_jsonb(c)
    into v_row
  from public.check_is_admin(p_token) as c
  limit 1;

  if v_row is null then
    return false;
  end if;

  if jsonb_typeof(v_row) = 'object' then
    v_value := v_row ->> 'is_admin';

    if v_value is null then
      select value into v_value
      from jsonb_each_text(v_row)
      limit 1;
    end if;
  elsif jsonb_typeof(v_row) = 'boolean' then
    v_value := v_row::text;
  end if;

  return coalesce(v_value::boolean, false);
exception
  when others then
    return false;
end;
$$;

-- Create a room request. One pending request per user is enforced
-- by the unique partial index created in the previous migration.
create or replace function public.request_room_creation(
  p_token text,
  p_room_name text,
  p_visibility text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nickname text;
  v_request public.chat_room_requests%rowtype;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  if length(trim(p_room_name)) < 2
     or length(trim(p_room_name)) > 40 then
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
exception
  when unique_violation then
    raise exception 'PENDING_REQUEST_EXISTS';
end;
$$;

create or replace function public.list_my_room_requests(
  p_token text
)
returns setof public.chat_room_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nickname text;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  return query
  select r.*
  from public.chat_room_requests r
  where r.requester_nickname = v_nickname
  order by r.created_at desc;
end;
$$;

create or replace function public.list_my_rooms(
  p_token text
)
returns table (
  id uuid,
  name text,
  code text,
  visibility text,
  owner_nickname text,
  created_at timestamptz,
  member_count bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nickname text;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  return query
  select
    r.id, r.name, r.code, r.visibility,
    r.owner_nickname, r.created_at,
    count(m.nickname) as member_count
  from public.chat_rooms r
  join public.chat_room_members mine
    on mine.room_id = r.id
   and mine.nickname = v_nickname
  left join public.chat_room_members m
    on m.room_id = r.id
  group by r.id
  order by r.created_at desc;
end;
$$;

create or replace function public.list_public_rooms(
  p_token text
)
returns table (
  id uuid,
  name text,
  code text,
  visibility text,
  owner_nickname text,
  created_at timestamptz,
  member_count bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.pulse_room_current_nickname(p_token);

  return query
  select
    r.id, r.name, r.code, r.visibility,
    r.owner_nickname, r.created_at,
    count(m.nickname) as member_count
  from public.chat_rooms r
  left join public.chat_room_members m
    on m.room_id = r.id
  where r.visibility = 'public'
  group by r.id
  order by r.created_at desc;
end;
$$;

create or replace function public.find_room_by_code(
  p_token text,
  p_code text
)
returns table (
  id uuid,
  name text,
  code text,
  visibility text,
  owner_nickname text,
  created_at timestamptz,
  member_count bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.pulse_room_current_nickname(p_token);

  return query
  select
    r.id, r.name, r.code, r.visibility,
    r.owner_nickname, r.created_at,
    count(m.nickname) as member_count
  from public.chat_rooms r
  left join public.chat_room_members m
    on m.room_id = r.id
  where upper(r.code) = upper(trim(p_code))
  group by r.id;
end;
$$;

create or replace function public.join_public_room(
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
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  if not exists (
    select 1 from public.chat_rooms
    where chat_rooms.id = p_room_id
      and chat_rooms.visibility = 'public'
  ) then
    raise exception 'ROOM_NOT_FOUND_OR_NOT_PUBLIC';
  end if;

  insert into public.chat_room_members (room_id, nickname)
  values (p_room_id, v_nickname)
  on conflict (room_id, nickname) do nothing;

  return true;
end;
$$;

create or replace function public.join_restricted_room(
  p_token text,
  p_room_id uuid,
  p_password text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nickname text;
  v_hash text;
  v_visibility text;
begin
  v_nickname := public.pulse_room_current_nickname(p_token);

  select password_hash, visibility
    into v_hash, v_visibility
  from public.chat_rooms
  where chat_rooms.id = p_room_id;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if v_visibility <> 'restricted' then
    raise exception 'ROOM_NOT_RESTRICTED';
  end if;

  if not public.pulse_room_is_admin(p_token) then
    if v_hash is null then
      raise exception 'ROOM_PASSWORD_NOT_SET';
    end if;

    if p_password is null
       or crypt(p_password, v_hash) <> v_hash then
      raise exception 'INVALID_ROOM_PASSWORD';
    end if;
  end if;

  insert into public.chat_room_members (room_id, nickname)
  values (p_room_id, v_nickname)
  on conflict (room_id, nickname) do nothing;

  return true;
end;
$$;

create or replace function public.leave_room(
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

  select owner_nickname into v_owner
  from public.chat_rooms
  where chat_rooms.id = p_room_id;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if v_owner = v_nickname then
    raise exception 'OWNER_CANNOT_LEAVE';
  end if;

  delete from public.chat_room_members
  where room_id = p_room_id
    and nickname = v_nickname;

  return true;
end;
$$;

create or replace function public.change_room_password(
  p_token text,
  p_room_id uuid,
  p_new_password text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  where chat_rooms.id = p_room_id
    and visibility = 'restricted';

  if not found then
    raise exception 'ROOM_NOT_RESTRICTED';
  end if;

  return true;
end;
$$;

-- Admin: inspect pending requests.
create or replace function public.admin_list_room_requests(
  p_token text
)
returns setof public.chat_room_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.pulse_room_current_nickname(p_token);

  if not public.pulse_room_is_admin(p_token) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  return query
  select r.*
  from public.chat_room_requests r
  where r.status = 'pending'
  order by r.created_at asc;
end;
$$;

-- Admin: approve or reject a request.
-- Approval generates a unique five-character alphanumeric room code.
create or replace function public.admin_review_room_request(
  p_token text,
  p_request_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin text;
  v_request public.chat_room_requests%rowtype;
  v_room public.chat_rooms%rowtype;
  v_code text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_i integer;
  v_attempt integer := 0;
begin
  v_admin := public.pulse_room_current_nickname(p_token);

  if not public.pulse_room_is_admin(p_token) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'INVALID_DECISION';
  end if;

  select * into v_request
  from public.chat_room_requests
  where id = p_request_id
  for update;

  if not found or v_request.status <> 'pending' then
    raise exception 'REQUEST_NOT_PENDING';
  end if;

  if p_decision = 'rejected' then
    update public.chat_room_requests
    set status = 'rejected',
        rejection_reason = left(p_rejection_reason, 500),
        reviewed_by = v_admin,
        reviewed_at = now()
    where id = p_request_id
    returning * into v_request;

    return jsonb_build_object(
      'status', 'rejected',
      'request', to_jsonb(v_request)
    );
  end if;

  loop
    v_code := '';

    for v_i in 1..5 loop
      v_code := v_code || substr(
        v_alphabet,
        1 + floor(random() * length(v_alphabet))::integer,
        1
      );
    end loop;

    exit when not exists (
      select 1 from public.chat_rooms where code = v_code
    );

    v_attempt := v_attempt + 1;

    if v_attempt > 100 then
      raise exception 'ROOM_CODE_GENERATION_FAILED';
    end if;
  end loop;

  insert into public.chat_rooms (
    name, code, visibility, owner_nickname
  )
  values (
    v_request.room_name,
    v_code,
    v_request.visibility,
    v_request.requester_nickname
  )
  returning * into v_room;

  insert into public.chat_room_members (
    room_id, nickname, role
  )
  values (
    v_room.id, v_request.requester_nickname, 'member'
  )
  on conflict (room_id, nickname) do nothing;

  update public.chat_room_requests
  set status = 'approved',
      reviewed_by = v_admin,
      reviewed_at = now()
  where id = p_request_id
  returning * into v_request;

  return jsonb_build_object(
    'status', 'approved',
    'room', to_jsonb(v_room),
    'request', to_jsonb(v_request)
  );
end;
$$;

-- Do not allow clients to invoke the internal helper functions directly.
revoke all on function public.pulse_room_current_nickname(text)
  from public, anon, authenticated;

revoke all on function public.pulse_room_is_admin(text)
  from public, anon, authenticated;

-- RPCs are called by the app's Supabase client.
grant execute on function public.request_room_creation(text, text, text)
  to anon, authenticated;
grant execute on function public.list_my_room_requests(text)
  to anon, authenticated;
grant execute on function public.list_my_rooms(text)
  to anon, authenticated;
grant execute on function public.list_public_rooms(text)
  to anon, authenticated;
grant execute on function public.find_room_by_code(text, text)
  to anon, authenticated;
grant execute on function public.join_public_room(text, uuid)
  to anon, authenticated;
grant execute on function public.join_restricted_room(text, uuid, text)
  to anon, authenticated;
grant execute on function public.leave_room(text, uuid)
  to anon, authenticated;
grant execute on function public.change_room_password(text, uuid, text)
  to anon, authenticated;
grant execute on function public.admin_list_room_requests(text)
  to anon, authenticated;
grant execute on function public.admin_review_room_request(text, uuid, text, text)
  to anon, authenticated;