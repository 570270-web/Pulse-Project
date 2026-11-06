-- 읽음 확인(read receipt): 방 멤버별 "마지막으로 읽은 시각"만 저장한다.
-- 메시지마다 읽은 사람 행을 쌓지 않아도 되고, last_read_at 과 메시지 created_at 비교로
-- "읽음 N / 안 읽음 N" 을 계산할 수 있다.

alter table public.chat_room_members
  add column if not exists last_read_at timestamp with time zone;

-- 내가 이 방을 지금 읽었다고 표시한다 (시각은 항상 앞으로만 움직인다)
create or replace function public.mark_room_read(p_token text, p_room_id uuid)
returns timestamp with time zone
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
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
$fn$;

-- 방 멤버들의 마지막 읽은 시각 (권한 있는 방 멤버만 조회 가능)
create or replace function public.get_room_read_state(p_token text, p_room_id uuid)
returns table(nickname text, last_read_at timestamp with time zone)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not public.pulse_room_can_read(p_token, p_room_id) then
    raise exception 'NOT_ROOM_MEMBER';
  end if;

  return query
  select m.nickname::text, m.last_read_at
  from public.chat_room_members m
  where m.room_id = p_room_id
  order by m.nickname;
end;
$fn$;
