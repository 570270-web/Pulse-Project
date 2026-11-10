-- 차단을 멤버십에서 분리한다.
--
-- 기존에는 chat_room_members.blocked_at 에 차단을 저장했는데, 나갔다 다시 들어오면
-- join_room 이 멤버 행을 새로 만들어 차단이 사라졌다. 차단은 멤버십과 무관하게
-- 유지되어야 하므로 별도 테이블로 옮긴다. 이미 나간 멤버의 차단도 여기 남아 해제할 수 있다.

create table if not exists public.chat_room_blocks (
  room_id uuid not null references public.chat_rooms (id) on delete cascade,
  nickname text not null,
  blocked_by text,
  blocked_at timestamp with time zone not null default now(),
  primary key (room_id, nickname)
);

alter table public.chat_room_blocks enable row level security;

revoke all on public.chat_room_blocks from anon, authenticated;

insert into public.chat_room_blocks (room_id, nickname, blocked_by, blocked_at)
select m.room_id, m.nickname, m.blocked_by, coalesce(m.blocked_at, now())
from public.chat_room_members m
where m.blocked_at is not null
on conflict (room_id, nickname) do nothing;

create or replace function public.pulse_room_is_blocked(p_token text, p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
    from public.chat_room_blocks b
    where b.room_id = p_room_id
      and b.nickname = v_nick
  );
end;
$function$;

create or replace function public.get_room_members(p_token text, p_room_id uuid)
returns table(nickname text, role text, joined_at timestamp with time zone, blocked boolean)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.pulse_room_can_read(p_token, p_room_id) then
    raise exception 'NOT_ROOM_MEMBER';
  end if;

  return query
  select
    m.nickname,
    (case when r.owner_nickname = m.nickname then 'owner' else m.role end)::text,
    m.joined_at,
    exists (
      select 1
      from public.chat_room_blocks b
      where b.room_id = m.room_id
        and b.nickname = m.nickname
    )
  from public.chat_room_members m
  join public.chat_rooms r on r.id = m.room_id
  where m.room_id = p_room_id
  order by
    (r.owner_nickname = m.nickname) desc,
    (m.role = 'co_admin') desc,
    m.joined_at asc;
end;
$function$;

create or replace function public.get_room_blocked_members(p_token text, p_room_id uuid)
returns table(nickname text, blocked_at timestamp with time zone, blocked_by text, is_member boolean)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.pulse_room_can_read(p_token, p_room_id) then
    raise exception 'NOT_ROOM_MEMBER';
  end if;

  return query
  select
    b.nickname,
    b.blocked_at,
    b.blocked_by,
    exists (
      select 1
      from public.chat_room_members m
      where m.room_id = b.room_id
        and m.nickname = b.nickname
    )
  from public.chat_room_blocks b
  where b.room_id = p_room_id
  order by b.blocked_at desc;
end;
$function$;

create or replace function public.set_room_member_blocked(
  p_token text,
  p_room_id uuid,
  p_nickname text,
  p_blocked boolean
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

  -- 이미 나간 멤버도 해제할 수 있어야 하므로, 멤버일 때만 role 을 본다.
  select m.role into v_target_role
  from public.chat_room_members m
  where m.room_id = p_room_id
    and m.nickname = p_nickname;

  v_target_role := coalesce(v_target_role, 'member');

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

  if v_block then
    insert into public.chat_room_blocks (room_id, nickname, blocked_by, blocked_at)
    values (p_room_id, p_nickname, v_caller, now())
    on conflict (room_id, nickname)
    do update set blocked_by = excluded.blocked_by, blocked_at = now();
  else
    delete from public.chat_room_blocks b
    where b.room_id = p_room_id
      and b.nickname = p_nickname;
  end if;

  return v_block;
end;
$function$;

grant execute on function public.get_room_blocked_members(text, uuid) to anon, authenticated;
grant execute on function public.set_room_member_blocked(text, uuid, text, boolean) to anon, authenticated;

alter table public.chat_room_members drop column if exists blocked_at;
alter table public.chat_room_members drop column if exists blocked_by;
