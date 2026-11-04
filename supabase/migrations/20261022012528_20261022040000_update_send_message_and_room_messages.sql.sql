/*
# Update send_message for rooms, replies, and admin block

## Overview
Modifies send_message to:
1. Support room-scoped messages (p_room_id parameter).
2. Support reply-to (p_reply_to_id parameter).
3. Block site admin from sending chat messages.

Also adds:
- get_room_messages(p_token, p_room_id): paginated room message retrieval with reply preview.
- delete_message(p_token, p_message_id): soft-delete by original author or admin.
- get_room_messages_for_admin(p_token, p_room_id): same as get_room_messages but for admin
  who isn't a room member.

## Changes to send_message
- New signature: send_message(p_token, p_content, p_room_id uuid DEFAULT NULL, p_reply_to_id uuid DEFAULT NULL)
- If p_room_id is provided, the caller must be a member of that room (not admin).
- If p_room_id is NULL, behaves as before (legacy global chat — kept for backward compat).
- If caller is site admin, raises ADMIN_CANNOT_SEND_MESSAGES.
- If p_reply_to_id is provided, verifies the replied-to message exists in the same room
  (or both are in the global chat if room_id is NULL).

## Security
- Site admin blocked from sending at the database function level.
- Room membership verified before allowing room messages.
- Reply target validated to be in the same context.
*/

-- ── Drop old send_message and recreate with new params ──
DROP FUNCTION IF EXISTS public.send_message(text, text);

CREATE OR REPLACE FUNCTION public.send_message(
  p_token text,
  p_content text,
  p_room_id uuid DEFAULT NULL,
  p_reply_to_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_member public.room_members%ROWTYPE;
  v_reply_msg public.messages%ROWTYPE;
BEGIN
  SELECT p.* INTO v_profile
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  -- Block site admin from sending messages
  IF v_profile.is_admin THEN RAISE EXCEPTION 'ADMIN_CANNOT_SEND_MESSAGES'; END IF;

  -- Validate content
  IF length(trim(p_content)) = 0 THEN RAISE EXCEPTION 'EMPTY_MESSAGE'; END IF;
  IF length(p_content) > 500 THEN RAISE EXCEPTION 'MESSAGE_TOO_LONG'; END IF;

  -- If room-scoped, verify membership
  IF p_room_id IS NOT NULL THEN
    SELECT * INTO v_member FROM public.room_members
    WHERE room_id = p_room_id AND profile_id = v_profile.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_ROOM_MEMBER'; END IF;
  END IF;

  -- If reply, verify the replied-to message exists in the same context
  IF p_reply_to_id IS NOT NULL THEN
    SELECT * INTO v_reply_msg FROM public.messages WHERE id = p_reply_to_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'REPLY_TARGET_NOT_FOUND'; END IF;
    -- Must be in the same room (or both global)
    IF COALESCE(v_reply_msg.room_id, '00000000-0000-0000-0000-000000000000'::uuid)
       <> COALESCE(p_room_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      RAISE EXCEPTION 'REPLY_TARGET_WRONG_ROOM';
    END IF;
  END IF;

  -- Update last_active
  UPDATE public.profiles SET last_active_at = now() WHERE id = v_profile.id;
  UPDATE public.sessions SET last_used_at = now() WHERE token = p_token;

  INSERT INTO public.messages (profile_id, nickname, content, room_id, reply_to_id)
  VALUES (v_profile.id, v_profile.nickname, trim(p_content), p_room_id, p_reply_to_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_message(text, text, uuid, uuid) TO anon, authenticated;

-- ── Get room messages (paginated, with reply preview) ──
CREATE OR REPLACE FUNCTION public.get_room_messages(
  p_token text,
  p_room_id uuid,
  p_before timestamp with time zone DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  id uuid,
  nickname text,
  content text,
  created_at timestamptz,
  is_system boolean,
  deleted boolean,
  reply_to_id uuid,
  reply_to_nickname text,
  reply_to_content text,
  reply_to_deleted boolean
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

  -- Admin can view any room; regular users must be a member
  IF NOT v_profile.is_admin THEN
    IF NOT EXISTS (SELECT 1 FROM public.room_members WHERE room_id = p_room_id AND profile_id = v_profile.id) THEN
      RAISE EXCEPTION 'NOT_ROOM_MEMBER';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.nickname,
    CASE WHEN m.deleted THEN '' ELSE m.content END,
    m.created_at,
    m.is_system,
    m.deleted,
    m.reply_to_id,
    rm.nickname,
    CASE WHEN rm.deleted THEN '' ELSE left(rm.content, 100) END,
    COALESCE(rm.deleted, false)
  FROM public.messages m
  LEFT JOIN public.messages rm ON rm.id = m.reply_to_id
  WHERE m.room_id = p_room_id
    AND (p_before IS NULL OR m.created_at < p_before)
  ORDER BY m.created_at DESC
  LIMIT LEAST(p_limit, 100);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_room_messages(text, uuid, timestamptz, integer) TO anon, authenticated;

-- ── Delete message (soft-delete by author or admin) ──
CREATE OR REPLACE FUNCTION public.delete_message(
  p_token text,
  p_message_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_msg public.messages%ROWTYPE;
BEGIN
  SELECT p.* INTO v_profile
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

  SELECT * INTO v_msg FROM public.messages WHERE id = p_message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MESSAGE_NOT_FOUND'; END IF;

  -- Admin can delete any message; otherwise only the author
  IF v_profile.is_admin THEN
    -- admin can delete
  ELSIF v_msg.profile_id <> v_profile.id THEN
    RAISE EXCEPTION 'NOT_MESSAGE_AUTHOR';
  END IF;

  -- Don't allow deleting system messages
  IF v_msg.is_system THEN RAISE EXCEPTION 'CANNOT_DELETE_SYSTEM_MESSAGE'; END IF;

  UPDATE public.messages SET deleted = true, content = '' WHERE id = p_message_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_message(text, uuid) TO anon, authenticated;
