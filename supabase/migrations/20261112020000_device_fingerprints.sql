/*
# Stronger device identity + admin bypass

## Stronger identity
A single localStorage key was easy to reset, so the device is now identified
by two signals:

1. `device_id` (as before): random 32-hex id, stored in localStorage **and**
   a first-party cookie, so clearing one of them keeps the same device.
2. `fingerprint`: a 16-hex hash of browser traits (user agent, languages,
   screen, timezone, CPU cores, touch points, a canvas render and the WebGL
   vendor/renderer). Sent as the `x-pulse-fingerprint` header.

Enforcement: a device is blocked when its `device_id` is banned **or** its
fingerprint matches a banned one — but only while that fingerprint is used by
fewer than 3 distinct accounts. School PCs that share one hardware/browser
profile therefore do not get everyone banned, while a single person who wipes
storage and comes back with a new id is still caught.

## Admin bypass
`login_nickname` and `get_session_profile` skip the device/fingerprint ban when
the profile is a site admin, so an admin can never lock themselves out while
testing. Registration stays blocked (a new account is never an admin).

## Admin RPCs
Device lists and the ban list now also return `fingerprint`; banning stores it.
*/

drop function if exists public.admin_list_account_devices(text, text);
drop function if exists public.admin_list_device_bans(text);

alter table public.account_devices add column if not exists fingerprint text;
alter table public.device_bans add column if not exists fingerprint text;

create index if not exists idx_account_devices_fingerprint
  on public.account_devices (fingerprint);

create or replace function public.pulse_client_fingerprint()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_headers jsonb;
  v_fp text;
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

  v_fp := lower(nullif(trim(v_headers ->> 'x-pulse-fingerprint'), ''));

  if v_fp is null or v_fp !~ '^[0-9a-f]{8,64}$' then
    return null;
  end if;

  return v_fp;
end;
$$;

-- 이 지문이 금지된 지문과 같고, 여러 계정이 함께 쓰는 흔한 지문이 아닐 때만 막는다
create or replace function public.pulse_fingerprint_blocked(p_fingerprint text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_fingerprint is not null
     and exists (
       select 1 from public.device_bans b
       where b.fingerprint = p_fingerprint
     )
     and (
       select count(distinct d.nickname)
       from public.account_devices d
       where d.fingerprint = p_fingerprint
     ) < 3;
$$;

create or replace function public.pulse_record_client_device(
  p_nickname text,
  p_device_id text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.account_devices (nickname, device_id, user_agent, fingerprint)
  values (
    lower(p_nickname),
    p_device_id,
    public.pulse_client_user_agent(),
    public.pulse_client_fingerprint()
  )
  on conflict (nickname, device_id) do update
    set last_seen_at = now(),
        user_agent = coalesce(
          excluded.user_agent,
          public.account_devices.user_agent
        ),
        fingerprint = coalesce(
          excluded.fingerprint,
          public.account_devices.fingerprint
        )
    where public.account_devices.last_seen_at < now() - interval '5 minutes';
$$;

revoke all on function public.pulse_client_fingerprint() from public, anon, authenticated;
revoke all on function public.pulse_fingerprint_blocked(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enforcement (+ admin bypass)
-- ---------------------------------------------------------------------------

create or replace function public.register_nickname(p_nickname text, p_password text)
returns text
language plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_token text; v_device text; v_fp text;
BEGIN
  v_device := public.pulse_client_device();
  v_fp := public.pulse_client_fingerprint();

  IF public.pulse_is_device_banned(v_device)
     OR public.pulse_fingerprint_blocked(v_fp) THEN
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
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_token text;
  v_device text;
  v_fp text;
BEGIN
  v_device := public.pulse_client_device();
  v_fp := public.pulse_client_fingerprint();

  SELECT * INTO v_profile FROM public.profiles WHERE nickname = lower(p_nickname);
  IF NOT FOUND THEN RAISE EXCEPTION 'NICKNAME_NOT_FOUND'; END IF;
  IF v_profile.password_hash <> extensions.crypt(p_password, v_profile.password_hash) THEN
    RAISE EXCEPTION 'INVALID_PASSWORD';
  END IF;

  -- 사이트 관리자는 기기 밴과 무관하게 로그인할 수 있다 (자기 자신 잠금 방지)
  IF v_profile.is_admin IS NOT TRUE
     AND (
       public.pulse_is_device_banned(v_device)
       OR public.pulse_fingerprint_blocked(v_fp)
     ) THEN
    RAISE EXCEPTION 'DEVICE_BANNED';
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
DECLARE v_nickname text; v_is_admin boolean; v_device text; v_fp text;
BEGIN
  v_device := public.pulse_client_device();
  v_fp := public.pulse_client_fingerprint();

  SELECT p.nickname, p.is_admin INTO v_nickname, v_is_admin
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;

  IF v_nickname IS NULL THEN
    RETURN;
  END IF;

  -- 관리자 계정은 막지 않는다
  IF v_is_admin IS NOT TRUE
     AND (
       public.pulse_is_device_banned(v_device)
       OR public.pulse_fingerprint_blocked(v_fp)
     ) THEN
    RAISE EXCEPTION 'DEVICE_BANNED';
  END IF;

  IF v_device IS NOT NULL THEN
    PERFORM public.pulse_record_client_device(v_nickname, v_device);
  END IF;

  RETURN QUERY SELECT v_nickname;
END;
$$;

grant execute on function public.register_nickname(text, text) to anon, authenticated;
grant execute on function public.login_nickname(text, text) to anon, authenticated;
grant execute on function public.get_session_profile(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin RPCs (now include the fingerprint)
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_account_devices(
  p_token text,
  p_nickname text
)
returns table (
  device_id text,
  user_agent text,
  fingerprint text,
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
         d.fingerprint,
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
    INSERT INTO public.device_bans (
      device_id, nickname, user_agent, fingerprint, reason, banned_by
    )
    SELECT d.device_id, lower(p_nickname), d.user_agent, d.fingerprint,
           v_reason, v_admin_nickname
    FROM public.account_devices d
    WHERE d.nickname = lower(p_nickname)
    ON CONFLICT (device_id) DO UPDATE
      SET nickname = excluded.nickname,
          user_agent = coalesce(excluded.user_agent, public.device_bans.user_agent),
          fingerprint = coalesce(excluded.fingerprint, public.device_bans.fingerprint),
          reason = coalesce(excluded.reason, public.device_bans.reason),
          banned_by = excluded.banned_by
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM banned;

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
  fingerprint text,
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
  SELECT b.device_id, b.nickname, b.user_agent, b.fingerprint, b.reason,
         b.banned_by, b.created_at
  FROM public.device_bans b
  ORDER BY b.created_at DESC;
END;
$$;

revoke all on function public.admin_list_account_devices(text, text) from public;
revoke all on function public.admin_ban_account_devices(text, text, text) from public;
revoke all on function public.admin_list_device_bans(text) from public;

grant execute on function public.admin_list_account_devices(text, text) to anon, authenticated;
grant execute on function public.admin_ban_account_devices(text, text, text) to anon, authenticated;
grant execute on function public.admin_list_device_bans(text) to anon, authenticated;
