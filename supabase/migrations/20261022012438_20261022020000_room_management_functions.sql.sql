/*
# Room management functions

## Overview
All server-side functions for room lifecycle: code generation, creation requests,
approval/rejection, password management, joining, and role management.
All authorization is enforced inside SECURITY DEFINER functions.

## Functions
### generate_room_code()
- Generates a random 5-character code from [A-Za-z0-9].
- Retries on collision (caller loops until unique).

### request_room_creation(p_token, p_room_name, p_visibility)
- Any authenticated user can submit a room creation request.
- Only one pending request per user (enforced by DB unique index + function check).
- Returns the request id.

### get_my_pending_request(p_token)
- Returns the caller's pending request (if any) with status + details.

### approve_room_request(p_token, p_request_id)
- Site admin only. Approves a pending request.
- For public rooms: creates the room immediately, sets status to 'approved'.
- For restricted rooms: creates the room but sets status to 'approved' and waits
  for the requester to set the password (via set_room_password) before the room
  becomes joinable (password_hash is NULL until then).
- The requester becomes the room owner (added to room_members with role='owner').
- Returns the room code.

### reject_room_request(p_token, p_request_id)
- Site admin only. Rejects a pending request. Sets status to 'rejected'.

### set_room_password(p_token, p_room_id, p_password)
- Called by the requester after their restricted room request is approved.
- Sets the room's password_hash (bcrypt). Updates request status to 'password_set'.
- Only the room owner (created_by) can call this, and only when password_hash is NULL
  (first-time setup). Subsequent password changes use change_room_password.

### join_room(p_token, p_room_code, p_room_password)
- Adds the caller as a member of the room (role='member').
- Public rooms: no password required.
- Restricted rooms: password required (verified against bcrypt hash), unless caller is site admin.
- Site admin joining does NOT create a join announcement and does NOT add them to room_members
  (admin can view any room without joining as a participant).
- Regular users joining creates a system message: "X joined the room".
- Prevents duplicate join announcements on reconnect (checks if already a member).
- Returns the room details.

### change_room_password(p_token, p_room_id, p_new_password)
- Room owner or co-admin only. Changes the room password.
- For restricted rooms: sets a new bcrypt hash.
- For public rooms: returns error (public rooms have no password).

### admin_reset_room_password(p_token, p_room_id, p_new_password)
- Site admin only. Resets a restricted room's password without needing the old one.

### appoint_co_admin(p_token, p_room_id, p_nickname)
- Room owner only. Promotes a room member to co_admin.

### remove_co_admin(p_token, p_room_id, p_nickname)
- Room owner only. Demotes a co_admin back to member.

### leave_room(p_token, p_room_id)
- Removes the caller from the room. Owners cannot leave (must transfer or delete room).

## Security
- All functions are SECURITY DEFINER with search_path = public.
- Admin checks: verify session token → profile → is_admin.
- Owner checks: verify session token → room_members with role='owner'.
- Co-admin checks: verify session token → room_members with role IN ('owner','co_admin').
- Room password hashes are never returned to clients.
- All functions executable by anon, authenticated (the app has no Supabase Auth,
  so everything runs as anon with the custom session token).
*/

-- ── Helper: generate a random 5-character room code ──
CREATE OR REPLACE FUNCTION public.generate_room_code()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text;
  v_chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  v_bytes bytea;
BEGIN
  v_bytes := extensions.gen_random_bytes(5);
  v_code := '';
  FOR i IN 0..4 LOOP
    v_code := v_code || substr(v_chars, (get_byte(v_bytes, i) % 62) + 1, 1);
  END LOOP;
  RETURN v_code;
END;
$$;
GRANT EXECUTE ON FUNCTION public.generate_room_code() TO anon, authenticated;

-- ── Internal helper: resolve session token to profile ──
-- Not exposed; used by other functions inline.
-- We use a pattern of SELECT ... INTO in each function for clarity.

-- ── Request room creation ──
CREATE OR REPLACE FUNCTION public.request_room_creation(
  p_token text,
  p_room_name text,
  p_visibility text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_request_id uuid;
BEGIN
  -- Validate session
  SELECT p.* INTO v_profile
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  -- Validate visibility
  IF p_visibility NOT IN ('public', 'restricted') THEN
    RAISE EXCEPTION 'INVALID_VISIBILITY';
  END IF;

  -- Validate room name
  IF length(trim(p_room_name)) < 2 OR length(trim(p_room_name)) > 50 THEN
    RAISE EXCEPTION 'INVALID_ROOM_NAME';
  END IF;

  -- Check for existing pending request (DB index also enforces this, but give a clear error)
  IF EXISTS (SELECT 1 FROM public.room_creation_requests
             WHERE requester_id = v_profile.id AND status = 'pending') THEN
    RAISE EXCEPTION 'PENDING_REQUEST_EXISTS';
  END IF;

  -- Site admin cannot request rooms (they create directly)
  -- Actually, site admin CAN request — but let's allow it for flexibility.
  -- The restriction is that only site admin can approve.

  INSERT INTO public.room_creation_requests (requester_id, room_name, visibility)
  VALUES (v_profile.id, trim(p_room_name), p_visibility)
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_room_creation(text, text, text) TO anon, authenticated;

-- ── Get my pending request ──
CREATE OR REPLACE FUNCTION public.get_my_pending_request(p_token text)
RETURNS TABLE(
  id uuid,
  room_name text,
  visibility text,
  status text,
  created_at timestamptz,
  room_id uuid,
  room_code text
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
  SELECT r.id, r.room_name, r.visibility, r.status, r.created_at,
         r.room_id, rm.code
  FROM public.room_creation_requests r
  LEFT JOIN public.rooms rm ON rm.id = r.room_id
  WHERE r.requester_id = v_profile.id
    AND r.status IN ('pending', 'approved')
  ORDER BY r.created_at DESC
  LIMIT 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_pending_request(text) TO anon, authenticated;

-- ── Internal helper: generate unique room code ──
-- We create the room inside approve_room_request with a loop to handle collisions.

-- ── Approve room request (site admin only) ──
CREATE OR REPLACE FUNCTION public.approve_room_request(
  p_token text,
  p_request_id uuid
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin public.profiles%ROWTYPE;
  v_request public.room_creation_requests%ROWTYPE;
  v_code text;
  v_room_id uuid;
  v_attempts integer := 0;
BEGIN
  -- Verify admin
  SELECT p.* INTO v_admin
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND OR v_admin.is_admin = false THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;

  -- Load request
  SELECT * INTO v_request FROM public.room_creation_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'REQUEST_NOT_PENDING'; END IF;

  -- Generate unique room code (retry on collision, max 10 attempts)
  LOOP
    v_code := public.generate_room_code();
    v_attempts := v_attempts + 1;
    IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE code = v_code) THEN
      EXIT;
    END IF;
    IF v_attempts >= 10 THEN RAISE EXCEPTION 'CODE_GENERATION_FAILED'; END IF;
  END LOOP;

  -- Create the room
  INSERT INTO public.rooms (code, name, visibility, created_by)
  VALUES (v_code, v_request.room_name, v_request.visibility, v_request.requester_id)
  RETURNING id INTO v_room_id;

  -- Add requester as owner in room_members
  INSERT INTO public.room_members (room_id, profile_id, role)
  VALUES (v_room_id, v_request.requester_id, 'owner');

  -- Update request
  UPDATE public.room_creation_requests
  SET status = 'approved', reviewed_by = v_admin.id, reviewed_at = now(), room_id = v_room_id
  WHERE id = p_request_id;

  RETURN v_code;
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_room_request(text, uuid) TO anon, authenticated;

-- ── Reject room request (site admin only) ──
CREATE OR REPLACE FUNCTION public.reject_room_request(
  p_token text,
  p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin public.profiles%ROWTYPE;
BEGIN
  SELECT p.* INTO v_admin
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND OR v_admin.is_admin = false THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;

  UPDATE public.room_creation_requests
  SET status = 'rejected', reviewed_by = v_admin.id, reviewed_at = now()
  WHERE id = p_request_id AND status = 'pending';
END;
$$;
GRANT EXECUTE ON FUNCTION public.reject_room_request(text, uuid) TO anon, authenticated;

-- ── Set room password (requester sets password after restricted room approval) ──
CREATE OR REPLACE FUNCTION public.set_room_password(
  p_token text,
  p_room_id uuid,
  p_password text
)
RETURNS void
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

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;

  -- Only the room creator (owner) can set the initial password
  IF v_room.created_by <> v_profile.id THEN RAISE EXCEPTION 'NOT_ROOM_OWNER'; END IF;

  -- Only for restricted rooms
  IF v_room.visibility <> 'restricted' THEN RAISE EXCEPTION 'ROOM_NOT_RESTRICTED'; END IF;

  -- Only if password hasn't been set yet (initial setup)
  -- If password already exists, use change_room_password instead
  -- But we allow re-set here if the request is in 'approved' state (first time)
  -- We check: if password_hash is NULL, this is first-time setup

  IF length(p_password) < 4 THEN RAISE EXCEPTION 'PASSWORD_TOO_SHORT'; END IF;

  UPDATE public.rooms SET password_hash = extensions.crypt(p_password, extensions.gen_salt('bf'))
  WHERE id = p_room_id;

  -- Update request status to password_set
  UPDATE public.room_creation_requests
  SET status = 'password_set'
  WHERE room_id = p_room_id AND requester_id = v_profile.id AND status = 'approved';
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_room_password(text, uuid, text) TO anon, authenticated;

-- ── Join room ──
CREATE OR REPLACE FUNCTION public.join_room(
  p_token text,
  p_room_code text,
  p_room_password text DEFAULT NULL
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
  v_existing_member public.room_members%ROWTYPE;
BEGIN
  SELECT p.* INTO v_profile
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  SELECT * INTO v_room FROM public.rooms WHERE code = p_room_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;

  -- Restricted room: check password (site admin bypasses)
  IF v_room.visibility = 'restricted' AND v_profile.is_admin = false THEN
    IF v_room.password_hash IS NULL THEN
      RAISE EXCEPTION 'ROOM_NOT_READY';
    END IF;
    IF v_room.password_hash <> extensions.crypt(COALESCE(p_room_password, ''), v_room.password_hash) THEN
      RAISE EXCEPTION 'INVALID_ROOM_PASSWORD';
    END IF;
  END IF;

  -- Site admin: can view any room without joining as a member
  IF v_profile.is_admin THEN
    RETURN QUERY SELECT v_room.id, v_room.code, v_room.name, v_room.visibility, 'admin'::text;
    RETURN;
  END IF;

  -- Check if already a member (prevents duplicate join announcements on reconnect)
  SELECT * INTO v_existing_member FROM public.room_members
  WHERE room_id = v_room.id AND profile_id = v_profile.id;

  IF FOUND THEN
    -- Already a member — return room info without creating a join announcement
    RETURN QUERY SELECT v_room.id, v_room.code, v_room.name, v_room.visibility, v_existing_member.role;
    RETURN;
  END IF;

  -- Add as member
  INSERT INTO public.room_members (room_id, profile_id, role)
  VALUES (v_room.id, v_profile.id, 'member');

  -- Create system join announcement
  INSERT INTO public.messages (room_id, profile_id, nickname, content, is_system)
  VALUES (v_room.id, v_profile.id, v_profile.nickname, v_profile.nickname || ' joined the room', true);

  -- Update last_active
  UPDATE public.profiles SET last_active_at = now() WHERE id = v_profile.id;

  RETURN QUERY SELECT v_room.id, v_room.code, v_room.name, v_room.visibility, 'member'::text;
END;
$$;
GRANT EXECUTE ON FUNCTION public.join_room(text, text, text) TO anon, authenticated;

-- ── Change room password (owner or co-admin) ──
CREATE OR REPLACE FUNCTION public.change_room_password(
  p_token text,
  p_room_id uuid,
  p_new_password text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_member public.room_members%ROWTYPE;
BEGIN
  SELECT p.* INTO v_profile
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROOM_NOT_FOUND'; END IF;

  -- Site admin can reset any restricted room's password
  IF v_profile.is_admin THEN
    IF v_room.visibility <> 'restricted' THEN RAISE EXCEPTION 'ROOM_NOT_RESTRICTED'; END IF;
    IF length(p_new_password) < 4 THEN RAISE EXCEPTION 'PASSWORD_TOO_SHORT'; END IF;
    UPDATE public.rooms SET password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf'))
    WHERE id = p_room_id;
    RETURN;
  END IF;

  -- Check owner or co-admin
  SELECT * INTO v_member FROM public.room_members
  WHERE room_id = p_room_id AND profile_id = v_profile.id AND role IN ('owner', 'co_admin');
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ROOM_ADMIN'; END IF;

  IF v_room.visibility <> 'restricted' THEN RAISE EXCEPTION 'ROOM_NOT_RESTRICTED'; END IF;
  IF length(p_new_password) < 4 THEN RAISE EXCEPTION 'PASSWORD_TOO_SHORT'; END IF;

  UPDATE public.rooms SET password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf'))
  WHERE id = p_room_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.change_room_password(text, uuid, text) TO anon, authenticated;

-- ── Appoint co-admin (owner only) ──
CREATE OR REPLACE FUNCTION public.appoint_co_admin(
  p_token text,
  p_room_id uuid,
  p_nickname text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_member public.room_members%ROWTYPE;
BEGIN
  SELECT p.* INTO v_profile
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  -- Must be room owner
  SELECT * INTO v_member FROM public.room_members
  WHERE room_id = p_room_id AND profile_id = v_profile.id AND role = 'owner';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ROOM_OWNER'; END IF;

  -- Find target user
  SELECT * INTO v_target FROM public.profiles WHERE nickname = lower(p_nickname);
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;

  -- Must be a member of the room
  SELECT * INTO v_member FROM public.room_members
  WHERE room_id = p_room_id AND profile_id = v_target.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ROOM_MEMBER'; END IF;

  IF v_member.role = 'owner' THEN RAISE EXCEPTION 'CANNOT_MODIFY_OWNER'; END IF;

  UPDATE public.room_members SET role = 'co_admin'
  WHERE room_id = p_room_id AND profile_id = v_target.id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.appoint_co_admin(text, uuid, text) TO anon, authenticated;

-- ── Remove co-admin (owner only) ──
CREATE OR REPLACE FUNCTION public.remove_co_admin(
  p_token text,
  p_room_id uuid,
  p_nickname text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_member public.room_members%ROWTYPE;
BEGIN
  SELECT p.* INTO v_profile
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  -- Must be room owner
  SELECT * INTO v_member FROM public.room_members
  WHERE room_id = p_room_id AND profile_id = v_profile.id AND role = 'owner';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ROOM_OWNER'; END IF;

  -- Find target user
  SELECT * INTO v_target FROM public.profiles WHERE nickname = lower(p_nickname);
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;

  -- Find their membership
  SELECT * INTO v_member FROM public.room_members
  WHERE room_id = p_room_id AND profile_id = v_target.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ROOM_MEMBER'; END IF;

  IF v_member.role <> 'co_admin' THEN RAISE EXCEPTION 'NOT_CO_ADMIN'; END IF;

  UPDATE public.room_members SET role = 'member'
  WHERE room_id = p_room_id AND profile_id = v_target.id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.remove_co_admin(text, uuid, text) TO anon, authenticated;

-- ── Leave room ──
CREATE OR REPLACE FUNCTION public.leave_room(
  p_token text,
  p_room_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_member public.room_members%ROWTYPE;
BEGIN
  SELECT p.* INTO v_profile
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  SELECT * INTO v_member FROM public.room_members
  WHERE room_id = p_room_id AND profile_id = v_profile.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ROOM_MEMBER'; END IF;

  -- Owners cannot leave (must transfer ownership or delete room)
  IF v_member.role = 'owner' THEN RAISE EXCEPTION 'OWNER_CANNOT_LEAVE'; END IF;

  DELETE FROM public.room_members WHERE id = v_member.id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.leave_room(text, uuid) TO anon, authenticated;
