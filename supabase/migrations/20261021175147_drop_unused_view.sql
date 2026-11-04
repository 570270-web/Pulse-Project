/*
# Drop unused active_nicknames view

The active_nicknames view was flagged by the security advisor as a
SECURITY DEFINER view (it bypasses RLS on profiles). It is not used by
the frontend — check_nickname() handles nickname availability checks
instead. Dropping it eliminates the only ERROR-level advisor finding.
*/

DROP VIEW IF EXISTS public.active_nicknames;
