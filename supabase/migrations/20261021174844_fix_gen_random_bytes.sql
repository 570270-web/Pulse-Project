/*
# Fix gen_random_bytes references

gen_random_bytes() is in the extensions schema. Updated functions to call
extensions.gen_random_bytes explicitly.
*/

CREATE OR REPLACE FUNCTION public.register_nickname(p_nickname text, p_password text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_token text;
BEGIN
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
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.login_nickname(p_nickname text, p_password text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_profile public.profiles%ROWTYPE; v_token text;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE nickname = lower(p_nickname);
  IF NOT FOUND THEN RAISE EXCEPTION 'NICKNAME_NOT_FOUND'; END IF;
  IF v_profile.password_hash <> extensions.crypt(p_password, v_profile.password_hash) THEN
    RAISE EXCEPTION 'INVALID_PASSWORD';
  END IF;
  UPDATE public.profiles SET last_active_at = now() WHERE id = v_profile.id;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.sessions (token, profile_id) VALUES (v_token, v_profile.id);
  RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_nickname(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_nickname(text, text) TO anon, authenticated;
