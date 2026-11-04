/*
# Hub listing and admin request management functions

## Overview
Functions for the Hub page: listing joined rooms, finding rooms by code,
browsing public rooms, and admin management of room creation requests.
Also includes room detail and member listing functions.

## Functions
### get_joined_rooms(p_token)
- Returns rooms the caller has joined (via room_members), with their role in each.

### find_room_by_code(p_token, p_code)
- Exact 5-character code lookup. Returns room metadata (id, code, name, visibility).
- Returns whether the caller has already joined.
- Does NOT return password hashes.

### list_public_rooms(p_token)
- Returns all public rooms (visibility = 'public'), ordered by name.
- Does NOT return restricted rooms.

### get_room_details(p_token, p_room_id)
- Returns details for a specific room: code, name, visibility, and the caller's role
  (or 'none' / 'admin' if not a member). Site admin gets role='admin'.
- Does NOT return password hashes.

### list_room_members(p_token, p_room_id)
- Returns all members of a room with their nickname, role, and joined_at.
- Anyone can call this (room membership is public).

### list_all_room_requests(p_token)
- Site admin only. Returns all pending room creation requests with requester nickname.

### change_account_password(p_token, p_current_password, p_new_password)
- Any signed-in user can change their own account password.
- Verifies the current password first. Hashes the new password with bcrypt.

### admin_initiate_password_reset(p_token, p_nickname)
- Site admin only. Generates a new temporary password for the user, sets it as their
  password hash, and returns the temporary password so the admin can relay it.
- This is a server-side reset — the admin doesn't see the old password.

## Security
- All functions SECURITY DEFINER, search_path = public.
- Password hashes never returned.
- Admin-only functions check is_admin via session token.
*/

-- ── Get joined rooms ──
CREATE OR REPLACE FUNCTION public.get_joined_rooms(p_token text)
RETURNS TABLE(
  room_id uuid,
  code text,
  name text,
  visibility text,
  role text,
  joined_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT p.* INTO v_profile
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  RETURN QUERY
  SELECT r.id, r.code, r.name, r.visibility, m.role, m.joined_at
  FROM public.room_members m
  JOIN public.rooms r ON r.id = m.room_id
  WHERE m.profile_id = v_profile.id
  ORDER BY m.joined_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_joined_rooms(text) TO anon, authenticated;

-- ── Find room by exact code ──
CREATE OR REPLACE FUNCTION public.find_room_by_code(
  p_token text,
  p_code text
)
RETURNS TABLE(
  id uuid,
  code text,
  name text,
  visibility text,
  already_joined boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_room public.rooms%ROWTYPE;
BEGIN
  SELECT p.* INTO v_profile
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  SELECT * INTO v_room FROM public.rooms WHERE code = p_code;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT v_room.id, v_room.code, v_room.name, v_room.visibility,
         EXISTS(SELECT 1 FROM public.room_members WHERE room_id = v_room.id AND profile_id = v_profile.id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.find_room_by_code(text, text) TO anon, authenticated;

-- ── List public rooms ──
CREATE OR REPLACE FUNCTION public.list_public_rooms(p_token text)
RETURNS TABLE(
  id uuid,
  code text,
  name text,
  already_joined boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT p.* INTO v_profile
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  RETURN QUERY
  SELECT r.id, r.code, r.name,
         EXISTS(SELECT 1 FROM public.room_members WHERE room_id = r.id AND profile_id = v_profile.id)
  FROM public.rooms r
  WHERE r.visibility = 'public'
    AND r.password_hash IS NULL OR (r.visibility = 'public')
  ORDER BY r.name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_public_rooms(text) TO anon, authenticated;

-- ── Get room details ──
CREATE OR REPLACE FUNCTION public.get_room_details(
  p_token text,
  p_room_id uuid
)
RETURNS TABLE(
  id uuid,
  code text,
  name text,
  visibility text,
  role text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_member public.room_members%ROWTYPE;
  v_role text;
BEGIN
  SELECT p.* INTO v_profile
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;

  IF v_profile.is_admin THEN
    v_role := 'admin';
  ELSE
    SELECT * INTO v_member FROM public.room_members
    WHERE room_id = p_room_id AND profile_id = v_profile.id;
    v_role := COALESCE(v_member.role, 'none');
  END IF;

  RETURN QUERY SELECT v_room.id, v_room.code, v_room.name, v_room.visibility, v_role;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_room_details(text, uuid) TO anon, authenticated;

-- ── List room members ──
CREATE OR REPLACE FUNCTION public.list_room_members(
  p_token text,
  p_room_id uuid
)
RETURNS TABLE(
  nickname text,
  role text,
  joined_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT p.* INTO v_profile
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  RETURN QUERY
  SELECT p.nickname, m.role, m.joined_at
  FROM public.room_members m
  JOIN public.profiles p ON p.id = m.profile_id
  WHERE m.room_id = p_room_id
  ORDER BY
    CASE m.role WHEN 'owner' THEN 0 WHEN 'co_admin' THEN 1 ELSE 2 END,
    m.joined_at;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_room_members(text, uuid) TO anon, authenticated;

-- ── Admin: list all pending room creation requests ──
CREATE OR REPLACE FUNCTION public.list_all_room_requests(p_token text)
RETURNS TABLE(
  id uuid,
  requester_nickname text,
  room_name text,
  visibility text,
  status text,
  created_at timestamptz,
  room_id uuid,
  room_code text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin public.profiles%ROWTYPE;
BEGIN
  SELECT p.* INTO v_admin
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND OR v_admin.is_admin = false THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;

  RETURN QUERY
  SELECT r.id, p.nickname, r.room_name, r.visibility, r.status, r.created_at,
         r.room_id, rm.code
  FROM public.room_creation_requests r
  JOIN public.profiles p ON p.id = r.requester_id
  LEFT JOIN public.rooms rm ON rm.id = r.room_id
  WHERE r.status IN ('pending', 'approved')
  ORDER BY r.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_all_room_requests(text) TO anon, authenticated;

-- ── Change account password (self-service) ──
CREATE OR REPLACE FUNCTION public.change_account_password(
  p_token text,
  p_current_password text,
  p_new_password text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT p.* INTO v_profile
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  -- Verify current password
  IF v_profile.password_hash <> extensions.crypt(p_current_password, v_profile.password_hash) THEN
    RAISE EXCEPTION 'INVALID_PASSWORD';
  END IF;

  IF length(p_new_password) < 4 THEN RAISE EXCEPTION 'PASSWORD_TOO_SHORT'; END IF;

  UPDATE public.profiles
  SET password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf'))
  WHERE id = v_profile.id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.change_account_password(text, text, text) TO anon, authenticated;

-- ── Admin: initiate password reset for a user ──
CREATE OR REPLACE FUNCTION public.admin_initiate_password_reset(
  p_token text,
  p_nickname text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_temp_password text;
  v_bytes bytea;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  i integer;
BEGIN
  SELECT p.* INTO v_admin
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND OR v_admin.is_admin = false THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;

  SELECT * INTO v_target FROM public.profiles WHERE nickname = lower(p_nickname);
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;

  -- Generate a random 12-character temporary password
  v_bytes := extensions.gen_random_bytes(12);
  v_temp_password := '';
  FOR i IN 0..11 LOOP
    v_temp_password := v_temp_password || substr(v_chars, (get_byte(v_bytes, i) % length(v_chars)) + 1, 1);
  END LOOP;

  UPDATE public.profiles
  SET password_hash = extensions.crypt(v_temp_password, extensions.gen_salt('bf'))
  WHERE id = v_target.id;

  RETURN v_temp_password;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_initiate_password_reset(text, text) TO anon, authenticated;
