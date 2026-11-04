/*
# Fix clear_all_messages — DELETE requires WHERE clause in PostgREST

PostgREST blocks bare `DELETE FROM table` (no WHERE) inside SECURITY DEFINER
functions. Adding `WHERE true` satisfies the requirement.
*/

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

  DELETE FROM public.messages WHERE true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_all_messages(text) TO anon, authenticated;
