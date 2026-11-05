/*
# Add server-side message rate limit (60 per minute)

## Overview
The client already caps sending at 60 messages/minute, but that check is
client-side only and can be bypassed. This adds the same limit server-side
inside the `send_message` function so the database enforces it regardless
of how the request is made.

## Changes
- Drops and recreates `public.send_message` with a rate-limit check.
  Counts the caller's messages in the last 60 seconds; if >= 60 it raises
  `RATE_LIMIT_EXCEEDED:<seconds>` where <seconds> is how long until the
  oldest message in the window expires.
- No schema/table changes. No RLS/policy changes.
- Grants are re-applied to preserve EXECUTE on anon + authenticated.

## Behavior
- Limit: 60 messages per profile per rolling 60-second window.
- The error message format `RATE_LIMIT_EXCEEDED:<n>` is matched by the
  existing client error handler in `src/lib/rooms.ts`.
*/

DROP FUNCTION IF EXISTS public.send_message(text, text, uuid, uuid);

CREATE OR REPLACE FUNCTION public.send_message(
  p_token text,
  p_content text,
  p_room_id uuid DEFAULT NULL,
  p_reply_to_id uuid DEFAULT NULL
)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_member_count int;
  v_message public.messages%ROWTYPE;
  v_recent_count int;
  v_oldest_ts timestamptz;
  v_wait_secs int;
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

  INSERT INTO public.messages (profile_id, nickname, content, room_id, reply_to_id)
  VALUES (v_profile.id, v_profile.nickname, p_content, p_room_id, p_reply_to_id)
  RETURNING * INTO v_message;

  RETURN v_message;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.send_message(text, text, uuid, uuid) TO anon, authenticated;
