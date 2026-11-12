/*
# Remove the browser fingerprint from device bans

The fingerprint (user agent, screen, canvas/WebGL, ...) was too coarse: every
PC in a school lab hashes the same, and the "3+ accounts share it" escape
hatch can be gamed by creating accounts. It was also prone to false positives,
so it is removed entirely.

What stays:
- `device_id` (localStorage + cookie, sent as `x-pulse-device`) is still the
  ban key.
- Admin accounts still bypass device bans (`login_nickname`,
  `get_session_profile`).
- Device list / ban list RPCs no longer return a fingerprint.

The fingerprint columns, index, helper functions and the header check go away;
no bans existed at the time of the change.
*/

drop function if exists public.admin_list_account_devices(text, text);
drop function if exists public.admin_list_device_bans(text);

alter table public.account_devices drop column if exists fingerprint;
alter table public.device_bans drop column if exists fingerprint;
drop index if exists public.idx_account_devices_fingerprint;

drop function if exists public.pulse_fingerprint_blocked(text);
drop function if exists public.pulse_client_fingerprint();

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

  SELECT * INTO v_profile FROM public.profiles WHERE nickname = lower(p_nickname);
  IF NOT FOUND THEN RAISE EXCEPTION 'NICKNAME_NOT_FOUND'; END IF;
  IF v_profile.password_hash <> extensions.crypt(p_password, v_profile.password_hash) THEN
    RAISE EXCEPTION 'INVALID_PASSWORD';
  END IF;

  -- 사이트 관리자는 기기 밴과 무관하게 로그인할 수 있다
  IF v_profile.is_admin IS NOT TRUE
     AND public.pulse_is_device_banned(v_device) THEN
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
DECLARE v_nickname text; v_is_admin boolean; v_device text;
BEGIN
  v_device := public.pulse_client_device();

  SELECT p.nickname, p.is_admin INTO v_nickname, v_is_admin
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;

  IF v_nickname IS NULL THEN
    RETURN;
  END IF;

  IF v_is_admin IS NOT TRUE
     AND public.pulse_is_device_banned(v_device) THEN
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

revoke all on function public.admin_list_account_devices(text, text) from public;
revoke all on function public.admin_ban_account_devices(text, text, text) from public;
revoke all on function public.admin_list_device_bans(text) from public;

grant execute on function public.admin_list_account_devices(text, text) to anon, authenticated;
grant execute on function public.admin_ban_account_devices(text, text, text) to anon, authenticated;
grant execute on function public.admin_list_device_bans(text) to anon, authenticated;
