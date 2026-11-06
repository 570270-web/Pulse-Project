-- 0003: 채팅 이미지 첨부
-- 메시지 1개에 이미지 1장. 파일은 Storage 버킷(chat-images)에 두고
-- messages.attachment_path 에 객체 경로만 저장한다.
-- 업로드는 방 멤버에게만 발급되는 HMAC 티켓이 있어야 가능하다.
-- (이 앱은 Supabase Auth 를 쓰지 않고 자체 세션 토큰을 쓰기 때문에,
--  storage.objects 정책에서 토큰을 검증할 수 없어 서명 경로로 대신한다.)

alter table public.messages
  add column if not exists attachment_path text;

-- 업로드 티켓 서명 비밀값. anon 은 읽을 수 없고 SECURITY DEFINER 함수만 접근한다.
create table if not exists public.app_secrets (
  key text primary key,
  value text not null
);

alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

insert into public.app_secrets (key, value)
values ('image_upload_hmac', encode(gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- 공개 읽기 버킷: 경로 안에 서명이 들어 있어 경로를 아는 사람만 접근한다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-images',
  'chat-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 티켓 서명 계산. anon 에게서 EXECUTE 를 회수해야 위조가 불가능하다.
create or replace function public.pulse_image_signature(
  p_room_id uuid,
  p_expires bigint
)
returns text
language sql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  select encode(
    hmac(
      p_room_id::text || ':' || p_expires::text,
      s.value,
      'sha256'
    ),
    'hex'
  )
  from public.app_secrets s
  where s.key = 'image_upload_hmac';
$$;

revoke all on function public.pulse_image_signature(uuid, bigint)
  from anon, authenticated;

-- 저장소 업로드 경로 검사: {room_id}/{만료epoch}/{서명}/{파일명}
create or replace function public.storage_upload_allowed(p_name text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_parts text[] := string_to_array(coalesce(p_name, ''), '/');
  v_room uuid;
  v_expires bigint;
begin
  if coalesce(array_length(v_parts, 1), 0) <> 4 then
    return false;
  end if;

  begin
    v_room := v_parts[1]::uuid;
    v_expires := v_parts[2]::bigint;
  exception when others then
    return false;
  end;

  if v_expires < extract(epoch from now())::bigint then
    return false;
  end if;

  return public.pulse_image_signature(v_room, v_expires) = lower(v_parts[3]);
end;
$$;

drop policy if exists "chat image upload" on storage.objects;

create policy "chat image upload" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'chat-images'
    and public.storage_upload_allowed(name)
  );

-- 업로드 티켓 발급 (방을 읽을 수 있는 사람에게만, 10분 유효)
create or replace function public.create_image_upload_ticket(
  p_token text,
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_expires bigint := extract(epoch from now())::bigint + 600;
  v_signature text;
begin
  if not public.pulse_room_can_read(p_token, p_room_id) then
    raise exception 'NOT_ROOM_MEMBER';
  end if;

  v_signature := public.pulse_image_signature(p_room_id, v_expires);

  if v_signature is null then
    raise exception 'UPLOAD_NOT_CONFIGURED';
  end if;

  return jsonb_build_object(
    'bucket', 'chat-images',
    'prefix', p_room_id::text || '/' || v_expires::text || '/' || v_signature,
    'expires_at', to_char(
      to_timestamp(v_expires) at time zone 'utc',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    )
  );
end;
$$;

-- send_message: 첨부 경로를 함께 저장한다. 사진만 보내는 경우 본문은 비어도 된다.
drop function if exists public.send_message(text, text, uuid, uuid);

create or replace function public.send_message(
  p_token text,
  p_content text,
  p_room_id uuid default null,
  p_reply_to_id uuid default null,
  p_attachment_path text default null
)
returns public.messages
language plpgsql
security definer
set search_path to 'public'
as $$
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
SELECT p.* INTO v_profile
FROM public.profiles p
JOIN public.sessions s ON s.profile_id = p.id
WHERE s.token = p_token;

IF NOT FOUND THEN
RAISE EXCEPTION 'INVALID_SESSION';
END IF;

UPDATE public.profiles SET last_active_at = now() WHERE id = v_profile.id;
UPDATE public.sessions SET last_used_at = now() WHERE token = p_token;

-- Rate limit: max 60 messages per profile in a rolling 60-second window
SELECT count(*), min(created_at)
INTO v_recent_count, v_oldest_ts
FROM public.messages
WHERE profile_id = v_profile.id
AND created_at > now() - interval '60 seconds';

IF v_recent_count >= 60 THEN
v_wait_secs := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_oldest_ts + interval '60 seconds' - now()))));
RAISE EXCEPTION 'RATE_LIMIT_EXCEEDED:%', v_wait_secs;
END IF;

IF p_room_id IS NOT NULL THEN
SELECT count(*) INTO v_member_count
FROM public.chat_room_members
WHERE room_id = p_room_id
AND nickname = v_profile.nickname;

IF v_member_count = 0 THEN
RAISE EXCEPTION 'NOT_ROOM_MEMBER';
END IF;
END IF;

-- 첨부는 이 방 폴더 안의 티켓 경로만 허용한다
IF v_attachment IS NOT NULL THEN
IF p_room_id IS NULL
OR v_attachment !~ (
  '^' || p_room_id::text ||
  '/[0-9]{9,12}/[0-9a-f]{64}/[A-Za-z0-9_-]{1,80}\.[A-Za-z0-9]{2,5}$'
) THEN
RAISE EXCEPTION 'INVALID_ATTACHMENT';
END IF;
END IF;

IF v_attachment IS NULL AND btrim(v_content) = '' THEN
RAISE EXCEPTION 'INVALID_MESSAGE_CONTENT';
END IF;

INSERT INTO public.messages (
  profile_id,
  nickname,
  content,
  room_id,
  reply_to_id,
  attachment_path
)
VALUES (
  v_profile.id,
  v_profile.nickname,
  v_content,
  p_room_id,
  p_reply_to_id,
  v_attachment
)
RETURNING * INTO v_message;

RETURN v_message;
END;
$$;

-- 조회 RPC 는 반환 컬럼이 바뀌므로 다시 만든다 (attachment_path 추가)
drop function if exists public.get_room_messages(text, uuid, timestamptz, integer);
drop function if exists public.get_room_messages_after(text, uuid, timestamptz, integer);
drop function if exists public.get_message_previews(text, uuid, uuid[]);

create or replace function public.get_room_messages(
  p_token text,
  p_room_id uuid,
  p_before timestamptz default null,
  p_limit integer default 50
)
returns table(
  id uuid,
  nickname text,
  content text,
  created_at timestamptz,
  reply_to_id uuid,
  deleted boolean,
  is_system boolean,
  attachment_path text
)
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
    m.id,
    m.nickname,
    (case when m.deleted then '' else m.content end)::text,
    m.created_at,
    m.reply_to_id,
    coalesce(m.deleted, false),
    coalesce(m.is_system, false),
    (case when m.deleted then null else m.attachment_path end)::text
  from public.messages as m
  where m.room_id = p_room_id
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit least(greatest(p_limit, 1), 200);
end;
$function$;

create or replace function public.get_room_messages_after(
  p_token text,
  p_room_id uuid,
  p_after timestamptz,
  p_limit integer default 50
)
returns table(
  id uuid,
  nickname text,
  content text,
  created_at timestamptz,
  reply_to_id uuid,
  deleted boolean,
  is_system boolean,
  attachment_path text
)
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
    m.id,
    m.nickname,
    (case when m.deleted then '' else m.content end)::text,
    m.created_at,
    m.reply_to_id,
    coalesce(m.deleted, false),
    coalesce(m.is_system, false),
    (case when m.deleted then null else m.attachment_path end)::text
  from public.messages as m
  where m.room_id = p_room_id
    and m.created_at > p_after
  order by m.created_at asc
  limit least(greatest(p_limit, 1), 200);
end;
$function$;

create or replace function public.get_message_previews(
  p_token text,
  p_room_id uuid,
  p_ids uuid[]
)
returns table(
  id uuid,
  nickname text,
  content text,
  deleted boolean,
  attachment_path text
)
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
    m.id,
    m.nickname,
    (case when m.deleted then '' else m.content end)::text,
    coalesce(m.deleted, false),
    (case when m.deleted then null else m.attachment_path end)::text
  from public.messages as m
  where m.room_id = p_room_id
    and m.id = any (p_ids[1:100]);
end;
$function$;
