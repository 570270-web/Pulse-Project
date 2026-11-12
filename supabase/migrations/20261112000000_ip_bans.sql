/*
# Per-account IP log and IP bans

## Overview
- `account_ip_log`: one row per (nickname, ip) with first/last seen timestamps.
  Filled automatically whenever a session is used or an account logs in.
- `ip_bans`: the banned IP list (ip PK, optional reason, the account it came from).
- `pulse_client_ip()`: reads the real client IP from the PostgREST request headers
  (Cloudflare / Supabase proxy set `cf-connecting-ip` and `x-forwarded-for`).
- Enforcement: login, registration and every session lookup (so every room RPC,
  since they all go through get_session_profile) raise `IP_BANNED`.
- Admin RPCs: list an account's IPs, ban all of them, list bans, unban one IP.

## Notes
- Both tables have RLS enabled with no policies, so they are only reachable
  through the SECURITY DEFINER functions below.
- Banning an account also deletes its sessions so it is kicked immediately.
- Because a ban is per IP, everyone sharing that IP (e.g. school NAT) is blocked.
*/

create table if not exists public.account_ip_log (
  nickname text not null,
  ip text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (nickname, ip)
);

create index if not exists idx_account_ip_log_ip
  on public.account_ip_log (ip);

create table if not exists public.ip_bans (
  ip text primary key,
  nickname text,
  reason text,
  banned_by text,
  created_at timestamptz not null default now()
);

alter table public.account_ip_log enable row level security;
alter table public.ip_bans enable row level security;

-- ---------------------------------------------------------------------------
-- Client IP helpers
-- ---------------------------------------------------------------------------

create or replace function public.pulse_client_ip()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_headers jsonb;
  v_ip text;
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

  -- Cloudflare가 붙여 주는 값이 가장 믿을 만하다 (클라이언트가 덮어쓸 수 없음)
  v_ip := nullif(trim(v_headers ->> 'cf-connecting-ip'), '');

  if v_ip is null then
    v_ip := nullif(trim(v_headers ->> 'sb-forwarded-for'), '');
  end if;

  -- 마지막 항목이 프록시가 실제로 본 주소다 (앞쪽은 클라이언트가 보낸 값일 수 있음)
  if v_ip is null then
    v_ip := nullif(
      trim(regexp_replace(coalesce(v_headers ->> 'x-forwarded-for', ''), '^.*,', '')),
      ''
    );
  end if;

  if v_ip is null
     or length(v_ip) > 64
     or v_ip !~ '^[0-9a-fA-F:.]{3,64}$' then
    return null;
  end if;

  return v_ip;
end;
$$;

create or replace function public.pulse_is_ip_banned(p_ip text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_ip is not null
     and exists (select 1 from public.ip_bans b where b.ip = p_ip);
$$;

-- 같은 계정/같은 IP 조합은 5분에 한 번만 갱신한다 (모든 RPC마다 쓰지 않도록)
create or replace function public.pulse_record_client_ip(
  p_nickname text,
  p_ip text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.account_ip_log (nickname, ip)
  values (lower(p_nickname), p_ip)
  on conflict (nickname, ip) do update
    set last_seen_at = now()
    where public.account_ip_log.last_seen_at < now() - interval '5 minutes';
$$;

revoke all on function public.pulse_client_ip() from public, anon, authenticated;
revoke all on function public.pulse_is_ip_banned(text) from public, anon, authenticated;
revoke all on function public.pulse_record_client_ip(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enforcement on auth entry points
-- ---------------------------------------------------------------------------

create or replace function public.register_nickname(p_nickname text, p_password text)
returns text
language plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_token text; v_ip text;
BEGIN
  v_ip := public.pulse_client_ip();

  IF public.pulse_is_ip_banned(v_ip) THEN
    RAISE EXCEPTION 'IP_BANNED';
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
  INSERT INTO public.sessions (token, profile_id) VALUES (v_token, v_id);

  IF v_ip IS NOT NULL THEN
    PERFORM public.pulse_record_client_ip(lower(p_nickname), v_ip);
  END IF;

  RETURN v_token;
END;
$$;

create or replace function public.login_nickname(p_nickname text, p_password text)
returns text
language plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_profile public.profiles%ROWTYPE; v_token text; v_ip text;
BEGIN
  v_ip := public.pulse_client_ip();

  IF public.pulse_is_ip_banned(v_ip) THEN
    RAISE EXCEPTION 'IP_BANNED';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE nickname = lower(p_nickname);
  IF NOT FOUND THEN RAISE EXCEPTION 'NICKNAME_NOT_FOUND'; END IF;
  IF v_profile.password_hash <> extensions.crypt(p_password, v_profile.password_hash) THEN
    RAISE EXCEPTION 'INVALID_PASSWORD';
  END IF;
  UPDATE public.profiles SET last_active_at = now() WHERE id = v_profile.id;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.sessions (token, profile_id) VALUES (v_token, v_profile.id);

  IF v_ip IS NOT NULL THEN
    PERFORM public.pulse_record_client_ip(v_profile.nickname, v_ip);
  END IF;

  RETURN v_token;
END;
$$;

create or replace function public.get_session_profile(p_token text)
returns table(nickname text)
language plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nickname text; v_ip text;
BEGIN
  v_ip := public.pulse_client_ip();

  IF public.pulse_is_ip_banned(v_ip) THEN
    RAISE EXCEPTION 'IP_BANNED';
  END IF;

  SELECT p.nickname INTO v_nickname
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;

  IF v_nickname IS NULL THEN
    RETURN;
  END IF;

  IF v_ip IS NOT NULL THEN
    PERFORM public.pulse_record_client_ip(v_nickname, v_ip);
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

create or replace function public.admin_list_account_ips(
  p_token text,
  p_nickname text
)
returns table (
  ip text,
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
  SELECT l.ip,
         l.first_seen_at,
         l.last_seen_at,
         exists (select 1 from public.ip_bans b where b.ip = l.ip) as banned,
         (select count(distinct o.nickname)::integer
            from public.account_ip_log o
           where o.ip = l.ip
             and o.nickname <> lower(p_nickname)) as other_accounts
  FROM public.account_ip_log l
  WHERE l.nickname = lower(p_nickname)
  ORDER BY l.last_seen_at DESC;
END;
$$;

create or replace function public.admin_ban_account_ips(
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

  WITH inserted AS (
    INSERT INTO public.ip_bans (ip, nickname, reason, banned_by)
    SELECT l.ip, lower(p_nickname), v_reason, v_admin_nickname
    FROM public.account_ip_log l
    WHERE l.nickname = lower(p_nickname)
    ON CONFLICT (ip) DO UPDATE
      SET nickname = excluded.nickname,
          reason = coalesce(excluded.reason, public.ip_bans.reason),
          banned_by = excluded.banned_by
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM inserted;

  -- 로그인되어 있던 세션은 바로 끊는다
  DELETE FROM public.sessions s
  USING public.profiles p
  WHERE s.profile_id = p.id
    AND p.nickname = lower(p_nickname);

  RETURN coalesce(v_count, 0);
END;
$$;

create or replace function public.admin_list_ip_bans(p_token text)
returns table (
  ip text,
  nickname text,
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
  SELECT b.ip, b.nickname, b.reason, b.banned_by, b.created_at
  FROM public.ip_bans b
  ORDER BY b.created_at DESC;
END;
$$;

create or replace function public.admin_unban_ip(p_token text, p_ip text)
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

  DELETE FROM public.ip_bans WHERE ip = trim(p_ip);
END;
$$;

revoke all on function public.admin_list_account_ips(text, text) from public;
revoke all on function public.admin_ban_account_ips(text, text, text) from public;
revoke all on function public.admin_list_ip_bans(text) from public;
revoke all on function public.admin_unban_ip(text, text) from public;

grant execute on function public.admin_list_account_ips(text, text) to anon, authenticated;
grant execute on function public.admin_ban_account_ips(text, text, text) to anon, authenticated;
grant execute on function public.admin_list_ip_bans(text) to anon, authenticated;
grant execute on function public.admin_unban_ip(text, text) to anon, authenticated;
