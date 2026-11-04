-- Drop functions whose return type or signature changes
DROP FUNCTION IF EXISTS public.leave_room(text, uuid);
DROP FUNCTION IF EXISTS public.list_admin_rooms(text);
DROP FUNCTION IF EXISTS public.list_public_rooms(text);
DROP FUNCTION IF EXISTS public.find_room_by_code(text, text);
DROP FUNCTION IF EXISTS public.list_my_rooms(text);
DROP FUNCTION IF EXISTS public.admin_list_room_requests(text);
DROP FUNCTION IF EXISTS public.list_my_room_requests(text);
DROP FUNCTION IF EXISTS public.send_message(text, text);
DROP FUNCTION IF EXISTS public.join_public_room(text, uuid);
DROP FUNCTION IF EXISTS public.join_restricted_room(text, uuid, text);
DROP FUNCTION IF EXISTS public.change_room_password(text, uuid, text);
