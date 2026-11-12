/*
# Device bans (replaces the earlier IP bans)

## Why
IP bans are network bans: on a school/office NAT every student shares one
public IP, so banning one person blocked everyone. A device ban follows the
browser instead.

## How the device is identified
The app stores a random 32-hex id in `localStorage` (`pulse_device_id`) and
sends it on every request as the `x-pulse-device` header. PostgREST exposes
request headers through `current_setting('request.headers')`, so the server
reads the id without changing any RPC signature.

Clearing site data creates a new id, which is the known limit of this method.

## Tables
- `account_devices`: (nickname, device_id) with user agent and first/last seen.
- `device_bans`: banned device ids with the account it came from, reason,
  who banned it and when.
- `sessions.device_id`: which device created a session, so banning a device
  can drop exactly those sessions.

## Enforcement
`DEVICE_BANNED` is raised by `register_nickname`, `login_nickname` and
`get_session_profile` (every room RPC goes through the last one), so a banned
device cannot log in with any account and its live sessions stop working.

## Admin RPCs
`admin_list_account_devices`, `admin_ban_account_devices`,
`admin_list_device_bans`, `admin_unban_device`.

## Cleanup
The IP-ban tables and functions from the previous change are dropped
(`ip_bans`, `account_ip_log`, `pulse_client_ip`, ...). There were no bans.
*/

drop function if exists public.admin_list_account_ips(text, text);
drop function if exists public.admin_ban_account_ips(text, text, text);
drop function if exists public.admin_list_ip_bans(text);
drop function if exists public.admin_unban_ip(text, text);
drop function if exists public.pulse_record_client_ip(text, text);
drop function if exists public.pulse_is_ip_banned(text);
drop function if exists public.pulse_client_ip();
drop table if exists public.account_ip_log;
drop table if exists public.ip_bans;

create table if not exists public.account_devices (
  nickname text not null,
  device_id text not null,
  user_agent text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (nickname, device_id)
);

create index if not exists idx_account_devices_device
  on public.account_devices (device_id);

create table if not exists public.device_bans (
  device_id text primary key,
  nickname text,
  user_agent text,
  reason text,
  banned_by text,
  created_at timestamptz not null default now()
);

alter table public.account_devices enable row level security;
alter table public.device_bans enable row level security;

alter table public.sessions add column if not exists device_id text;

-- ---------------------------------------------------------------------------
-- Request header helpers
-- ---------------------------------------------------------------------------

create or replace function public.pulse_client_device()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_headers jsonb;
  v_id text;
begin
  begin
    v_headers := coalesce(
      current_setting('request.headers', true),
      '{}'
    )::jsonb;
  exception when others then
    return null;
  end;

  if v_headers is null then
    return null;
  end if;

  v_id := lower(nullif(trim(v_headers ->> 'x-pulse-device'), ''));

  if v_id is null or v_id !~ '^[0-9a-f]{16,64}$' then
    return null;
  end if;

  return v_id;
end;
$$;

create or replace function public.pulse_client_user_agent()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_headers jsonb;
begin
  begin
    v_headers := coalesce(
      current_setting('request.headers', true),
      '{}'
    )::jsonb;
  exception when others then
    return null;
  end;

  return nullif(left(coalesce(v_headers ->> 'user-agent', ''), 200), '');
end;
$$;

create or replace function public.pulse_is_device_banned(p_device_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_device_id is not null
     and exists (
       select 1 from public.device_bans b
       where b.device_id = p_device_id
     );
$$;

-- 같은 계정/같은 기기 조합은 5분에 한 번만 갱신한다
create or replace function public.pulse_record_client_device(
  p_nickname text,
  p_device_id text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.account_devices (nickname, device_id, user_agent)
  values (lower(p_nickname), p_device_id, public.pulse_client_user_agent())
  on conflict (nickname, device_id) do update
    set last_seen_at = now(),
        user_agent = coalesce(
          excluded.user_agent,
          public.account_devices.user_agent
        )
    where public.account_devices.last_seen_at < now() - interval '5 minutes';
$$;

revoke all on function public.pulse_client_device() from public, anon, authenticated;
revoke all on function public.pulse_client_user_agent() from public, anon, authenticated;
revoke all on function public.pulse_is_device_banned(text) from public, anon, authenticated;
revoke all on function public.pulse_record_client_device(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enforcement on auth entry points
-- ---------------------------------------------------------------------------

create or replace function public.register_nickname(p_nickname text, p_password text)
returns text
language plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_token text; v_device text;
BEGIN
  v_device := public.pulse_client_device();

  IF public.pulse_is_device_banned(v_device) THEN
    RAISE EXCEPTION 'DEVICE_BANNED';
  END IF;

  PERFORM public.cleanup_expired_nicknames();
  IF EXISTS (SELECT 1 FROM public.profiles WHERE nickname = lower(p_nickname)) THEN
    RAISE EXCEPTION 'NICKNAME_TAKEN';
  END IF;
  DELETE FROM public.profiles WHERE nickname = lower(p_nickname);
  INSERT INTO public.profiles (nickname, password_hash)
  VALUES (lower(p_nickname), extensions.crypt(p_password, extensions.gen_salt('bf')))
  RETURNING id INTO v_id;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.sessions (token, profile_id, device_id)
  VALUES (v_token, v_id, v_device);

  IF v_device IS NOT NULL THEN
    PERFORM public.pulse_record_client_device(lower(p_nickname), v_device);
  END IF;

  RETURN v_token;
END;
$$;

create or replace function public.login_nickname(p_nickname text, p_password text)
returns text
language plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_profile public.profiles%ROWTYPE; v_token text; v_device text;
BEGIN
  v_device := public.pulse_client_device();

  IF public.pulse_is_device_banned(v_device) THEN
    RAISE EXCEPTION 'DEVICE_BANNED';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE nickname = lower(p_nickname);
  IF NOT FOUND THEN RAISE EXCEPTION 'NICKNAME_NOT_FOUND'; END IF;
  IF v_profile.password_hash <> extensions.crypt(p_password, v_profile.password_hash) THEN
    RAISE EXCEPTION 'INVALID_PASSWORD';
  END IF;
  UPDATE public.profiles SET last_active_at = now() WHERE id = v_profile.id;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.sessions (token, profile_id, device_id)
  VALUES (v_token, v_profile.id, v_device);

  IF v_device IS NOT NULL THEN
    PERFORM public.pulse_record_client_device(v_profile.nickname, v_device);
  END IF;

  RETURN v_token;
END;
$$;

create or replace function public.get_session_profile(p_token text)
returns table(nickname text)
language plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nickname text; v_device text;
BEGIN
  v_device := public.pulse_client_device();

  IF public.pulse_is_device_banned(v_device) THEN
    RAISE EXCEPTION 'DEVICE_BANNED';
  END IF;

  SELECT p.nickname INTO v_nickname
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;

  IF v_nickname IS NULL THEN
    RETURN;
  END IF;

  IF v_device IS NOT NULL THEN
    PERFORM public.pulse_record_client_device(v_nickname, v_device);
  END IF;

  RETURN QUERY SELECT v_nickname;
END;
$$;

revoke all on function public.register_nickname(text, text) from public;
revoke all on function public.login_nickname(text, text) from public;
revoke all on function public.get_session_profile(text) from public;

grant execute on function public.register_nickname(text, text) to anon, authenticated;
grant execute on function public.login_nickname(text, text) to anon, authenticated;
grant execute on function public.get_session_profile(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin RPCs
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_account_devices(
  p_token text,
  p_nickname text
)
returns table (
  device_id text,
  user_agent text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  banned boolean,
  other_accounts integer
)
language plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_is_admin boolean;
BEGIN
  SELECT p.is_admin INTO v_is_admin
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;

  IF v_is_admin IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  RETURN QUERY
  SELECT d.device_id,
         d.user_agent,
         d.first_seen_at,
         d.last_seen_at,
         exists (
           select 1 from public.device_bans b where b.device_id = d.device_id
         ) as banned,
         (select count(distinct o.nickname)::integer
            from public.account_devices o
           where o.device_id = d.device_id
             and o.nickname <> lower(p_nickname)) as other_accounts
  FROM public.account_devices d
  WHERE d.nickname = lower(p_nickname)
  ORDER BY d.last_seen_at DESC;
END;
$$;

create or replace function public.admin_ban_account_devices(
  p_token text,
  p_nickname text,
  p_reason text DEFAULT NULL
)
returns integer
language plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin_nickname text;
  v_is_admin boolean;
  v_reason text;
  v_count integer;
BEGIN
  SELECT p.nickname, p.is_admin INTO v_admin_nickname, v_is_admin
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;

  IF v_is_admin IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  IF lower(p_nickname) = v_admin_nickname THEN
    RAISE EXCEPTION 'CANNOT_BAN_SELF';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE nickname = lower(p_nickname) AND is_admin
  ) THEN
    RAISE EXCEPTION 'CANNOT_BAN_ADMIN';
  END IF;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');

  WITH banned AS (
    INSERT INTO public.device_bans (device_id, nickname, user_agent, reason, banned_by)
    SELECT d.device_id, lower(p_nickname), d.user_agent, v_reason, v_admin_nickname
    FROM public.account_devices d
    WHERE d.nickname = lower(p_nickname)
    ON CONFLICT (device_id) DO UPDATE
      SET nickname = excluded.nickname,
          user_agent = coalesce(excluded.user_agent, public.device_bans.user_agent),
          reason = coalesce(excluded.reason, public.device_bans.reason),
          banned_by = excluded.banned_by
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM banned;

  -- 그 기기로 만든 세션은 바로 끊는다
  DELETE FROM public.sessions s
  USING public.profiles p
  WHERE s.profile_id = p.id
    AND p.nickname = lower(p_nickname)
    AND s.device_id IN (
      SELECT d.device_id
      FROM public.account_devices d
      WHERE d.nickname = lower(p_nickname)
    );

  RETURN coalesce(v_count, 0);
END;
$$;

create or replace function public.admin_list_device_bans(p_token text)
returns table (
  device_id text,
  nickname text,
  user_agent text,
  reason text,
  banned_by text,
  created_at timestamptz
)
language plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_is_admin boolean;
BEGIN
  SELECT p.is_admin INTO v_is_admin
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;

  IF v_is_admin IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  RETURN QUERY
  SELECT b.device_id, b.nickname, b.user_agent, b.reason, b.banned_by, b.created_at
  FROM public.device_bans b
  ORDER BY b.created_at DESC;
END;
$$;

create or replace function public.admin_unban_device(p_token text, p_device_id text)
returns void
language plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_is_admin boolean;
BEGIN
  SELECT p.is_admin INTO v_is_admin
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;

  IF v_is_admin IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  DELETE FROM public.device_bans WHERE device_id = lower(trim(p_device_id));
END;
$$;

revoke all on function public.admin_list_account_devices(text, text) from public;
revoke all on function public.admin_ban_account_devices(text, text, text) from public;
revoke all on function public.admin_list_device_bans(text) from public;
revoke all on function public.admin_unban_device(text, text) from public;

grant execute on function public.admin_list_account_devices(text, text) to anon, authenticated;
grant execute on function public.admin_ban_account_devices(text, text, text) to anon, authenticated;
grant execute on function public.admin_list_device_bans(text) to anon, authenticated;
grant execute on function public.admin_unban_device(text, text) to anon, authenticated;
