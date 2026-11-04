/*
# Fix check_is_admin return format + add clear_all_messages

## Problem
check_is_admin() returns a scalar boolean, but via PostgREST RPC the anon
client sometimes receives it as null or in an unexpected wrapper. Changing
it to return a TABLE with a single boolean column makes the return format
consistent and reliably parseable.

## Changes
1. check_is_admin: DROP + recreate as RETURNS TABLE(is_admin boolean).
2. New function clear_all_messages(p_token): admin-only, deletes all rows
   from the messages table.
*/

DROP FUNCTION IF EXISTS public.check_is_admin(text);

CREATE FUNCTION public.check_is_admin(p_token text)
RETURNS TABLE(is_admin boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT p.is_admin
  FROM public.profiles p
  JOIN public.sessions s ON s.profile_id = p.id
  WHERE s.token = $1;
$$;

CREATE OR REPLACE FUNCTION public.clear_all_messages(p_token text)
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

  DELETE FROM public.messages;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_is_admin(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_all_messages(text) TO anon, authenticated;
