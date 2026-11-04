/*
# Real-time chat with Tetrio-style nickname auth

## Overview
Creates a shared real-time chat with custom nickname-based authentication.
Nicknames are password-protected. A nickname inactive for 6 months is
automatically released so someone else can claim it.

## New Tables
### profiles
- id (uuid, PK), nickname (text, unique, lowercase), password_hash (bcrypt),
  last_active_at, created_at
### sessions
- token (text, PK), profile_id (FK), created_at, last_used_at
### messages
- id (uuid, PK), profile_id (FK), nickname, content, created_at

## View
- active_nicknames — public, exposes only nickname + last_active_at for active
  profiles (no password hashes)

## Security
- RLS on all tables. messages: public SELECT. profiles/sessions: no direct
  access (locked). All auth + messaging via SECURITY DEFINER functions with
  search_path = public. View runs as owner so it bypasses profiles RLS to
  expose only safe columns.

## Functions
- check_nickname, register_nickname, login_nickname, send_message,
  get_session_profile, logout, cleanup_expired_nicknames
*/

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profiles_last_active ON public.profiles(last_active_at);

CREATE TABLE IF NOT EXISTS public.sessions (
  token text PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_profile ON public.sessions(profile_id);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  nickname text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON public.messages(created_at DESC);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_messages" ON public.messages;
CREATE POLICY "anon_read_messages" ON public.messages FOR SELECT
  TO anon, authenticated USING (true);

CREATE OR REPLACE VIEW public.active_nicknames AS
  SELECT nickname, last_active_at
  FROM public.profiles
  WHERE last_active_at > now() - interval '6 months';

GRANT SELECT ON public.active_nicknames TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.cleanup_expired_nicknames()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.profiles WHERE last_active_at < now() - interval '6 months';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_nickname(p_nickname text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.cleanup_expired_nicknames();
  RETURN EXISTS (SELECT 1 FROM public.profiles WHERE nickname = lower(p_nickname));
END;
$$;

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
  VALUES (lower(p_nickname), crypt(p_password, gen_salt('bf')))
  RETURNING id INTO v_id;
  v_token := encode(gen_random_bytes(32), 'hex');
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
  IF v_profile.password_hash <> crypt(p_password, v_profile.password_hash) THEN
    RAISE EXCEPTION 'INVALID_PASSWORD';
  END IF;
  UPDATE public.profiles SET last_active_at = now() WHERE id = v_profile.id;
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.sessions (token, profile_id) VALUES (v_token, v_profile.id);
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_message(p_token text, p_content text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT p.* INTO v_profile
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  UPDATE public.profiles SET last_active_at = now() WHERE id = v_profile.id;
  UPDATE public.sessions SET last_used_at = now() WHERE token = p_token;
  INSERT INTO public.messages (profile_id, nickname, content)
  VALUES (v_profile.id, v_profile.nickname, p_content);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_session_profile(p_token text)
RETURNS TABLE(nickname text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT p.nickname FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id WHERE s.token = $1;
$$;

CREATE OR REPLACE FUNCTION public.logout(p_token text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.sessions WHERE token = $1;
$$;

GRANT EXECUTE ON FUNCTION public.check_nickname(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_nickname(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_nickname(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_message(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_profile(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logout(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_nicknames() TO anon, authenticated;
