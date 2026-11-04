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
