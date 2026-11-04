/*
# Admin account and management functions

## Overview
1. Registers the sys_admin account with password qazwsxedc1@3.
2. Adds `is_admin` boolean column to profiles (default false).
3. Adds admin-only SECURITY DEFINER functions:
   - list_all_profiles(): returns all profiles (id, nickname, last_active_at, created_at)
   - delete_profile(p_nickname): deletes a profile by nickname (cascade deletes sessions+messages)
   - check_is_admin(p_token): returns true if the session belongs to an admin
4. Grants execute to anon + authenticated.

## Security
- sys_admin is flagged is_admin = true.
- list_all_profiles and delete_profile are SECURITY DEFINER because they
  bypass RLS on profiles (which is locked down). These functions check
  is_admin via the session token before performing any action.
- check_is_admin lets the frontend determine if the logged-in user is an admin.
*/

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- Register sys_admin account (idempotent — if already exists, do nothing)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE nickname = 'sys_admin') THEN
    INSERT INTO public.profiles (nickname, password_hash, is_admin)
    VALUES ('sys_admin', extensions.crypt('qazwsxedc1@3', extensions.gen_salt('bf')), true);
  END IF;
END $$;

-- Check if session belongs to an admin
CREATE OR REPLACE FUNCTION public.check_is_admin(p_token text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT p.is_admin
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = $1;
$$;

-- List all profiles (admin only)
CREATE OR REPLACE FUNCTION public.list_all_profiles(p_token text)
RETURNS TABLE(id uuid, nickname text, last_active_at timestamptz, created_at timestamptz, is_admin boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_is_admin boolean;
BEGIN
  SELECT p.is_admin INTO v_is_admin
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;

  IF v_is_admin IS NULL OR v_is_admin = false THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  RETURN QUERY SELECT p.id, p.nickname, p.last_active_at, p.created_at, p.is_admin
  FROM public.profiles p
  ORDER BY p.created_at DESC;
END;
$$;

-- Delete a profile by nickname (admin only)
CREATE OR REPLACE FUNCTION public.delete_profile(p_token text, p_nickname text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_is_admin boolean;
BEGIN
  SELECT p.is_admin INTO v_is_admin
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = p_token;

  IF v_is_admin IS NULL OR v_is_admin = false THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  DELETE FROM public.profiles WHERE nickname = lower(p_nickname);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_is_admin(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_all_profiles(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_profile(text, text) TO anon, authenticated;
